/**
 * Cron: ИИ-агент сканер. Гарантирует, что агент реально отрабатывает на живом
 * трафике — НЕ полагаясь на то, что webhook доберётся до runAgent.
 *
 * Зачем: входящие пишутся в БД, но inline-вызов агента в webhook на практике
 * не давал решений (см. сессию: модель Together была мертва + неопределённость
 * пути ингеста). Крон делает путь детерминированным: каждые N минут находит
 * каналы, где клиент ждёт, и прогоняет runAgent. runAgent сам логирует решение
 * в support_agent_decisions → видно в «Журнале ИИ» и «Журнале решений» агента.
 *
 * Расписание: каждые 5 минут (vercel.json crons).
 *
 * SHADOW-безопасность: вызываем ТОЛЬКО runAgent (он логирует решение). НЕ зовём
 * executeDecision → клиенту НИЧЕГО не уходит, команде уведомлений нет. Чистое
 * наблюдение качества в Журнале. Когда решим выводить в live — отдельный шаг.
 *
 * Дедуп: на одну «реплику клиента» — одно решение. Канал пропускается, если
 * по нему уже есть решение агента ПОСЛЕ последнего сообщения клиента.
 *
 * Гейт: весь скан выключается, если ai_agent_enabled != true (как у runAgent).
 * Защита эндпоинта: Vercel cron (user-agent) или CRON_SECRET.
 */
import { getSQL, json } from '../lib/db.js'
import { runAgent } from '../lib/ai-agent.js'

export const config = { runtime: 'edge', maxDuration: 60 }

const ORG = process.env.AGENT_SCAN_ORG || 'org_delever'
const WA_RECONNECT = new Date('2026-06-03T00:00:00Z')
const MAX_AGE_DAYS = 3          // старше — уже не «горячий» диалог, не наблюдаем
const MAX_PER_RUN = 25          // лимит вызовов модели за цикл (стоимость/время)

const render = (m: any) => {
  const t = (m.text_content || m.ai_summary || '').replace(/\s+/g, ' ')
  if (t) return t
  return m.content_type && m.content_type !== 'text' ? `[вложение ${m.content_type} без текста]` : ''
}

async function agentEnabled(sql: any): Promise<boolean> {
  try {
    const r = await sql`SELECT value FROM support_settings WHERE org_id=${ORG} AND key='ai_agent_enabled' LIMIT 1`
    return String(r[0]?.value ?? '').toLowerCase() === 'true'
  } catch { return false }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null)
  const ua = req.headers.get('user-agent') || ''
  const auth = req.headers.get('authorization') || ''
  if (!ua.includes('vercel-cron') && !(process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  try {
    await sql`CREATE TABLE IF NOT EXISTS support_ai_events (
      id BIGSERIAL PRIMARY KEY, org_id VARCHAR(50), actor VARCHAR(30), kind VARCHAR(30),
      channel_id VARCHAR(60), channel_name VARCHAR(255), tier VARCHAR(20),
      reasoning TEXT, payload JSONB, mode VARCHAR(10), created_at TIMESTAMPTZ DEFAULT NOW()
    )` } catch {}

  const enabled = await agentEnabled(sql)
  const stat = { enabled, scanned: 0, ran: 0, decided: 0, skipped: 0, already: 0, hold: 0, errors: 0, actions: {} as Record<string, number> }

  if (!enabled) {
    try {
      await sql`INSERT INTO support_ai_events (org_id, actor, kind, reasoning, payload, mode)
        VALUES (${ORG}, 'agent_scan', 'cycle', 'Агент выключен (ai_agent_enabled=false) — скан пропущен', ${JSON.stringify(stat)}::jsonb, 'shadow')`
    } catch {}
    return json({ ok: true, ...stat })
  }

  // кандидаты: партнёрские каналы, где последнее сообщение от клиента (клиент ждёт)
  const channels = await sql`
    SELECT id, name, source, last_client_message_at
    FROM support_channels
    WHERE org_id=${ORG}
      AND last_message_at > NOW() - INTERVAL '3 days'
      AND name ILIKE '%delever%'
      AND last_client_message_at IS NOT NULL
      AND (last_team_message_at IS NULL OR last_client_message_at >= last_team_message_at)
    ORDER BY last_client_message_at DESC
    LIMIT 200` as any[]

  const now = Date.now()

  for (const ch of channels) {
    if (stat.ran >= MAX_PER_RUN) break
    stat.scanned++

    // WA до реконнекта моста → HOLD (дыра простоя, данные недостоверны)
    if (ch.source === 'whatsapp' && new Date(ch.last_client_message_at) < WA_RECONNECT) { stat.hold++; continue }
    // слишком старый «висяк» — не наблюдаем
    if ((now - new Date(ch.last_client_message_at).getTime()) / 864e5 > MAX_AGE_DAYS) { stat.skipped++; continue }

    // дедуп: уже есть решение агента ПОСЛЕ последнего сообщения клиента?
    try {
      const [d] = await sql`SELECT created_at FROM support_agent_decisions
        WHERE org_id=${ORG} AND channel_id=${ch.id} ORDER BY created_at DESC LIMIT 1`
      if (d?.created_at && new Date(d.created_at) >= new Date(ch.last_client_message_at)) { stat.already++; continue }
    } catch {}

    // последнее сообщение клиента = входящее для агента
    const [lastClient] = await sql`SELECT sender_name, text_content, ai_summary, content_type, is_from_client
      FROM support_messages WHERE channel_id=${ch.id} AND org_id=${ORG}
      ORDER BY created_at DESC LIMIT 1` as any[]
    if (!lastClient || !lastClient.is_from_client) { stat.skipped++; continue }
    const incoming = render(lastClient)
    if (!incoming || incoming.length < 2) { stat.skipped++; continue }

    // прогон агента — runAgent сам делает shouldSkipChannel + logDecision
    try {
      stat.ran++
      const res = await runAgent({
        channelId: ch.id,
        channelName: ch.name,
        orgId: ORG,
        incomingMessage: incoming,
        senderName: lastClient.sender_name || 'Клиент',
        isGroup: true,
        source: ch.source === 'whatsapp' ? 'whatsapp' : 'telegram',
      })
      if (res?.skipped) { stat.skipped++; continue }
      if (res?.decision) {
        stat.decided++
        const a = res.decision.action || 'unknown'
        stat.actions[a] = (stat.actions[a] || 0) + 1
        // НЕ зовём executeDecision: чистый shadow — клиенту/команде ничего не уходит.
      }
    } catch (e: any) {
      stat.errors++
      console.error('[agent-scan] runAgent error', ch.id, e?.message)
    }
  }

  try {
    await sql`INSERT INTO support_ai_events (org_id, actor, kind, reasoning, payload, mode)
      VALUES (${ORG}, 'agent_scan', 'cycle',
        ${`Цикл: ${stat.scanned} скан, ${stat.ran} прогон, ${stat.decided} решений (${stat.already} уже было)`},
        ${JSON.stringify(stat)}::jsonb, 'shadow')`
  } catch {}

  console.log(`[agent-scan] ${JSON.stringify(stat)}`)
  return json({ ok: true, ...stat })
}
