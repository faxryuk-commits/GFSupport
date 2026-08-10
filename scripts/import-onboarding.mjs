// Разовый импорт чек-листа брендов из Google Sheets в модуль «Подключения».
// Источники: свежий CSV-снапшот (текущее состояние) + changes.json
// (история смен статусов, восстановленная из ревизий Google Sheets).
//
// Запуск: node scripts/import-onboarding.mjs <latest.csv> <changes.json>
// Требует DATABASE_URL в .env.local. Идемпотентен: бренды матчатся по имени.

import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'fs'
import 'dotenv/config'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const ORG = 'org_delever'
const [, , csvPath, changesPath] = process.argv
if (!csvPath || !changesPath) {
  console.error('Usage: node scripts/import-onboarding.mjs <latest.csv> <changes.json>')
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL)

function obId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

// ── Схема (зеркало api/support/lib/onboarding-schema.ts) ──────────────
async function ensureSchema() {
  await sql`CREATE TABLE IF NOT EXISTS onboarding_statuses (
    id VARCHAR(50) PRIMARY KEY, org_id VARCHAR(50) NOT NULL, label VARCHAR(100) NOT NULL,
    kind VARCHAR(20) NOT NULL DEFAULT 'todo', color VARCHAR(20) NOT NULL DEFAULT 'gray',
    sort_order INT NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true)`
  await sql`CREATE TABLE IF NOT EXISTS onboarding_task_types (
    id VARCHAR(50) PRIMARY KEY, org_id VARCHAR(50) NOT NULL, label VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true)`
  await sql`CREATE TABLE IF NOT EXISTS onboarding_pos_systems (
    id VARCHAR(50) PRIMARY KEY, org_id VARCHAR(50) NOT NULL, name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true)`
  await sql`CREATE TABLE IF NOT EXISTS onboarding_pos_task_map (
    org_id VARCHAR(50) NOT NULL, pos_id VARCHAR(50) NOT NULL, task_type_id VARCHAR(50) NOT NULL,
    PRIMARY KEY (pos_id, task_type_id))`
  await sql`CREATE TABLE IF NOT EXISTS onboarding_brands (
    id VARCHAR(50) PRIMARY KEY, org_id VARCHAR(50) NOT NULL, name VARCHAR(255) NOT NULL,
    pos_id VARCHAR(50), channel_id VARCHAR(50), owner_name VARCHAR(255), notes TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  await sql`CREATE TABLE IF NOT EXISTS onboarding_tasks (
    id VARCHAR(50) PRIMARY KEY, org_id VARCHAR(50) NOT NULL, brand_id VARCHAR(50) NOT NULL,
    task_type_id VARCHAR(50) NOT NULL, status_id VARCHAR(50), assignee_name VARCHAR(255),
    status_since TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (brand_id, task_type_id))`
  await sql`CREATE TABLE IF NOT EXISTS onboarding_task_events (
    id BIGSERIAL PRIMARY KEY, org_id VARCHAR(50) NOT NULL, brand_id VARCHAR(50) NOT NULL,
    task_type_id VARCHAR(50) NOT NULL, old_status_id VARCHAR(50), new_status_id VARCHAR(50),
    changed_by VARCHAR(255), changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  await sql`CREATE INDEX IF NOT EXISTS idx_ob_tasks_brand ON onboarding_tasks(brand_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_ob_events_brand ON onboarding_task_events(brand_id, changed_at)`
  await sql`CREATE INDEX IF NOT EXISTS idx_ob_brands_org ON onboarding_brands(org_id, archived_at)`
}

async function seedRefs() {
  const [{ count: sc }] = await sql`SELECT COUNT(*)::int AS count FROM onboarding_statuses WHERE org_id = ${ORG}`
  if (sc === 0) {
    const statuses = [
      ['Не начато', 'todo', 'gray'], ['В работе', 'active', 'blue'],
      ['Ждем данные', 'waiting', 'amber'], ['Готово', 'done', 'green'],
      ['Отменено', 'cancelled', 'red'], ['Не требуется', 'na', 'slate'],
    ]
    for (let i = 0; i < statuses.length; i++) {
      const [label, kind, color] = statuses[i]
      await sql`INSERT INTO onboarding_statuses (id, org_id, label, kind, color, sort_order)
                VALUES (${obId('obst')}, ${ORG}, ${label}, ${kind}, ${color}, ${i})`
    }
  }
  const [{ count: tc }] = await sql`SELECT COUNT(*)::int AS count FROM onboarding_task_types WHERE org_id = ${ORG}`
  if (tc === 0) {
    const types = ['POS', 'Меню', 'Тип оплаты', 'Данные филиала', 'Сайт/Бот', 'Служба доставки',
      'Курьер сервис', 'Uzum Tezkor', 'Yandex Eats', 'Смс провайдер', 'Обучение']
    for (let i = 0; i < types.length; i++) {
      await sql`INSERT INTO onboarding_task_types (id, org_id, label, sort_order)
                VALUES (${obId('obtt')}, ${ORG}, ${types[i]}, ${i})`
    }
  }
  const [{ count: pc }] = await sql`SELECT COUNT(*)::int AS count FROM onboarding_pos_systems WHERE org_id = ${ORG}`
  if (pc === 0) {
    for (const name of ['IIKO', 'POSTER', 'CLOPOS', 'R_KEEPER', 'ALISA']) {
      await sql`INSERT INTO onboarding_pos_systems (id, org_id, name) VALUES (${obId('obps')}, ${ORG}, ${name})`
    }
    await sql`INSERT INTO onboarding_pos_task_map (org_id, pos_id, task_type_id)
              SELECT ${ORG}, p.id, t.id FROM onboarding_pos_systems p
              CROSS JOIN onboarding_task_types t
              WHERE p.org_id = ${ORG} AND t.org_id = ${ORG}
              ON CONFLICT DO NOTHING`
  }
}

// ── Маппинг значений таблицы на статусы ───────────────────────────────
function normStatus(raw) {
  const v = (raw || '').trim()
  if (!v || v === '---') return 'Не требуется'
  if (v.startsWith('Ждем данн')) return 'Ждем данные'
  if (v === 'Не начато' || v === 'В работе' || v === 'Готово' || v === 'Отменено') return v
  // Произвольный текст в ячейке (например, название курьерской службы) —
  // считаем шаг выполненным, текст сохраняем ответственным/значением.
  return 'Готово'
}

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

async function main() {
  await ensureSchema()
  await seedRefs()

  const statusRows = await sql`SELECT id, label FROM onboarding_statuses WHERE org_id = ${ORG}`
  const statusId = Object.fromEntries(statusRows.map(r => [r.label, r.id]))
  const typeRows = await sql`SELECT id, label FROM onboarding_task_types WHERE org_id = ${ORG}`
  const typeId = Object.fromEntries(typeRows.map(r => [r.label, r.id]))
  const posRows = await sql`SELECT id, name FROM onboarding_pos_systems WHERE org_id = ${ORG}`
  const posId = Object.fromEntries(posRows.map(r => [r.name, r.id]))

  // Текущее состояние из CSV
  const lines = readFileSync(csvPath, 'utf-8').split('\n').map(parseCsvLine)
  const headerIdx = lines.findIndex(r => r.some(c => c.toLowerCase().includes('бренда')))
  const header = lines[headerIdx].map(c => c.trim())
  const taskCols = header
    .map((label, idx) => ({ label, idx }))
    .filter(c => typeId[c.label])
  const sysIdx = header.indexOf('Система')

  const brands = []
  for (const row of lines.slice(headerIdx + 1)) {
    const name = (row[0] || '').trim()
    if (!name) continue
    brands.push({
      name,
      pos: sysIdx >= 0 ? (row[sysIdx] || '').trim() : '',
      cells: Object.fromEntries(taskCols.map(c => [c.label, (row[c.idx] || '').trim()])),
    })
  }
  console.log(`Брендов в CSV: ${brands.length}`)

  // История из changes.json: { "Бренд|Задача": [[ms, prevMs, old, new], ...] }
  const changes = JSON.parse(readFileSync(changesPath, 'utf-8'))

  const brandIds = {}
  for (const b of brands) {
    const existing = await sql`
      SELECT id FROM onboarding_brands WHERE org_id = ${ORG} AND name = ${b.name} LIMIT 1`
    if (existing.length) {
      brandIds[b.name] = existing[0].id
      console.log(`  = ${b.name} (уже есть, пропуск)`)
      continue
    }

    // started_at = самое раннее событие бренда в истории
    let startedMs = null
    for (const [key, evs] of Object.entries(changes)) {
      const [bn] = key.split('|')
      if (bn.trim() !== b.name) continue
      for (const [ms] of evs) if (startedMs === null || ms < startedMs) startedMs = ms
    }
    const startedAt = startedMs ? new Date(startedMs).toISOString() : new Date().toISOString()

    const id = obId('obbr')
    brandIds[b.name] = id
    await sql`
      INSERT INTO onboarding_brands (id, org_id, name, pos_id, started_at, created_at, notes)
      VALUES (${id}, ${ORG}, ${b.name}, ${posId[b.pos] || null}, ${startedAt}, ${startedAt},
              ${'Импортировано из Google Sheets 10.08.2026'})`

    // События истории по этому бренду
    let evCount = 0
    for (const [key, evs] of Object.entries(changes)) {
      const [bn, taskLabel] = key.split('|')
      if (bn.trim() !== b.name) continue
      const tt = typeId[taskLabel.trim()]
      if (!tt) continue
      let prevStatus = null
      const sorted = [...evs].sort((a, z) => a[0] - z[0])
      for (const [ms, , old, next] of sorted) {
        const newNorm = normStatus(next)
        const oldNorm = old === null ? null : normStatus(old)
        // Начальный снапшот «Не начато» — не событие, а исходное состояние
        if (old === null && newNorm === 'Не начато') { prevStatus = newNorm; continue }
        if (oldNorm !== null && normStatus(old) === newNorm) { prevStatus = newNorm; continue }
        await sql`
          INSERT INTO onboarding_task_events (org_id, brand_id, task_type_id, old_status_id, new_status_id, changed_by, changed_at)
          VALUES (${ORG}, ${id}, ${tt}, ${prevStatus ? statusId[prevStatus] : null},
                  ${statusId[newNorm]}, ${'импорт из Google Sheets'}, ${new Date(ms).toISOString()})`
        prevStatus = newNorm
        evCount++
      }
    }

    // Текущее состояние задач
    for (const c of taskCols) {
      const raw = b.cells[c.label]
      const norm = normStatus(raw)
      // status_since = время последнего события по этой задаче (или startedAt)
      const [last] = await sql`
        SELECT changed_at FROM onboarding_task_events
        WHERE brand_id = ${id} AND task_type_id = ${typeId[c.label]}
        ORDER BY changed_at DESC LIMIT 1`
      const isFreeText = norm === 'Готово' && raw && raw !== 'Готово'
      await sql`
        INSERT INTO onboarding_tasks (id, org_id, brand_id, task_type_id, status_id, assignee_name, status_since, created_at)
        VALUES (${obId('obtk')}, ${ORG}, ${id}, ${typeId[c.label]}, ${statusId[norm]},
                ${isFreeText ? raw : null},
                ${last ? last.changed_at : startedAt}, ${startedAt})
        ON CONFLICT (brand_id, task_type_id) DO NOTHING`
    }
    console.log(`  + ${b.name}: задач ${taskCols.length}, событий ${evCount}`)
  }

  const [{ count: totalEv }] = await sql`SELECT COUNT(*)::int AS count FROM onboarding_task_events WHERE org_id = ${ORG}`
  const [{ count: totalTasks }] = await sql`SELECT COUNT(*)::int AS count FROM onboarding_tasks WHERE org_id = ${ORG}`
  console.log(`Итого: брендов ${Object.keys(brandIds).length}, задач ${totalTasks}, событий в журнале ${totalEv}`)
}

main().catch(e => { console.error(e); process.exit(1) })
