/**
 * Ежедневный отчёт сотруднику в Telegram.
 *
 * Что считаем:
 *   1. FRT и SLA Compliance сотрудника за СЕГОДНЯ (Tashkent сутки)
 *   2. Те же метрики — среднее за последние 7 дней (его собственный baseline)
 *   3. Бенчмарки команды (bronze/silver/gold) для сравнения с целями
 *   4. Сколько сессий обработал сегодня (sample_size)
 *
 * Что в тексте:
 *   - Сводка за день со светофором (🟢/🟡/🔴) и дельтой vs прошлая неделя
 *   - 1-3 совета «над чем поработать завтра» — выбираются по эвристике:
 *     - status='bad' по метрике → совет конкретный
 *     - sessions < половины недельного среднего → совет об активности
 *     - всё в Gold → благодарность
 *   - Ссылка на 360°-профиль
 *
 * Как отправляем:
 *   - GET /daily-report?secret=<CRON>  — режим cron, обходит ВСЕХ агентов
 *     с роли Support и заполненным telegram_id
 *   - POST /daily-report body {agentId, dry?: true}  — preview/manual.
 *     Если dry=true, текст возвращается, но не отправляется в Telegram.
 *
 * Безопасность отчёта по нерабочим дням: при cron-запуске пропускаем агентов
 * без активности за день (0 сессий — не присылаем «у тебя 0 сессий», это
 * скорее всего выходной/болезнь, а не плохой день).
 */

import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import {
  computeFrtAvg,
  computeSlaCompliance,
  frtAvgDescriptor,
  slaComplianceDescriptor,
  resolvePeriod,
} from './metrics/index.js'
import type { MetricResult, ResolvedPeriod } from './metrics/index.js'

export const config = {
  runtime: 'edge',
  maxDuration: 300,
}

// Какие роли получают daily report. Совпадает с SUPPORT_ROLE_KEYWORDS из agent-roles.
const SUPPORT_ROLES = [
  'support',
  'support_agent',
  'agent',
  'team_lead',
  'team lead',
  'team_leader',
  'helpdesk',
  'agent_support',
  'kam',
  'sales',
  'sdr',
  'manager',
]

interface AgentRow {
  id: string
  name: string
  telegram_id: string | null
  role: string | null
  org_id: string
}

interface ReportData {
  agentId: string
  agentName: string
  today: { frt: MetricResult; sla: MetricResult }
  weekAvg: { frt: MetricResult; sla: MetricResult }
}

async function getOrgBotToken(orgId: string): Promise<string | null> {
  const sql = getSQL()
  try {
    const [row] = await sql`
      SELECT value FROM support_settings
      WHERE org_id = ${orgId} AND key = 'telegram_bot_token' LIMIT 1
    `
    if (row?.value) return String(row.value)
  } catch {}
  return process.env.TELEGRAM_BOT_TOKEN || null
}

function fmtMinutes(v: number | null): string {
  if (v === null) return '—'
  return v < 1 ? `${Math.round(v * 60)}с` : `${v.toFixed(1)} мин`
}
function fmtPercent(v: number | null): string {
  if (v === null) return '—'
  return `${v.toFixed(1)}%`
}

function statusEmoji(status: MetricResult['status']): string {
  switch (status) {
    case 'good':
      return '🟢'
    case 'borderline':
      return '🟡'
    case 'bad':
      return '🔴'
    default:
      return '⚪'
  }
}

function deltaText(
  today: number | null,
  baseline: number | null,
  direction: 'higher_better' | 'lower_better',
  unit: 'minutes' | 'percent',
): string {
  if (today === null || baseline === null || baseline === 0) return ''
  const diff = today - baseline
  const pct = Math.round((diff / Math.abs(baseline)) * 100)
  if (Math.abs(pct) < 3) return ' (≈ как обычно)'
  const isImproving = direction === 'lower_better' ? diff < 0 : diff > 0
  const arrow = isImproving ? '↗' : '↘'
  const sign = pct > 0 ? '+' : ''
  if (unit === 'minutes') {
    return ` (${arrow} ${sign}${pct}% к среднему ${fmtMinutes(baseline)})`
  }
  return ` (${arrow} ${sign}${pct.toFixed(0)} п.п. vs ${fmtPercent(baseline)})`
}

