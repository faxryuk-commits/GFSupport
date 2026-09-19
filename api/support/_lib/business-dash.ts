import type { NeonQueryFunction } from '@neondatabase/serverless'
import { loadChConfig, chQuery, CH_DONE_STATUS } from './clickhouse.js'

type SQL = NeonQueryFunction<false, false>

/**
 * Бизнес-дашборд: сводная картина платформы Delever из ClickHouse,
 * нарезанная по странам (рынкам). Все срезы считаются заранее в один
 * снапшот — фильтр на странице переключается мгновенно, без запросов.
 * Деньги показываем только внутри рынка (валюты разные, суммы через
 * границы не складываем); срез «ALL» отдаёт avgCheck = null.
 */

const D = CH_DONE_STATUS
// Присоединение страны бренда; ISO-код — ключ среза
const JOIN = `INNER JOIN shippers s ON s.id = o.shipper_id LEFT JOIN countries c ON c.id = s.country_id`
const ISO = `ifNull(nullIf(c.iso_code, ''), '—')`

/**
 * Срез по странам + итог по платформе ОДНИМ сканом: GROUPING SETS считает
 * агрегаты (включая медианы — честно, не суммой) и по (период, страна),
 * и по (период). В итоговых строках ключ iso приходит пустым — JS мапит
 * '' → 'ALL'. Вариант с UNION ALL сканировал таблицу дважды и не влезал
 * в 25 секунд edge-функции (FUNCTION_INVOCATION_TIMEOUT).
 */
function slicedQuery(cols: string, where: string, group?: string) {
  const sets = group ? `GROUPING SETS ((${group}, iso), (${group}))` : `GROUPING SETS ((iso), ())`
  return `SELECT ${ISO} AS iso, ${cols} FROM order_v o ${JOIN} WHERE ${where} GROUP BY ${sets}`
}

const kpiCols = (p: string) => `
  countIf(${p}created_at >= now() - INTERVAL 30 DAY AND ${p}status_id = ${D}) done30,
  countIf(${p}created_at >= now() - INTERVAL 60 DAY AND ${p}created_at < now() - INTERVAL 30 DAY AND ${p}status_id = ${D}) prev30,
  countIf(${p}created_at >= now() - INTERVAL 30 DAY AND ${p}status_id != ${D} AND ${p}finished_at IS NULL) cancel30,
  uniqExactIf(${p}shipper_id, ${p}created_at >= now() - INTERVAL 30 DAY AND ${p}status_id = ${D}) brands30,
  uniqExactIf(${p}shipper_id, ${p}created_at >= now() - INTERVAL 60 DAY AND ${p}created_at < now() - INTERVAL 30 DAY AND ${p}status_id = ${D}) brandsPrev30,
  round(quantileIf(0.5)(${p}delivered_time, ${p}created_at >= now() - INTERVAL 30 DAY AND ${p}status_id = ${D} AND ${p}delivery_type = 'delivery' AND ${p}delivered_time BETWEEN 1 AND 300)) medMin,
  round(quantileIf(0.5)(${p}distance, ${p}created_at >= now() - INTERVAL 30 DAY AND ${p}status_id = ${D} AND ${p}delivery_type = 'delivery' AND ${p}distance BETWEEN 1 AND 50000)) medDist,
  round(avgIf(${p}price, ${p}created_at >= now() - INTERVAL 30 DAY AND ${p}status_id = ${D} AND ${p}price > 0)) avgCheck,
  round(quantileIf(0.5)(${p}price, ${p}created_at >= now() - INTERVAL 30 DAY AND ${p}status_id = ${D} AND ${p}price > 0)) medCheck,
  round(countIf(${p}created_at >= now() - INTERVAL 30 DAY AND ${p}status_id = ${D} AND ${p}delivery_type = 'delivery' AND ${p}delivered_in_time = 1)
    / nullIf(countIf(${p}created_at >= now() - INTERVAL 30 DAY AND ${p}status_id = ${D} AND ${p}delivery_type = 'delivery'), 0) * 100) ontimePct`

