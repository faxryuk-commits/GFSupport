// Релизная миграция чек-листа онбординга org_delever → 7 групп / 15 шагов
// (по структуре админ-панели Delever, см. delever.gitbook.io).
//
// Что делает:
//  - переименовывает существующие шаги и раскладывает их по группам;
//  - колонки «Uzum Tezkor»/«Yandex Eats» сливает в шаг «Агрегаторы»
//    (задачи и журнал переезжают под-задачами с поставщиком);
//  - добавляет новые шаги и создаёт для существующих брендов задачи «Не начато»;
//  - расширяет справочники поставщиков; обновляет шаблон POS→шаги.
// История событий сохраняется полностью. Запуск повторно безопасен.
import { neon } from '@neondatabase/serverless'
import dotenv from 'dotenv'
dotenv.config({ path: new URL('../.env.local', import.meta.url).pathname })

const sql = neon(process.env.DATABASE_URL)
const ORG = 'org_delever'

const STEPS = [
  { label: 'Основные настройки', group: '1 · Компания и филиал' },
  { label: 'Филиал', group: '1 · Компания и филиал', renameFrom: 'Данные филиала' },
  { label: 'Геозоны и зоны доставки', group: '1 · Компания и филиал' },
  { label: 'Категории и товары', group: '2 · Каталог' },
  { label: 'Меню', group: '2 · Каталог', renameFrom: 'Меню' },
  { label: 'Типы оплаты', group: '3 · Оплата', renameFrom: 'Тип оплаты', cat: 'Тип оплаты' },
  { label: 'Каналы продаж', group: '4 · Каналы продаж', renameFrom: 'Сайт/Бот', cat: 'Каналы продаж' },
  { label: 'Тарифы доставки', group: '5 · Доставка' },
  { label: 'Курьеры / служба доставки', group: '5 · Доставка', renameFrom: 'Курьер сервис', cat: 'Курьер-сервисы' },
  { label: 'POS-интеграция', group: '6 · Интеграции', renameFrom: 'POS' },
  { label: 'СМС-провайдер', group: '6 · Интеграции', renameFrom: 'Смс провайдер', cat: 'СМС-сервисы' },
  { label: 'Агрегаторы', group: '6 · Интеграции', cat: 'Агрегаторы', mergeFrom: ['Uzum Tezkor', 'Yandex Eats'] },
  { label: 'Пользователи и роли', group: '7 · Персонал и запуск' },
  { label: 'Обучение', group: '7 · Персонал и запуск', renameFrom: 'Обучение' },
  { label: 'Тестовый заказ и запуск', group: '7 · Персонал и запуск' },
]

const EXTRA_OPTIONS = {
  'Тип оплаты': ['Kaspi', 'Epay', 'TipTop Pay', 'Atmos'],
  'Каналы продаж': ['Киоск самообслуживания', 'QR-зал'],
  'Курьер-сервисы': ['Uzum Delivery', 'Wolt Drive'],
  'Агрегаторы': ['Chocofood', 'Foody', 'Click Mini-App', 'My Uzbekistan'],
}

let seq = 0
const obId = p => `${p}_${Date.now()}_${(seq++).toString(36)}`

