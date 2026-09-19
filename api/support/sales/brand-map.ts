import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { loadChConfig, chQuery, CH_DONE_STATUS } from '../_lib/clickhouse.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Ручная связка аккаунта CRM с брендом Delever: поиск бренда по имени,
 * привязка (сразу подтверждённая — её делает человек), подтверждение
 * автосвязки и отвязка. Дополняет автомэппинг по имени.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  const sql = getSQL()
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  if (req.method === 'GET') {
    const q = (new URL(req.url).searchParams.get('q') || '').trim()
    if (q.length < 2) return json({ brands: [] })
    const cfg = await loadChConfig(sql)
    if (!cfg) return json({ error: 'ClickHouse не настроен' }, 200)
    const safe = q.replace(/['\\%_]/g, '')
    const res = await chQuery(cfg, `
      SELECT id, name, is_archived FROM shippers
      WHERE name ILIKE '%${safe}%'
      ORDER BY is_archived, name LIMIT 10`)
    if (!res.ok) return json({ error: res.error }, 200)
    const found = res.data || []
    // Индикаторы живости: одинаковых имён в платформе несколько, и без
    // «заказов за 30 дней» не понять, который из них настоящий
    if (found.length) {
      const ids = found.map((b: any) => `'${String(b.id).replace(/[^0-9a-f-]/gi, '')}'`).join(',')
      const act = await chQuery(cfg, `
        SELECT shipper_id,
               countIf(created_at >= now() - INTERVAL 30 DAY AND status_id = ${CH_DONE_STATUS}) done30,
               max(created_at) last_order
        FROM order_v WHERE shipper_id IN (${ids}) GROUP BY shipper_id`)
      if (act.ok) {
        const byId: Record<string, any> = {}
        for (const a of act.data || []) byId[a.shipper_id] = a
        for (const b of found as any[]) {
          const a = byId[b.id]
          b.done30 = a ? Number(a.done30) : 0
          b.lastOrderDays = a?.last_order
            ? Math.floor((Date.now() - new Date(a.last_order).getTime()) / 86400e3)
            : null
        }
      }
    }
    return json({ brands: found })
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  let body: any = {}
  try { body = await req.json() } catch { /* пустое тело */ }
  const accountId = String(body.accountId || '')
  if (!accountId) return json({ error: 'accountId required' }, 400)

  if (body.action === 'link') {
    const shipperId = String(body.shipperId || '').replace(/[^0-9a-f-]/gi, '')
    const shipperName = String(body.shipperName || '').slice(0, 200)
    if (!shipperId) return json({ error: 'shipperId required' }, 400)
    await sql`
      INSERT INTO ch_brand_map (account_id, shipper_id, shipper_name, method, confirmed)
      VALUES (${accountId}, ${shipperId}, ${shipperName}, 'manual', true)
      ON CONFLICT (account_id) DO UPDATE
        SET shipper_id = EXCLUDED.shipper_id, shipper_name = EXCLUDED.shipper_name,
            method = 'manual', confirmed = true`
    return json({ ok: true })
  }

  if (body.action === 'confirm') {
    await sql`UPDATE ch_brand_map SET confirmed = true WHERE account_id = ${accountId}`
    return json({ ok: true })
  }

  if (body.action === 'unlink') {
    await sql`DELETE FROM ch_brand_map WHERE account_id = ${accountId}`
    return json({ ok: true })
  }

  return json({ error: 'unknown action' }, 400)
}
