import type { NeonQueryFunction } from '@neondatabase/serverless'

/**
 * Модуль «Продажи» (CRM).
 *
 * Границы модуля: ведёт клиента от появления лида до подписи и передаёт результат
 * во внедрение. Начисления, счета, ЭСФ и учёт живут в админке Delever, Didox и 1С —
 * здесь только обещание (сумма предложения), а не факт выручки.
 *
 * Сквозной объект — sales_accounts. Аккаунт рождается вместе с лидом и живёт после
 * продажи: на нём висят сделки, чат клиента (support_channels), проект внедрения
 * (onboarding_brands) и merchant_id из админки.
 *
 * Правила — данные, а не код. У этапа есть required_fields (без них переход
 * заблокирован), cadence (какие касания создать при входе), sla_hours и probability.
 * Меняются из UI, как статусы в «Подключениях», — без деплоя.
 */

type SQL = NeonQueryFunction<false, false>

const ensuredOrgs = new Set<string>()

/**
 * Версия схемы. Поднимается при любом изменении DDL или сидов.
 *
 * Раньше быстрый путь опирался на наличие последней добавленной колонки, и это
 * дало неприятный эффект на проде: пока колонки нет, КАЖДЫЙ запрос гнал полный
 * прогон из 140 операций и не укладывался в лимит edge-функции. Версия в одной
 * строке настроек снимает проблему: проверка — один запрос, полный прогон
 * случается ровно один раз на изменение.
 */
const SCHEMA_VERSION = '2026-08-13.2'

export function salesId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Нормализация телефона для склейки: последние 9 цифр.
 * Тот же принцип, что в identification.ts для сотрудников — у номеров UZ/KZ/AZ
 * различаются префиксы записи (+998, 998, 8), а последние 9 цифр стабильны.
 */
export function normPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length < 7) return null
  return digits.slice(-9)
}

/** Этапы воронки из плейбука v0.1 (§2). required_fields — колонки sales_deals. */
const STAGE_SEED: Array<{
  key: string
  label: string
  kind: 'open' | 'won' | 'lost'
  ownerRole: string
  slaHours: number | null
  probability: number
  requiredFields: string[]
  cadence: Array<{ day: number; title: string; channel: string }>
}> = [
  { key: 'new', label: 'Новый', kind: 'open', ownerRole: 'sdr', slaHours: 0.25, probability: 5,
    requiredFields: [], cadence: [] },
  { key: 'attempting', label: 'Дозвон', kind: 'open', ownerRole: 'sdr', slaHours: 168, probability: 10,
    requiredFields: [],
    cadence: [
      { day: 1, title: 'Попытка дозвона 2', channel: 'call' },
      { day: 3, title: 'Попытка дозвона 3 + сообщение', channel: 'telegram' },
      { day: 7, title: 'Финальная попытка перед отказом', channel: 'call' },
    ] },
  { key: 'qualified', label: 'Квалифицирован', kind: 'open', ownerRole: 'sdr', slaHours: 24, probability: 20,
    requiredFields: ['city', 'points', 'orders_per_day', 'pos', 'aggregators', 'delivery_type', 'pain'],
    cadence: [] },
  { key: 'meeting', label: 'Демо назначено', kind: 'open', ownerRole: 'sdr', slaHours: 24, probability: 25,
    requiredFields: ['meeting_at', 'dm_name'],
    cadence: [{ day: 0, title: 'Напомнить о встрече за 2 часа', channel: 'telegram' }] },
  { key: 'demo', label: 'Демо проведено', kind: 'open', ownerRole: 'ae', slaHours: 24, probability: 30,
    requiredFields: ['dm_confirmed', 'budget_stated', 'next_step', 'next_step_at'],
    cadence: [] },
  { key: 'kp', label: 'КП отправлено', kind: 'open', ownerRole: 'ae', slaHours: 336, probability: 40,
    requiredFields: ['kp_file', 'monthly_amount', 'valid_till'],
    cadence: [
      { day: 1, title: 'Подтвердить получение КП', channel: 'telegram' },
      { day: 3, title: 'Звонок: что вызывает сомнения', channel: 'call' },
      { day: 7, title: 'Кейс клиента в его сегменте', channel: 'telegram' },
      { day: 14, title: 'Финальный звонок, срок КП истекает', channel: 'call' },
    ] },
  { key: 'contract', label: 'Договор', kind: 'open', ownerRole: 'ae', slaHours: 336, probability: 70,
    requiredFields: ['legal_name', 'start_date'],
    cadence: [
      { day: 2, title: 'Напомнить про реквизиты', channel: 'telegram' },
      { day: 5, title: 'Звонок по договору', channel: 'call' },
    ] },
  { key: 'won', label: 'Выиграна', kind: 'won', ownerRole: 'ae', slaHours: null, probability: 100,
    requiredFields: ['paid_at'], cadence: [] },
  { key: 'lost', label: 'Проиграна', kind: 'lost', ownerRole: 'ae', slaHours: null, probability: 0,
    requiredFields: ['lost_reason_id'], cadence: [] },
]

/**
 * Партнёрская воронка: дистрибьюторы, агенты, реселлеры, разовые рекомендации.
 * Партнёр — это тоже лид, но продаём мы ему не подписку, а условия сотрудничества,
 * и «выигрыш» здесь — не оплата, а первая приведённая им сделка.
 */
