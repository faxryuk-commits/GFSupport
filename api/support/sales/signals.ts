import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { loadChConfig, chQuery, CH_DONE_STATUS } from '../_lib/clickhouse.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Сводка сигналов по клиентам из аналитики Delever:
 *  — «спад»: зрелый бренд (90+ дней), последние 2 полные недели < 75%
 *    его же медианы за предыдущие недели;
 *  — «запуск под угрозой»: бренд моложе 90 дней, не добравший порогов
 *    активации (≥100 заказов/30д, отмены ≤40%) — пороги из когортного
 *    анализа: старт ≥100 → выживаемость 64–75%, старт <30 → 32%.
 * Считается на лету по брендам из ch_brand_map; только агрегаты.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)
  const sql = getSQL()
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const cfg = await loadChConfig(sql)
  if (!cfg) return json({ error: 'ClickHouse не настроен' }, 200)

  const maps = await sql`
    SELECT m.account_id, m.shipper_id, m.shipper_name, m.confirmed, a.lifecycle, a.owner_agent_id
    FROM ch_brand_map m
    JOIN sales_accounts a ON a.id = m.account_id
    WHERE a.archived_at IS NULL`
  if (!maps.length) return json({ declines: [], launches: [], mapped: 0 })

  const ids = (maps as any[]).map(m => `'${String(m.shipper_id).replace(/[^0-9a-f-]/gi, '')}'`).join(',')

  const [wk, agg] = await Promise.all([
    chQuery(cfg, `
      SELECT shipper_id, toStartOfWeek(created_at) w, count() n
      FROM order_v
      WHERE shipper_id IN (${ids}) AND status_id = ${CH_DONE_STATUS}
        AND created_at >= now() - INTERVAL 84 DAY
      GROUP BY shipper_id, w ORDER BY shipper_id, w`, 15000),
    chQuery(cfg, `
      SELECT shipper_id,
             min(created_at) f0,
             countIf(created_at >= now() - INTERVAL 30 DAY) total30,
             countIf(created_at >= now() - INTERVAL 30 DAY AND status_id = ${CH_DONE_STATUS}) done30,
             uniqExactIf(source, created_at >= now() - INTERVAL 30 DAY AND status_id = ${CH_DONE_STATUS}) channels
      FROM order_v
      WHERE shipper_id IN (${ids})
      GROUP BY shipper_id`, 15000),
  ])
  if (!wk.ok || !agg.ok) return json({ error: wk.error || agg.error }, 200)

  const byShip: Record<string, any> = {}
  for (const m of maps as any[]) byShip[m.shipper_id] = m
  const weeks: Record<string, number[]> = {}
  for (const r of wk.data || []) (weeks[r.shipper_id] = weeks[r.shipper_id] || []).push(Number(r.n))

  const declines: any[] = []
  const launches: any[] = []
  for (const r of agg.data || []) {
    const m = byShip[r.shipper_id]
    if (!m || !r.f0) continue
    const ageDays = Math.floor((Date.now() - new Date(r.f0).getTime()) / 86400e3)
    const done30 = Number(r.done30), total30 = Number(r.total30)
    const cancelPct = total30 ? Math.round((1 - done30 / total30) * 100) : 0
    const base = {
      accountId: m.account_id, name: m.shipper_name, lifecycle: m.lifecycle,
      confirmed: Boolean(m.confirmed), ageDays, done30, cancelPct, channels: Number(r.channels || 0),
    }
    if (ageDays > 90) {
      const ws = weeks[r.shipper_id] || []
      if (ws.length >= 6) {
        const closed = ws.slice(0, -1) // текущая неделя не закончилась
        const recent = (closed[closed.length - 1] + closed[closed.length - 2]) / 2
        const sorted = closed.slice(0, -2).slice().sort((a, b) => a - b)
        const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
        if (med >= 20 && recent < med * 0.75) {
          declines.push({ ...base, weeklyNorm: med, weeklyNow: Math.round(recent), dropPct: Math.round((1 - recent / med) * 100) })
        }
      }
    } else if (done30 < 100 || cancelPct > 40) {
      launches.push({
        ...base,
        level: done30 < 30 || cancelPct > 60 ? 'red' : 'yellow',
      })
    }
  }
  declines.sort((a, b) => b.dropPct - a.dropPct)
  launches.sort((a, b) => (a.level === b.level ? a.done30 - b.done30 : a.level === 'red' ? -1 : 1))

  return json({ mapped: maps.length, declines, launches })
}
