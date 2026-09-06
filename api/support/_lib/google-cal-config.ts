import { getSQL, ensureOnce } from './db.js'

/**
 * Доступ к Google Календарю живёт в базе, а не в переменных окружения —
 * по тем же причинам, что и доступы Meta: подключает тот, у кого есть права
 * на календарь продаж, а не тот, у кого есть доступ к панели хостинга.
 *
 * Подключается каждый сотрудник сам, своим ящиком. Общий календарь на всех
 * не годился по существу: на общем аккаунте Google не может сказать, кто
 * именно занят, и мы видели только те конфликты, которые создали сами —
 * стоматолог, отпуск или совещание вне CRM оставались невидимыми.
 *
 * Реквизиты приложения при этом одни на организацию: OAuth-клиент заводится
 * администратором один раз, а согласие проходит каждый за себя.
 */

export interface GoogleCalConfig {
  orgId: string
  clientId: string | null
  clientSecret: string | null
  /** Закреплён при сохранении ключей: Google требует точного совпадения. */
  redirectUri: string | null
  workDays: number[]
  workFrom: number
  workTo: number
  slotMinutes: number
  publicBooking: boolean
}

const DEFAULTS = {
  workDays: [1, 2, 3, 4, 5, 6],
  workFrom: 10,
  workTo: 19,
  slotMinutes: 60,
}