const PARTNER_STAGE_SEED: Array<{
  key: string; label: string; kind: 'open' | 'won' | 'lost'
  slaHours: number | null; probability: number
  requiredFields: string[]; cadence: Array<{ day: number; title: string; channel: string }>
}> = [
  { key: 'p_new', label: 'Новый партнёр', kind: 'open', slaHours: 24, probability: 5,
    requiredFields: [], cadence: [] },
  { key: 'p_intro', label: 'Знакомство', kind: 'open', slaHours: 72, probability: 15,
    requiredFields: ['city', 'pain'],
    cadence: [{ day: 2, title: 'Отправить презентацию партнёрской программы', channel: 'telegram' }] },
  { key: 'p_terms', label: 'Условия обсуждаются', kind: 'open', slaHours: 168, probability: 40,
    requiredFields: ['dm_name', 'next_step', 'next_step_at'],
    cadence: [{ day: 3, title: 'Согласовать вознаграждение и территорию', channel: 'call' }] },
  { key: 'p_contract', label: 'Партнёрский договор', kind: 'open', slaHours: 336, probability: 70,
    requiredFields: ['legal_name'],
    cadence: [{ day: 3, title: 'Напомнить про подписание', channel: 'telegram' }] },
  { key: 'p_active', label: 'Активен', kind: 'won', slaHours: null, probability: 100,
    requiredFields: [], cadence: [] },
  { key: 'p_lost', label: 'Не состоялось', kind: 'lost', slaHours: null, probability: 0,
    requiredFields: ['lost_reason_id'], cadence: [] },
]

/** Причины отказа из плейбука v0.1 (§9). Срок возврата запускает реактивацию. */
const LOST_REASON_SEED: Array<{ code: string; label: string; days: number | null }> = [
  { code: 'not_icp', label: 'Не наш клиент', days: null },
  { code: 'no_response', label: 'Не отвечает после 5+ касаний', days: 90 },
  { code: 'competitor', label: 'Выбрали конкурента', days: 180 },
  { code: 'too_expensive', label: 'Слишком дорого', days: 180 },
  { code: 'bad_timing', label: 'Не сейчас, заняты', days: 60 },
  { code: 'decision_postponed', label: 'Откладывают решение', days: 45 },
  { code: 'no_dm_access', label: 'Не дошли до ЛПР', days: 30 },
  { code: 'feature_gap', label: 'Не хватает функциональности', days: 120 },
  { code: 'internal_solution', label: 'Делают сами', days: 180 },
  { code: 'other', label: 'Другое', days: null },
]

/** Источники лидов. kind нужен для отчёта: платное / входящее / исходящее / реферальное. */
const SOURCE_SEED: Array<{ key: string; label: string; kind: string }> = [
  { key: 'meta_leadform', label: 'Meta лид-форма', kind: 'paid' },
  { key: 'site', label: 'Сайт delever.io', kind: 'inbound' },
  { key: 'instagram_direct', label: 'Instagram Direct', kind: 'inbound' },
  { key: 'telegram', label: 'Telegram', kind: 'inbound' },
  { key: 'whatsapp', label: 'WhatsApp', kind: 'inbound' },
  { key: 'call', label: 'Входящий звонок', kind: 'inbound' },
  { key: 'referral', label: 'Реферал', kind: 'referral' },
  { key: 'manual', label: 'Заведён вручную', kind: 'referral' },
  { key: 'upsell', label: 'Допродажа клиенту', kind: 'referral' },
  { key: 'partner_lead', label: 'Лид от партнёра', kind: 'referral' },
  { key: 'partner_apply', label: 'Заявка в партнёры', kind: 'inbound' },
  { key: 'outbound', label: 'Исходящий холодный', kind: 'outbound' },
  { key: 'import', label: 'Импорт базы', kind: 'outbound' },
]