export const DASH_QUERIES = {
  kpi: slicedQuery(
    `any(ifNull(c.name, '')) cname, any(ifNull(c.currency, '')) cur, ${kpiCols('o.')}`,
    `o.created_at >= now() - INTERVAL 60 DAY`),
  weekly: slicedQuery(
    `toStartOfWeek(o.created_at) w, count() n`,
    `o.status_id = ${D} AND o.created_at >= now() - INTERVAL 371 DAY`, 'w'),
  // Каналы, источники, оплаты и качество — одним сканом 400 дней:
  // по отдельности четыре запроса не влезали в лимит edge
  months: slicedQuery(
    `toStartOfMonth(o.created_at) m,
      countIf(o.delivery_type = 'aggregator') d_agg, countIf(o.delivery_type = 'delivery') d_own,
      countIf(o.delivery_type = 'self-pickup') d_pickup, countIf(o.delivery_type = 'hall') d_hall,
      countIf(o.source = 'aggregator') s_agg, countIf(o.source = 'admin_panel') s_admin,
      countIf(o.source = 'bot') s_bot, countIf(o.source = 'kiosk') s_kiosk,
      countIf(o.source IN ('ios', 'android')) s_mobile, countIf(o.source = 'website') s_website,
      countIf(o.source = 'hall') s_hall,
      countIf(o.payment_type = 'cash') p_cash, countIf(o.payment_type = 'card') p_card,
      countIf(o.payment_type = 'online') p_online,
      countIf(o.payment_type NOT IN ('cash', 'card', 'online')) p_other,
      round(quantileIf(0.5)(o.delivered_time, o.delivery_type = 'delivery' AND o.delivered_time BETWEEN 1 AND 300)) q_medMin,
      round(countIf(o.delivery_type = 'delivery' AND o.delivered_in_time = 1)
        / nullIf(countIf(o.delivery_type = 'delivery'), 0) * 100) q_ontime`,
    `o.status_id = ${D} AND o.created_at >= now() - INTERVAL 400 DAY`, 'm'),
  hours: slicedQuery(
    `toHour(o.created_at) h, count() n`,
    `o.status_id = ${D} AND o.created_at >= now() - INTERVAL 30 DAY`, 'h'),
  movers: `
    SELECT s.name AS name, ${ISO} AS iso, cur.done30 AS done30, cur.prev30 AS prev30,
           round((cur.done30 - cur.prev30) / cur.prev30 * 100) chg
    FROM (
      SELECT shipper_id,
             countIf(created_at >= now() - INTERVAL 30 DAY) done30,
             countIf(created_at < now() - INTERVAL 30 DAY) prev30
      FROM order_v WHERE status_id = ${D} AND created_at >= now() - INTERVAL 60 DAY
      GROUP BY shipper_id HAVING prev30 >= 100
    ) cur
    INNER JOIN shippers s ON s.id = cur.shipper_id
    LEFT JOIN countries c ON c.id = s.country_id
    ORDER BY chg DESC`,
  // «Новый» = первый заказ в горизонте 400 дней пришёлся на последние 30:
  // скан всей истории (23М строк) не влезал в лимит edge; бренд, вернувшийся
  // после года тишины, честно считается новым запуском
  newcomers: `
    SELECT iso, count() n FROM (
      SELECT any(${ISO}) AS iso, o.shipper_id sh FROM order_v o ${JOIN}
      WHERE o.status_id = ${D} AND o.created_at >= now() - INTERVAL 400 DAY
      GROUP BY sh HAVING min(o.created_at) >= now() - INTERVAL 30 DAY)
    GROUP BY GROUPING SETS ((iso), ())`,
}

