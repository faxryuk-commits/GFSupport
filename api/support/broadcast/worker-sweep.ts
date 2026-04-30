import { getSQL, json, corsHeaders } from '../lib/db.js'
import { ensureBroadcastSchema } from '../lib/broadcast-schema.js'

export const config = {
  runtime: 'edge',
  regions: ['iad1'],
  maxDuration: 30,
}

/**
 * Вспомогательный cron — раз в 5 минут.
 *
 * Спасает «зависшие» строки, которые worker не успел обновить (например,
 * если функция была убита Vercel'ом за timeout):
 *   - 'sending' дольше 3 минут → возвращаем в 'queued' (worker возьмёт снова)
 *   - кампания 'running' дольше 1 часа без активности → 'failed' с пояснением
 *   - кампания 'queued' и все её получатели уже обработаны → финализируем
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() })
  }

  const url = new URL(req.url)
  const cronSecret = url.searchParams.get('secret') || ''
  const auth = req.headers.get('Authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const expectedSecret = process.env.CRON_SECRET || ''
  const isCron = !!expectedSecret && (cronSecret === expectedSecret || bearer === expectedSecret)
  const isAgent = !isCron && bearer.startsWith('agent_')
  if (!isCron && !isAgent) {
    return json({ error: 'Unauthorized' }, 401)
  }

  await ensureBroadcastSchema()
  const sql = getSQL()

  try {
    // 1. Спасаем зависшие 'sending' старше 3 минут.
    const requeued = await sql`
      UPDATE support_broadcast_recipients
      SET status = 'queued',
          updated_at = NOW(),
          retry_after_at = NOW() + INTERVAL '5 seconds'
      WHERE status = 'sending'
        AND last_attempt_at IS NOT NULL
        AND last_attempt_at < NOW() - INTERVAL '3 minutes'
      RETURNING id
    `

    // 2. Финализируем кампании, у которых нет активных получателей.
    const stuckRunning = await sql`
      SELECT b.id
      FROM support_broadcast_scheduled b
      WHERE b.status IN ('queued', 'running')
        AND NOT EXISTS (
          SELECT 1 FROM support_broadcast_recipients r
          WHERE r.broadcast_id = b.id AND r.status IN ('queued', 'sending')
        )
    `
    let finalized = 0
    for (const row of stuckRunning as any[]) {
      const counts = await sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped,
          COUNT(*)::int AS total
        FROM support_broadcast_recipients
        WHERE broadcast_id = ${row.id}
      `
      const c = (counts as any[])[0] || {}
      const delivered = Number(c.delivered || 0)
      const failed = Number(c.failed || 0)
      const total = Number(c.total || 0)
      let status = 'completed'
      if (total === 0) status = 'failed'
      else if (delivered === 0 && failed > 0) status = 'failed'
      else if (failed > 0) status = 'partial'

      await sql`
        UPDATE support_broadcast_scheduled
        SET status = ${status},
            completed_at = NOW(),
            sent_at = COALESCE(sent_at, NOW()),
            delivered_count = ${delivered},
            failed_count = ${failed},
            queued_count = 0,
            recipients_count = ${total}
        WHERE id = ${row.id}
      `.catch(() => {})
      finalized += 1
    }

    // 3. Кампания 'running' без касания worker'ом дольше часа — сворачиваем.
    const stalled = await sql`
      UPDATE support_broadcast_scheduled
      SET status = 'failed',
          completed_at = NOW(),
          error_message = 'Worker stalled for over 1 hour'
      WHERE status = 'running'
        AND last_worker_at IS NOT NULL
        AND last_worker_at < NOW() - INTERVAL '1 hour'
      RETURNING id
    `

    return json({
      success: true,
      requeued: (requeued as any[]).length,
      finalized,
      stalled: (stalled as any[]).length,
    })
  } catch (e: any) {
    console.error('[broadcast/worker-sweep] fatal:', e)
    return json({ success: false, error: e?.message || 'sweep error' }, 500)
  }
}
