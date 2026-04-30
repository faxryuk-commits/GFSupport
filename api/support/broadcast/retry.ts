import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { ensureBroadcastSchema } from '../lib/broadcast-schema.js'
import { runBroadcastWorker } from '../lib/broadcast-runner.js'

export const config = {
  runtime: 'edge',
  maxDuration: 30,
}

/**
 * Повторная отправка failed-получателей в кампании.
 *
 *   POST /broadcast/retry  { id: "<broadcastId>", scope?: "failed" | "all_failed_codes" }
 *
 * Поднимает failed-строки обратно в queued, обнуляет error_code/retry_after_at,
 * НЕ обнуляет attempts (зацикливание ограничивается MAX_ATTEMPTS в worker'e).
 * После — fire-and-forget вызов воркера.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() })
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  await ensureBroadcastSchema()
  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  let body: { id?: string; scope?: string } = {}
  try { body = await req.json() } catch {}
  if (!body.id) return json({ error: 'id_required' }, 400)
  const broadcastId = body.id
  const scope = body.scope || 'failed'

  try {
    const [campaign] = await sql`
      SELECT id, status FROM support_broadcast_scheduled
      WHERE id = ${broadcastId} AND org_id = ${orgId}
      LIMIT 1
    `
    if (!campaign) return json({ error: 'not_found' }, 404)

    // Поднимаем failed-получателей обратно в очередь.
    // attempts оставляем как есть — worker остановит ретраи на MAX_ATTEMPTS.
    const requeued = scope === 'all'
      ? await sql`
          UPDATE support_broadcast_recipients
          SET status = 'queued',
              error_code = NULL,
              error_message = NULL,
              retry_after_at = NULL,
              updated_at = NOW()
          WHERE broadcast_id = ${broadcastId} AND org_id = ${orgId}
            AND status IN ('failed', 'skipped')
          RETURNING id
        `
      : await sql`
          UPDATE support_broadcast_recipients
          SET status = 'queued',
              error_code = NULL,
              error_message = NULL,
              retry_after_at = NULL,
              updated_at = NOW()
          WHERE broadcast_id = ${broadcastId} AND org_id = ${orgId}
            AND status = 'failed'
            AND attempts < 5
          RETURNING id
        `

    const requeuedCount = (requeued as any[]).length

    let inlineStats: any = null
    if (requeuedCount > 0) {
      await sql`
        UPDATE support_broadcast_scheduled
        SET status = 'queued',
            completed_at = NULL,
            error_message = NULL,
            queued_count = queued_count + ${requeuedCount}
        WHERE id = ${broadcastId} AND org_id = ${orgId}
      `

      // Inline-запуск worker'а: для маленьких retry-запросов всё уйдёт сразу.
      try {
        inlineStats = await runBroadcastWorker({
          orgId,
          targetBroadcastId: broadcastId,
          budgetMs: 20_000,
        })
      } catch (e) {
        console.warn('[broadcast/retry] inline worker error:', e)
      }
    }

    return json({ success: true, requeued: requeuedCount, inlineStats })
  } catch (e: any) {
    console.error('[broadcast/retry] error:', e)
    return json({ success: false, error: e?.message || 'retry error' }, 500)
  }
}
