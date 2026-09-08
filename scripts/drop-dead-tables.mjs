/**
 * Снос мёртвых таблиц — 26 штук в CamelCase из заброшенной ранней модели CRM.
 *
 * Почему список именно такой:
 *  - настоящий count(*), а НЕ n_live_tup. Оценка планировщика соврала по
 *    16 таблицам: в support_case_activity оказалось 922 строки, в support_docs
 *    117, в support_conversation_sessions 466, и все они по оценке были «пусты».
 *    Удалять по оценке нельзя;
 *  - ни одного упоминания в коде: ищем «"Имя"», FROM/INTO/JOIN/UPDATE Имя.
 *
 * Таблицы того же слоя, где строки ЕСТЬ (User, Role, Currency, Territory,
 * Source, Campaign, Pipeline, PipelineStage, SalesRep), сознательно не трогаем.
 *
 * Перед сносом структура сохраняется в docs/dropped-schema-<дата>.sql, чтобы
 * откат сводился к прогону этого файла.
 *
 * Запуск: node scripts/drop-dead-tables.mjs
 *         node scripts/drop-dead-tables.mjs --dry   (только показать)
 */
import { neon } from '@neondatabase/serverless'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)="?([^"]*)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL)
const DRY = process.argv.includes('--dry')

const TARGETS = [
  'ActivationMilestone', 'AuditLog', 'CommissionAccrual', 'CommissionPlan', 'CommissionRule',
  'Company', 'Contact', 'Contract', 'Deal', 'HealthScore', 'IdempotencyKey', 'Invoice',
  'Lead', 'MetricSnapshot', 'Onboarding', 'Partner', 'Payment', 'Payout', 'PipelineSnapshot',
  'PriceList', 'PriceListItem', 'Product', 'SalesActivity', 'Subscription', 'Task', 'Workflow',
]

// 1. Настоящий счёт строк. Хоть одна строка — останавливаемся целиком
const counts = []
for (const t of TARGETS) {
  const rows = await sql.query(`SELECT count(*)::int AS n FROM "${t}"`)
  counts.push({ t, n: rows[0].n })
}
const notEmpty = counts.filter(c => c.n > 0)
if (notEmpty.length) {
  console.error('ОСТАНОВКА — в этих таблицах есть строки:')
  for (const c of notEmpty) console.error(`  ${c.t}: ${c.n}`)
  process.exit(1)
}
console.log(`проверено настоящим счётом: все ${TARGETS.length} пусты`)

// 2. Структура — в репозиторий, чтобы снос был обратим
const cols = await sql`
  SELECT table_name, column_name, data_type, character_maximum_length,
         is_nullable, column_default, ordinal_position
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = ANY(${TARGETS})
  ORDER BY table_name, ordinal_position`
const fks = await sql`
  SELECT tc.table_name AS child, kcu.column_name AS col, ccu.table_name AS parent
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ANY(${TARGETS})`

const byTable = new Map()
for (const c of cols) {
  if (!byTable.has(c.table_name)) byTable.set(c.table_name, [])
  byTable.get(c.table_name).push(c)
}
const day = new Date().toISOString().slice(0, 10)
let out = `-- Снятые таблицы, ${day}\n`
  + '-- Заброшенная модель данных ранней версии CRM: ни одной строки,\n'
  + '-- ни одного упоминания в коде. Файл лежит здесь, чтобы снос был обратим.\n\n'
for (const [table, list] of byTable) {
  out += `CREATE TABLE "${table}" (\n`
  out += list.map(c => {
    const type = c.character_maximum_length ? `${c.data_type}(${c.character_maximum_length})` : c.data_type
    return `  "${c.column_name}" ${type}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}`
      + `${c.column_default ? ` DEFAULT ${c.column_default}` : ''}`
  }).join(',\n')
  out += '\n);\n'
  for (const f of fks.filter(f => f.child === table)) {
    out += `-- FK: "${table}"."${f.col}" → "${f.parent}"\n`
  }
  out += '\n'
}
mkdirSync('docs', { recursive: true })
writeFileSync(`docs/dropped-schema-${day}.sql`, out)
console.log(`структура сохранена: docs/dropped-schema-${day}.sql (${byTable.size} таблиц)`)

if (DRY) {
  console.log('\n--dry: ничего не удалено. Убрать флаг, чтобы снести.')
  process.exit(0)
}

// 3. Снос
for (const t of TARGETS) await sql.query(`DROP TABLE IF EXISTS "${t}" CASCADE`)
const [{ n }] = await sql`SELECT count(*)::int AS n FROM pg_stat_user_tables`
console.log(`снесено ${TARGETS.length}; таблиц осталось ${n}`)
console.log('дальше: node scripts/db-schema.mjs — перегенерировать справочник')