function buildAdvice(data: ReportData): string[] {
  const advice: string[] = []
  const { today, weekAvg } = data

  // 1. FRT в красной зоне
  if (today.frt.status === 'bad' && today.frt.benchmarks.silver) {
    advice.push(
      `Сократить время первого ответа — сейчас ${fmtMinutes(today.frt.value)}, цель Silver: ${fmtMinutes(today.frt.benchmarks.silver.value)}`,
    )
  }
  // 2. SLA в красной зоне
  if (today.sla.status === 'bad' && today.sla.benchmarks.silver) {
    advice.push(
      `Поднять SLA Compliance — сейчас ${fmtPercent(today.sla.value)}, цель Silver: ${fmtPercent(today.sla.benchmarks.silver.value)}`,
    )
  }
  // 3. Активность ниже половины недельного среднего
  if (
    today.frt.sampleSize > 0 &&
    weekAvg.frt.sampleSize > 7 &&
    today.frt.sampleSize < weekAvg.frt.sampleSize / 7 / 2
  ) {
    advice.push(
      `Сегодня меньше активности чем обычно: ${today.frt.sampleSize} сессий vs среднее ${Math.round(weekAvg.frt.sampleSize / 7)} в день. Завтра — догнать.`,
    )
  }
  // 4. FRT борется на грани между silver и gold
  if (today.frt.status === 'borderline' && today.frt.benchmarks.gold) {
    advice.push(
      `Можешь зайти в Gold по FRT — осталось чуть-чуть: текущее ${fmtMinutes(today.frt.value)}, gold ${fmtMinutes(today.frt.benchmarks.gold.value)}`,
    )
  }

  // Если всё в Gold — поздравляем
  if (today.frt.status === 'good' && today.sla.status === 'good' && advice.length === 0) {
    advice.push('Все ключевые метрики в зоне Gold — отличный день. Просто продолжай.')
  }
  // Если совсем ничего не дали — позитивный закрытый совет
  if (advice.length === 0) {
    advice.push('День в зоне Silver — это норм. Поработать над пиками задержек, чтобы выйти в Gold.')
  }

  return advice.slice(0, 3)
}

function buildReportText(data: ReportData): string {
  const { agentName, today, weekAvg } = data
  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

  const lines: string[] = []
  lines.push(`📊 <b>Итоги дня · ${agentName}</b>`)
  lines.push(`<i>${date}</i>`)
  lines.push('')

  // === Сегодня ===
  lines.push(`<b>За сегодня:</b>`)
  lines.push(
    `${statusEmoji(today.frt.status)} Время ответа: <b>${fmtMinutes(today.frt.value)}</b>` +
      deltaText(today.frt.value, weekAvgValue(weekAvg.frt), 'lower_better', 'minutes'),
  )
  lines.push(
    `${statusEmoji(today.sla.status)} SLA Compliance: <b>${fmtPercent(today.sla.value)}</b>` +
      deltaText(today.sla.value, weekAvgValue(weekAvg.sla), 'higher_better', 'percent'),
  )
  lines.push(`📨 Сессий обработано: <b>${today.frt.sampleSize}</b>`)
  lines.push('')

  // === Целевые уровни ===
  const fb = today.frt.benchmarks
  if (fb.bronze || fb.silver || fb.gold) {
    lines.push(`<b>Цели по FRT:</b>`)
    if (fb.bronze) lines.push(`🥉 ${fmtMinutes(fb.bronze.value)}`)
    if (fb.silver) lines.push(`🥈 ${fmtMinutes(fb.silver.value)}`)
    if (fb.gold) lines.push(`🥇 ${fmtMinutes(fb.gold.value)}`)
    lines.push('')
  }

  // === Над чем поработать ===
  lines.push(`<b>🎯 Над чем поработать завтра:</b>`)
  for (const a of buildAdvice(data)) {
    lines.push(`• ${a}`)
  }
  lines.push('')

  return lines.join('\n')
}

/** Усреднённое значение из metric.value, делённое на дни, для дельты «сегодня vs среднее в день». */
function weekAvgValue(m: MetricResult): number | null {
  // Для FRT и SLA это уже среднее, не сумма. Так что value == день среднего.
  return m.value
}

