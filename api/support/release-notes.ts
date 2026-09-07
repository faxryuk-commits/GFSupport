import { getSQL, json, corsHeaders } from './_lib/db.js'
import { extractAgentContext } from './_lib/auth.js'
import { RELEASES } from './_lib/release-notes.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/** Что нового: список выпусков для страницы и для точки в меню. */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)
  getSQL()
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  return json({ releases: RELEASES, latest: RELEASES[0]?.version || null })
}
