import { getSQL } from './db.js'

/**
 * Доступы к Meta живут в базе, а не в переменных окружения.
 *
 * Причина простая: подключать Instagram и Facebook должен тот, у кого есть
 * права на страницу, — а это не разработчик. Пока ключи лежали в Vercel,
 * каждое подключение упиралось в выкладку и в человека с доступом к панели
 * хостинга. Теперь всё делается из настроек в самой системе.
 *
 * Переменные окружения остаются запасным путём: если в базе пусто, читаем
 * их — так уже настроенное окружение не ломается при переезде.
 */

export interface MetaConfig {
  orgId: string
  appId: string | null
  appSecret: string | null
  verifyToken: string | null
  pageId: string | null
  pageName: string | null
  pageToken: string | null
  igUserId: string | null
  igUsername: string | null
  connectedByName: string | null
  connectedAt: string | null
  tokenExpiresAt: string | null
  /** Пользовательский токен OAuth — им ходим за списками и в CAPI. */
  userToken: string | null
  /** Пиксель (dataset) для обратной петли рекламы. */
  datasetId: string | null
  datasetName: string | null
  /** Токен System User, введённый руками, — запасной путь для CAPI. */
  capiToken: string | null
  /** Откуда взялись доступы — это видно в карточке интеграции. */
  source: 'db' | 'env' | 'none'
}

const EMPTY: Omit<MetaConfig, 'orgId'> = {
  appId: null, appSecret: null, verifyToken: null, pageId: null, pageName: null,
  pageToken: null, igUserId: null, igUsername: null, connectedByName: null,
  connectedAt: null, tokenExpiresAt: null, userToken: null,
  datasetId: null, datasetName: null, capiToken: null, source: 'none',
}

let schemaReady = false

