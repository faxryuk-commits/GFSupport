import OpenAI from 'openai'
import { getRequestOrgId } from '../lib/org.js'
import { getSQL, getOpenAIKey, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
  regions: ['iad1'],
  maxDuration: 60,
}

// Максимум кластеров за один запуск, чтобы уложиться в окно edge-функции
const MAX_CLUSTERS = 5
// Таймаут на один вызов LLM, сек
const LLM_TIMEOUT_MS = 18_000

/**
 * GET  /api/support/analytics/root-cause-analysis?period=7d&market=...
 *   → возвращает последний кэш, не генерирует.
 * POST /api/support/analytics/root-cause-analysis
 *   body: { period: '7d'|'30d'|'90d', market?, force?: boolean }
 *   → строит кластеры по AI-категориям клиентских сообщений,
 *     для каждого крупного кластера вызывает LLM и возвращает структурированные
 *     корневые причины + рекомендации.
 */

const NOISE_CATEGORIES = ['unknown', 'other', 'general', 'noise', 'small_talk', 'greeting', 'closing', 'information', 'none', '']

const SYSTEM_PROMPT = `Ты — старший аналитик службы поддержки Delever, платформы для ресторанов и доставки в Узбекистане и Казахстане.
Ты свободно понимаешь русский, узбекский (латиница и кириллица), английский.

Тебе дадут пачку реальных обращений клиентов по одной теме. Твоя задача — НЕ пересказать симптомы, а найти одну корневую причину, которая объединяет большинство сообщений.

Правила:
- "rootCause" — одной короткой фразой, без воды. Это не симптом ("чеки не печатаются"), а источник ("интеграция с iiko перестала отдавать заказы после обновления"). Если в сообщениях явно не хватает данных — так и скажи ("недостаточно данных: нужны логи интеграции X").
- "whatBreaks" — что реально ломается у клиента, как он это видит. 2–3 предложения.
- "whyItHappens" — твоя гипотеза, почему это происходит системно. Если не уверен — пометь как гипотезу.
- "severity": critical (теряется выручка / блокирует продажи), high (клиенты готовы уйти или много потерь времени), medium (раздражает, но работа идёт), low (мелочь / вопрос процесса).
- "affectedCount" — сколько из приведённых примеров реально попадают под эту причину (1..N).
- "fixSteps" — 2–4 конкретных шага, что именно сделать. В поле "owner": support | dev | product | ops | sales. Никаких "разобраться" — только конкретика.
- "tags" — 2–4 ключевых тега для поиска (интеграция-iiko, печать-чеков, скидки-бонусы и т.п.).
- Если сообщений слишком мало или они слишком разные для одной причины — честно укажи это в "rootCause" и поставь severity: low.

Отвечай СТРОГО JSON без markdown блоков, одной строкой или многострочно:
{
  "rootCause": string,
  "whatBreaks": string,
  "whyItHappens": string,
  "severity": "critical" | "high" | "medium" | "low",
  "affectedCount": number,
  "fixSteps": [{"step": string, "owner": string}],
  "tags": [string]
}`

interface ClusterSample {
  id: string
  channelId: string | null
  channelName: string
  text: string
  createdAt: string
  urgency: number
  sentiment: string | null
}

interface Cluster {
  key: string
  label: string
  messages: number
  cases: number
  channels: { id: string; name: string; count: number }[]
  samples: ClusterSample[]
}

interface RCAResult {
  clusterKey: string
  clusterLabel: string
  sampleCount: number
  rootCause: string
  whatBreaks: string
  whyItHappens: string
  severity: string
  affectedCount: number
  fixSteps: { step: string; owner: string }[]
  tags: string[]
  affectedChannels: { id: string; name: string; count: number }[]
  exampleMessageIds: string[]
  generatedAt: string
  model: string
}

function periodDays(p: string): number {
  return p === '30d' ? 30 : p === '90d' ? 90 : 7
}

