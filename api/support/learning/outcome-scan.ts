/**
 * Cron: детектор ИСХОДА — замыкает петлю самообучения агента.
 *
 * Для каждого решения агента (reply/reply_and_tag) без оценки смотрит реакцию
 * КЛИЕНТА после ответа и автоматически ставит feedback='correct'|'wrong'.
 * Эти метки УЖЕ читает runAgent (fetchFeedbackExamples → УДАЧНЫЕ/ОШИБКИ в промпте),
 * так что агент сразу учится на реальных исходах, без ручной разметки.
 *
 * Расписание: каждые 30 мин (см. vercel.json). Исход созревает не сразу.
 * Защита: Vercel cron (user-agent) или CRON_SECRET.
 */
import { getSQL, json, getOpenAIKey } from '../lib/db.js'

export const config = { runtime: 'edge', regions: ['iad1'], maxDuration: 60 }

const ORG = process.env.SLA_GUARD_ORG || 'org_delever'

const SYS = `Дан ОТВЕТ поддержки Delever клиенту и СЛЕДУЮЩИЕ сообщения клиента. Помог ли ответ?
- resolved=true: клиент благодарит/подтверждает/закрывает тему (спасибо, рахмат, хоп, заработало, ок).
- resolved=false: клиент повторяет проблему, злится, пишет «не работает/не помогло», эскалирует.
- unclear: новая тема или непонятно.
Учитывай рус/узб/каз. Ответь СТРОГО JSON: {"resolved":true|false|null}`

async function classify(apiKey: string, reply: string, followups: string): Promise<boolean | null> {
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', response_format: { type: 'json_object' }, temperature: 0,
        messages: [{ role: 'system', content: SYS }, { role: 'user', content: `ОТВЕТ ПОДДЕРЖКИ: ${reply}\n\nПОТОМ КЛИЕНТ:\n${followups}` }] }),
      signal: AbortSignal.timeout(20000),
    })
    if (!r.ok) return null
    const d: any = await r.json()
    const v = JSON.parse(d.choices[0].message.content).resolved
    return v === true ? true : v === false ? false : null
  } catch { return null }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null)
  const ua = req.headers.get('user-agent') || ''
  const auth = req.headers.get('authorization') || ''
  if (!ua.includes('vercel-cron') && !(process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)) {
    return json({ error: 'Unauthorized' }, 401)
  }
  const sql = getSQL()
  try { await sql`ALTER TABLE support_agent_decisions ADD COLUMN IF NOT EXISTS feedback VARCHAR(20)` } catch {}
  try { await sql`ALTER TABLE support_agent_decisions ADD COLUMN IF NOT EXISTS feedback_note TEXT` } catch {}
  try { await sql`ALTER TABLE support_agent_decisions ADD COLUMN IF NOT EXISTS outcome_at TIMESTAMPTZ` } catch {}

  const apiKey = await getOpenAIKey(ORG)
  if (!apiKey) return json({ ok: false, error: 'no openai key' })

  // решения с ответом, ещё без оценки, не моложе 30 мин (дать клиенту время) и не старше 7 дней
  const decisions = await sql`
    SELECT id, channel_id, reply_text, created_at
    FROM support_agent_decisions
    WHERE org_id = ${ORG} AND feedback IS NULL
      AND action IN ('reply', 'reply_and_tag') AND reply_text IS NOT NULL
      AND created_at < NOW() - INTERVAL '30 minutes'
      AND created_at > NOW() - INTERVAL '7 days'
    ORDER BY created_at DESC LIMIT 40` as any[]

  const stat = { checked: 0, correct: 0, wrong: 0, unclear: 0, pending: 0 }
  for (const d of decisions) {
    stat.checked++
    // сообщения клиента ПОСЛЕ ответа агента
    const after = await sql`
      SELECT text_content, ai_summary FROM support_messages
      WHERE channel_id = ${d.channel_id} AND is_from_client = true AND created_at > ${d.created_at}
      ORDER BY created_at ASC LIMIT 3` as any[]
    if (!after.length) { stat.pending++; continue } // клиент ещё не ответил — ждём
    const followups = after.map((m) => (m.text_content || m.ai_summary || '[медиа]').replace(/\s+/g, ' ').slice(0, 200)).join('\n')
    const resolved = await classify(apiKey, String(d.reply_text).slice(0, 400), followups)
    if (resolved === null) { stat.unclear++; continue }
    const fb = resolved ? 'correct' : 'wrong'
    if (resolved) stat.correct++; else stat.wrong++
    try {
      await sql`UPDATE support_agent_decisions SET feedback = ${fb}, feedback_note = ${'auto: реакция клиента'}, outcome_at = NOW() WHERE id = ${d.id}`
    } catch {}
  }

  // heartbeat в ledger — чтобы пульт «Модули» видел, когда модуль работал
  try {
    await sql`CREATE TABLE IF NOT EXISTS support_ai_events (id BIGSERIAL PRIMARY KEY, org_id VARCHAR(50), actor VARCHAR(30), kind VARCHAR(30), channel_id VARCHAR(60), channel_name VARCHAR(255), tier VARCHAR(20), reasoning TEXT, payload JSONB, mode VARCHAR(10), created_at TIMESTAMPTZ DEFAULT NOW())`
    await sql`INSERT INTO support_ai_events (org_id, actor, kind, reasoning, payload)
      VALUES (${ORG}, 'learning', 'cycle', ${`Исходы: ${stat.correct} ✅ / ${stat.wrong} ❌, ${stat.pending} ждут`}, ${JSON.stringify(stat)}::jsonb)`
  } catch {}

  console.log(`[outcome-scan] ${JSON.stringify(stat)}`)
  return json({ ok: true, ...stat })
}
