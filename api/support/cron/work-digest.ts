import { getSQL, json } from '../lib/db.js'
import { assertCron, cronSecured } from '../lib/cron-auth.js'
import { ensureWorkSchema, workDigest } from '../lib/work-items.js'

export const config = { runtime: 'edge' }

/**
 * Вечерняя сверка — 18:00 по Ташкенту, один раз в день.
 *
 * Шлёт каждому владельцу задач, ожидающих подтверждения, дайджест в личку
 * @gfsupport_robot: до 5 вопросов, каждый закрывается одним нажатием.
 * Это единственная точка, где механика учёта просит человека о чём-то.
 *
 * ?dry=1 — показать, кому и сколько ушло бы, ничего не отправляя.
 */
const ORG = process.env.SALES_ORG || 'org_delever'

export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

  const sql = getSQL()
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  try {
    await ensureWorkSchema(sql)
    const out = await workDigest(sql, ORG, dry)
    return json({ ok: true, secured: cronSecured(), dry, ...out })
  } catch (e: any) {
    console.error('[work-digest] failed:', e)
    return json({ ok: false, error: e?.message || 'failed' }, 200)
  }
}
