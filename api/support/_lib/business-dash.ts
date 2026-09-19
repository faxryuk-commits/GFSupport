import type { NeonQueryFunction } from '@neondatabase/serverless'
import { loadChConfig, chQuery, CH_DONE_STATUS } from './clickhouse.js'

type SQL = NeonQueryFunction<false, false>

/**
 * Бизнес-дашборд: сводная картина платформы Delever из ClickHouse.
 * Считается кроном раз в день (и кнопкой), страница читает снапшот.
 * Только агрегаты; суммы в валютах не смешиваем — обороты не показываем.
 */
export async function computeBusinessDash(sql: SQL) {
  const cfg = await loadChConfig(sql)
  if (!cfg) return { ok: false as const, error: 'ClickHouse не настроен' }

  const D = CH_DONE_STATUS
  const [kpi, weekly, channels, cash, dtime, hours, movers, newcomers] = await Promise.all([
    chQuery(cfg, `
      SELECT countIf(created_at >= now() - INTERVAL 30 DAY AND status_id = ${D}) done30,
             countIf(created_at >= now() - INTERVAL 60 DAY AND created_at < now() - INTERVAL 30 DAY AND status_id = ${D}) prev30,
             countIf(created_at >= now() - INTERVAL 30 DAY AND status_id != ${D} AND finished_at IS NULL) cancel30,
             uniqExactIf(shipper_id, created_at >= now() - INTERVAL 30 DAY AND status_id = ${D}) brands30,
             uniqExactIf(shipper_id, created_at >= now() - INTERVAL 60 DAY AND created_at < now() - INTERVAL 30 DAY AND status_id = ${D}) brandsPrev30,
             round(quantileIf(0.5)(delivered_time, created_at >= now() - INTERVAL 30 DAY AND delivery_type='delivery' AND delivered_time BETWEEN 1 AND 300)) medMin,
             round(quantileIf(0.5)(distance, created_at >= now() - INTERVAL 30 DAY AND delivery_type='delivery' AND distance BETWEEN 1 AND 50000)) medDist
      FROM order_v`, 20000),
    chQuery(cfg, `
      SELECT toStartOfWeek(created_at) w, count() n
      FROM order_v WHERE status_id = ${D} AND created_at >= now() - INTERVAL 182 DAY
      GROUP BY w ORDER BY w`, 20000),
    chQuery(cfg, `
      SELECT toStartOfMonth(created_at) m,
             countIf(delivery_type = 'aggregator') agg,
             countIf(delivery_type = 'delivery') own,
             countIf(delivery_type = 'self-pickup') pickup,
             countIf(delivery_type = 'hall') hall
      FROM order_v WHERE status_id = ${D} AND created_at >= now() - INTERVAL 240 DAY
      GROUP BY m ORDER BY m`, 20000),
    chQuery(cfg, `
      SELECT toStartOfMonth(created_at) m,
             round(countIf(payment_type = 'cash') / count() * 100, 1) cashPct
      FROM order_v WHERE status_id = ${D} AND created_at >= now() - INTERVAL 240 DAY
      GROUP BY m ORDER BY m`, 20000),
    chQuery(cfg, `
      SELECT toStartOfMonth(created_at) m,
             round(quantileIf(0.5)(delivered_time, delivery_type='delivery' AND delivered_time BETWEEN 1 AND 300)) medMin
      FROM order_v WHERE status_id = ${D} AND created_at >= now() - INTERVAL 240 DAY
      GROUP BY m ORDER BY m`, 20000),
    chQuery(cfg, `
      SELECT toHour(created_at) h, count() n
      FROM order_v WHERE status_id = ${D} AND created_at >= now() - INTERVAL 30 DAY
      GROUP BY h ORDER BY h`, 20000),
    chQuery(cfg, `
      SELECT s.name, cur.done30, cur.prev30,
             round((cur.done30 - cur.prev30) / cur.prev30 * 100) chg
      FROM (
        SELECT shipper_id,
               countIf(created_at >= now() - INTERVAL 30 DAY) done30,
               countIf(created_at < now() - INTERVAL 30 DAY) prev30
        FROM order_v
        WHERE status_id = ${D} AND created_at >= now() - INTERVAL 60 DAY
        GROUP BY shipper_id
        HAVING prev30 >= 100
      ) cur
      INNER JOIN shippers s ON s.id = cur.shipper_id
      ORDER BY chg DESC`, 20000),
    chQuery(cfg, `
      SELECT count() n FROM (
        SELECT shipper_id FROM order_v WHERE status_id = ${D}
        GROUP BY shipper_id HAVING min(created_at) >= now() - INTERVAL 30 DAY
      )`, 20000),
  ])

  for (const r of [kpi, weekly, channels, cash, dtime, hours, movers, newcomers]) {
    if (!r.ok) return { ok: false as const, error: r.error || 'ошибка ClickHouse' }
  }

  const mv = (movers.data || []).map((r: any) => ({
    name: r.name, done30: Number(r.done30), prev30: Number(r.prev30), chg: Number(r.chg),
  }))
  const k = (kpi.data || [])[0] || {}
  const done30 = Number(k.done30 || 0), prev30 = Number(k.prev30 || 0)

  const payload = {
    kpi: {
      done30, prev30,
      momPct: prev30 ? Math.round((done30 - prev30) / prev30 * 1000) / 10 : null,
      cancelPct: done30 + Number(k.cancel30 || 0)
        ? Math.round(Number(k.cancel30 || 0) / (done30 + Number(k.cancel30 || 0)) * 100) : 0,
      brands30: Number(k.brands30 || 0),
      brandsPrev30: Number(k.brandsPrev30 || 0),
      newBrands30: Number((newcomers.data || [])[0]?.n || 0),
      medMin: k.medMin !== null && k.medMin !== undefined ? Number(k.medMin) : null,
      medDistKm: k.medDist ? Math.round(Number(k.medDist) / 100) / 10 : null,
    },
    // Крайние неполные периоды обрезаются — иначе график всегда «взлетает»
    // на входе окна и «падает» на текущей неделе/месяце
    weekly: (weekly.data || []).slice(1, -1).map((r: any) => ({ w: r.w, n: Number(r.n) })),
    channels: (channels.data || []).slice(1, -1).map((r: any) => ({
      m: r.m, agg: Number(r.agg), own: Number(r.own), pickup: Number(r.pickup), hall: Number(r.hall),
    })),
    cash: (cash.data || []).map((r: any) => ({ m: r.m, pct: Number(r.cashPct) })),
    dtime: (dtime.data || []).map((r: any) => ({ m: r.m, medMin: Number(r.medMin) })),
    hours: (hours.data || []).map((r: any) => ({ h: Number(r.h), n: Number(r.n) })),
    growers: mv.slice(0, 10),
    fallers: mv.slice(-10).reverse(),
  }

  await sql`
    CREATE TABLE IF NOT EXISTS business_dash_snapshot (
      id int PRIMARY KEY DEFAULT 1,
      computed_at timestamptz NOT NULL DEFAULT now(),
      payload jsonb NOT NULL
    )`
  await sql`
    INSERT INTO business_dash_snapshot (id, computed_at, payload)
    VALUES (1, now(), ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET computed_at = now(), payload = EXCLUDED.payload`
  return { ok: true as const, computedAt: new Date().toISOString(), ...payload }
}

export async function readBusinessDashSnapshot(sql: SQL): Promise<any | null> {
  try {
    const [row] = await sql`SELECT computed_at, payload FROM business_dash_snapshot WHERE id = 1`
    if (!row) return null
    return { computedAt: (row as any).computed_at, ...(row as any).payload }
  } catch {
    return null
  }
}
