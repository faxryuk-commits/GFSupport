import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { ensureBroadcastSchema } from '../lib/broadcast-schema.js'
import { runBroadcastWorker } from '../lib/broadcast-runner.js'

export const config = {
  runtime: 'edge',
  maxDuration: 30,
}

/**
 * Ручной запуск worker'а для конкретной кампании.
 *
 *   POST /broadcast/kick  { id: "<broadcastId>" }
 *
 * Используется UI-кнопкой «Запустить сейчас» для случаев, когда кампания
 * зависла в queued (например, cron не работает или CRON_SECRET не настроен).
 *
 * В отличие от /broadcast/worker (cron-only), этот endpoint авторизуется
 * по обычному agent_-bearer и фильтруется по org_id.
 */

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() })
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  await ensureBroadcastSchema()
  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  let body: any = {}
  try { body = await req.json() } catch {}
  const broadcastId = body.id ? String(body.id) : null

  try {
    if (broadcastId) {
      const [campaign] = await sql`
        SELECT id, status FROM support_broadcast_scheduled
        WHERE id = ${broadcastId} AND org_id = ${orgId}
        LIMIT 1
      `
      if (!campaign) return json({ error: 'not_found' }, 404)

      // Если кампания была cancelled/completed — пропускаем.
      if ((campaign as any).status === 'cancelled') {
        return json({ success: false, error: 'campaign_cancelled' }, 400)
      }
    }

    const stats = await runBroadcastWorker({
      orgId,
      targetBroadcastId: broadcastId,
      budgetMs: 25_000,
    })

    return json({ success: true, stats })
  } catch (e: any) {
    console.error('[broadcast/kick] error:', e)
    return json({ success: false, error: e?.message || 'kick error' }, 500)
  }
}
