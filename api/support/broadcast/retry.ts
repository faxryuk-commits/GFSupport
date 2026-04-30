import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { ensureBroadcastSchema } from '../lib/broadcast-schema.js'

export const config = {
  runtime: 'edge',
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

    if (requeuedCount > 0) {
      // Поднимаем кампанию обратно в running.
      await sql`
        UPDATE support_broadcast_scheduled
        SET status = 'queued',
            completed_at = NULL,
            error_message = NULL,
            queued_count = queued_count + ${requeuedCount}
        WHERE id = ${broadcastId} AND org_id = ${orgId}
      `

      // Fire-and-forget: дёргаем воркер, чтобы не ждать cron.
      triggerWorker(req, broadcastId).catch(() => {})
    }

    return json({ success: true, requeued: requeuedCount })
  } catch (e: any) {
    console.error('[broadcast/retry] error:', e)
    return json({ success: false, error: e?.message || 'retry error' }, 500)
  }
}

async function triggerWorker(req: Request, broadcastId: string): Promise<void> {
  const url = new URL(req.url)
  const secret = process.env.CRON_SECRET
  if (!secret) return
  const workerUrl = `${url.protocol}//${url.host}/api/support/broadcast/worker?secret=${encodeURIComponent(secret)}&id=${encodeURIComponent(broadcastId)}`
  // Без await — fire-and-forget. AbortController с маленьким таймаутом, чтобы
  // запрос точно ушёл, но мы не блокировались.
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), 1500)
  await fetch(workerUrl, { signal: ctrl.signal }).catch(() => {})
}
