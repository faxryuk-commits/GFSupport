import type { NeonQueryFunction } from '@neondatabase/serverless'

/**
 * Модуль «Подключения» (онбординг брендов).
 *
 * Справочники (statuses, task_types, pos_systems, pos_task_map) редактируемые:
 * набор колонок матрицы и набор статусов задаётся данными, не кодом — новая
 * POS-система или новый шаг чек-листа добавляются через UI без деплоя.
 *
 * У статуса есть kind — семантика для метрик, которая переживает переименования:
 *   todo | active | waiting | done | cancelled | na
 * Время «в работе» = сумма интервалов в статусах kind='active',
 * «ожидание данных» = kind='waiting'. Источник — onboarding_task_events.
 */

type SQL = NeonQueryFunction<false, false>

const ensuredOrgs = new Set<string>()

export function obId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export async function ensureOnboardingSchema(sql: SQL, orgId: string): Promise<void> {
  if (ensuredOrgs.has(orgId)) return

  // Быстрый путь: схема уже актуальна (маркер — последняя добавленная колонка)
  // и справочники организации засеяны → пропускаем DDL и сиды на холодном старте.
  try {
    const [probe] = await sql`
      SELECT tariff FROM onboarding_brands WHERE org_id = ${orgId} LIMIT 1
    `
    if (probe !== undefined) {
      ensuredOrgs.add(orgId)
      return
    }
  } catch {
    // колонки/таблицы нет — идём по полному пути ниже
  }

  await sql`
    CREATE TABLE IF NOT EXISTS onboarding_statuses (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      label VARCHAR(100) NOT NULL,
      kind VARCHAR(20) NOT NULL DEFAULT 'todo',
      color VARCHAR(20) NOT NULL DEFAULT 'gray',
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS onboarding_task_types (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      label VARCHAR(100) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS onboarding_pos_systems (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      name VARCHAR(100) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS onboarding_pos_task_map (
      org_id VARCHAR(50) NOT NULL,
      pos_id VARCHAR(50) NOT NULL,
      task_type_id VARCHAR(50) NOT NULL,
      PRIMARY KEY (pos_id, task_type_id)
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS onboarding_brands (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      name VARCHAR(255) NOT NULL,
      pos_id VARCHAR(50),
      channel_id VARCHAR(50),
      owner_name VARCHAR(255),
      notes TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS onboarding_tasks (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      brand_id VARCHAR(50) NOT NULL,
      task_type_id VARCHAR(50) NOT NULL,
      status_id VARCHAR(50),
      assignee_name VARCHAR(255),
      status_since TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (brand_id, task_type_id)
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS onboarding_task_events (
      id BIGSERIAL PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      brand_id VARCHAR(50) NOT NULL,
      task_type_id VARCHAR(50) NOT NULL,
      old_status_id VARCHAR(50),
      new_status_id VARCHAR(50),
      changed_by VARCHAR(255),
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_ob_tasks_brand ON onboarding_tasks(brand_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_ob_events_brand ON onboarding_task_events(brand_id, changed_at)`
  await sql`CREATE INDEX IF NOT EXISTS idx_ob_brands_org ON onboarding_brands(org_id, archived_at)`

  // v2: категории провайдеров, исполнители, next step / блокеры, комментарии, мини-задачи
  await sql`
    CREATE TABLE IF NOT EXISTS onboarding_option_categories (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      label VARCHAR(100) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS onboarding_options (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      category_id VARCHAR(50) NOT NULL,
      label VARCHAR(100) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS onboarding_comments (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      brand_id VARCHAR(50) NOT NULL,
      author_id VARCHAR(64),
      author_name VARCHAR(255),
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS onboarding_todos (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      brand_id VARCHAR(50) NOT NULL,
      text TEXT NOT NULL,
      assignee_id VARCHAR(64),
      assignee_name VARCHAR(255),
      due_at TIMESTAMPTZ,
      done_at TIMESTAMPTZ,
      created_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`ALTER TABLE onboarding_task_types ADD COLUMN IF NOT EXISTS option_category_id VARCHAR(50)`
  await sql`ALTER TABLE onboarding_tasks ADD COLUMN IF NOT EXISTS assignee_id VARCHAR(64)`
  await sql`ALTER TABLE onboarding_tasks ADD COLUMN IF NOT EXISTS option_id VARCHAR(50)`
  // v3: несколько поставщиков в одной ячейке — по под-задаче на поставщика.
  // UNIQUE(brand, type) → UNIQUE(brand, type, поставщик).
  await sql`ALTER TABLE onboarding_tasks DROP CONSTRAINT IF EXISTS onboarding_tasks_brand_id_task_type_id_key`
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_ob_tasks_brand_type_option
    ON onboarding_tasks (brand_id, task_type_id, COALESCE(option_id, ''))
  `
  await sql`ALTER TABLE onboarding_task_events ADD COLUMN IF NOT EXISTS option_id VARCHAR(50)`
  // v6: группировка шагов чек-листа по блокам запуска (Компания, Каталог, Оплата…)
  await sql`ALTER TABLE onboarding_task_types ADD COLUMN IF NOT EXISTS group_label VARCHAR(100)`
  // v11: «ждём кого» на задаче (us|client|provider) и норматив дней на шаг
  await sql`ALTER TABLE onboarding_tasks ADD COLUMN IF NOT EXISTS waiting_on VARCHAR(12)`
  await sql`ALTER TABLE onboarding_task_types ADD COLUMN IF NOT EXISTS target_days INT`
  // v14: участники проекта — назначаются вручную и автоматически по действиям
  await sql`
    CREATE TABLE IF NOT EXISTS onboarding_participants (
      org_id VARCHAR(50) NOT NULL,
      brand_id VARCHAR(50) NOT NULL,
      agent_id VARCHAR(64),
      name VARCHAR(255) NOT NULL,
      source VARCHAR(10) NOT NULL DEFAULT 'auto',
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_ob_participants ON onboarding_participants (brand_id, name)`
  // v15: владелец процесса у задачи чек-листа — отвечает, когда процесс стоит
  await sql`ALTER TABLE onboarding_task_types ADD COLUMN IF NOT EXISTS owner_agent_id VARCHAR(64)`
  await sql`ALTER TABLE onboarding_task_types ADD COLUMN IF NOT EXISTS owner_name VARCHAR(255)`
  // v16: заявка от продаж — тариф и дедлайн запуска
  await sql`ALTER TABLE onboarding_brands ADD COLUMN IF NOT EXISTS tariff VARCHAR(100)`
  await sql`ALTER TABLE onboarding_brands ADD COLUMN IF NOT EXISTS launch_due DATE`
  await sql`ALTER TABLE onboarding_brands ADD COLUMN IF NOT EXISTS assignee_id VARCHAR(64)`
  await sql`ALTER TABLE onboarding_brands ADD COLUMN IF NOT EXISTS assignee_name VARCHAR(255)`
  await sql`ALTER TABLE onboarding_brands ADD COLUMN IF NOT EXISTS next_step TEXT`
  await sql`ALTER TABLE onboarding_brands ADD COLUMN IF NOT EXISTS depends_on TEXT`
  await sql`ALTER TABLE onboarding_brands ADD COLUMN IF NOT EXISTS blockers TEXT`
  await sql`CREATE INDEX IF NOT EXISTS idx_ob_comments_brand ON onboarding_comments(brand_id, created_at)`
  await sql`CREATE INDEX IF NOT EXISTS idx_ob_todos_brand ON onboarding_todos(brand_id)`

  await seedDefaults(sql, orgId)
  await seedCategories(sql, orgId)
  ensuredOrgs.add(orgId)
}

