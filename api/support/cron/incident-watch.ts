import { getSQL, json } from '../lib/db.js'
import { assertCron, cronSecured } from '../lib/cron-auth.js'
import { ensureErrorFeedSchema, indexFeed, detectSpikes } from '../lib/error-feed.js'
import { logEvent } from '../lib/system-journal.js'

export const config = { runtime: 'edge' }

/**
 * Сводка состояния систем — раз в 2 минуты.
 *
 * 1. Индексирует новые сообщения канала ошибок (≈2–3 на минуту).
 * 2. Ищет всплески одинаковых ошибок → инциденты «error_spike».
 * 3. Читает свежие сообщения партнёрских/технических групп и, если люди
 *    пишут об аварии («iiko лежит», «восстановили»), ведёт инциденты
 *    «partner_report». Жаргон учтён: «заказ упал» здесь означает «дошёл
 *    до кассы», признак проблемы — «НЕ упал».
 *
 * Сводка питает промпт агента и бейдж в обзоре: система узнаёт об аварии
 * тем же путём, что сотрудники, — но в момент прихода сообщения.
 */
const ORG = process.env.SALES_ORG || 'org_delever'
const SCAN_CURSOR = 'incident_scan_at'

const GLOSSARY = 'Жаргон: «заказ упал» = успешно дошёл до кассы (НЕ проблема); '
  + '«не упал», «упал без интеграции» = проблема. «Пробили вручную» = обошли сбой руками.'

async function scanPartnerGroups(sql: any, apiKey: string | undefined) {
  const [cur] = await sql`SELECT value FROM support_platform_settings WHERE key = ${SCAN_CURSOR}`
  const since = cur?.value || new Date(Date.now() - 3600_000).toISOString()

  const msgs = await sql`
    SELECT m.id, m.text_content, m.created_at, ch.name AS channel
    FROM support_messages m
    JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = ${ORG}
    WHERE ch.name ~* 'supply|business partners|технические вопросы'
      AND m.created_at > ${since}::timestamptz
      AND m.text_content IS NOT NULL AND LENGTH(m.text_content) > 10
    ORDER BY m.created_at LIMIT 30
  `
  if (!msgs.length) return { scanned: 0, events: 0 }
  const maxAt = (msgs as any[])[msgs.length - 1].created_at
  await sql`
    INSERT INTO support_platform_settings (key, value, updated_at)
    VALUES (${SCAN_CURSOR}, ${new Date(maxAt).toISOString()}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `
  if (!apiKey) return { scanned: msgs.length, events: 0 }

  const numbered = (msgs as any[]).map((m, i) =>
    `${i + 1}. [${m.channel}] ${String(m.text_content).replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `Ты следишь за сообщениями в технических группах платформы доставки. ${GLOSSARY} `
          + 'Найди сообщения о МАССОВЫХ сбоях или восстановлении систем (iiko, Wolt, Yandex, Uzum, наша платформа). '
          + 'Единичная проблема одного ресторана — НЕ авария. '
          + 'JSON: {"events":[{"n":1,"system":"iiko","status":"down|degraded|restored","quote":"..."}]} — только уверенные случаи.' },
        { role: 'user', content: numbered },
      ],
    }),
  })
  if (!res.ok) return { scanned: msgs.length, events: 0 }
  const data = await res.json()
  let events: any[] = []
  try { events = JSON.parse(data.choices[0].message.content).events || [] } catch { /* нет событий */ }

  let applied = 0
  for (const e of events) {
    const m = (msgs as any[])[Number(e.n) - 1]
    if (!m || !e.system) continue
    const sys = String(e.system).toLowerCase().slice(0, 60)
    if (e.status === 'restored') {
      await sql`
        UPDATE system_incidents SET status = 'resolved', resolved_at = ${m.created_at}
        WHERE status = 'open' AND kind = 'partner_report' AND system = ${sys}
      `
    } else {
      const [open] = await sql`
        SELECT id FROM system_incidents
        WHERE status = 'open' AND kind = 'partner_report' AND system = ${sys} LIMIT 1
      `
      if (open) {
        await sql`UPDATE system_incidents SET last_seen = ${m.created_at}, count = count + 1 WHERE id = ${open.id}`
      } else {
        await sql`
          INSERT INTO system_incidents (id, kind, system, title, status, first_seen, last_seen, sample, source_ref, confidence)
          VALUES (${'inc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)},
                  'partner_report', ${sys}, ${String(e.status).slice(0, 40)}, 'open',
                  ${m.created_at}, ${m.created_at}, ${String(e.quote || '').slice(0, 300)}, ${m.channel}, 0.8)
        `
      }
    }
    applied++
  }
  return { scanned: msgs.length, events: applied }
}

export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

  const sql = getSQL()
  const started = Date.now()
  try {
    await ensureErrorFeedSchema(sql)
    const idx = await indexFeed(sql, ORG)
    const spikes = await detectSpikes(sql)
    const partner = await scanPartnerGroups(sql, process.env.OPENAI_API_KEY)
    if (partner.events > 0) {
      await logEvent(sql, 'Сводка аварий', 'сигнал из партнёрских групп',
        `распознано событий: ${partner.events} из ${partner.scanned} сообщений`)
    }
    return json({ ok: true, secured: cronSecured(), ms: Date.now() - started, ...idx, ...spikes, partner })
  } catch (e: any) {
    console.error('[incident-watch] failed:', e)
    return json({ ok: false, error: e?.message || 'failed' }, 200)
  }
}
