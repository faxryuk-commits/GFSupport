#!/usr/bin/env node
// Прогрев снапшота бизнес-дашборда в обход крона. Логика НЕ дублируется:
// боевой api/support/_lib/business-dash.ts собирается esbuild-ом на лету
// и выполняется здесь — скрипт никогда не разъедется с продом.
import { readFileSync, existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { build } from 'esbuild'
import { neon } from '@neondatabase/serverless'

if (!process.env.DATABASE_URL && existsSync('/Users/faxriddin/GFSupport/.env.local')) {
  for (const line of readFileSync('/Users/faxriddin/GFSupport/.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL)

const out = join(mkdtempSync(join(tmpdir(), 'gfs-dash-')), 'business-dash.mjs')
await build({
  entryPoints: ['/Users/faxriddin/GFSupport/api/support/_lib/business-dash.ts'],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  external: ['@neondatabase/serverless'],
})
const { computeBusinessDash } = await import(pathToFileURL(out).href)

const res = await computeBusinessDash(sql)
if (res.ok === false) {
  console.error('ошибка:', res.error)
  process.exit(1)
}
console.log('рынки:', res.markets.map(m => `${m.iso} ${m.done30.toLocaleString('ru-RU')} (${m.momPct > 0 ? '+' : ''}${m.momPct}%)`).join(' | '))
const all = res.slices.ALL
console.log('ALL kpi:', JSON.stringify(all.kpi))
console.log('недель:', all.weekly.length, '| месяцев:', all.channels.length,
  '| срезов:', Object.keys(res.slices).join(','))
console.log('топ рост:', all.growers.slice(0, 3).map(g => `${g.name} +${g.chg}%`).join(', '))
console.log('топ падение:', all.fallers.slice(0, 3).map(g => `${g.name} ${g.chg}%`).join(', '))