export async function ensureSalesSchema(sql: SQL, orgId: string): Promise<void> {
  if (ensuredOrgs.has(orgId)) return

  // Быстрый путь: одна строка с версией схемы
  const versionKey = `sales_schema_${orgId}`
  try {
    const [row] = await sql`
      SELECT value FROM support_platform_settings WHERE key = ${versionKey}
    `
    if (row?.value === SCHEMA_VERSION) {
      ensuredOrgs.add(orgId)
      return
    }
  } catch {
    // таблицы настроек нет — идём полным путём
  }

  // ─── Аккаунт: сквозной объект ────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS sales_accounts (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      name VARCHAR(255) NOT NULL,
      market_id VARCHAR(50),
      city VARCHAR(100),
      inn VARCHAR(20),
      merchant_id VARCHAR(50),
      channel_id VARCHAR(50),
      onboarding_brand_id VARCHAR(50),
      lifecycle VARCHAR(20) NOT NULL DEFAULT 'lead',
      account_type VARCHAR(20) NOT NULL DEFAULT 'client',
      partner_kind VARCHAR(30),
      partner_program_id VARCHAR(50),
      partner_terms JSONB,
      referred_by_account_id VARCHAR(50),
      owner_agent_id VARCHAR(50),
      launched_at TIMESTAMPTZ,
      first_order_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      archived_at TIMESTAMPTZ
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS sales_contacts (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      account_id VARCHAR(50) NOT NULL,
      name VARCHAR(255),
      role VARCHAR(100),
      phone VARCHAR(50),
      phone_norm VARCHAR(20),
      telegram VARCHAR(100),
      email VARCHAR(255),
      is_primary BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  // ─── Справочники: здесь живут правила движка ─────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS sales_stages (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      key VARCHAR(50) NOT NULL,
      label VARCHAR(100) NOT NULL,
      kind VARCHAR(20) NOT NULL DEFAULT 'open',
      owner_role VARCHAR(20) NOT NULL DEFAULT 'ae',
      sla_hours NUMERIC(8,2),
      required_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      cadence JSONB NOT NULL DEFAULT '[]'::jsonb,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      probability INT NOT NULL DEFAULT 0,
      pipeline VARCHAR(20) NOT NULL DEFAULT 'sales'
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS sales_lost_reasons (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      code VARCHAR(50) NOT NULL,
      label VARCHAR(150) NOT NULL,
      reactivate_days INT,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS sales_sources (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      key VARCHAR(50) NOT NULL,
      label VARCHAR(150) NOT NULL,
      kind VARCHAR(20) NOT NULL DEFAULT 'inbound',
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true
    )
  `
  // Курс фиксируется в момент предложения и потом не меняется — иначе
  // исторические отчёты «плавают» вслед за курсом.
  await sql`
    CREATE TABLE IF NOT EXISTS sales_fx_rates (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      currency VARCHAR(10) NOT NULL,
      rate_to_usd NUMERIC(14,6) NOT NULL,
      valid_from DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  // ─── Лид: факт обращения (не путать со сделкой) ──────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS sales_leads (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      source_id VARCHAR(50),
      external_id VARCHAR(120),
      account_id VARCHAR(50),
      name VARCHAR(255),
      phone VARCHAR(50),
      phone_norm VARCHAR(20),
      contact_name VARCHAR(255),
      city VARCHAR(100),
      market_id VARCHAR(50),
      campaign VARCHAR(255),
      form_id VARCHAR(80),
      ad_id VARCHAR(80),
      text TEXT,
      raw JSONB,
      icp_score INT,
      icp_reasons JSONB,
      status VARCHAR(20) NOT NULL DEFAULT 'new',
      assigned_agent_id VARCHAR(50),
      assigned_at TIMESTAMPTZ,
      first_touch_at TIMESTAMPTZ,
      sla_due_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  // ─── Сделка ──────────────────────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS sales_deals (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      account_id VARCHAR(50) NOT NULL,
      stage_id VARCHAR(50) NOT NULL,
      owner_agent_id VARCHAR(50),
      market_id VARCHAR(50),
      title VARCHAR(255),
      deal_type VARCHAR(20) NOT NULL DEFAULT 'new',
      pipeline VARCHAR(20) NOT NULL DEFAULT 'sales',
      source_lead_id VARCHAR(50),
      external_id VARCHAR(120),

      city VARCHAR(100),
      points INT,
      orders_per_day VARCHAR(50),
      pos VARCHAR(100),
      aggregators VARCHAR(255),
      delivery_type VARCHAR(50),
      pain TEXT,
      dm_name VARCHAR(255),
      dm_confirmed BOOLEAN,
      meeting_at TIMESTAMPTZ,

      tariff VARCHAR(50),
      items JSONB,
      budget_stated NUMERIC(14,2),
      monthly_amount NUMERIC(14,2),
      onetime_amount NUMERIC(14,2),
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      amount_usd NUMERIC(14,2),
      discount_pct NUMERIC(5,2),
      term_months INT,
      valid_till DATE,
      kp_file VARCHAR(500),
      legal_name VARCHAR(255),
      start_date DATE,
      paid_at TIMESTAMPTZ,
      expected_close_at DATE,
      probability INT,

      next_step VARCHAR(500),
      next_step_at TIMESTAMPTZ,
      stage_since TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      stalled_at TIMESTAMPTZ,
      approval_state VARCHAR(20),

      won_at TIMESTAMPTZ,
      lost_at TIMESTAMPTZ,
      lost_reason_id VARCHAR(50),
      lost_comment TEXT,
      reactivate_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  // ─── Журналы: из них считаются воронка, цикл и время на этапе ────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS sales_deal_events (
      id BIGSERIAL PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      deal_id VARCHAR(50) NOT NULL,
      old_stage_id VARCHAR(50),
      new_stage_id VARCHAR(50),
      changed_by VARCHAR(255),
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS sales_activities (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      deal_id VARCHAR(50),
      account_id VARCHAR(50),
      type VARCHAR(20) NOT NULL,
      direction VARCHAR(10),
      result VARCHAR(50),
      text TEXT,
      message_id VARCHAR(50),
      agent_id VARCHAR(50),
      happened_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS sales_tasks (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      deal_id VARCHAR(50),
      account_id VARCHAR(50),
      lead_id VARCHAR(50),
      kind VARCHAR(20) NOT NULL DEFAULT 'manual',
      title VARCHAR(500) NOT NULL,
      channel VARCHAR(20),
      due_at TIMESTAMPTZ,
      done_at TIMESTAMPTZ,
      done_result VARCHAR(50),
      assignee_agent_id VARCHAR(50),
      cadence_step INT,
      auto BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  // ─── Настройки территории: валюта, юрлицо, множитель цен ─────────────────────
  // «Цены и валюта для всех регионов свои» — поэтому валюта живёт на территории,
  // а прайс хранит сумму сразу во всех валютах, без пересчёта по курсу.
  await sql`
    CREATE TABLE IF NOT EXISTS sales_market_settings (
      org_id VARCHAR(50) NOT NULL,
      market_id VARCHAR(50) NOT NULL,
      currency VARCHAR(10) NOT NULL,
      legal_entity VARCHAR(150),
      contract_template_kind VARCHAR(30),
      is_active BOOLEAN NOT NULL DEFAULT true,
      PRIMARY KEY (org_id, market_id)
    )
  `

  // ─── Прайс-лист: тарифы, интеграции, модули, депозиты ────────────────────────
  // Источник — каталог с сайта и генератора КП. Цены во всех валютах в одном
  // поле: цена в тенге не равна долларовой по курсу, это отдельное решение.
  await sql`
    CREATE TABLE IF NOT EXISTS sales_price_items (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      key VARCHAR(50) NOT NULL,
      name VARCHAR(200) NOT NULL,
      description TEXT,
      category VARCHAR(20) NOT NULL DEFAULT 'module',
      unit VARCHAR(50),
      unit_kind VARCHAR(20) NOT NULL DEFAULT 'flat',
      recurring VARCHAR(20) NOT NULL DEFAULT 'monthly',
      prices JSONB NOT NULL DEFAULT '{}'::jsonb,
      included_orders INT,
      extra_order_price JSONB,
      markets JSONB,
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  // ─── Партнёрские программы ───────────────────────────────────────────────────
  // Смысл справочника — навести порядок в договорённостях: партнёр выбирается
  // из программы, а не описывается текстом. Индивидуальные условия остаются
  // возможными, но становятся видимым исключением, а не нормой.
  //
  // model:  revshare — процент с платежей приведённого клиента
  //         bounty   — разовая выплата за подписанного клиента
  //         discount — реселлер покупает лицензии со скидкой и продаёт по прайсу
  //         mixed    — комбинация, условия в partner_terms
  await sql`
    CREATE TABLE IF NOT EXISTS sales_partner_programs (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      key VARCHAR(50) NOT NULL,
      name VARCHAR(150) NOT NULL,
      model VARCHAR(20) NOT NULL DEFAULT 'revshare',
      rate_pct NUMERIC(5,2),
      bounty_amount NUMERIC(14,2),
      bounty_currency VARCHAR(10),
      duration_months INT,            -- NULL = бессрочно
      payout_rule VARCHAR(20) NOT NULL DEFAULT 'always',  -- always | case_by_case | none
      attribution_days INT,           -- сколько дней контакт «принадлежит» партнёру
      exclusive_territory BOOLEAN NOT NULL DEFAULT false,
      min_deals_per_quarter INT,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INT NOT NULL DEFAULT 0
    )
  `

  // ─── Реестр правовых документов ──────────────────────────────────────────────
  // Оферта, политика, соглашения по странам и языкам живут снаружи (сайт,
  // Google Docs), здесь только ссылки на действующие редакции. Смысл: в КП и
  // оферте подставляется актуальная ссылка, а не файл из чьей-то папки.
  await sql`
    CREATE TABLE IF NOT EXISTS sales_legal_docs (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      kind VARCHAR(30) NOT NULL,
      market_id VARCHAR(50),
      lang VARCHAR(5) NOT NULL DEFAULT 'ru',
      title VARCHAR(200) NOT NULL,
      url TEXT NOT NULL,
      version VARCHAR(30),
      effective_from DATE,
      is_active BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  // ─── Документы: КП, договор, оферта ──────────────────────────────────────────
  // Документ отправляется ссылкой, а не файлом: тогда видно, кто открыл, сколько
  // раз и сколько времени читал, а клиент всегда смотрит актуальную версию.
  // Файл (Word/PDF) генерируется отдельно — его отдают бухгалтерии.
  await sql`
    CREATE TABLE IF NOT EXISTS sales_documents (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      deal_id VARCHAR(50),
      account_id VARCHAR(50),
      kind VARCHAR(20) NOT NULL DEFAULT 'quote',
      number VARCHAR(50),
      version INT NOT NULL DEFAULT 1,
      parent_id VARCHAR(50),
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      title VARCHAR(255),
      lines JSONB NOT NULL DEFAULT '[]'::jsonb,
      conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
      requisites JSONB NOT NULL DEFAULT '{}'::jsonb,
      body TEXT,
      subtotal NUMERIC(14,2),
      discount_pct NUMERIC(5,2),
      total NUMERIC(14,2),
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      valid_till DATE,
      share_token VARCHAR(64),
      file_url TEXT,
      template_id VARCHAR(50),
      opened_count INT NOT NULL DEFAULT 0,
      read_seconds INT NOT NULL DEFAULT 0,
      first_opened_at TIMESTAMPTZ,
      last_opened_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      accepted_at TIMESTAMPTZ,
      signed_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ,
      created_by VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  // Каждое открытие отдельной строкой: из них считается «сколько времени читал»
  // и видно, что документ пересылали внутри компании клиента
  await sql`
    CREATE TABLE IF NOT EXISTS sales_document_views (
      id BIGSERIAL PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      document_id VARCHAR(50) NOT NULL,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      seconds INT NOT NULL DEFAULT 0,
      viewer_hash VARCHAR(64),
      user_agent VARCHAR(255),
      referrer VARCHAR(255)
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS sales_doc_templates (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      kind VARCHAR(20) NOT NULL DEFAULT 'contract',
      market_id VARCHAR(50),
      pipeline VARCHAR(20) NOT NULL DEFAULT 'sales',
      entity JSONB,
      number_format VARCHAR(50),
      name VARCHAR(150) NOT NULL,
      body TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT false,
      is_active BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  // Внутренняя нумерация: свободная для клиента, но сквозная для учёта.
  // Счётчик берётся одним атомарным UPDATE ... RETURNING — без гонок.
  await sql`
    CREATE TABLE IF NOT EXISTS sales_doc_counters (
      org_id VARCHAR(50) NOT NULL,
      kind VARCHAR(20) NOT NULL,
      year INT NOT NULL,
      last_seq INT NOT NULL DEFAULT 0,
      PRIMARY KEY (org_id, kind, year)
    )
  `

  // Догоняющие изменения для уже созданной схемы: CREATE TABLE IF NOT EXISTS
  // существующую таблицу не трогает, поэтому новые колонки добавляются явно
  await sql`ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS city VARCHAR(100)`

  // ─── Индексы под запросы очереди, отчётов и склейки ──────────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_accounts_org ON sales_accounts(org_id, lifecycle)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_accounts_merchant ON sales_accounts(org_id, merchant_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_accounts_channel ON sales_accounts(channel_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_contacts_phone ON sales_contacts(org_id, phone_norm)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_contacts_account ON sales_contacts(account_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_leads_status ON sales_leads(org_id, status, created_at)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_leads_sla ON sales_leads(org_id, sla_due_at) WHERE first_touch_at IS NULL`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_leads_phone ON sales_leads(org_id, phone_norm)`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_leads_external ON sales_leads(org_id, source_id, external_id) WHERE external_id IS NOT NULL`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_deals_stage ON sales_deals(org_id, stage_id, stage_since)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_deals_owner ON sales_deals(org_id, owner_agent_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_deals_account ON sales_deals(account_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_deals_react ON sales_deals(org_id, reactivate_at) WHERE reactivate_at IS NOT NULL`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_deals_forecast ON sales_deals(org_id, expected_close_at)`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_deals_external ON sales_deals(org_id, external_id) WHERE external_id IS NOT NULL`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_events_deal ON sales_deal_events(deal_id, changed_at)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_activities_deal ON sales_activities(deal_id, happened_at)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_tasks_due ON sales_tasks(org_id, assignee_agent_id, due_at) WHERE done_at IS NULL`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_stages_key ON sales_stages(org_id, key)`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_reasons_code ON sales_lost_reasons(org_id, code)`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_sources_key ON sales_sources(org_id, key)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_docs_deal ON sales_documents(deal_id, created_at)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_docs_org ON sales_documents(org_id, kind, status)`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_docs_token ON sales_documents(share_token) WHERE share_token IS NOT NULL`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_docviews_doc ON sales_document_views(document_id, opened_at)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_accounts_partner ON sales_accounts(org_id, account_type)`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_partner_programs_key ON sales_partner_programs(org_id, key)`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_price_items_key ON sales_price_items(org_id, key)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_legal_docs ON sales_legal_docs(org_id, kind, lang)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_accounts_referrer ON sales_accounts(referred_by_account_id) WHERE referred_by_account_id IS NOT NULL`

  // ─── Сиды справочников: ON CONFLICT DO NOTHING — правки в UI не затираются ───
  for (let i = 0; i < STAGE_SEED.length; i++) {
    const s = STAGE_SEED[i]
    await sql`
      INSERT INTO sales_stages (id, org_id, key, label, kind, owner_role, sla_hours,
                              required_fields, cadence, sort_order, probability)
      VALUES (${salesId('sst')}, ${orgId}, ${s.key}, ${s.label}, ${s.kind}, ${s.ownerRole},
              ${s.slaHours}, ${JSON.stringify(s.requiredFields)}::jsonb,
              ${JSON.stringify(s.cadence)}::jsonb, ${i}, ${s.probability})
      ON CONFLICT (org_id, key) DO NOTHING
    `
  }
  for (let i = 0; i < PARTNER_STAGE_SEED.length; i++) {
    const s = PARTNER_STAGE_SEED[i]
    await sql`
      INSERT INTO sales_stages (id, org_id, key, label, kind, owner_role, sla_hours,
                                required_fields, cadence, sort_order, probability, pipeline)
      VALUES (${salesId('sst')}, ${orgId}, ${s.key}, ${s.label}, ${s.kind}, 'ae',
              ${s.slaHours}, ${JSON.stringify(s.requiredFields)}::jsonb,
              ${JSON.stringify(s.cadence)}::jsonb, ${i}, ${s.probability}, 'partner')
      ON CONFLICT (org_id, key) DO NOTHING
    `
  }
  for (let i = 0; i < LOST_REASON_SEED.length; i++) {
    const r = LOST_REASON_SEED[i]
    await sql`
      INSERT INTO sales_lost_reasons (id, org_id, code, label, reactivate_days, sort_order)
      VALUES (${salesId('slr')}, ${orgId}, ${r.code}, ${r.label}, ${r.days}, ${i})
      ON CONFLICT (org_id, code) DO NOTHING
    `
  }
  for (let i = 0; i < SOURCE_SEED.length; i++) {
    const s = SOURCE_SEED[i]
    await sql`
      INSERT INTO sales_sources (id, org_id, key, label, kind, sort_order)
      VALUES (${salesId('ssrc')}, ${orgId}, ${s.key}, ${s.label}, ${s.kind}, ${i})
      ON CONFLICT (org_id, key) DO NOTHING
    `
  }


  // ─── Прайс из каталога сайта и генератора КП ─────────────────────────────────
  // Тарифы считаются по заказам в месяц, а не по точкам. Цена в каждой валюте
  // задана отдельно, курсом не пересчитывается.
  const MARKETS = [
    { market: 'uz', currency: 'UZS', entity: 'ООО «DELEVER»', tpl: 'contract' },
    { market: 'kz', currency: 'KZT', entity: 'Частная компания Delever Ltd.', tpl: 'contract' },
    { market: 'ge', currency: 'GEL', entity: 'Delever (партнёр)', tpl: 'contract' },
    { market: 'ae', currency: 'USD', entity: 'Delever', tpl: 'service_agreement' },
    { market: 'az', currency: 'USD', entity: 'Delever', tpl: 'contract' },
  ]
  for (const m of MARKETS) {
    await sql`
      INSERT INTO sales_market_settings (org_id, market_id, currency, legal_entity, contract_template_kind)
      VALUES (${orgId}, ${m.market}, ${m.currency}, ${m.entity}, ${m.tpl})
      ON CONFLICT (org_id, market_id) DO NOTHING
    `
  }

  const PRICE_ITEMS: Array<{
    key: string; name: string; desc: string; cat: string; kind: string; unit: string; rec: string
    prices: Record<string, number>; orders?: number; extra?: Record<string, number>
  }> = [
    // Тарифы: цена зависит от числа заказов в месяц, сверх лимита — доплата за заказ
    { key: 'plan-start', name: 'Тариф Start', desc: '1 000 заказов включено, сайт, бот, POS, CRM, аналитика',
      kind: 'flat', cat: 'plan', unit: '/мес', rec: 'monthly', orders: 1000,
      prices: { UZS: 1300000, USD: 150, KZT: 75000, GEL: 700 },
      extra: { UZS: 1950, USD: 0.2, KZT: 100, GEL: 0.5 } },
    { key: 'plan-medium', name: 'Тариф Medium', desc: '3 000 заказов включено, сайт, бот, POS, CRM, аналитика',
      kind: 'flat', cat: 'plan', unit: '/мес', rec: 'monthly', orders: 3000,
      prices: { UZS: 3600000, USD: 300, KZT: 150000, GEL: 1400 },
      extra: { UZS: 1950, USD: 0.2, KZT: 100, GEL: 0.5 } },
    { key: 'plan-big', name: 'Тариф Big', desc: '6 000 заказов включено, сайт, бот, POS, CRM, аналитика',
      kind: 'flat', cat: 'plan', unit: '/мес', rec: 'monthly', orders: 6000,
      prices: { UZS: 6600000, USD: 600, KZT: 300000, GEL: 2800 },
      extra: { UZS: 1950, USD: 0.2, KZT: 100, GEL: 0.5 } },
    { key: 'plan-enterprise', name: 'Тариф Enterprise', desc: '10 000 заказов, все модули, персональный менеджер',
      kind: 'flat', cat: 'plan', unit: '/мес', rec: 'monthly', orders: 10000,
      prices: { UZS: 13000000, USD: 1200, KZT: 600000, GEL: 5600 },
      extra: { UZS: 1000, USD: 0.1, KZT: 50, GEL: 0.3 } },

    { key: 'agg-single', name: 'Агрегатор (1 сервис)', desc: 'Wolt / Glovo / Uzum / Yandex / Bolt — за филиал',
      kind: 'per_service', cat: 'integration', unit: 'за филиал/мес', rec: 'monthly',
      prices: { UZS: 260000, USD: 50, KZT: 25000, GEL: 150 } },
    { key: 'agg-all', name: 'Все агрегаторы', desc: 'Все сервисы в одном окне — за филиал',
      kind: 'per_point', cat: 'integration', unit: 'за филиал/мес', rec: 'monthly',
      prices: { UZS: 650000, USD: 150, KZT: 75000, GEL: 400 } },
    { key: 'delivery', name: 'Курьерские сервисы', desc: 'Yandex Go, Wolt Drive, Millennium, Noor',
      kind: 'per_brand', cat: 'integration', unit: 'за бренд/мес', rec: 'monthly',
      prices: { UZS: 520000, USD: 80, KZT: 75000, GEL: 200 } },

    { key: 'mobile-app', name: 'Мобильное приложение', desc: 'iOS + Android, push, программа лояльности',
      kind: 'flat', cat: 'module', unit: 'разовая оплата', rec: 'one-time',
      prices: { UZS: 13000000, USD: 1500, KZT: 500000, GEL: 4000 } },
    { key: 'kiosk', name: 'Киоск самообслуживания', desc: 'Терминал для зала. Средний чек +15%',
      kind: 'per_kiosk', cat: 'module', unit: 'за киоск/мес', rec: 'monthly',
      prices: { UZS: 910000, USD: 100, KZT: 50000, GEL: 250 } },
    { key: 'qr-menu', name: 'QR-меню', desc: 'Гость сканирует, выбирает, оплачивает со смартфона',
      kind: 'per_point', cat: 'module', unit: '/мес', rec: 'monthly',
      prices: { UZS: 260000, USD: 20, KZT: 10000, GEL: 50 } },
    { key: 'courier-app', name: 'Курьерское приложение', desc: 'Управление курьерами, GPS, автораспределение',
      kind: 'flat', cat: 'module', unit: '/мес', rec: 'monthly',
      prices: { UZS: 520000, USD: 60, KZT: 30000, GEL: 150 } },
    { key: 'kds', name: 'KDS (экран кухни)', desc: 'Заказы на кухне в реальном времени',
      kind: 'per_point', cat: 'module', unit: '/мес', rec: 'monthly',
      prices: { UZS: 390000, USD: 40, KZT: 20000, GEL: 100 } },
    { key: 'marketing', name: 'Маркетинг-модуль', desc: 'Промокоды, акции, push, реферальная программа',
      kind: 'flat', cat: 'module', unit: '/мес', rec: 'monthly',
      prices: { UZS: 520000, USD: 60, KZT: 30000, GEL: 150 } },
    { key: 'analytics-dash', name: 'Дашборд аналитики', desc: 'Продажи, средний чек, LTV, когорты',
      kind: 'flat', cat: 'module', unit: '/мес', rec: 'monthly',
      prices: { UZS: 390000, USD: 40, KZT: 20000, GEL: 100 } },
    { key: 'booking', name: 'Бронирование', desc: 'Онлайн-бронирование столиков, управление залом',
      kind: 'per_point', cat: 'module', unit: '/мес', rec: 'monthly',
      prices: { UZS: 390000, USD: 40, KZT: 20000, GEL: 100 } },

    { key: 'setup-custom', name: 'Установка, интеграция или доработка', desc: 'Стоимость по оценке: объём работ определяется после уточнения задачи',
      kind: 'flat', cat: 'custom', unit: 'по оценке', rec: 'one-time',
      prices: { UZS: 0, USD: 0, KZT: 0, GEL: 0 } },

    { key: 'deposit-platform', name: 'Депозит (платформа)', desc: 'Предоплата, расходуется помесячно в счёт тарифа',
      kind: 'flat', cat: 'deposit', unit: 'при подключении', rec: 'deposit',
      prices: { UZS: 6500000, USD: 750, KZT: 375000, GEL: 3500 } },
    { key: 'deposit-agg', name: 'Депозит (агрегаторы)', desc: 'Предоплата, расходуется помесячно в счёт агрегаторов',
      kind: 'flat', cat: 'deposit', unit: 'при подключении', rec: 'deposit',
      prices: { UZS: 3900000, USD: 450, KZT: 225000, GEL: 2100 } },
  ]
  for (let i = 0; i < PRICE_ITEMS.length; i++) {
    const it = PRICE_ITEMS[i]
    await sql`
      INSERT INTO sales_price_items (id, org_id, key, name, description, category, unit, unit_kind,
                                     recurring, prices, included_orders, extra_order_price, sort_order)
      VALUES (${salesId('spi')}, ${orgId}, ${it.key}, ${it.name}, ${it.desc}, ${it.cat}, ${it.unit}, ${it.kind},
              ${it.rec}, ${JSON.stringify(it.prices)}::jsonb, ${it.orders ?? null},
              ${it.extra ? JSON.stringify(it.extra) : null}::jsonb, ${i})
      ON CONFLICT (org_id, key) DO NOTHING
    `
  }

  // Отправная сетка: четыре модели вместо индивидуальных договорённостей.
  // Ставки — предмет вашего решения, правятся в интерфейсе без деплоя.
  const PARTNER_PROGRAMS = [
    { key: 'contact', name: 'Передал контакт', model: 'bounty', payout: 'case_by_case',
      rate: null, bounty: null, cur: null, months: null, attr: 90, excl: false, minDeals: null,
      notes: 'Просто передал контакт. Вознаграждение по решению: иногда выплата, иногда благодарность. Обязательств нет.' },
    { key: 'referral_paid', name: 'Разовое вознаграждение', model: 'bounty', payout: 'always',
      rate: null, bounty: 100, cur: 'USD', months: null, attr: 90, excl: false, minDeals: null,
      notes: 'Фиксированная выплата после первого платежа клиента. Дальше партнёр не участвует.' },
    { key: 'revshare_limited', name: 'Процент, ограниченный период', model: 'revshare', payout: 'always',
      rate: 15, bounty: null, cur: null, months: 12, attr: 120, excl: false, minDeals: null,
      notes: 'Процент с платежей клиента в течение срока. По окончании клиент полностью наш.' },
    { key: 'revshare_lifetime', name: 'Процент, бессрочно', model: 'revshare', payout: 'always',
      rate: 10, bounty: null, cur: null, months: null, attr: 180, excl: false, minDeals: null,
      notes: 'Процент без ограничения срока, пока клиент платит. Ставка ниже: обязательство длинное.' },
    { key: 'reseller', name: 'Реселлер', model: 'discount', payout: 'always',
      rate: 25, bounty: null, cur: null, months: null, attr: null, excl: false, minDeals: 2,
      notes: 'Покупает лицензии со скидкой и продаёт по прайсу. Первую линию поддержки держит сам.' },
    { key: 'distributor', name: 'Дистрибьютор', model: 'mixed', payout: 'always',
      rate: 35, bounty: null, cur: null, months: null, attr: null, excl: true, minDeals: 5,
      notes: 'Эксклюзив по территории при выполнении плана. Скидка плюс маркетинговая поддержка.' },
  ]
  for (let i = 0; i < PARTNER_PROGRAMS.length; i++) {
    const p = PARTNER_PROGRAMS[i]
    await sql`
      INSERT INTO sales_partner_programs (id, org_id, key, name, model, rate_pct,
                                          bounty_amount, bounty_currency, duration_months,
                                          payout_rule, attribution_days,
                                          exclusive_territory, min_deals_per_quarter, notes, sort_order)
      VALUES (${salesId('spp')}, ${orgId}, ${p.key}, ${p.name}, ${p.model}, ${p.rate},
              ${p.bounty}, ${p.cur}, ${p.months}, ${p.payout}, ${p.attr},
              ${p.excl}, ${p.minDeals}, ${p.notes}, ${i})
      ON CONFLICT (org_id, key) DO NOTHING
    `
  }

  // Действующие редакции правовых документов Delever
  const LEGAL = [
    { kind: 'public_offer', market: 'uz', lang: 'ru', title: 'Публичная оферта',
      url: 'https://admin.delever.uz/#/public-offer' },
    { kind: 'privacy_policy', market: 'uz', lang: 'ru', title: 'Политика конфиденциальности',
      url: 'https://admin.delever.uz/#/privacy-policy' },
    { kind: 'service_agreement', market: null, lang: 'en', title: 'Service agreement (EN)',
      url: 'https://docs.google.com/document/d/1YvB8eSL7w5N2mnKJKc85riAVu_obrL-nEROVPmUalN0/edit' },
    { kind: 'service_agreement', market: null, lang: 'ru', title: 'Соглашение об обслуживании (RU)',
      url: 'https://docs.google.com/document/d/1fy9eL4PD2HqDe-mE6Yjmx9bDpCNT6YqpLkXoBvxhSH4/edit' },
    { kind: 'service_agreement', market: 'ae', lang: 'en', title: 'Service agreement — UAE',
      url: 'https://docs.google.com/document/d/1H2HqAkjq7LOLuj3yas_d1UxGjXkXGBT4LXPUWETug7M/edit' },
    { kind: 'terms_of_service', market: null, lang: 'ru', title: 'Оферта и условия использования',
      url: 'https://docs.google.com/document/d/1xRaG7W8hdPwNmGVCwt7jOiHUFLNqweg0_BSi7_yruGM/edit' },
  ]
  for (const d of LEGAL) {
    const [ex] = await sql`
      SELECT id FROM sales_legal_docs WHERE org_id = ${orgId} AND url = ${d.url} LIMIT 1
    `
    if (ex) continue
    await sql`
      INSERT INTO sales_legal_docs (id, org_id, kind, market_id, lang, title, url)
      VALUES (${salesId('sld')}, ${orgId}, ${d.kind}, ${d.market}, ${d.lang}, ${d.title}, ${d.url})
    `
  }

  // ─── Шаблоны договоров: по одному на юрлицо и территорию ────────────────────
  // Структура снята с боевых договоров: Узбекистан — ООО «DELEVER», номер вида
  // 108/26; Казахстан — Delever Ltd., сквозной номер 181, реквизиты с БИН/КБе/БИК.
  // Полный текст юрист вставляет один раз в интерфейсе — здесь скелет с
  // плейсхолдерами, чтобы подстановка и нумерация заработали сразу.
  const TEMPLATES = [
    {
      kind: 'contract', market: 'uz', name: 'Лицензионный договор — Узбекистан',
      numberFormat: '{seq}/{yy}',
      entity: {
        legal: 'Общество с ограниченной ответственностью «DELEVER»',
        signer: 'Директор Юсупов Ф. Ш.', basis: 'на основании Устава', city: 'Ташкент',
      },
      body: `ЛИЦЕНЗИОННЫЙ ДОГОВОР №{{contract_number}}

г. {{city}}, «{{contract_date}}»

{{licensor_legal}}, именуемое «Лицензиар», в лице {{licensor_signer}}, действующего {{licensor_basis}},
и {{client_legal}}, именуемое «Лицензиат», в лице {{client_signer}}, действующего {{client_basis}},
заключили настоящий лицензионный договор о нижеследующем.

[ПОЛНЫЙ ТЕКСТ ДОГОВОРА — вставляется юристом один раз]

Тариф: {{tariff}} · точек: {{points}} · абонентская плата {{monthly_amount}} {{currency}} в месяц.
Дата начала обслуживания: {{start_date}}.

12. АДРЕСА И РЕКВИЗИТЫ СТОРОН

ЛИЦЕНЗИАР: {{licensor_requisites}}

ЛИЦЕНЗИАТ: {{client_legal}}
ИНН: {{client_inn}}
Банк: {{client_bank}}, МФО: {{client_mfo}}
Расчётный счёт: {{client_account}}
Адрес: {{client_address}}
{{client_signer_title}} ___________ {{client_signer}}`,
    },
    {
      kind: 'contract', market: 'kz', name: 'Лицензионный договор — Казахстан',
      numberFormat: '{seq}',
      entity: {
        legal: 'Частная компания Delever Ltd.', signer: 'Директор Юсупов Ф. Ш.',
        basis: 'на основании Устава', city: 'Астана',
        bin: '241240900095', kbe: '17', account: 'KZ638562203142516964 (KZT)',
        bank: 'филиал АО «Банк ЦентрКредит»', bik: 'KCJBKZKX',
        address: 'Z05T2K5, город Астана, район Есиль, проспект Аль-Фараби 21/1, НП 5',
      },
      body: `ЛИЦЕНЗИОННЫЙ ДOГOBOP № {{contract_number}}

г. {{city}}, «{{contract_date}}»

{{licensor_legal}}, именуемое «Лицензиар», в лице {{licensor_signer}}, действующего {{licensor_basis}},
и {{client_legal}}, именуемое «Лицензиат», в лице {{client_signer}}, действующего {{client_basis}},
заключили настоящий лицензионный договор о нижеследующем.

[ПОЛНЫЙ ТЕКСТ ДОГОВОРА — вставляется юристом один раз]

12. АДРЕСА И РЕКВИЗИТЫ СТОРОН

ЛИЦЕНЗИАР: {{licensor_requisites}}

ЛИЦЕНЗИАТ: {{client_legal}}
БИН (ИИН): {{client_bin}}, КБе: {{client_kbe}}
Банк: {{client_bank}}, БИК: {{client_bik}}
Номер счёта: {{client_account}}
Адрес: {{client_address}}
{{client_signer_title}} _________ {{client_signer}}`,
    },
    {
      kind: 'act', market: null, name: 'Акт приёма-передачи (Приложение №2)',
      numberFormat: '{seq}',
      entity: null,
      body: `Приложение №2

АКТ приёма-передачи права использования Системы

г. {{city}}, «{{contract_date}}»

Лицензиар — {{licensor_legal}}, в лице {{licensor_signer}}, и Лицензиат — {{client_legal}},
в лице {{client_signer}}, составили настоящий Акт о нижеследующем:

1. В соответствии с Лицензионным договором № {{contract_number}} от «{{contract_date}}»
   Лицензиар передал, а Лицензиат принял право использования программного продукта
   «Система автоматизации службы доставки (Delever)» в объёме выбранного Тарифа.
2. Доступ предоставлен путём передачи учётных данных и выполнения настроек.
3. Претензий по объёму и способу передачи права использования Стороны не имеют.

Лицензиар: ___________ / {{licensor_signer}} /   М.П.
Лицензиат: ___________ / {{client_signer}} /   М.П.`,
    },
    {
      kind: 'partner_contract', market: null, name: 'Партнёрский договор — базовый',
      numberFormat: 'P-{seq}/{yy}',
      entity: null,
      body: `ПАРТНЁРСКИЙ (АГЕНТСКИЙ) ДОГОВОР № {{contract_number}}

г. {{city}}, «{{contract_date}}»

{{licensor_legal}} и {{client_legal}}, именуемый «Партнёр», договорились о следующем.

Тип партнёрства: {{partner_kind}}
Территория: {{partner_territory}}
Вознаграждение: {{partner_fee}}
Порядок расчётов: {{partner_settlement}}

[ПОЛНЫЙ ТЕКСТ — вставляется юристом один раз]`,
    },
  ]

  for (const t of TEMPLATES) {
    const [exists] = await sql`
      SELECT id FROM sales_doc_templates
      WHERE org_id = ${orgId} AND kind = ${t.kind}
        AND COALESCE(market_id, '') = ${t.market || ''}
      LIMIT 1
    `
    if (exists) continue
    await sql`
      INSERT INTO sales_doc_templates (id, org_id, kind, market_id, pipeline, entity,
                                       number_format, name, body, is_default)
      VALUES (${salesId('sdt')}, ${orgId}, ${t.kind}, ${t.market}, 
              ${t.kind === 'partner_contract' ? 'partner' : 'sales'},
              ${t.entity ? JSON.stringify(t.entity) : null}::jsonb,
              ${t.numberFormat}, ${t.name}, ${t.body}, true)
    `
  }

  // Версию пишем последней: упавший на середине прогон повторится в следующий
  // раз, а не будет считаться выполненным
  await sql`
    INSERT INTO support_platform_settings (key, value, updated_at)
    VALUES (${versionKey}, ${SCHEMA_VERSION}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${SCHEMA_VERSION}, updated_at = NOW()
  `

  ensuredOrgs.add(orgId)
}
