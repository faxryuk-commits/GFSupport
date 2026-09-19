import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { loadChConfig, chQuery, CH_DONE_STATUS } from '../_lib/clickhouse.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * «Пульс бренда» — живые данные заказов клиента из аналитики Delever
 * в карточке аккаунта CRM. Связка через ch_brand_map (автомэппинг по имени,
 * подтверждается людьми). Только агрегаты по бренду; запросы зашиты в код.
 *
 * Отдаёт: недельную динамику заказов (12 недель), каналы и отмены за 30 дней,
 * светофор активации для новичков (<90 дней) и сигнал спада для остальных.
 * Пороги светофора выверены по когорте 13+ мес: старт ≥100 заказов/30д →
 * выживаемость 64–75% против 32% у стартующих с <30 заказов.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)
  const sql = getSQL()
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const accountId = new URL(req.url).searchParams.get('accountId') || ''
  if (!accountId) return json({ error: 'accountId required' }, 400)

  const [map] = await sql`
    SELECT shipper_id, shipper_name, confirmed FROM ch_brand_map WHERE account_id = ${accountId} LIMIT 1`
  if (!map) return json({ mapped: false })

  const cfg = await loadChConfig(sql)
  if (!cfg) return json({ mapped: true, error: 'ClickHouse не настроен' }, 200)

  const sid = String((map as any).shipper_id).replace(/[^0-9a-f-]/gi, '')

  const [weekly, month, first, meta] = await Promise.all([
    chQuery(cfg, `
      SELECT toStartOfWeek(created_at) w, count() n
      FROM order_v
      WHERE shipper_id = '${sid}' AND status_id = ${CH_DONE_STATUS}
        AND created_at >= now() - INTERVAL 84 DAY
      GROUP BY w ORDER BY w`),
    chQuery(cfg, `
      SELECT count() total,
             countIf(status_id = ${CH_DONE_STATUS}) done,
             countIf(status_id = ${CH_DONE_STATUS} AND delivery_type != 'aggregator') own,
             uniqExactIf(source, status_id = ${CH_DONE_STATUS}) channels,
             round(quantileIf(0.5)(delivered_time, delivery_type='delivery' AND delivered_time BETWEEN 1 AND 300)) med_min
      FROM order_v
      WHERE shipper_id = '${sid}' AND created_at >= now() - INTERVAL 30 DAY`),
    chQuery(cfg, `
      SELECT min(created_at) f0 FROM order_v
      WHERE shipper_id = '${sid}' AND status_id = ${CH_DONE_STATUS}`),
    chQuery(cfg, `SELECT rating, rating_count FROM shippers WHERE id = '${sid}' LIMIT 1`),
  ])

  if (!weekly.ok || !month.ok) {
    return json({ mapped: true, error: weekly.error || month.error }, 200)
  }

  const weeks = (weekly.data || []).map((r: any) => ({ week: r.w, n: Number(r.n) }))
  const m = (month.data || [])[0] || {}
  const total30 = Number(m.total || 0)
  const done30 = Number(m.done || 0)
  const cancelPct = total30 ? Math.round((1 - done30 / total30) * 100) : 0
  const ownPct = done30 ? Math.round(Number(m.own || 0) / done30 * 100) : 0

  const f0 = (first.data || [])[0]?.f0 || null
  const ageDays = f0 ? Math.floor((Date.now() - new Date(f0).getTime()) / 86400e3) : null

  // Светофор активации для новичков — пороги из когортного анализа
  let activation: null | { level: 'green' | 'yellow' | 'red'; reasons: string[] } = null
  if (ageDays !== null && ageDays <= 90) {
    const reasons: string[] = []
    if (done30 < 30) reasons.push(`мало заказов: ${done30} за 30 дней (порог выживания — от 100)`)
    else if (done30 < 100) reasons.push(`заказы ниже безопасного порога: ${done30}/30д (цель 100+)`)
    if (cancelPct > 40) reasons.push(`отмены ${cancelPct}% (у выживающих <20%)`)
    if (Number(m.channels || 0) < 2) reasons.push('один канал продаж (3+ канала → выживаемость 80%)')
    activation = {
      level: done30 >= 100 && cancelPct <= 40 ? 'green' : done30 >= 30 ? 'yellow' : 'red',
      reasons,
    }
  }

  // Сигнал спада для зрелых: последние 2 недели против медианы предыдущих 8
  let decline: null | { droppedPct: number } = null
  if (ageDays !== null && ageDays > 90 && weeks.length >= 6) {
    const closed = weeks.slice(0, -1) // текущая неделя неполная
    const recent = closed.slice(-2).reduce((s, w) => s + w.n, 0) / 2
    const base = closed.slice(0, -2).map(w => w.n).sort((a, b) => a - b)
    const med = base.length ? base[Math.floor(base.length / 2)] : 0
    if (med >= 20 && recent < med * 0.75) {
      decline = { droppedPct: Math.round((1 - recent / med) * 100) }
    }
  }

  return json({
    mapped: true,
    confirmed: Boolean((map as any).confirmed),
    shipperName: (map as any).shipper_name,
    ageDays,
    weeks,
    month30: {
      done: done30, cancelPct, ownPct,
      channels: Number(m.channels || 0),
      medMin: m.med_min !== null && m.med_min !== undefined ? Number(m.med_min) : null,
    },
    rating: meta.ok && meta.data?.[0] ? { value: Number(meta.data[0].rating || 0), count: Number(meta.data[0].rating_count || 0) } : null,
    activation,
    decline,
  })
}