/** Чистая сборка снапшота из строк ответов — переиспользуется прогрев-скриптом. */
export function buildDashPayload(rows: Record<keyof typeof DASH_QUERIES, any[]>) {
  // Итоговые строки GROUPING SETS приходят с пустым iso
  for (const key of Object.keys(rows) as Array<keyof typeof DASH_QUERIES>) {
    if (key === 'movers') continue
    for (const r of rows[key]) if (!r.iso) r.iso = 'ALL'
  }
  const byIso = (arr: any[]) => {
    const map: Record<string, any[]> = {}
    for (const r of arr) (map[r.iso] ||= []).push(r)
    return map
  }
  const kpiByIso = byIso(rows.kpi)
  const weeklyByIso = byIso(rows.weekly)
  const monthsByIso = byIso(rows.months)
  const hoursByIso = byIso(rows.hours)
  const newByIso = byIso(rows.newcomers)
  const moversByIso = byIso(rows.movers)

  // Ось времени — по платформе целиком; крайние неполные периоды обрезаются,
  // иначе графики «взлетают» на входе окна и «падают» на текущем периоде
  const axis = (arr: any[], key: string) =>
    [...new Set(arr.map(r => String(r[key])))].sort().slice(1, -1)
  const weekAxis = axis(weeklyByIso['ALL'] || [], 'w')
  const monthAxis = axis(monthsByIso['ALL'] || [], 'm')

  const series = (arr: any[] | undefined, key: string, ax: string[], fields: string[]) => {
    const at: Record<string, any> = {}
    for (const r of arr || []) at[String(r[key])] = r
    return ax.map(v => {
      const r = at[v] || {}
      const out: any = { [key]: v }
      for (const f of fields) out[f] = Number(r[f] || 0)
      return out
    })
  }

  const markets = (rows.kpi || [])
    .filter(r => r.iso !== 'ALL' && r.iso !== '—' && Number(r.done30) > 0)
    .sort((a, b) => Number(b.done30) - Number(a.done30))
    .map(r => ({
      iso: r.iso, name: String(r.cname || r.iso), currency: String(r.cur || ''),
      done30: Number(r.done30), prev30: Number(r.prev30),
      momPct: Number(r.prev30) ? Math.round((Number(r.done30) - Number(r.prev30)) / Number(r.prev30) * 1000) / 10 : null,
      cancelPct: Number(r.done30) + Number(r.cancel30)
        ? Math.round(Number(r.cancel30) / (Number(r.done30) + Number(r.cancel30)) * 100) : 0,
      brands30: Number(r.brands30),
      avgCheck: r.avgCheck ? Number(r.avgCheck) : null,
    }))

  const slice = (iso: string) => {
    const k = (kpiByIso[iso] || [])[0] || {}
    const done30 = Number(k.done30 || 0), prev30 = Number(k.prev30 || 0)
    const mv = (iso === 'ALL' ? rows.movers : (moversByIso[iso] || []))
      .map((r: any) => ({ name: r.name, done30: Number(r.done30), prev30: Number(r.prev30), chg: Number(r.chg) }))
      .sort((a: any, b: any) => b.chg - a.chg)
    return {
      kpi: {
        done30, prev30,
        momPct: prev30 ? Math.round((done30 - prev30) / prev30 * 1000) / 10 : null,
        cancelPct: done30 + Number(k.cancel30 || 0)
          ? Math.round(Number(k.cancel30 || 0) / (done30 + Number(k.cancel30 || 0)) * 100) : 0,
        brands30: Number(k.brands30 || 0),
        brandsPrev30: Number(k.brandsPrev30 || 0),
        newBrands30: Number((newByIso[iso] || [])[0]?.n || 0),
        medMin: k.medMin !== null && k.medMin !== undefined ? Number(k.medMin) : null,
        medDistKm: k.medDist ? Math.round(Number(k.medDist) / 100) / 10 : null,
        // Деньги между рынками не складываем — у «ALL» чека нет
        avgCheck: iso !== 'ALL' && k.avgCheck ? Number(k.avgCheck) : null,
        medCheck: iso !== 'ALL' && k.medCheck ? Number(k.medCheck) : null,
        ontimePct: k.ontimePct !== null && k.ontimePct !== undefined ? Number(k.ontimePct) : null,
      },
      weekly: series(weeklyByIso[iso], 'w', weekAxis, ['n']),
      channels: series(monthsByIso.channels[iso], 'm', monthAxis, ['agg', 'own', 'pickup', 'hall']),
      sources: series(monthsByIso.sources[iso], 'm', monthAxis, ['agg', 'admin', 'bot', 'kiosk', 'mobile', 'website', 'hall']),
      payments: series(monthsByIso.payments[iso], 'm', monthAxis, ['cash', 'card', 'online', 'other']),
      quality: series(monthsByIso.quality[iso], 'm', monthAxis, ['medMin', 'ontimePct']),
      hours: series(hoursByIso[iso], 'h', Array.from({ length: 24 }, (_, i) => String(i)), ['n']),
      growers: mv.slice(0, 10).filter((r: any) => r.chg > 0),
      fallers: mv.slice(-10).reverse().filter((r: any) => r.chg < 0),
    }
  }

  const slices: Record<string, any> = { ALL: slice('ALL') }
  for (const m of markets) slices[m.iso] = slice(m.iso)
  return { markets, slices }
}

export async function computeBusinessDash(sql: SQL) {
  const cfg = await loadChConfig(sql)
  if (!cfg) return { ok: false as const, error: 'ClickHouse не настроен' }

  // Не больше четырёх запросов разом + один повтор: девять параллельных
  // коннектов ловят таймауты, а последовательные не влезают в лимит edge
  const keys = Object.keys(DASH_QUERIES) as Array<keyof typeof DASH_QUERIES>
  const results: Array<{ ok: boolean; data?: any[]; error?: string }> = new Array(keys.length)
  let next = 0
  const worker = async () => {
    while (next < keys.length) {
      const i = next++
      let r = await chQuery(cfg, DASH_QUERIES[keys[i]], 15000)
      if (r.ok === false) r = await chQuery(cfg, DASH_QUERIES[keys[i]], 15000)
      results[i] = r
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  const rows: any = {}
  for (let i = 0; i < keys.length; i++) {
    const r = results[i]
    if (r.ok === false) return { ok: false as const, error: `${keys[i]}: ${r.error || 'ошибка ClickHouse'}` }
    rows[keys[i]] = r.data || []
  }

  const payload = buildDashPayload(rows)
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
    const payload = (row as any).payload
    // Снапшот старого формата (до срезов по странам) — пусть эндпоинт пересчитает
    if (!payload?.slices) return null
    return { computedAt: (row as any).computed_at, ...payload }
  } catch {
    return null
  }
}
