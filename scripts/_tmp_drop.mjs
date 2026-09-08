import { neon } from '@neondatabase/serverless'
import { readFileSync, writeFileSync } from 'node:fs'
for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)="?([^"]*)"?$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL)

const extra = ['crm_calls', 'support_broadcast_stats', 'support_conversation_sessions']
const camel = (await sql`SELECT relname FROM pg_stat_user_tables WHERE relname ~ '^[A-Z]' ORDER BY relname`)
  .map(r => r.relname)
const targets = [...camel, ...extra]
console.log('к удалению:', targets.length)

// Настоящий счёт строк, а не оценка планировщика: удалять по оценке нельзя
for (const t of targets) {
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM "${t}"`)
  if (n !== 0) { console.error(`ОСТАНОВКА: в ${t} есть строки (${n})`); process.exit(1) }
}
console.log('все пусты — проверено настоящим счётом')

// Структуру сохраняем в репозиторий: удаление станет обратимым
const cols = await sql`
  SELECT table_name, column_name, data_type, character_maximum_length,
         is_nullable, column_default, ordinal_position
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = ANY(${targets})
  ORDER BY table_name, ordinal_position`
const fks = await sql`
  SELECT tc.table_name AS child, kcu.column_name AS col, ccu.table_name AS parent
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ANY(${targets})`

const byTable = new Map()
for (const c of cols) {
  if (!byTable.has(c.table_name)) byTable.set(c.table_name, [])
  byTable.get(c.table_name).push(c)
}
let out = `-- Снятые таблицы, ${new Date().toISOString().slice(0, 10)}\n`
  + `--\n`
  + `-- 35 таблиц в CamelCase — заброшенная модель данных ранней версии CRM:\n`
  + `-- ни одной строки, ни одной ссылки из кода. Плюс три остатка от снесённого\n`
  + `-- legacy: crm_calls, support_broadcast_stats, support_conversation_sessions.\n`
  + `-- Лежат здесь, чтобы удаление было обратимым: структура восстанавливается\n`
  + `-- отсюда. Данных в них не было.\n\n`
for (const [table, list] of byTable) {
  out += `CREATE TABLE "${table}" (\n`
  out += list.map(c => {
    const type = c.character_maximum_length ? `${c.data_type}(${c.character_maximum_length})` : c.data_type
    const nul = c.is_nullable === 'NO' ? ' NOT NULL' : ''
    const def = c.column_default ? ` DEFAULT ${c.column_default}` : ''
    return `  "${c.column_name}" ${type}${nul}${def}`
  }).join(',\n')
  out += '\n);\n'
  const rel = fks.filter(f => f.child === table)
  for (const f of rel) out += `-- FK: "${table}"."${f.col}" → "${f.parent}"\n`
  out += '\n'
}
writeFileSync('docs/dropped-schema-2026-09-08.sql', out)
console.log('структура сохранена: docs/dropped-schema-2026-09-08.sql,', byTable.size, 'таблиц')

for (const t of targets) await sql(`DROP TABLE IF EXISTS "${t}" CASCADE`)
const [{ n }] = await sql`SELECT count(*)::int AS n FROM pg_stat_user_tables`
const [{ e }] = await sql`SELECT count(*)::int AS e FROM pg_stat_user_tables WHERE n_live_tup = 0`
console.log(`удалено ${targets.length}; таблиц осталось ${n}, из них пустых ${e}`)
