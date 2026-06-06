/**
 * Cron: SLA-страж. Ловит каналы партнёров, где клиент реально ждёт ответа
 * дольше нормы, и шлёт алерт (in-app + Telegram DM) агенту/лиду.
 *
 * Расписание: каждые 5 минут (см. vercel.json crons).
 *
 * Логика (валидирована на всех 333 каналах, см. сессию анализа):
 *   1. Кандидаты = недавние ПАРТНЁРСКИЕ каналы (name ~ delever), где последнее
 *      сообщение от клиента (awaiting). /start-мусор и личные аккаунты отсечены.
 *   2. Структура: последнее от команды → resolved (сброс). Внутренние → skip.
 *   3. WA до реконнекта (дыра простоя моста) → HOLD (не алертим, ручная проверка).
 *   4. Старше MAX_AGE дней → STALE (в архив, не лид-спам).
 *   5. Рабочие минуты ожидания (businessMinutesBetween, рабочие часы/tz из SlaConfig).
 *   6. Если ожидание >= порога WARNING → LLM-gate: это реальный запрос или
 *      закрытие/«спасибо»/«решил сам» (многоязычно)? Закрытие → SUPPRESS.
 *   7. Реальный запрос → тир (WARNING/BREACH/CRITICAL). Алерт ТОЛЬКО при переходе
 *      на новый тир (анти-спам), состояние в support_channels.sla_*.
 *
 * Защита: Vercel cron (user-agent) или CRON_SECRET.
 */
import { getSQL, json, getOpenAIKey } from '../lib/db.js'
import { loadSla, businessMinutesBetween } from '../lib/sla.js'
import { sendNotification } from '../lib/notifications.js'

export const config = { runtime: 'edge' }

const ORG = process.env.SLA_GUARD_ORG || 'org_delever'
// Безопасный rollout: по умолчанию SHADOW (считает + пишет sla_state, НЕ шлёт алерты).
// Реальные уведомления включаются явно: SLA_GUARD_LIVE=1.
const LIVE = process.env.SLA_GUARD_LIVE === '1'
const WA_RECONNECT = new Date('2026-06-03T00:00:00Z')
const MAX_AGE_DAYS = 5
const T_WARN = 30, T_BREACH = 60, T_CRIT = 240 // рабочие минуты
const TIER_LEVEL: Record<string, number> = { WARNING: 1, BREACH: 2, CRITICAL: 3 }
const PRIORITY: Record<string, 'medium' | 'high' | 'critical'> = { WARNING: 'medium', BREACH: 'high', CRITICAL: 'critical' }

const BROADCAST = /(құрметті серіктестер|поздравля|с праздником|бүгін —|мерекес)/i
const AUTO_GREETING = /(готов помочь|обратите внимание на сообщение|пожалуйста, опиш|запрос принят)/i
const render = (m: any) => {
  const t = (m.text_content || m.ai_summary || '').replace(/\s+/g, ' ')
  if (t) return t
  return m.content_type && m.content_type !== 'text' ? `[вложение ${m.content_type} без текста]` : ''
}

const GATE_SYS = `Дан хвост диалога поддержки Delever (клиент-ресторан ↔ команда). Последнее — от КЛИЕНТА. Нужен ли ОТВЕТ/ДЕЙСТВИЕ команды, или клиент уже закрыл тему? Узбекский/казахский/русский: хоп/булади/яхши/майли/рахмат/тушунарли=ок/спасибо; «вручную пробили/сами решили»=решил сам. Если клиент прислал вложение/скриншот без текста — обычно ждёт реакции (needs_reply=true). Ответь СТРОГО JSON: {"needs_reply":true|false,"kind":"pending_request|closing_ack|self_resolved|chitchat"}`