async function buildReportForAgent(agent: AgentRow): Promise<ReportData> {
  // Период «сегодня» в Tashkent
  const todayPeriod = resolvePeriod('today')
  // Период «прошлая неделя» — последние 7 дней (не вкл. сегодня)
  const now = new Date()
  const sevenAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const yesterdayEnd = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const weekPeriod: ResolvedPeriod = {
    from: sevenAgo,
    to: yesterdayEnd,
    granularity: 'weekly',
    label: '7 дней',
  }
  const scope = {
    orgId: agent.org_id,
    agentId: agent.id,
    market: null,
    source: null,
    role: null,
    roles: null,
  }
  const [frtToday, slaToday, frtWeek, slaWeek] = await Promise.all([
    computeFrtAvg(scope, todayPeriod),
    computeSlaCompliance(scope, todayPeriod),
    computeFrtAvg(scope, weekPeriod),
    computeSlaCompliance(scope, weekPeriod),
  ])
  return {
    agentId: agent.id,
    agentName: agent.name,
    today: { frt: frtToday, sla: slaToday },
    weekAvg: { frt: frtWeek, sla: slaWeek },
  }
}

async function sendToTelegram(orgId: string, telegramId: string, text: string): Promise<boolean> {
  const token = await getOrgBotToken(orgId)
  if (!token) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    })
    const data = (await res.json()) as { ok?: boolean; description?: string }
    if (!data.ok) console.error('[daily-report] TG send failed:', data.description)
    return !!data.ok
  } catch (e) {
    console.error('[daily-report] TG send error:', e instanceof Error ? e.message : e)
    return false
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)

  // POST: preview / manual для одного агента
  if (req.method === 'POST') {
    const ctx = await extractAgentContext(req)
    if (!ctx.orgId) return json({ error: 'Unauthorized' }, 401)
    const body = (await req.json().catch(() => null)) as
      | null
      | { agentId?: string; dry?: boolean }
    if (!body?.agentId) return json({ error: 'agentId required' }, 400)

    const [agent] = (await sql`
      SELECT id, name, telegram_id, role, org_id
      FROM support_agents
      WHERE id = ${body.agentId} AND org_id = ${ctx.orgId} LIMIT 1
    `) as AgentRow[]
    if (!agent) return json({ error: 'Agent not found' }, 404)

    const data = await buildReportForAgent(agent)
    const text = buildReportText(data)

    if (body.dry || !agent.telegram_id) {
      return json({ ok: true, dry: true, text, telegramId: agent.telegram_id, agent: agent.name })
    }

    const sent = await sendToTelegram(agent.org_id, agent.telegram_id, text)
    return json({ ok: sent, text, telegramId: agent.telegram_id, agent: agent.name })
  }

  // GET: cron-режим — обойти всех support-агентов всех org
  if (req.method === 'GET') {
    const querySecret = url.searchParams.get('secret') || ''
    const auth = req.headers.get('Authorization') || ''
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const expected = process.env.CRON_SECRET || ''
    const allowed = !!expected && (querySecret === expected || bearer === expected)
    if (!allowed) return json({ error: 'Unauthorized: cron secret required' }, 401)

    const agents = (await sql`
      SELECT id, name, telegram_id, role, org_id
      FROM support_agents
      WHERE telegram_id IS NOT NULL
        AND telegram_id <> ''
        AND LOWER(COALESCE(role, '')) = ANY(${SUPPORT_ROLES}::text[])
    `) as AgentRow[]

    const results: Array<{ agentId: string; sent: boolean; reason?: string }> = []
    for (const agent of agents) {
      try {
        const data = await buildReportForAgent(agent)
        // Пропускаем тех, у кого сегодня НЕТ активности — скорее всего выходной/отпуск.
        if (data.today.frt.sampleSize === 0) {
          results.push({ agentId: agent.id, sent: false, reason: 'no_activity_today' })
          continue
        }
        const text = buildReportText(data)
        const sent = await sendToTelegram(agent.org_id, agent.telegram_id!, text)
        results.push({ agentId: agent.id, sent, reason: sent ? undefined : 'tg_send_failed' })
      } catch (e) {
        results.push({
          agentId: agent.id,
          sent: false,
          reason: e instanceof Error ? e.message : 'error',
        })
      }
    }

    return json({
      ran: new Date().toISOString(),
      agentsConsidered: agents.length,
      sent: results.filter((r) => r.sent).length,
      skipped: results.filter((r) => !r.sent).length,
      results,
    })
  }

  return json({ error: 'Method not allowed' }, 405)
}