/** Таблицы создаём на месте: отдельного механизма миграций в проекте нет. */
export async function ensureGoogleCalSchema(sql: any): Promise<void> {
  await ensureOnce('google_cal_schema', async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS support_google_calendar (
        org_id VARCHAR(50) PRIMARY KEY,
        client_id VARCHAR(200),
        client_secret TEXT,
        redirect_uri TEXT,
        refresh_token TEXT,
        calendar_email VARCHAR(200),
        work_days VARCHAR(20) NOT NULL DEFAULT '1,2,3,4,5,6',
        work_from SMALLINT NOT NULL DEFAULT 10,
        work_to SMALLINT NOT NULL DEFAULT 19,
        slot_minutes SMALLINT NOT NULL DEFAULT 60,
        public_booking BOOLEAN NOT NULL DEFAULT false,
        connected_by VARCHAR(50),
        connected_by_name VARCHAR(150),
        connected_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    // state одноразовый и недолгий: без него подключить чужую организацию
    // по подобранной ссылке было бы можно
    await sql`
      CREATE TABLE IF NOT EXISTS support_google_oauth_state (
        state VARCHAR(100) PRIMARY KEY,
        org_id VARCHAR(50) NOT NULL,
        agent_id VARCHAR(50),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    // Доступ персональный: у каждого свой ящик и своё расписание
    await sql`
      CREATE TABLE IF NOT EXISTS support_google_agent (
        org_id VARCHAR(50) NOT NULL,
        agent_id VARCHAR(60) NOT NULL,
        refresh_token TEXT,
        calendar_email VARCHAR(200),
        connected_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (org_id, agent_id)
      )
    `
    // Уже выданный на уровне организации доступ переносим тому, кто его выдал,
    // — иначе рабочее подключение молча пропало бы при выкладке
    await sql`
      INSERT INTO support_google_agent (org_id, agent_id, refresh_token, calendar_email, connected_at)
      SELECT org_id, connected_by, refresh_token, calendar_email, connected_at
      FROM support_google_calendar
      WHERE refresh_token IS NOT NULL AND connected_by IS NOT NULL
      ON CONFLICT (org_id, agent_id) DO NOTHING
    `
  })
}

const parseDays = (v: string | null): number[] => {
  if (!v) return DEFAULTS.workDays
  const out = String(v).split(',').map(n => parseInt(n, 10)).filter(n => n >= 0 && n <= 6)
  return out.length ? out : DEFAULTS.workDays
}

export async function readGoogleCalConfig(orgId: string): Promise<GoogleCalConfig> {
  const sql = getSQL()
  await ensureGoogleCalSchema(sql)
  const [row] = await sql`
    SELECT * FROM support_google_calendar WHERE org_id = ${orgId} LIMIT 1
  ` as any[]
  return {
    orgId,
    clientId: row?.client_id ?? null,
    clientSecret: row?.client_secret ?? null,
    redirectUri: row?.redirect_uri ?? null,
    workDays: parseDays(row?.work_days ?? null),
    workFrom: row?.work_from ?? DEFAULTS.workFrom,
    workTo: row?.work_to ?? DEFAULTS.workTo,
    slotMinutes: row?.slot_minutes ?? DEFAULTS.slotMinutes,
    publicBooking: Boolean(row?.public_booking),
  }
}

/**
 * Живой access-токен конкретного сотрудника.
 *
 * Кэш в памяти функции: access живёт час, а дорога до базы ≈190 мс —
 * перечитывать подключение на каждый запрос к календарю незачем.
 */
const tokenCache = new Map<string, { token: string; exp: number }>()

export async function getAgentToken(orgId: string, agentId: string | null): Promise<string | null> {
  if (!agentId) return null
  const key = `${orgId}:${agentId}`
  const hit = tokenCache.get(key)
  if (hit && hit.exp > Date.now() + 60_000) return hit.token

  const sql = getSQL()
  await ensureGoogleCalSchema(sql)
  const [app] = await sql`
    SELECT client_id, client_secret FROM support_google_calendar WHERE org_id = ${orgId} LIMIT 1
  ` as any[]
  const [row] = await sql`
    SELECT refresh_token FROM support_google_agent
    WHERE org_id = ${orgId} AND agent_id = ${agentId} LIMIT 1
  ` as any[]
  if (!app?.client_id || !app?.client_secret || !row?.refresh_token) return null

  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: app.client_id,
        client_secret: app.client_secret,
        refresh_token: row.refresh_token,
        grant_type: 'refresh_token',
      }),
    })
    if (!r.ok) return null
    const j = await r.json() as any
    if (!j.access_token) return null
    tokenCache.set(key, { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 })
    return j.access_token
  } catch { return null }
}

/** Кто из команды подключил календарь — для карточки интеграции. */
export async function listConnectedAgents(orgId: string): Promise<Array<{
  agentId: string; name: string | null; email: string | null; connectedAt: string | null
}>> {
  const sql = getSQL()
  await ensureGoogleCalSchema(sql)
  const rows = await sql`
    SELECT g.agent_id, g.calendar_email, g.connected_at, a.name
    FROM support_google_agent g
    LEFT JOIN support_agents a ON a.id = g.agent_id
    WHERE g.org_id = ${orgId} AND g.refresh_token IS NOT NULL
    ORDER BY a.name NULLS LAST
  ` as any[]
  return rows.map(r => ({
    agentId: r.agent_id, name: r.name ?? null,
    email: r.calendar_email ?? null, connectedAt: r.connected_at ?? null,
  }))
}

/**
 * Подключён ли календарь — одним запросом, без обмена токена.
 *
 * Раньше признак для интерфейса считался через getAgentToken, а это поход
 * в Google на каждый показ календаря. Для галочки в UI достаточно факта
 * наличия доступа: живость всё равно проверяется там, где событие создаётся.
 */
export async function hasAgentCalendar(orgId: string, agentId: string | null): Promise<boolean> {
  if (!agentId) return false
  const sql = getSQL()
  await ensureGoogleCalSchema(sql)
  const [row] = await sql`
    SELECT 1 AS ok FROM support_google_agent
    WHERE org_id = ${orgId} AND agent_id = ${agentId} AND refresh_token IS NOT NULL LIMIT 1
  ` as any[]
  return Boolean(row)
}

export function invalidateAgentToken(orgId: string, agentId: string) {
  tokenCache.delete(`${orgId}:${agentId}`)
}

/**
 * Права запрашиваем минимальные: календарь и адрес подключившегося ящика.
 * userinfo.email нужен только чтобы показать в карточке, чей календарь
 * подключён — иначе человек не знает, тот ли аккаунт он выбрал.
 */
export const GOOGLE_CAL_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')
