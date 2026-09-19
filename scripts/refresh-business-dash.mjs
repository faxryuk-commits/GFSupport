#!/usr/bin/env node
// Прогрев снапшота бизнес-дашборда (business_dash_snapshot) в обход крона —
// та же логика, что в api/support/_lib/business-dash.ts.
import { readFileSync, existsSync } from 'fs'
import { neon } from '@neondatabase/serverless'

if (!process.env.DATABASE_URL && existsSync('/Users/faxriddin/GFSupport/.env.local')) {
  for (const line of readFileSync('/Users/faxriddin/GFSupport/.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL)

const [row] = await sql`SELECT value FROM support_settings WHERE org_id='org_delever' AND key='creator_clickhouse'`
const cfg = JSON.parse(row.value)
// Последовательно и с ретраем: 8 параллельных коннектов ловят таймаут
const q = async (query) => {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`http://${cfg.host}:${cfg.port}/?default_format=JSON&database=delever`, {
        method: 'POST',
        headers: { 'X-ClickHouse-User': cfg.username, 'X-ClickHouse-Key': cfg.password },
        body: query,
      })
      const text = await r.text()
      if (!r.ok) throw new Error(text.slice(0, 300))
      return JSON.parse(text).data
    } catch (e) {
      if (attempt >= 3) throw e
      await new Promise(res => setTimeout(res, 2000 * attempt))
    }
  }
}

const D = "'e665273d-5415-4243-a329-aee410e39465'"
const seq = async (fns) => { const out = []; for (const f of fns) out.push(await f()); return out }
const [kpi, weekly, channels, cash, dtime, hours, movers, newcomers] = await seq([
  () => q(`SELECT countIf(created_at >= now() - INTERVAL 30 DAY AND status_id = ${D}) done30,
            countIf(created_at >= now() - INTERVAL 60 DAY AND created_at < now() - INTERVAL 30 DAY AND status_id = ${D}) prev30,
            countIf(created_at >= now() - INTERVAL 30 DAY AND status_id != ${D} AND finished_at IS NULL) cancel30,
            uniqExactIf(shipper_id, created_at >= now() - INTERVAL 30 DAY AND status_id = ${D}) brands30,
            uniqExactIf(shipper_id, created_at >= now() - INTERVAL 60 DAY AND created_at < now() - INTERVAL 30 DAY AND status_id = ${D}) brandsPrev30,
            round(quantileIf(0.5)(delivered_time, created_at >= now() - INTERVAL 30 DAY AND delivery_type='delivery' AND delivered_time BETWEEN 1 AND 300)) medMin,
            round(quantileIf(0.5)(distance, created_at >= now() - INTERVAL 30 DAY AND delivery_type='delivery' AND distance BETWEEN 1 AND 50000)) medDist
     FROM order_v`),
  () => q(`SELECT toStartOfWeek(created_at) w, count() n FROM order_v
     WHERE status_id = ${D} AND created_at >= now() - INTERVAL 182 DAY GROUP BY w ORDER BY w`),
  () => q(`SELECT toStartOfMonth(created_at) m,
            countIf(delivery_type = 'aggregator') agg, countIf(delivery_type = 'delivery') own,
            countIf(delivery_type = 'self-pickup') pickup, countIf(delivery_type = 'hall') hall
     FROM order_v WHERE status_id = ${D} AND created_at >= now() - INTERVAL 240 DAY GROUP BY m ORDER BY m`),
  () => q(`SELECT toStartOfMonth(created_at) m, round(countIf(payment_type = 'cash') / count() * 100, 1) cashPct
     FROM order_v WHERE status_id = ${D} AND created_at >= now() - INTERVAL 240 DAY GROUP BY m ORDER BY m`),
  () => q(`SELECT toStartOfMonth(created_at) m,
            round(quantileIf(0.5)(delivered_time, delivery_type='delivery' AND delivered_time BETWEEN 1 AND 300)) medMin
     FROM order_v WHERE status_id = ${D} AND created_at >= now() - INTERVAL 240 DAY GROUP BY m ORDER BY m`),
  () => q(`SELECT toHour(created_at) h, count() n FROM order_v
     WHERE status_id = ${D} AND created_at >= now() - INTERVAL 30 DAY GROUP BY h ORDER BY h`),
  () => q(`SELECT s.name, cur.done30, cur.prev30, round((cur.done30 - cur.prev30) / cur.prev30 * 100) chg
     FROM (
       SELECT shipper_id,
              countIf(created_at >= now() - INTERVAL 30 DAY) done30,
              countIf(created_at < now() - INTERVAL 30 DAY) prev30
       FROM order_v WHERE status_id = ${D} AND created_at >= now() - INTERVAL 60 DAY
       GROUP BY shipper_id HAVING prev30 >= 100
     ) cur INNER JOIN shippers s ON s.id = cur.shipper_id ORDER BY chg DESC`),
  () => q(`SELECT count() n FROM (
       SELECT shipper_id FROM order_v WHERE status_id = ${D}
       GROUP BY shipper_id HAVING min(created_at) >= now() - INTERVAL 30 DAY)`),
])

const mv = movers.map(r => ({ name: r.name, done30: Number(r.done30), prev30: Number(r.prev30), chg: Number(r.chg) }))
const k = kpi[0] || {}
const done30 = Number(k.done30 || 0), prev30 = Number(k.prev30 || 0)
const payload = {
  kpi: {
    done30, prev30,
    momPct: prev30 ? Math.round((done30 - prev30) / prev30 * 1000) / 10 : null,
    cancelPct: done30 + Number(k.cancel30 || 0)
      ? Math.round(Number(k.cancel30 || 0) / (done30 + Number(k.cancel30 || 0)) * 100) : 0,
    brands30: Number(k.brands30 || 0),
    brandsPrev30: Number(k.brandsPrev30 || 0),
    newBrands30: Number(newcomers[0]?.n || 0),
    medMin: k.medMin !== null && k.medMin !== undefined ? Number(k.medMin) : null,
    medDistKm: k.medDist ? Math.round(Number(k.medDist) / 100) / 10 : null,
  },
  weekly: weekly.slice(1, -1).map(r => ({ w: r.w, n: Number(r.n) })),
  channels: channels.slice(1, -1).map(r => ({ m: r.m, agg: Number(r.agg), own: Number(r.own), pickup: Number(r.pickup), hall: Number(r.hall) })),
  cash: cash.map(r => ({ m: r.m, pct: Number(r.cashPct) })),
  dtime: dtime.map(r => ({ m: r.m, medMin: Number(r.medMin) })),
  hours: hours.map(r => ({ h: Number(r.h), n: Number(r.n) })),
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

console.log('KPI:', JSON.stringify(payload.kpi))
console.log('недель:', payload.weekly.length, '| месяцев каналов:', payload.channels.length,
  '| растут:', payload.growers.length, '| падают:', payload.fallers.length)
console.log('топ рост:', payload.growers.slice(0, 3).map(g => `${g.name} +${g.chg}%`).join(', '))
console.log('топ падение:', payload.fallers.slice(0, 3).map(g => `${g.name} ${g.chg}%`).join(', '))
