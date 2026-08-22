import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { fetchJournal } from '../lib/system-journal.js'

export const config = { runtime: 'edge' }

/**
 * Хроника системы: что, как и когда делали автоматы и ИИ.
 * GET ?actor=&limit= — единая лента из событий и следов в таблицах.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const limit = Math.min(300, Math.max(20, parseInt(url.searchParams.get('limit') || '120', 10)))
  const actor = url.searchParams.get('actor') || ''

  let events = await fetchJournal(sql, orgId, limit)
  if (actor) events = (events as any[]).filter(e => e.actor === actor)

  const actors = [...new Set((events as any[]).map(e => e.actor))].sort()
  return json({ events, actors })
}
