#!/usr/bin/env node
// Импорт действующих брендов Delever (ClickHouse) в CRM GFSupport:
// для каждого активного бренда с заказами за 30 дней, отсутствующего в
// ch_brand_map, создаётся sales_account (lifecycle=customer) + связка.
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
const q = async (query) => {
  const r = await fetch(`http://${cfg.host}:${cfg.port}/?default_format=JSON&database=delever`, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': cfg.username, 'X-ClickHouse-Key': cfg.password },
    body: query,
  })
  return JSON.parse(await r.text()).data
}

const DONE = "'e665273d-5415-4243-a329-aee410e39465'"
const mapped = new Set((await sql`SELECT DISTINCT shipper_id FROM ch_brand_map`).map(r => r.shipper_id))
const active = await q(`
  SELECT s.id, s.name, cnt.done30
  FROM shippers s
  INNER JOIN (
    SELECT shipper_id, countIf(status_id=${DONE}) done30 FROM order_v
    WHERE created_at >= now() - INTERVAL 30 DAY GROUP BY shipper_id
  ) cnt ON cnt.shipper_id = s.id
  WHERE s.is_archived = 0 AND cnt.done30 > 0
  ORDER BY cnt.done30 DESC`)
const missing = active.filter(s => !mapped.has(s.id))
console.log('к импорту:', missing.length)

let i = 0, created = 0
for (const s of missing) {
  const accId = 'acc_' + (Date.now() + i++) + '_' + Math.random().toString(36).slice(2, 6)
  const name = String(s.name || '').trim().slice(0, 200)
  if (!name) continue
  await sql.transaction([
    sql`INSERT INTO sales_accounts (id, org_id, name, lifecycle, notes, created_at)
        VALUES (${accId}, 'org_delever', ${name}, 'customer',
                'Создан импортом из Delever (ClickHouse), 20.09.2026 — действующий клиент платформы', now())`,
    sql`INSERT INTO ch_brand_map (account_id, shipper_id, shipper_name, method, confirmed)
        VALUES (${accId}, ${s.id}, ${name}, 'import', true)`,
  ])
  created++
}
console.log('создано аккаунтов со связками:', created)
const [tot] = await sql`SELECT count(*) n FROM ch_brand_map`
console.log('всего связок теперь:', tot.n)