/**
 * Категории провайдеров + стартовые опции. Привязка колонок чек-листа
 * к категориям — по текущим названиям колонок (только если ещё не привязаны).
 */
async function seedCategories(sql: SQL, orgId: string): Promise<void> {
  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM onboarding_option_categories WHERE org_id = ${orgId}
  `
  if (count > 0) return

  const categories: { label: string; options: string[]; taskTypes: string[] }[] = [
    { label: 'Тип оплаты', options: ['Наличные', 'Payme', 'Click', 'Uzum Pay'], taskTypes: ['Тип оплаты'] },
    { label: 'Агрегаторы', options: ['Uzum Tezkor', 'Yandex Eats', 'Wolt'], taskTypes: ['Uzum Tezkor', 'Yandex Eats'] },
    { label: 'Курьер-сервисы', options: ['NOOR', 'MILLENIUM', 'Yandex Delivery'], taskTypes: ['Курьер сервис', 'Служба доставки'] },
    { label: 'СМС-сервисы', options: ['Eskiz', 'Play Mobile'], taskTypes: ['Смс провайдер'] },
    { label: 'Телефония', options: [], taskTypes: [] },
    { label: 'Каналы продаж', options: ['Сайт', 'Telegram-бот', 'Моб. приложение'], taskTypes: ['Сайт/Бот'] },
    { label: 'Тарифы', options: ['Start', 'Pro', 'Enterprise'], taskTypes: [] },
  ]
  for (let i = 0; i < categories.length; i++) {
    const c = categories[i]
    const catId = obId('obcat')
    await sql`
      INSERT INTO onboarding_option_categories (id, org_id, label, sort_order)
      VALUES (${catId}, ${orgId}, ${c.label}, ${i})
    `
    for (let j = 0; j < c.options.length; j++) {
      await sql`
        INSERT INTO onboarding_options (id, org_id, category_id, label, sort_order)
        VALUES (${obId('obopt')}, ${orgId}, ${catId}, ${c.options[j]}, ${j})
      `
    }
    for (const tt of c.taskTypes) {
      await sql`
        UPDATE onboarding_task_types SET option_category_id = ${catId}
        WHERE org_id = ${orgId} AND label = ${tt} AND option_category_id IS NULL
      `
    }
  }
}

async function seedDefaults(sql: SQL, orgId: string): Promise<void> {
  const [{ count: statusCount }] = await sql`
    SELECT COUNT(*)::int AS count FROM onboarding_statuses WHERE org_id = ${orgId}
  `
  if (statusCount === 0) {
    const statuses = [
      { label: 'Не начато', kind: 'todo', color: 'gray' },
      { label: 'В работе', kind: 'active', color: 'blue' },
      { label: 'Ждем данные', kind: 'waiting', color: 'amber' },
      { label: 'Готово', kind: 'done', color: 'green' },
      { label: 'Отменено', kind: 'cancelled', color: 'red' },
      { label: 'Не требуется', kind: 'na', color: 'slate' },
    ]
    for (let i = 0; i < statuses.length; i++) {
      const s = statuses[i]
      await sql`
        INSERT INTO onboarding_statuses (id, org_id, label, kind, color, sort_order)
        VALUES (${obId('obst')}, ${orgId}, ${s.label}, ${s.kind}, ${s.color}, ${i})
      `
    }
  }

  const [{ count: typeCount }] = await sql`
    SELECT COUNT(*)::int AS count FROM onboarding_task_types WHERE org_id = ${orgId}
  `
  if (typeCount === 0) {
    const types = [
      'POS', 'Меню', 'Тип оплаты', 'Данные филиала', 'Сайт/Бот',
      'Служба доставки', 'Курьер сервис', 'Uzum Tezkor', 'Yandex Eats',
      'Смс провайдер', 'Обучение',
    ]
    for (let i = 0; i < types.length; i++) {
      await sql`
        INSERT INTO onboarding_task_types (id, org_id, label, sort_order)
        VALUES (${obId('obtt')}, ${orgId}, ${types[i]}, ${i})
      `
    }
  }

  const [{ count: posCount }] = await sql`
    SELECT COUNT(*)::int AS count FROM onboarding_pos_systems WHERE org_id = ${orgId}
  `
  if (posCount === 0) {
    for (const name of ['IIKO', 'POSTER', 'CLOPOS', 'R_KEEPER', 'ALISA']) {
      await sql`
        INSERT INTO onboarding_pos_systems (id, org_id, name)
        VALUES (${obId('obps')}, ${orgId}, ${name})
      `
    }
    // Шаблон по умолчанию: каждой POS-системе — полный чек-лист; правится в UI.
    await sql`
      INSERT INTO onboarding_pos_task_map (org_id, pos_id, task_type_id)
      SELECT ${orgId}, p.id, t.id
      FROM onboarding_pos_systems p
      CROSS JOIN onboarding_task_types t
      WHERE p.org_id = ${orgId} AND t.org_id = ${orgId}
      ON CONFLICT DO NOTHING
    `
  }
}

/** Участник проекта: любое действие в карточке добавляет автора (идемпотентно). */
export async function addParticipant(
  sql: SQL, orgId: string, brandId: string,
  agentId: string | null, name: string | null, source = 'auto',
): Promise<void> {
  if (!name || name.startsWith('импорт')) return
  try {
    await sql`
      INSERT INTO onboarding_participants (org_id, brand_id, agent_id, name, source)
      VALUES (${orgId}, ${brandId}, ${agentId}, ${name}, ${source})
      ON CONFLICT (brand_id, name) DO NOTHING
    `
  } catch {}
}

/** Имя агента для журнала событий (changed_by). */
export async function resolveAgentName(sql: SQL, agentId: string | null): Promise<string | null> {
  if (!agentId) return null
  try {
    const [row] = await sql`SELECT name FROM support_agents WHERE id = ${agentId} LIMIT 1`
    return row?.name || agentId
  } catch {
    return agentId
  }
}
