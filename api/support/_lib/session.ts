import { ensureOnce } from './db.js'

/**
 * Сессии входа.
 *
 * Раньше токеном доступа был сам идентификатор сотрудника: `agent_…`.
 * Эти идентификаторы система отдаёт в обычных ответах — владелец лида,
 * ответственный, список команды, — то есть любой сотрудник мог взять
 * идентификатор руководителя из ответа сервера и работать под ним.
 *
 * Теперь токен — случайные 32 байта, в базе лежит только их отпечаток
 * (SHA-256). Украсть токен из ответа API нельзя: его там нет. У сессии есть
 * срок, её видно в журнале и её можно отозвать выходом из системы.
 */

export const TOKEN_PREFIX = 'gfs_'

/** Сколько живёт сессия без активности. Продлевается на каждом запросе. */
const TTL_DAYS = 30

const b64url = (bytes: Uint8Array): string => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Отпечаток токена: в базе храним его, а не сам токен. */
export async function tokenHash(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return b64url(new Uint8Array(digest))
}

export async function ensureSessions(sql: any): Promise<void> {
  await ensureOnce('support_sessions', async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS support_sessions (
        token_hash varchar(64) PRIMARY KEY,
        agent_id varchar(64) NOT NULL,
        org_id varchar(64),
        created_at timestamptz DEFAULT NOW(),
        last_used_at timestamptz DEFAULT NOW(),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        ip varchar(64),
        user_agent text
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS support_sessions_agent ON support_sessions (agent_id)`
  })
}

/** Выдать сессию при входе. Возвращает сам токен — он больше нигде не всплывёт. */
export async function issueSession(
  sql: any, agentId: string, orgId: string | null, req?: Request,
): Promise<string> {
  await ensureSessions(sql)
  const raw = new Uint8Array(32)
  crypto.getRandomValues(raw)
  const token = TOKEN_PREFIX + b64url(raw)
  const hash = await tokenHash(token)
  const ip = req?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const ua = req?.headers.get('user-agent')?.slice(0, 300) || null
  await sql`
    INSERT INTO support_sessions (token_hash, agent_id, org_id, expires_at, ip, user_agent)
    VALUES (${hash}, ${agentId}, ${orgId}, NOW() + make_interval(days => ${TTL_DAYS}), ${ip}, ${ua})
  `
  return token
}

/**
 * Кто стоит за токеном. Один поход в базу: продление срока, отметка
 * активности и данные сотрудника берутся одним запросом — дорога до базы
 * стоит около 190 мс, и второй заход был бы виден человеку.
 */
export async function resolveSession(sql: any, token: string): Promise<{
  id: string; role: string | null; permissions: any; org_id: string | null
} | null> {
  const hash = await tokenHash(token)
  const rows = await sql`
    WITH t AS (
      UPDATE support_sessions
      SET last_used_at = NOW(), expires_at = NOW() + make_interval(days => ${TTL_DAYS})
      WHERE token_hash = ${hash} AND revoked_at IS NULL AND expires_at > NOW()
      RETURNING agent_id
    )
    SELECT a.id, a.role, a.permissions, a.org_id
    FROM t JOIN support_agents a ON a.id = t.agent_id
    LIMIT 1
  `.catch(() => [] as any[]) as any[]
  return rows[0] || null
}

/** Выход из системы: сессия гасится, украденный токен становится бесполезным. */
export async function revokeSession(sql: any, token: string): Promise<void> {
  const hash = await tokenHash(token)
  await sql`UPDATE support_sessions SET revoked_at = NOW() WHERE token_hash = ${hash}`.catch(() => {})
}

/** Погасить все сессии сотрудника — на случай увольнения или утечки. */
export async function revokeAllForAgent(sql: any, agentId: string): Promise<void> {
  await sql`
    UPDATE support_sessions SET revoked_at = NOW()
    WHERE agent_id = ${agentId} AND revoked_at IS NULL
  `.catch(() => {})
}
