#!/usr/bin/env node
/**
 * Генератор справочника схемы БД → DATABASE_SCHEMA.md
 *
 * Зачем: в базе ~98 таблиц, а DDL размазан по десяткам файлов
 * (CREATE TABLE IF NOT EXISTS прямо в обработчиках). Читать схему по коду
 * невозможно, а поддерживать справочник руками — значит врать через месяц.
 * Поэтому единственный источник правды — сама боевая база.
 *
 * Запуск:
 *   vercel env pull .env.local        # один раз, подтянуть DATABASE_URL
 *   node scripts/db-schema.mjs        # перегенерировать DATABASE_SCHEMA.md
 *
 * Скрипт только читает information_schema — никаких изменений в базе.
 */
import { neon } from '@neondatabase/serverless'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'

// .env.local подхватываем сами, чтобы не тянуть dotenv в рантайм
if (!process.env.DATABASE_URL && existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)="?([^"\n]*)"?$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const url = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.NEON_URL
if (!url) {
  console.error('Нет строки подключения. Сначала: vercel env pull .env.local')
  process.exit(1)
}
const sql = neon(url)

const [cols, pks, fks, idx, counts] = await Promise.all([
  sql`
    SELECT table_name, column_name, data_type, is_nullable, column_default,
           character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position`,
  sql`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'`,
  sql`
    SELECT tc.table_name, kcu.column_name,
           ccu.table_name AS ref_table, ccu.column_name AS ref_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
  sql`
    SELECT tablename AS table_name, indexname, indexdef
    FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`,
  sql`
    SELECT relname AS table_name, n_live_tup::bigint AS rows
    FROM pg_stat_user_tables`,
])

const pkSet = new Set(pks.map(r => `${r.table_name}.${r.column_name}`))
const fkMap = new Map()
for (const f of fks) {
  const k = `${f.table_name}.${f.column_name}`
  fkMap.set(k, `${f.ref_table}.${f.ref_column}`)
}
const rowsMap = new Map(counts.map(r => [r.table_name, Number(r.rows)]))

const byTable = new Map()
for (const c of cols) {
  if (!byTable.has(c.table_name)) byTable.set(c.table_name, [])
  byTable.get(c.table_name).push(c)
}

// Группировка по префиксу — так оглавление читается как карта модулей
const groups = [
  ['support_', 'Поддержка'],
  ['sales_', 'Продажи'],
  ['onboarding_', 'Подключения'],
  ['benchmark', 'Бенчмарки'],
  ['work_', 'Учёт работы'],
  ['system_', 'Системный журнал'],
  ['order_', 'Ошибки заказов'],
  ['', 'Прочее'],
]
const grouped = new Map(groups.map(g => [g[1], []]))
for (const t of [...byTable.keys()].sort()) {
  const g = groups.find(([p]) => p && t.startsWith(p)) || groups[groups.length - 1]
  grouped.get(g[1]).push(t)
}

function typeStr(c) {
  let t = c.data_type
    .replace('character varying', 'varchar')
    .replace('timestamp without time zone', 'timestamp')
    .replace('timestamp with time zone', 'timestamptz')
    .replace('double precision', 'float8')
  if (c.character_maximum_length) t += `(${c.character_maximum_length})`
  return t
}

let md = `# Схема базы GFSupport

> Файл сгенерирован из боевой базы: \`node scripts/db-schema.mjs\`.
> Не редактируйте руками — правки сотрёт следующая генерация.
> Обновлено: ${new Date().toISOString().slice(0, 10)} · таблиц: ${byTable.size}

Все таймстампы — \`timestamp\` **без часового пояса**, значения в UTC.
Для ташкентского времени: \`AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent'\`.

`

for (const [title, tables] of grouped) {
  if (!tables.length) continue
  md += `\n## ${title} (${tables.length})\n`
  for (const t of tables) {
    const rows = rowsMap.get(t)
    md += `\n### \`${t}\`${rows != null ? ` · ~${rows.toLocaleString('ru-RU')} строк` : ''}\n\n`
    md += `| Колонка | Тип | Null | Прим. |\n|---|---|---|---|\n`
    for (const c of byTable.get(t)) {
      const marks = []
      if (pkSet.has(`${t}.${c.column_name}`)) marks.push('PK')
      const ref = fkMap.get(`${t}.${c.column_name}`)
      if (ref) marks.push(`→ ${ref}`)
      if (c.column_default) {
        const d = String(c.column_default)
        if (!d.startsWith('nextval')) marks.push(`= ${d.split('::')[0].slice(0, 24)}`)
      }
      md += `| ${c.column_name} | ${typeStr(c)} | ${c.is_nullable === 'YES' ? '·' : '**нет**'} | ${marks.join(' · ')} |\n`
    }
    const tIdx = idx.filter(i => i.table_name === t && !i.indexname.endsWith('_pkey'))
    if (tIdx.length) {
      md += `\nИндексы: ${tIdx.map(i => `\`${i.indexname}\``).join(', ')}\n`
    }
  }
}

writeFileSync('DATABASE_SCHEMA.md', md)
console.log(`DATABASE_SCHEMA.md: ${byTable.size} таблиц, ${cols.length} колонок`)
