import OpenAI from 'openai'
import { getRequestOrgId } from '../lib/org.js'
import { getOpenAIKey, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
  regions: ['iad1'],
  maxDuration: 30,
}

/**
 * POST /api/support/analytics/agent-360-summary
 *   body: { payload: Agent360Payload }  // тот же payload, что отдаёт agent-360.ts
 *   → возвращает JSON-саммари по сотруднику для руководителя:
 *     { tldr, strengths[], concerns[], recommendations[], verdict }
 *
 * Делаем отдельным endpoint'ом, чтобы основной /agent-360 отдавался мгновенно,
 * а медленный LLM-вызов не задерживал отрисовку модалки.
 */

const LLM_TIMEOUT_MS = 22_000

const SYSTEM_PROMPT = `Ты — старший аналитик службы поддержки Delever (платформа для ресторанов и доставки в Узбекистане и Казахстане).
Тебе дают агрегированные метрики по одному сотруднику нашей команды поддержки за выбранный период.
Твоя задача — дать руководителю короткий, честный, конкретный обзор: где сотрудник силён, что просаживает, что делать.

Жёсткие правила:
- Пиши ПО-РУССКИ, без markdown-разметки в значениях полей.
- НЕ выдумывай факты, опирайся ТОЛЬКО на присланные числа. Если данных нет — так и пиши.
- Никаких "Отлично работает!" без числа. Каждый тезис — с конкретной метрикой ("FRT 4.2м против медианы команды 9.1м").
- Сравнения с командой бери из vsTeam.median* (если null — пропусти сравнение, не выдумывай).
- "tldr" — 1–2 предложения, суть за период.
- "strengths" — 2–4 пункта, что объективно хорошо.
- "concerns" — 0–4 пункта, что просаживается. Если всё хорошо — пустой массив.
- "recommendations" — 2–4 КОНКРЕТНЫХ шага для руководителя/сотрудника на следующую неделю. Никаких "разобраться" — глаголом и с метрикой.
- "verdict": "top" (явно лучше команды), "solid" (стабильно, без проблем), "watch" (есть просадки, нужен фокус), "risk" (срочно вмешаться).

Отвечай СТРОГО JSON без markdown-блоков:
{
  "tldr": string,
  "strengths": [string],
  "concerns": [string],
  "recommendations": [string],
  "verdict": "top" | "solid" | "watch" | "risk"
}`

interface Agent360Payload {
  profile?: { name?: string; role?: string; position?: string | null; status?: string | null }
  period?: { from: string; to: string; source: string }
  kpi?: Record<string, number | null>
  bySource?: Array<{ source: string; messages: number; avgFRT: number | null; channels: number }>
  byContentType?: Array<{ type: string; count: number; share: number }>
  byLanguage?: Array<{ lang: string; count: number; share: number }>
  byDomain?: Array<{ domain: string; subcategory: string | null; count: number }>
  statusFunnel?: Array<{ status: string; count: number }>
  sentiment?: { positive: number; neutral: number; negative: number; total: number }
  vsTeam?: { responses: number | null; resolved: number | null; medianResponses: number; medianResolved: number }
  topChannels?: Array<{ name: string; source: string; messages: number }>
  stuck?: Array<unknown>
  recentResolved?: Array<unknown>
}

interface SummaryResult {
  tldr: string
  strengths: string[]
  concerns: string[]
  recommendations: string[]
  verdict: 'top' | 'solid' | 'watch' | 'risk'
}

function compactPayload(p: Agent360Payload) {
  return {
    profile: p.profile || {},
    period: p.period || {},
    kpi: p.kpi || {},
    vsTeam: p.vsTeam || {},
    sentiment: p.sentiment || {},
    bySource: (p.bySource || []).slice(0, 5),
    byContentType: (p.byContentType || []).slice(0, 6),
    byLanguage: (p.byLanguage || []).slice(0, 5),
    byDomain: (p.byDomain || []).slice(0, 8).map((r) => ({
      domain: r.domain,
      subcategory: r.subcategory,
      count: r.count,
    })),
    statusFunnel: p.statusFunnel || [],
    topChannels: (p.topChannels || []).slice(0, 5).map((c) => ({
      name: c.name,
      source: c.source,
      messages: c.messages,
    })),
    stuckCount: Array.isArray(p.stuck) ? p.stuck.length : 0,
    recentResolvedCount: Array.isArray(p.recentResolved) ? p.recentResolved.length : 0,
  }
}

async function callLLM(client: OpenAI, payload: object): Promise<SummaryResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS)
  try {
    const resp = await client.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      },
      { signal: ctrl.signal }
    )
    const raw = resp.choices?.[0]?.message?.content || '{}'
    const parsed = JSON.parse(raw) as Partial<SummaryResult>

    return {
      tldr: typeof parsed.tldr === 'string' ? parsed.tldr.trim() : '',
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.filter((x) => typeof x === 'string').slice(0, 6) : [],
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns.filter((x) => typeof x === 'string').slice(0, 6) : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.filter((x) => typeof x === 'string').slice(0, 6) : [],
      verdict: (['top', 'solid', 'watch', 'risk'] as const).includes(parsed.verdict as any)
        ? (parsed.verdict as SummaryResult['verdict'])
        : 'solid',
    }
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const orgId = await getRequestOrgId(req)
  const apiKey = await getOpenAIKey(orgId)
  if (!apiKey) {
    return json(
      {
        error: 'no_openai_key',
        message: 'Не настроен OPENAI_API_KEY для организации. Добавьте его в Settings → AI.',
      },
      400
    )
  }

  let body: { payload?: Agent360Payload } = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const payload = body?.payload
  if (!payload || typeof payload !== 'object' || !payload.profile) {
    return json({ error: 'payload_required', message: 'В body нужен поле payload c результатом /agent-360' }, 400)
  }

  const client = new OpenAI({ apiKey })

  try {
    const summary = await callLLM(client, compactPayload(payload))
    return json({ summary, generatedAt: new Date().toISOString() })
  } catch (e: any) {
    const aborted = e?.name === 'AbortError'
    return json(
      {
        error: aborted ? 'llm_timeout' : 'llm_failed',
        message: aborted ? 'AI не успел ответить за 22 секунды, попробуйте ещё раз' : (e?.message || 'LLM error'),
      },
      aborted ? 504 : 500
    )
  }
}
