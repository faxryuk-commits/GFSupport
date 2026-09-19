import { getSQL, json } from '../_lib/db.js'
import { assertCron } from '../_lib/cron-auth.js'
import { computeBusinessDash } from '../_lib/business-dash.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Ночной пересчёт бизнес-дашборда (после сигналов): страница /business
 * утром открывается мгновенно со свежим снапшотом.
 */
export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied
  const sql = getSQL()
  const res = await computeBusinessDash(sql)
  if (res.ok === false) return json({ ok: false, error: res.error }, 200)
  return json({ ok: true, weeks: res.weekly.length, growers: res.growers.length, fallers: res.fallers.length })
}
