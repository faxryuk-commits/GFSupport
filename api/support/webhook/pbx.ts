import { getSQL, json, corsHeaders, ensureOnce } from '../_lib/db.js'
import { pbxHookSecret } from '../_lib/pbx.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Вебхук OnlinePBX: события звонков в реальном времени.
 *
 * Синк истории ходит в АТС раз в пять минут — для отчётов достаточно, но
 * «звонит прямо сейчас» так не показать. АТС умеет слать события сама
 * (личный кабинет → Сервисы → Webhooks); адрес с секретом показывается
 * в Настройках → Телефония. События складываются как есть — формат закрыт
 * документацией, поэтому разбор оборонительный, а сырьё остаётся в raw
 * для доводки по живым данным. Звонилка опрашивает свежие события и
 * показывает всплывающий входящий ещё до снятой трубки.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: true })

  const sql = getSQL()
  const url = new URL(req.url)
  const secret = url.searchParams.get('s') || ''
  // Ошибок наружу не отдаём: вебхук — публичный URL, и различимые ответы
  // помогали бы перебору
  if (!secret) return json({ ok: true })

  const keys = await sql`
    SELECT org_id, value FROM support_settings WHERE key = 'onlinepbx_api_key'
  `.catch(() => [] as any[]) as any[]
  let orgId: string | null = null
  for (const k of keys) {
    if (await pbxHookSecret(String(k.value || '')) === secret) { orgId = k.org_id; break }
  }
  if (!orgId) return json({ ok: true })

  const text = await req.text().catch(() => '')
  let data: any = null
  try { data = JSON.parse(text) } catch {
    data = Object.fromEntries(new URLSearchParams(text))
  }
  const pick = (...names: string[]): string | null => {
    for (const n of names) {
      const v = data?.[n]
      if (v !== undefined && v !== null && String(v).length) return String(v).slice(0, 64)
    }
    return null
  }
  // Живой формат (сверен по событиям): caller/callee/event/direction прямые
  // поля, на call_end приезжают hangup_cause и download_url записи
  const caller = pick('caller', 'caller_id_number', 'caller_id', 'from', 'src', 'phone')
  const callee = pick('callee', 'destination_number', 'destination', 'to', 'dst', 'user')
  const event = pick('event', 'type', 'status', 'state', 'command', 'hangup_cause')

  await ensureOnce('pbx-events', async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS sales_pbx_events (
        id BIGSERIAL PRIMARY KEY,
        org_id VARCHAR(50) NOT NULL,
        caller VARCHAR(64),
        callee VARCHAR(64),
        event VARCHAR(64),
        raw JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    await sql`
      CREATE INDEX IF NOT EXISTS idx_pbx_events_org_at
      ON sales_pbx_events(org_id, created_at DESC)
    `
  })
  await sql`
    INSERT INTO sales_pbx_events (org_id, caller, callee, event, raw)
    VALUES (${orgId}, ${caller}, ${callee}, ${event},
            ${JSON.stringify(data).slice(0, 8000)}::jsonb)
  `.catch(() => {})
  // События нужны минуту, живут сутки — на случай разбора формата
  await sql`
    DELETE FROM sales_pbx_events WHERE created_at < NOW() - INTERVAL '1 day'
  `.catch(() => {})

  return json({ ok: true })
}
