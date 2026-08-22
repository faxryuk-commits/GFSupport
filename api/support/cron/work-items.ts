import { getSQL, json } from '../lib/db.js'
import { assertCron, cronSecured } from '../lib/cron-auth.js'
import { ensureWorkSchema, workTick } from '../lib/work-items.js'

export const config = { runtime: 'edge' }

/**
 * Проход учёта работы — раз в 10 минут.
 *
 * Рождает задачи из свежих кейсов, назначает владельцев по поведению в
 * каналах, ловит сигналы завершения, переоткрывает то, к чему клиент
 * вернулся, и списывает неотвеченное. Вопросы людям задаёт не он —
 * этим занимается вечерний work-digest.
 */
const ORG = process.env.SALES_ORG || 'org_delever'

export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

  const sql = getSQL()
  const started = Date.now()
  try {
    await ensureWorkSchema(sql)
    const out = await workTick(sql, ORG)
    return json({ ok: true, secured: cronSecured(), ms: Date.now() - started, ...out })
  } catch (e: any) {
    console.error('[work-items] tick failed:', e)
    return json({ ok: false, error: e?.message || 'failed' }, 200)
  }
}
