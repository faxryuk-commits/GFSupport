import { getSQL, ensureOnce } from './db.js'

/**
 * Доступ к Google Календарю живёт в базе, а не в переменных окружения —
 * по тем же причинам, что и доступы Meta: подключает тот, у кого есть права
 * на календарь продаж, а не тот, у кого есть доступ к панели хостинга.
 *
 * Календарь один на всю команду. Это осознанный выбор, а не упрощение:
 * встречи распределяет CRM, но видеть их должны все — если менеджер
 * не успевает, встречу подхватывает коллега, и для этого чужое расписание
 * должно быть на одном полотне с собственным.
 */

export interface GoogleCalConfig {
  orgId: string
  clientId: string | null
  clientSecret: string | null
  /** Закреплён при сохранении ключей: Google требует точного совпадения. */
  redirectUri: string | null
  refreshToken: string | null
  calendarEmail: string | null
  connectedByName: string | null
  connectedAt: string | null
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
    refreshToken: row?.refresh_token ?? null,
    calendarEmail: row?.calendar_email ?? null,
    connectedByName: row?.connected_by_name ?? null,
    connectedAt: row?.connected_at ?? null,
    workDays: parseDays(row?.work_days ?? null),
    workFrom: row?.work_from ?? DEFAULTS.workFrom,
    workTo: row?.work_to ?? DEFAULTS.workTo,
    slotMinutes: row?.slot_minutes ?? DEFAULTS.slotMinutes,
    publicBooking: Boolean(row?.public_booking),
  }
}

/**
 * Живой access-токен по сохранённому refresh-токену.
 *
 * Кэш держим в памяти функции: access живёт час, а дорога до базы ≈190 мс —
 * перечитывать конфиг на каждый запрос к календарю незачем. Кэш привязан
 * к orgId, потому что холодный старт общий на все организации.
 */
const tokenCache = new Map<string, { token: string; exp: number }>()

export async function getGoogleAccessToken(cfg: GoogleCalConfig): Promise<string | null> {
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) return null
  const hit = tokenCache.get(cfg.orgId)
  if (hit && hit.exp > Date.now() + 60_000) return hit.token
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    if (!r.ok) return null
    const j = await r.json() as any
    if (!j.access_token) return null
    tokenCache.set(cfg.orgId, { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 })
    return j.access_token
  } catch { return null }
}

export function invalidateGoogleToken(orgId: string) {
  tokenCache.delete(orgId)
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
