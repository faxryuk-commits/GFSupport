import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { issueSession, revokeSession, TOKEN_PREFIX } from '../_lib/session.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Сессии входа: обмен старого токена на новый и выход из системы.
 *
 * POST { action: 'upgrade' }  старый токен (идентификатор сотрудника)
 *                             меняется на сессию — переезд без выхода
 * POST { action: 'logout' }   сессия гасится: украденный токен становится
 *                             бесполезным, раньше выход просто чистил
 *                             хранилище браузера
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => ({})) as any
  const action = String(body.action || 'upgrade')
  const raw = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()

  if (action === 'logout') {
    if (raw.startsWith(TOKEN_PREFIX)) await revokeSession(sql, raw)
    await sql`UPDATE support_agents SET status = 'offline' WHERE id = ${ctx.agentId}`.catch(() => {})
    return json({ ok: true })
  }

  if (action === 'upgrade') {
    // Уже на сессии — второй раз выдавать незачем
    if (raw.startsWith(TOKEN_PREFIX)) return json({ token: null, already: true })
    const token = await issueSession(sql, ctx.agentId, ctx.orgId, req)
    return json({ token })
  }

  return json({ error: 'unknown action' }, 400)
}
