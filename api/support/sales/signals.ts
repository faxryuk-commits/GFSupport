import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { computeAndStoreBrandSignals, readBrandSignalSnapshot } from '../_lib/brand-signals.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Страница «Сигналы»: по умолчанию отдаёт мгновенный снапшот (его освежает
 * утренний крон), ?fresh=1 — живой пересчёт по ClickHouse с сохранением.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)
  const sql = getSQL()
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const fresh = new URL(req.url).searchParams.get('fresh') === '1'
  if (!fresh) {
    const snap = await readBrandSignalSnapshot(sql)
    if (snap) return json(snap)
  }
  const res = await computeAndStoreBrandSignals(sql)
  if (res.ok === false) return json({ error: res.error }, 200)
  return json({ computedAt: res.computedAt, mapped: res.mapped, declines: res.declines, launches: res.launches })
}
