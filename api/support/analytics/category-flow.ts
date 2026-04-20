import { getSQL, json } from '../lib/db.js'
import { getRequestOrgId } from '../lib/org.js'
import { loadSla, businessMinutesBetween, type SlaConfig } from '../lib/sla.js'
import { TAXONOMY, LEGACY_CATEGORY_TO_DOMAIN, type DomainKey } from '../ai/taxonomy.js'
import { CHURN_PATTERNS } from '../lib/churn-signals.js'
import { ensureTaxonomyColumns } from '../lib/ensure-taxonomy.js'

export const config = {
  runtime: 'edge',
  regions: ['iad1'],
}

type FlowStatus = 'resolved' | 'in_progress' | 'stuck' | 'ignored' | 'blocked'
type Satisfaction = 'happy' | 'neutral' | 'unhappy'

interface FlowCell {
  total: number
  resolved: number
  in_progress: number
  stuck: number
  ignored: number
  blocked: number
  happy: number
  neutral: number
  unhappy: number
  churnRisk: number
}

interface DomainRow extends FlowCell {
  domain: DomainKey
  label: string
  subcategories: SubcategoryRow[]
}

interface SubcategoryRow extends FlowCell {
  domain: DomainKey
  subcategory: string
  label: string
}

/**
 * GET /api/support/analytics/category-flow?period=30d
 *
 * Возвращает агрегированную картину по иерархической таксономии:
 *  - KPI по всему периоду (total/resolved/in_progress/stuck/ignored/blocked/happy/neutral/unhappy/churnRisk)
 *  - Разбивка по доменам (10 штук) и внутри доменов — по подкатегориям
 *  - Топ-список «игнорируемых» сообщений и «недовольных» тредов
 *
 * Используется SLA из support_settings + рабочие часы (businessMinutesBetween).
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  const url = new URL(req.url)
  const period = url.searchParams.get('period') || '30d'
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30
  const rawSource = (url.searchParams.get('source') || 'all').toLowerCase()
  const source: 'all' | 'telegram' | 'whatsapp' =
    rawSource === 'telegram' ? 'telegram' : rawSource === 'whatsapp' ? 'whatsapp' : 'all'
  const now = new Date()
  const fromDate = new Date(now.getTime() - days * 86400000)
  const fromISO = fromDate.toISOString()

  // Подстраховка: если миграция ещё не прокатилась, добавим колонки на лету
  await ensureTaxonomyColumns()

  const sla = await loadSla(orgId)

  try {
    // === 1. Клиентские «содержательные» сообщения за период + join с кейсом + канал ===
    // ch.source даёт нам платформу: 'telegram' | 'whatsapp'
    const messages = (await sql`
      SELECT
        m.id,
        m.channel_id,
        m.case_id,
        m.created_at,
        m.ai_domain,
        m.ai_subcategory,
        m.ai_category,
        m.ai_intent,
        m.ai_sentiment,
        m.is_problem,
        m.ai_urgency,
        m.text_content,
        m.transcript,
        COALESCE(ch.source, 'telegram') AS channel_source,
        ch.name AS channel_name,
        c.status AS case_status,
        c.resolved_at AS case_resolved_at,
        c.updated_at AS case_updated_at
      FROM support_messages m
      LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
      LEFT JOIN support_cases c ON c.id = m.case_id AND c.org_id = m.org_id
      WHERE m.org_id = ${orgId}
        AND m.created_at >= ${fromISO}::timestamptz
        AND m.is_from_client = true
        AND (
          m.is_problem = true
          OR m.ai_intent IN ('report_problem', 'complaint', 'ask_question', 'request_feature')
        )
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
      ORDER BY m.created_at DESC
      LIMIT 10000
    `) as any[]

    // === 2. Все ответы агентов за период (для расчёта ignored) ===
    // Берём по каналам, чтобы быстро проверять "был ли ответ после X мин"
    const agentReplies = (await sql`
      SELECT m.channel_id, m.created_at
      FROM support_messages m
      LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
      WHERE m.org_id = ${orgId}
        AND m.created_at >= ${fromISO}::timestamptz
        AND m.sender_role IN ('support', 'team')
        AND m.is_from_client = false
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
      ORDER BY m.channel_id, m.created_at ASC
    `) as any[]

    // Group ответов агента по channel_id, уже отсортированы по created_at
    const repliesByChannel = new Map<string, number[]>()
    for (const r of agentReplies) {
      const key = r.channel_id as string
      if (!key) continue
      const ts = new Date(r.created_at).getTime()
      const arr = repliesByChannel.get(key)
      if (arr) arr.push(ts)
      else repliesByChannel.set(key, [ts])
    }

    // === 3. Расчёт состояния каждого сообщения ===
    // Группируем: caseAggregates[case_id] = { messages in case, status, ... }
    // Для сообщений без case_id — считаем каждое отдельно
    const processedCaseIds = new Set<string>()
    const items: Array<{
      domain: DomainKey
      subcategory: string
      flow: FlowStatus
      sat: Satisfaction
      hasChurn: boolean
      messageId: string
      channelId: string | null
      channelName: string | null
      channelSource: 'telegram' | 'whatsapp'
      caseId: string | null
      text: string
      createdAt: string
    }> = []

    for (const m of messages) {
      const caseId: string | null = m.case_id || null
      const text: string = String(m.text_content || m.transcript || '').slice(0, 500)
      const { domain, subcategory } = resolveTaxonomy(m)

      // Дедуп: для одного case_id берём только первое (самое последнее по времени) сообщение
      if (caseId) {
        if (processedCaseIds.has(caseId)) continue
        processedCaseIds.add(caseId)
      }

      const flow = computeFlow(m, repliesByChannel.get(m.channel_id) || [], sla, now)
      const sat = computeSatisfaction(m)
      const hasChurn = detectChurn(text)
      const channelSource: 'telegram' | 'whatsapp' =
        (m.channel_source as string) === 'whatsapp' ? 'whatsapp' : 'telegram'

      items.push({
        domain,
        subcategory,
        flow,
        sat,
        hasChurn,
        messageId: m.id,
        channelId: m.channel_id || null,
        channelName: m.channel_name || null,
        channelSource,
        caseId,
        text,
        createdAt: m.created_at,
      })
    }

    // === 4. Агрегация KPI + по доменам + по подкатегориям ===
    const kpi: FlowCell = emptyCell()
    const kpiByTelegram: FlowCell = emptyCell()
    const kpiByWhatsapp: FlowCell = emptyCell()
    const domainMap = new Map<DomainKey, FlowCell & { subcategories: Map<string, FlowCell> }>()

    for (const d of TAXONOMY) {
      domainMap.set(d.key, { ...emptyCell(), subcategories: new Map() })
    }

    for (const it of items) {
      bumpCell(kpi, it.flow, it.sat, it.hasChurn)
      if (it.channelSource === 'whatsapp') bumpCell(kpiByWhatsapp, it.flow, it.sat, it.hasChurn)
      else bumpCell(kpiByTelegram, it.flow, it.sat, it.hasChurn)
      const dom = domainMap.get(it.domain)
      if (!dom) continue
      bumpCell(dom, it.flow, it.sat, it.hasChurn)
      const sub = dom.subcategories.get(it.subcategory) || emptyCell()
      bumpCell(sub, it.flow, it.sat, it.hasChurn)
      dom.subcategories.set(it.subcategory, sub)
    }

    // === 5. Формируем красивый вывод ===
    const domains: DomainRow[] = []
    for (const d of TAXONOMY) {
      const cell = domainMap.get(d.key)!
      const subcats: SubcategoryRow[] = []
      const subLabelMap = new Map(d.subcategories.map((s) => [s.key, s.label]))
      for (const [subKey, subCell] of cell.subcategories) {
        subcats.push({
          ...subCell,
          domain: d.key,
          subcategory: subKey,
          label: subLabelMap.get(subKey) || subKey,
        })
      }
      subcats.sort((a, b) => b.total - a.total)
      const { subcategories: _, ...cellFlat } = cell
      domains.push({
        ...cellFlat,
        domain: d.key,
        label: d.label,
        subcategories: subcats,
      })
    }
    // Отсортировать домены по total убывающе, но 'other' в конец
    domains.sort((a, b) => {
      if (a.domain === 'other') return 1
      if (b.domain === 'other') return -1
      return b.total - a.total
    })

    // === 6. Топ-списки для таблиц ===
    const ignoredList = items
      .filter((i) => i.flow === 'ignored')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 20)
      .map((i) => ({
        messageId: i.messageId,
        channelId: i.channelId,
        channelName: i.channelName,
        source: i.channelSource,
        domain: i.domain,
        subcategory: i.subcategory,
        text: i.text,
        createdAt: i.createdAt,
      }))

    const unhappyList = items
      .filter((i) => i.sat === 'unhappy' || i.hasChurn)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 20)
      .map((i) => ({
        messageId: i.messageId,
        channelId: i.channelId,
        channelName: i.channelName,
        source: i.channelSource,
        caseId: i.caseId,
        domain: i.domain,
        subcategory: i.subcategory,
        text: i.text,
        hasChurn: i.hasChurn,
        createdAt: i.createdAt,
      }))

    return json(
      {
        period: { from: fromISO, to: now.toISOString(), days },
        source,
        sla: {
          targetResponseTime: sla.targetResponseTime,
          targetResolutionTime: sla.targetResolutionTime,
          workingHoursStart: sla.workingHoursStart,
          workingHoursEnd: sla.workingHoursEnd,
          workingDays: sla.workingDays,
        },
        kpi,
        bySource: {
          telegram: kpiByTelegram,
          whatsapp: kpiByWhatsapp,
        },
        domains,
        ignoredList,
        unhappyList,
        totalItems: items.length,
      },
      200,
      30,
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    const stack = e instanceof Error ? e.stack : undefined
    console.error('[category-flow] error:', msg, stack)
    return json({ error: msg, where: 'category-flow' }, 500)
  }
}

// ===================== Helpers =====================

function emptyCell(): FlowCell {
  return {
    total: 0,
    resolved: 0,
    in_progress: 0,
    stuck: 0,
    ignored: 0,
    blocked: 0,
    happy: 0,
    neutral: 0,
    unhappy: 0,
    churnRisk: 0,
  }
}

function bumpCell(cell: FlowCell, flow: FlowStatus, sat: Satisfaction, hasChurn: boolean) {
  cell.total++
  cell[flow]++
  cell[sat]++
  if (hasChurn) cell.churnRisk++
}

function resolveTaxonomy(m: any): { domain: DomainKey; subcategory: string } {
  const rawDomain = m.ai_domain as string | null
  const rawSub = m.ai_subcategory as string | null
  const legacyCat = (m.ai_category as string | null)?.toLowerCase() || ''
  const domainKeys = new Set(TAXONOMY.map((d) => d.key))
  let domain: DomainKey = 'other'
  if (rawDomain && domainKeys.has(rawDomain as DomainKey)) {
    domain = rawDomain as DomainKey
  } else if (legacyCat && LEGACY_CATEGORY_TO_DOMAIN[legacyCat]) {
    domain = LEGACY_CATEGORY_TO_DOMAIN[legacyCat]
  }
  let subcategory = rawSub && typeof rawSub === 'string' ? rawSub : '_unknown'
  // Если подкатегория не из этого домена — возвращаем _unknown
  const d = TAXONOMY.find((x) => x.key === domain)
  if (d && rawSub && !d.subcategories.some((s) => s.key === rawSub)) {
    subcategory = '_unknown'
  }
  return { domain, subcategory }
}

function computeFlow(
  m: any,
  channelAgentReplies: number[],
  sla: SlaConfig,
  now: Date,
): FlowStatus {
  const caseStatus = (m.case_status as string | null)?.toLowerCase() || null

  // Есть кейс
  if (caseStatus) {
    if (caseStatus === 'resolved' || caseStatus === 'closed') return 'resolved'
    if (caseStatus === 'blocked') return 'blocked'
    // Открытый кейс — считаем stuck/in_progress по последнему updated_at кейса
    const lastActivity: string | null = m.case_updated_at as string | null
    if (!lastActivity) return 'in_progress'
    const inactivityMin = businessMinutesBetween(lastActivity, now, sla)
    return inactivityMin > sla.targetResolutionTime ? 'stuck' : 'in_progress'
  }

  // Кейса нет — ищем ответ агента в канале после этого сообщения
  const msgTs = new Date(m.created_at).getTime()
  const answered = channelAgentReplies.find((t) => t >= msgTs)
  if (answered) {
    // Ответ был — это не ignored. Классифицируем как in_progress (сообщение в работе без формального кейса).
    return 'in_progress'
  }

  // Нет ответа — смотрим, превысил ли targetResponseTime
  const waitedMin = businessMinutesBetween(new Date(m.created_at), now, sla)
  return waitedMin > sla.targetResponseTime ? 'ignored' : 'in_progress'
}

function computeSatisfaction(m: any): Satisfaction {
  const s = (m.ai_sentiment as string | null)?.toLowerCase() || 'neutral'
  if (s === 'positive') return 'happy'
  if (s === 'negative' || s === 'frustrated') return 'unhappy'
  return 'neutral'
}

function detectChurn(text: string): boolean {
  if (!text || text.length < 4) return false
  for (const p of CHURN_PATTERNS) {
    if (p.pattern.test(text)) return true
  }
  return false
}