function pickSamples(samples: ClusterSample[], limit = 12): ClusterSample[] {
  // Распределяем примеры: половина — по urgency/негативу, другая — свежие разнообразные каналы
  const byUrgency = [...samples].sort((a, b) => b.urgency - a.urgency).slice(0, Math.ceil(limit / 2))
  const rest = samples.filter((s) => !byUrgency.some((u) => u.id === s.id))
  const seenChannels = new Set(byUrgency.map((s) => s.channelId))
  const diverse: ClusterSample[] = []
  for (const s of rest) {
    if (diverse.length >= limit - byUrgency.length) break
    if (!seenChannels.has(s.channelId)) {
      diverse.push(s)
      seenChannels.add(s.channelId)
    }
  }
  // Если не хватает разнообразия — добираем по свежести
  for (const s of rest) {
    if (diverse.length >= limit - byUrgency.length) break
    if (!diverse.includes(s)) diverse.push(s)
  }
  return [...byUrgency, ...diverse].slice(0, limit)
}

async function loadClusters(
  sql: any,
  orgId: string,
  fromDate: string,
  toDate: string,
  market: string | null,
): Promise<Cluster[]> {
  const rows: any[] = await sql`
    SELECT
      LOWER(ai_category) as cluster_key,
      COUNT(*)::int as messages,
      COUNT(DISTINCT case_id) FILTER (WHERE case_id IS NOT NULL)::int as cases
    FROM support_messages
    WHERE org_id = ${orgId}
      AND is_from_client = true
      AND ai_category IS NOT NULL AND ai_category <> ''
      AND LOWER(ai_category) <> ALL(${NOISE_CATEGORIES}::text[])
      AND created_at >= ${fromDate}::timestamptz AND created_at < ${toDate}::timestamptz
    GROUP BY LOWER(ai_category)
    HAVING COUNT(*) >= 5
    ORDER BY messages DESC
    LIMIT ${MAX_CLUSTERS}
  `

  if (rows.length === 0) return []

  // Грузим примеры по всем кластерам одним JOIN-запросом, чтобы избежать N+1 и ускорить edge-функцию
  const keys = rows.map((r: any) => r.cluster_key)
  const sampleRows: any[] = await sql`
    SELECT * FROM (
      SELECT
        LOWER(m.ai_category) as cluster_key,
        m.id, m.channel_id, ch.name as channel_name,
        COALESCE(NULLIF(m.ai_summary, ''), NULLIF(m.text_content, ''), NULLIF(m.transcript, '')) as text,
        m.created_at, COALESCE(m.ai_urgency, 0) as urgency, m.ai_sentiment,
        ROW_NUMBER() OVER (
          PARTITION BY LOWER(m.ai_category)
          ORDER BY COALESCE(m.ai_urgency, 0) DESC, m.created_at DESC
        ) as rn
      FROM support_messages m
      LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = ${orgId}
      WHERE m.org_id = ${orgId}
        AND m.is_from_client = true
        AND LOWER(m.ai_category) = ANY(${keys}::text[])
        AND m.created_at >= ${fromDate}::timestamptz AND m.created_at < ${toDate}::timestamptz
        AND (${market}::text IS NULL OR ch.market_id = ${market})
    ) t
    WHERE rn <= 30
  `

  const byCluster = new Map<string, any[]>()
  for (const r of sampleRows) {
    const key = r.cluster_key
    if (!byCluster.has(key)) byCluster.set(key, [])
    byCluster.get(key)!.push(r)
  }

  const clusters: Cluster[] = []
  for (const row of rows) {
    const key: string = row.cluster_key
    const sRows = byCluster.get(key) || []

    const samples: ClusterSample[] = sRows
      .map((r) => ({
        id: String(r.id),
        channelId: r.channel_id || null,
        channelName: r.channel_name || 'Канал',
        text: (r.text || '').slice(0, 400),
        createdAt: r.created_at,
        urgency: parseInt(r.urgency || 0),
        sentiment: r.ai_sentiment || null,
      }))
      .filter((s) => s.text.length >= 10)

    if (samples.length < 3) continue

    const byChannel = new Map<string, { id: string; name: string; count: number }>()
    for (const s of samples) {
      if (!s.channelId) continue
      const prev = byChannel.get(s.channelId)
      if (prev) prev.count++
      else byChannel.set(s.channelId, { id: s.channelId, name: s.channelName, count: 1 })
    }

    clusters.push({
      key,
      label: key,
      messages: parseInt(row.messages || 0),
      cases: parseInt(row.cases || 0),
      channels: Array.from(byChannel.values()).sort((a, b) => b.count - a.count).slice(0, 5),
      samples,
    })
  }
  return clusters
}