async function main() {
  await sql`ALTER TABLE onboarding_task_types ADD COLUMN IF NOT EXISTS group_label VARCHAR(100)`

  const cats = await sql`SELECT id, label FROM onboarding_option_categories WHERE org_id = ${ORG}`
  const catIdByLabel = Object.fromEntries(cats.map(c => [c.label, c.id]))

  // расширяем справочники поставщиков
  for (const [catLabel, labels] of Object.entries(EXTRA_OPTIONS)) {
    const catId = catIdByLabel[catLabel]
    if (!catId) continue
    for (const label of labels) {
      const [ex] = await sql`SELECT id FROM onboarding_options WHERE org_id = ${ORG} AND category_id = ${catId} AND label = ${label}`
      if (ex) continue
      await sql`INSERT INTO onboarding_options (id, org_id, category_id, label, sort_order)
                VALUES (${obId('obopt')}, ${ORG}, ${catId}, ${label}, 100)`
    }
  }

  const types = await sql`SELECT * FROM onboarding_task_types WHERE org_id = ${ORG}`
  const typeByLabel = Object.fromEntries(types.map(t => [t.label, t]))

  const stepIds = {}
  for (let i = 0; i < STEPS.length; i++) {
    const st = STEPS[i]
    const catId = st.cat ? catIdByLabel[st.cat] || null : null
    const existing = typeByLabel[st.label] || (st.renameFrom ? typeByLabel[st.renameFrom] : undefined)
    if (existing) {
      stepIds[st.label] = existing.id
      await sql`UPDATE onboarding_task_types
                SET label = ${st.label}, group_label = ${st.group}, sort_order = ${i},
                    option_category_id = COALESCE(${catId}, option_category_id), is_active = true
                WHERE id = ${existing.id}`
      console.log(`  = ${st.label}${st.renameFrom && st.renameFrom !== st.label ? ` (из «${st.renameFrom}»)` : ''}`)
    } else {
      const id = obId('obtt')
      stepIds[st.label] = id
      await sql`INSERT INTO onboarding_task_types (id, org_id, label, sort_order, group_label, option_category_id)
                VALUES (${id}, ${ORG}, ${st.label}, ${i}, ${st.group}, ${catId})`
      console.log(`  + ${st.label}`)
    }
  }

  // слияние колонок-агрегаторов в «Агрегаторы» с поставщиком
  const aggId = stepIds['Агрегаторы']
  for (const oldLabel of STEPS.find(s => s.label === 'Агрегаторы').mergeFrom) {
    const old = typeByLabel[oldLabel]
    if (!old || old.id === aggId) continue
    const [opt] = await sql`
      SELECT o.id FROM onboarding_options o
      WHERE o.org_id = ${ORG} AND o.category_id = ${catIdByLabel['Агрегаторы']} AND o.label = ${oldLabel}`
    await sql`UPDATE onboarding_tasks SET task_type_id = ${aggId}, option_id = ${opt?.id || null}
              WHERE task_type_id = ${old.id} AND org_id = ${ORG}`
    await sql`UPDATE onboarding_task_events SET task_type_id = ${aggId}, option_id = ${opt?.id || null}
              WHERE task_type_id = ${old.id} AND org_id = ${ORG}`
    await sql`DELETE FROM onboarding_pos_task_map WHERE task_type_id = ${old.id} AND org_id = ${ORG}`
    await sql`DELETE FROM onboarding_task_types WHERE id = ${old.id}`
    console.log(`  ⇒ «${oldLabel}» слит в «Агрегаторы»`)
  }

  // неактивные старые шаги — в конец
  await sql`UPDATE onboarding_task_types SET sort_order = 90
            WHERE org_id = ${ORG} AND is_active = false`

  // шаблон POS→шаги: все активные шаги для всех POS
  await sql`INSERT INTO onboarding_pos_task_map (org_id, pos_id, task_type_id)
            SELECT ${ORG}, p.id, t.id FROM onboarding_pos_systems p
            CROSS JOIN onboarding_task_types t
            WHERE p.org_id = ${ORG} AND t.org_id = ${ORG} AND t.is_active = true
            ON CONFLICT DO NOTHING`

  // задачи «Не начато» по новым шагам для существующих брендов
  const [todoStatus] = await sql`SELECT id FROM onboarding_statuses
    WHERE org_id = ${ORG} AND kind = 'todo' AND is_active = true ORDER BY sort_order LIMIT 1`
  const brands = await sql`SELECT id FROM onboarding_brands WHERE org_id = ${ORG} AND archived_at IS NULL`
  let created = 0
  for (const b of brands) {
    for (const st of STEPS) {
      const rows = await sql`
        INSERT INTO onboarding_tasks (id, org_id, brand_id, task_type_id, status_id)
        SELECT ${obId('obtk')}, ${ORG}, ${b.id}, ${stepIds[st.label]}, ${todoStatus?.id || null}
        WHERE NOT EXISTS (SELECT 1 FROM onboarding_tasks WHERE brand_id = ${b.id} AND task_type_id = ${stepIds[st.label]})
        RETURNING id`
      created += rows.length
    }
  }

  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM onboarding_tasks t
    JOIN onboarding_brands b ON b.id = t.brand_id
    WHERE t.org_id = ${ORG} AND b.archived_at IS NULL`
  console.log(`Готово: брендов ${brands.length}, задач всего ${count} (создано новых ${created})`)
}

main().catch(e => { console.error(e); process.exit(1) })
