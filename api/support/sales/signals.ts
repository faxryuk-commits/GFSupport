import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { computeBrandSignals } from '../_lib/brand-signals.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/** Страница «Сигналы»: live-сводка по клиентам. Расчёт — _lib/brand-signals. */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)
  const sql = getSQL()
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const res = await computeBrandSignals(sql)
  if (res.ok === false) return json({ error: res.error }, 200)
  return json({ mapped: res.mapped, declines: res.declines, launches: res.launches })
}