/** Таблицы создаём на месте: отдельного механизма миграций в проекте нет. */
export async function ensureMetaSchema(sql: any): Promise<void> {
  if (schemaReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS support_meta_integration (
      org_id VARCHAR(50) PRIMARY KEY,
      app_id VARCHAR(50),
      app_secret TEXT,
      verify_token TEXT,
      page_id VARCHAR(50),
      page_name VARCHAR(200),
      page_token TEXT,
      ig_user_id VARCHAR(50),
      ig_username VARCHAR(100),
      scopes TEXT,
      connected_by VARCHAR(50),
      connected_by_name VARCHAR(150),
      connected_at TIMESTAMPTZ,
      token_expires_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS support_meta_forms (
      org_id VARCHAR(50) NOT NULL,
      form_id VARCHAR(50) NOT NULL,
      name VARCHAR(255),
      page_id VARCHAR(50),
      market_id VARCHAR(50),
      suggested_market VARCHAR(50),
      status VARCHAR(30),
      leads_count INT NOT NULL DEFAULT 0,
      last_lead_at TIMESTAMPTZ,
      seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (org_id, form_id)
    )
  `
  // Подключённых аккаунтов может быть несколько: у каждого региона своя
  // страница со своей рекламой и своим инстаграмом. Раньше страница была
  // одна на всю организацию — вторую подключить было некуда
  await sql`
    CREATE TABLE IF NOT EXISTS support_meta_accounts (
      id VARCHAR(60) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      page_id VARCHAR(50) NOT NULL,
      page_name VARCHAR(200),
      page_token TEXT,
      ig_user_id VARCHAR(50),
      ig_username VARCHAR(100),
      market_id VARCHAR(50),
      subscribed BOOLEAN NOT NULL DEFAULT false,
      subscribe_error TEXT,
      connected_by VARCHAR(50),
      connected_by_name VARCHAR(150),
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_active BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_accounts_page
    ON support_meta_accounts(org_id, page_id)
  `
  // Обратная петля рекламы: пиксель и запасной токен. ALTER на месте —
  // отдельного механизма миграций в проекте нет.
  await sql`ALTER TABLE support_meta_integration ADD COLUMN IF NOT EXISTS dataset_id VARCHAR(50)`.catch(() => {})
  await sql`ALTER TABLE support_meta_integration ADD COLUMN IF NOT EXISTS dataset_name VARCHAR(200)`.catch(() => {})
  await sql`ALTER TABLE support_meta_integration ADD COLUMN IF NOT EXISTS capi_token TEXT`.catch(() => {})
  await sql`
    CREATE TABLE IF NOT EXISTS support_meta_oauth_state (
      state VARCHAR(80) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      agent_id VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  schemaReady = true
}

/**
 * Доступы организации. Вебхуки зовут это на каждый запрос, поэтому держим
 * короткий кэш: Meta шлёт уведомления пачками, и читать базу на каждое —
 * лишние сто девяносто миллисекунд к каждому сообщению.
 */
const cache = new Map<string, { at: number; cfg: MetaConfig }>()
const TTL_MS = 30_000

export async function readMetaConfig(orgId: string, fresh = false): Promise<MetaConfig> {
  if (!fresh) {
    const hit = cache.get(orgId)
    if (hit && Date.now() - hit.at < TTL_MS) return hit.cfg
  }

  const sql = getSQL()
  await ensureMetaSchema(sql)
  const [row] = await sql`
    SELECT * FROM support_meta_integration WHERE org_id = ${orgId} LIMIT 1
  ` as any[]

  const envCfg = {
    appId: process.env.META_APP_ID || process.env.FACEBOOK_APP_ID || null,
    appSecret: process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || null,
    verifyToken: process.env.META_VERIFY_TOKEN || process.env.IG_VERIFY_TOKEN || null,
    pageToken: process.env.META_PAGE_TOKEN || process.env.IG_PAGE_TOKEN || null,
    datasetId: process.env.META_DATASET_ID || null,
    capiToken: process.env.META_CAPI_TOKEN || null,
  }

  // База главнее переменных, но по одному полю: наполовину настроенная
  // интеграция не должна оставлять систему без запасного значения
  const cfg: MetaConfig = {
    ...EMPTY,
    orgId,
    appId: row?.app_id || envCfg.appId,
    appSecret: row?.app_secret || envCfg.appSecret,
    verifyToken: row?.verify_token || envCfg.verifyToken,
    pageToken: row?.page_token || envCfg.pageToken,
    pageId: row?.page_id || null,
    pageName: row?.page_name || null,
    igUserId: row?.ig_user_id || null,
    igUsername: row?.ig_username || null,
    connectedByName: row?.connected_by_name || null,
    connectedAt: row?.connected_at || null,
    tokenExpiresAt: row?.token_expires_at || null,
    userToken: row?.user_token || null,
    datasetId: row?.dataset_id || envCfg.datasetId,
    datasetName: row?.dataset_name || null,
    capiToken: row?.capi_token || envCfg.capiToken,
    source: row?.page_token ? 'db' : (envCfg.pageToken ? 'env' : 'none'),
  }

  cache.set(orgId, { at: Date.now(), cfg })
  return cfg
}

/** После правки доступов кэш нужно сбросить, иначе изменения ждут полминуты. */
export function invalidateMetaConfig(orgId?: string): void {
  if (orgId) cache.delete(orgId)
  else cache.clear()
}

/**
 * Регион, подсказанный названием формы.
 *
 * Названия вроде «KZ FORM NEW» или «Форма Узбекистан» несут регион прямо
 * в себе — это дешёвая и точная подсказка. Человек её подтверждает,
 * система не решает за него.
 */
const NAME_HINTS: Array<[RegExp, string]> = [
  [/\b(kz|каз|kazakh|казах|алматы|астана|almaty|astana)\b/i, 'kz'],
  [/\b(uz|узб|uzbek|ташкент|tashkent|toshkent)\b/i, 'uz'],
  [/\b(kg|кыр|kyrgyz|бишкек|bishkek)\b/i, 'kg'],
  [/\b(az|азер|azerb|баку|baku)\b/i, 'az'],
  [/\b(ge|груз|georgia|тбилиси|tbilisi|батуми)\b/i, 'ge'],
  [/\b(cy|кипр|cyprus|лимассол|limassol)\b/i, 'cy'],
  [/\b(ae|оаэ|uae|дубай|dubai|emirates)\b/i, 'ae'],
]

export function marketFromFormName(name: string | null | undefined): string | null {
  const n = String(name || '')
  if (!n) return null
  for (const [re, market] of NAME_HINTS) if (re.test(n)) return market
  return null
}


export interface MetaAccount {
  id: string; pageId: string; pageName: string | null; pageToken: string | null
  igUserId: string | null; igUsername: string | null; marketId: string | null
  subscribed: boolean; subscribeError: string | null
  connectedByName: string | null; connectedAt: string | null
}

/** Подключённые страницы организации. */
export async function readMetaAccounts(orgId: string): Promise<MetaAccount[]> {
  const sql = getSQL()
  await ensureMetaSchema(sql)
  const rows = await sql`
    SELECT * FROM support_meta_accounts
    WHERE org_id = ${orgId} AND is_active = true
    ORDER BY connected_at
  ` as any[]
  return rows.map(r => ({
    id: r.id, pageId: r.page_id, pageName: r.page_name, pageToken: r.page_token,
    igUserId: r.ig_user_id, igUsername: r.ig_username, marketId: r.market_id,
    subscribed: Boolean(r.subscribed), subscribeError: r.subscribe_error,
    connectedByName: r.connected_by_name, connectedAt: r.connected_at,
  }))
}

/**
 * Доступ к нужной странице. Вебхук приносит идентификатор страницы или
 * инстаграма, и отвечать надо именно её токеном: с несколькими подключёнными
 * аккаунтами общий токен «на организацию» отправил бы ответ не туда.
 *
 * Пока не подключено ни одного аккаунта, возвращаем токен из переменных
 * окружения — так уже настроенное окружение продолжает работать.
 */
export async function accountForPage(orgId: string, pageId: string | null): Promise<MetaAccount | null> {
  if (!pageId) return null
  const all = await readMetaAccounts(orgId)
  return all.find(a => a.pageId === String(pageId)) || null
}

export async function accountForIg(orgId: string, igUserId: string | null): Promise<MetaAccount | null> {
  if (!igUserId) return null
  const all = await readMetaAccounts(orgId)
  return all.find(a => a.igUserId === String(igUserId)) || null
}

/** Токен для ответа: сначала по конкретной странице, потом запасной из окружения. */
export async function tokenForPage(orgId: string, pageId: string | null): Promise<string | null> {
  const acc = await accountForPage(orgId, pageId)
  if (acc?.pageToken) return acc.pageToken
  const cfg = await readMetaConfig(orgId)
  return cfg.pageToken
}
