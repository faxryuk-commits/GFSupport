#!/usr/bin/env node
// Прогрев снапшота сигналов (та же логика, что в _lib/brand-signals.ts)
import { readFileSync, existsSync } from 'fs'
import { neon } from '@neondatabase/serverless'
if (!process.env.DATABASE_URL && existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL)
const [row] = await sql`SELECT value FROM support_settings WHERE org_id='org_delever' AND key='creator_clickhouse'`
const cfg = JSON.parse(row.value)
const q = async (query) => {
  const r = await fetch(`http://${cfg.host}:${cfg.port}/?default_format=JSON&database=delever`, {
    method: 'POST', headers: { 'X-ClickHouse-User': cfg.username, 'X-ClickHouse-Key': cfg.password }, body: query })
  return JSON.parse(await r.text()).data
}
const DONE = "'e665273d-5415-4243-a329-aee410e39465'"
const maps = await sql`
  SELECT DISTINCT ON (m.shipper_id) m.account_id, m.shipper_id, m.shipper_name, a.lifecycle, a.owner_agent_id
  FROM ch_brand_map m JOIN sales_accounts a ON a.id = m.account_id
  WHERE a.archived_at IS NULL
  ORDER BY m.shipper_id, (a.lifecycle = 'customer') DESC, m.confirmed DESC, a.created_at DESC`
const ids = maps.map(m => "'" + m.shipper_id + "'").join(',')
const wk = await q(`SELECT shipper_id, toStartOfWeek(created_at) w, count() n FROM order_v WHERE shipper_id IN (${ids}) AND status_id=${DONE} AND created_at >= now() - INTERVAL 84 DAY GROUP BY shipper_id, w ORDER BY shipper_id, w`)
const agg = await q(`SELECT shipper_id, min(created_at) f0, countIf(created_at >= now() - INTERVAL 30 DAY) total30, countIf(created_at >= now() - INTERVAL 30 DAY AND status_id=${DONE}) done30, countIf(created_at >= now() - INTERVAL 30 DAY AND status_id=${DONE} AND delivery_type != 'aggregator') own30, uniqExactIf(source, created_at >= now() - INTERVAL 30 DAY AND status_id=${DONE}) channels, round(quantileIf(0.5)(delivered_time, created_at >= now() - INTERVAL 30 DAY AND delivery_type='delivery' AND delivered_time BETWEEN 1 AND 300)) med_min FROM order_v WHERE shipper_id IN (${ids}) GROUP BY shipper_id`)
const byShip = {}; for (const m of maps) byShip[m.shipper_id] = m
const weeks = {}; for (const r of wk) (weeks[r.shipper_id] = weeks[r.shipper_id] || []).push(Number(r.n))
const declines = [], launches = []
for (const r of agg) {
  const m = byShip[r.shipper_id]; if (!m || !r.f0) continue
  const ageDays = Math.floor((Date.now() - new Date(r.f0).getTime()) / 86400e3)
  const done30 = Number(r.done30), total30 = Number(r.total30)
  const cancelPct = total30 ? Math.round((1 - done30 / total30) * 100) : 0
  const ws = weeks[r.shipper_id] || []
  const base = { accountId: m.account_id, name: m.shipper_name, lifecycle: m.lifecycle, ownerAgentId: m.owner_agent_id || null, ageDays, done30, cancelPct, channels: Number(r.channels || 0), ownPct: done30 ? Math.round(Number(r.own30 || 0) / done30 * 100) : 0, medMin: (r.med_min !== null && r.med_min !== undefined) ? Number(r.med_min) : null, weeks: ws.slice(-12) }
  if (ageDays > 90) {
    if (ws.length >= 6) {
      const closed = ws.slice(0, -1)
      const recent = (closed.at(-1) + closed.at(-2)) / 2
      const sorted = closed.slice(0, -2).slice().sort((a, b) => a - b)
      const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
      if (med >= 20 && recent < med * 0.75) declines.push({ ...base, weeklyNorm: med, weeklyNow: Math.round(recent), dropPct: Math.round((1 - recent / med) * 100) })
    }
  } else if (done30 < 100 || cancelPct > 40) {
    launches.push({ ...base, level: (done30 < 30 || cancelPct > 60) ? 'red' : 'yellow' })
  }
}
declines.sort((a, b) => b.dropPct - a.dropPct)
launches.sort((a, b) => (a.level === b.level ? a.done30 - b.done30 : a.level === 'red' ? -1 : 1))
const payload = { mapped: maps.length, declines, launches }
await sql`INSERT INTO brand_signal_snapshot (id, computed_at, payload) VALUES (1, now(), ${JSON.stringify(payload)}::jsonb) ON CONFLICT (id) DO UPDATE SET computed_at = now(), payload = EXCLUDED.payload`
console.log('снапшот: брендов', maps.length, '| спадов', declines.length, '| запусков', launches.length)