async function gate(apiKey: string, tail: string): Promise<boolean> {
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini', response_format: { type: 'json_object' }, temperature: 0, messages: [{ role: 'system', content: GATE_SYS }, { role: 'user', content: tail }] }),
        signal: AbortSignal.timeout(20000),
      })
      if (r.ok) { const d: any = await r.json(); return JSON.parse(d.choices[0].message.content).needs_reply !== false }
      if (r.status === 429 || r.status >= 500) { await new Promise(x => setTimeout(x, 1000 * (a + 1))); continue }
      return true // при ошибке gate — лучше пропустить дальше (conservative), но не дублировать алерт (анти-спам ниже)
    } catch { return true }
  }
  return true
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null)
  const ua = req.headers.get('user-agent') || ''
  const auth = req.headers.get('authorization') || ''
  if (!ua.includes('vercel-cron') && !(process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  // колонки состояния SLA (идемпотентно)
  try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS sla_state VARCHAR(20)` } catch {}
  try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS sla_alert_level INT DEFAULT 0` } catch {}
  try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS sla_last_alert_at TIMESTAMPTZ` } catch {}

  // 1) сброс resolved: команда ответила последней → чистим состояние
  try {
    await sql`UPDATE support_channels SET sla_state='ok', sla_alert_level=0
      WHERE org_id=${ORG} AND COALESCE(sla_alert_level,0) > 0
        AND last_team_message_at IS NOT NULL
        AND (last_client_message_at IS NULL OR last_team_message_at > last_client_message_at)`
  } catch {}

  const cfg = await loadSla(ORG)
  const apiKey = await getOpenAIKey(ORG)
  const now = new Date()
  const stat = { scanned: 0, gated: 0, alerts: { WARNING: 0, BREACH: 0, CRITICAL: 0 }, suppressed: 0, hold: 0, stale: 0, resolved_or_ok: 0 }

  // 2) кандидаты: недавние партнёрские каналы, где последнее от клиента
  const channels = await sql`
    SELECT id, name, source, assigned_to, sla_alert_level
    FROM support_channels
    WHERE org_id=${ORG}
      AND last_message_at > NOW() - INTERVAL '10 days'
      AND name ILIKE '%delever%'
      AND last_client_message_at IS NOT NULL
      AND (last_team_message_at IS NULL OR last_client_message_at >= last_team_message_at)
    ORDER BY last_client_message_at ASC
    LIMIT 200` as any[]

  for (const ch of channels) {
    stat.scanned++
    const msgs = await sql`SELECT is_from_client, ai_sentiment, content_type, text_content, ai_summary, created_at
      FROM support_messages WHERE channel_id=${ch.id} ORDER BY created_at DESC LIMIT 15` as any[]
    msgs.reverse()
    if (!msgs.length) continue
    const last = msgs[msgs.length - 1]

    // структура: последнее от команды → ок/resolved
    if (!last.is_from_client) { stat.resolved_or_ok++; continue }

    // первое неотвеченное сообщение клиента
    let fu: any = null
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (!m.is_from_client && !AUTO_GREETING.test(render(m)) && !BROADCAST.test(render(m))) break
      if (m.is_from_client) fu = m
    }
    if (!fu) fu = msgs.find((m: any) => m.is_from_client) || last
    const since = new Date(fu.created_at)

    // WA до реконнекта моста → HOLD
    if (ch.source === 'whatsapp' && since < WA_RECONNECT) { stat.hold++; continue }
    // старше MAX_AGE → STALE (не лид-спам)
    if ((now.getTime() - since.getTime()) / 864e5 > MAX_AGE_DAYS) {
      stat.stale++
      try { await sql`UPDATE support_channels SET sla_state='stale' WHERE id=${ch.id}` } catch {}
      continue
    }

    // рабочие минуты ожидания
    const neg = ['negative', 'frustrated'].includes(last.ai_sentiment)
    const prio = neg ? 0.5 : 1
    const bm = businessMinutesBetween(since, now, cfg)
    if (bm < T_WARN * prio) { stat.resolved_or_ok++; continue }

    // LLM-gate только для тех, кто за порогом
    stat.gated++
    const tail = msgs.slice(-4).map((m: any) => `${m.is_from_client ? 'КЛИЕНТ' : 'КОМАНДА'}: ${render(m).slice(0, 120)}`).join('\n')
    const needsReply = apiKey ? await gate(apiKey, tail) : true
    if (!needsReply) {
      stat.suppressed++
      try { await sql`UPDATE support_channels SET sla_state='ok', sla_alert_level=0 WHERE id=${ch.id}` } catch {}
      continue
    }

    // тир
    let tier = 'WARNING'
    if (bm >= T_CRIT * prio) tier = 'CRITICAL'; else if (bm >= T_BREACH * prio) tier = 'BREACH'
    const level = TIER_LEVEL[tier]
    const prev = ch.sla_alert_level || 0
    if (level <= prev) {
      try { await sql`UPDATE support_channels SET sla_state=${tier.toLowerCase()} WHERE id=${ch.id}` } catch {}
      continue // тир не вырос — анти-спам
    }

    // АЛЕРТ (в SHADOW — только лог + состояние, без рассылки)
    const ask = render(fu).slice(0, 120)
    const waitH = Math.round(bm / 6) / 10
    if (LIVE) {
      await sendNotification({
        orgId: ORG,
        type: 'sla_breach',
        title: `SLA ${tier}: ${ch.name}`,
        body: `Клиент ждёт ответа ~${waitH} раб.ч${neg ? ' (негатив)' : ''}. Запрос: «${ask}»`,
        channelId: ch.id,
        channelName: ch.name,
        priority: PRIORITY[tier],
        targetAgentIds: tier === 'WARNING' && ch.assigned_to ? [ch.assigned_to] : undefined,
        targetRoles: tier === 'WARNING' && ch.assigned_to ? undefined : ['admin', 'manager'],
      }).catch((e: any) => console.error('[sla-guard] notify failed', e?.message))
    } else {
      console.log(`[sla-guard:SHADOW] would alert ${tier} «${ch.name}» wait=${waitH}ч ask="${ask.slice(0, 50)}"`)
    }

    try {
      await sql`UPDATE support_channels SET sla_state=${tier.toLowerCase()}, sla_alert_level=${level}, sla_last_alert_at=NOW() WHERE id=${ch.id}`
    } catch {}
    stat.alerts[tier as 'WARNING' | 'BREACH' | 'CRITICAL']++
  }

  console.log(`[sla-guard:${LIVE ? 'LIVE' : 'SHADOW'}] ${JSON.stringify(stat)}`)
  return json({ ok: true, mode: LIVE ? 'live' : 'shadow', ...stat })
}
