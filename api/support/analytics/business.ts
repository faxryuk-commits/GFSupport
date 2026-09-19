import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { CREATOR_OWNER_ID } from '../_lib/creator.js'
import { computeBusinessDash, readBusinessDashSnapshot } from '../_lib/business-dash.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Бизнес-дашборд по ClickHouse Delever — только владельцу. По умолчанию
 * отдаёт снапшот утреннего крона, ?fresh=1 — живой пересчёт с сохранением.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)
  const sql = getSQL()
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  if (ctx.agentId !== CREATOR_OWNER_ID) return json({ error: 'forbidden' }, 403)

  const fresh = new URL(req.url).searchParams.get('fresh') === '1'
  if (!fresh) {
    const snap = await readBusinessDashSnapshot(sql)
    if (snap) return json(snap)
  }
  try {
    const res = await computeBusinessDash(sql)
    if (res.ok === false) return json({ error: res.error }, 200)
    return json(res)
  } catch (e: any) {
    // Необработанное исключение на edge превращается в голую пятисотку
    // без текста — отдаём причину сами
    return json({ error: `пересчёт упал: ${e?.message || String(e)}` }, 200)
  }
}