async function analyzeCluster(openai: OpenAI, model: string, cluster: Cluster): Promise<RCAResult | null> {
  const chosen = pickSamples(cluster.samples, 10)
  const numbered = chosen
    .map((s, i) => `[${i + 1}] ${s.channelName} | u=${s.urgency}${s.sentiment ? ` | ${s.sentiment}` : ''} | ${s.text.replace(/\s+/g, ' ').trim()}`)
    .join('\n')

  const userPrompt = `Тема: «${cluster.label}». Сообщений за период: ${cluster.messages}.

${chosen.length} примеров:
${numbered}

Сформулируй корневую причину строго по схеме JSON.`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const completion = await openai.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 450,
        response_format: { type: 'json_object' },
      },
      { signal: controller.signal as any },
    )

    const content = completion.choices[0]?.message?.content || ''
    const parsed = JSON.parse(content) as Partial<RCAResult> & { fixSteps?: any[] }

    const fix = Array.isArray(parsed.fixSteps)
      ? parsed.fixSteps.map((s: any) => ({ step: String(s?.step || '').trim(), owner: String(s?.owner || 'support').trim() })).filter((s) => s.step)
      : []
    const tags = Array.isArray(parsed.tags) ? parsed.tags.map((t: any) => String(t)).slice(0, 6) : []
    const severity = ['critical', 'high', 'medium', 'low'].includes(String(parsed.severity || '').toLowerCase())
      ? String(parsed.severity).toLowerCase()
      : 'medium'

    return {
      clusterKey: cluster.key,
      clusterLabel: cluster.label,
      sampleCount: chosen.length,
      rootCause: String(parsed.rootCause || '').trim() || 'Не удалось определить',
      whatBreaks: String(parsed.whatBreaks || '').trim(),
      whyItHappens: String(parsed.whyItHappens || '').trim(),
      severity,
      affectedCount: Math.max(0, parseInt(String(parsed.affectedCount || 0), 10) || 0),
      fixSteps: fix,
      tags,
      affectedChannels: cluster.channels,
      exampleMessageIds: chosen.map((s) => s.id),
      generatedAt: new Date().toISOString(),
      model,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[RCA] analyze error for cluster', cluster.key, msg)
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function saveAnalysis(
  sql: any,
  orgId: string,
  periodKey: string,
  market: string | null,
  results: RCAResult[],
) {
  try {
    await sql`DELETE FROM support_root_cause_analysis WHERE org_id = ${orgId} AND period_key = ${periodKey}`
  } catch (e) {
    // ignore
  }
  for (const r of results) {
    const id = `rca_${orgId}_${periodKey}_${r.clusterKey}_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60)
    try {
      await sql`
        INSERT INTO support_root_cause_analysis (
          id, org_id, market_id, period_key, cluster_key, cluster_label,
          sample_count, root_cause, what_breaks, why_it_happens,
          severity, affected_count, fix_steps, tags, affected_channels,
          example_message_ids, model, generated_at
        ) VALUES (
          ${id}, ${orgId}, ${market}, ${periodKey}, ${r.clusterKey}, ${r.clusterLabel},
          ${r.sampleCount}, ${r.rootCause}, ${r.whatBreaks}, ${r.whyItHappens},
          ${r.severity}, ${r.affectedCount}, ${JSON.stringify(r.fixSteps)}::jsonb,
          ${JSON.stringify(r.tags)}::jsonb, ${JSON.stringify(r.affectedChannels)}::jsonb,
          ${JSON.stringify(r.exampleMessageIds)}::jsonb, ${r.model}, ${r.generatedAt}::timestamptz
        )
      `
    } catch (e) {
      console.error('[RCA] save error', e instanceof Error ? e.message : e)
    }
  }
}

async function loadCached(sql: any, orgId: string, periodKey: string): Promise<{ results: RCAResult[]; generatedAt: string | null }> {
  try {
    const rows: any[] = await sql`
      SELECT * FROM support_root_cause_analysis
      WHERE org_id = ${orgId} AND period_key = ${periodKey}
      ORDER BY severity_rank(severity) DESC, affected_count DESC
    `
    return buildCached(rows)
  } catch {
    // fallback without severity_rank func (не определена в БД): читаем и сортируем в JS
    try {
      const rows: any[] = await sql`
        SELECT * FROM support_root_cause_analysis
        WHERE org_id = ${orgId} AND period_key = ${periodKey}
        ORDER BY generated_at DESC
      `
      return buildCached(rows)
    } catch {
      return { results: [], generatedAt: null }
    }
  }
}

function buildCached(rows: any[]): { results: RCAResult[]; generatedAt: string | null } {
  if (!rows.length) return { results: [], generatedAt: null }
  const results: RCAResult[] = rows.map((r) => ({
    clusterKey: r.cluster_key,
    clusterLabel: r.cluster_label || r.cluster_key,
    sampleCount: parseInt(r.sample_count || 0),
    rootCause: r.root_cause || '',
    whatBreaks: r.what_breaks || '',
    whyItHappens: r.why_it_happens || '',
    severity: r.severity || 'medium',
    affectedCount: parseInt(r.affected_count || 0),
    fixSteps: Array.isArray(r.fix_steps) ? r.fix_steps : [],
    tags: Array.isArray(r.tags) ? r.tags : [],
    affectedChannels: Array.isArray(r.affected_channels) ? r.affected_channels : [],
    exampleMessageIds: Array.isArray(r.example_message_ids) ? r.example_message_ids : [],
    generatedAt: r.generated_at,
    model: r.model || 'gpt-4o-mini',
  }))
  const sevRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
  results.sort((a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0) || b.affectedCount - a.affectedCount)
  const generatedAt = rows
    .map((r) => (r.generated_at ? new Date(r.generated_at).getTime() : 0))
    .reduce((m, t) => (t > m ? t : m), 0)
  return { results, generatedAt: generatedAt ? new Date(generatedAt).toISOString() : null }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const orgId = await getRequestOrgId(req)
  const sql = getSQL()
  const url = new URL(req.url)
  const period = url.searchParams.get('period') || '7d'
  const market = url.searchParams.get('market') || null
  const periodKey = ['7d', '30d', '90d'].includes(period) ? period : '7d'

  if (req.method === 'GET') {
    const { results, generatedAt } = await loadCached(sql, orgId, periodKey)
    return json({ period: periodKey, generatedAt, results }, 200, 30)
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const force = Boolean(body.force)

  try {
    if (!force) {
      const cached = await loadCached(sql, orgId, periodKey)
      if (cached.results.length > 0 && cached.generatedAt) {
        const ageH = (Date.now() - new Date(cached.generatedAt).getTime()) / 3600000
        if (ageH < 6) {
          return json({ period: periodKey, generatedAt: cached.generatedAt, results: cached.results, fromCache: true }, 200)
        }
      }
    }

    const apiKey = await getOpenAIKey(orgId)
    if (!apiKey) {
      return json({ error: 'OpenAI key not configured for organization' }, 400)
    }
    const openai = new OpenAI({ apiKey })
    const model = 'gpt-4o-mini'

    const days = periodDays(periodKey)
    const now = new Date()
    const toDate = now.toISOString()
    const fromDate = new Date(now.getTime() - days * 86400000).toISOString()

    const clusters = await loadClusters(sql, orgId, fromDate, toDate, market)
    if (clusters.length === 0) {
      await saveAnalysis(sql, orgId, periodKey, market, [])
      return json({ period: periodKey, generatedAt: now.toISOString(), results: [], note: 'Недостаточно данных для анализа' }, 200)
    }

    // Запускаем анализ всех кластеров параллельно и принимаем частичные результаты,
    // чтобы уложиться в окно edge-функции
    const settled = await Promise.allSettled(
      clusters.map((c) => analyzeCluster(openai, model, c)),
    )
    const results: RCAResult[] = []
    const failed: string[] = []
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i]
      if (s.status === 'fulfilled' && s.value) results.push(s.value)
      else failed.push(clusters[i].key)
    }

    await saveAnalysis(sql, orgId, periodKey, market, results)

    const sevRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
    results.sort((a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0) || b.affectedCount - a.affectedCount)

    return json(
      {
        period: periodKey,
        generatedAt: now.toISOString(),
        results,
        fromCache: false,
        partial: failed.length > 0,
        failedClusters: failed,
        note: failed.length > 0 ? `Не удалось проанализировать ${failed.length} из ${clusters.length} кластеров (таймаут или ошибка LLM)` : undefined,
      },
      200,
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[RCA]', msg)
    return json({ error: msg }, 500)
  }
}
