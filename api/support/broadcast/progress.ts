import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { ensureBroadcastSchema } from '../lib/broadcast-schema.js'

export const config = {
  runtime: 'edge',
}

/**
 * Live-progress по кампании. Фронт poll'ит каждые 2 секунды пока статус
 * 'queued' или 'running'. Один SQL агрегирует получателей по статусам,
 * второй — собирает топ ошибок.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() })
  }
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)

  await ensureBroadcastSchema()
  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return json({ error: 'id_required' }, 400)

  try {
    const [campaign] = await sql`
      SELECT id, status, recipients_count, delivered_count, failed_count, queued_count,
             started_at, completed_at, last_worker_at, scheduled_at, error_message
      FROM support_broadcast_scheduled
      WHERE id = ${id} AND org_id = ${orgId}
      LIMIT 1
    `
    if (!campaign) return json({ error: 'not_found' }, 404)

    const statusRows = await sql`
      SELECT status, COUNT(*)::int AS n
      FROM support_broadcast_recipients
      WHERE broadcast_id = ${id} AND org_id = ${orgId}
      GROUP BY status
    `
    const totals: Record<string, number> = {
      queued: 0, sending: 0, delivered: 0, failed: 0, skipped: 0,
    }
    for (const r of statusRows as any[]) totals[r.status] = Number(r.n)
    totals.total = (Object.values(totals) as number[]).reduce((s, n) => s + n, 0)

    const errorRows = await sql`
      SELECT error_code, COUNT(*)::int AS n
      FROM support_broadcast_recipients
      WHERE broadcast_id = ${id} AND org_id = ${orgId}
        AND status = 'failed' AND error_code IS NOT NULL
      GROUP BY error_code
      ORDER BY n DESC
      LIMIT 10
    `

    return json({
      success: true,
      broadcast: {
        id: (campaign as any).id,
        status: (campaign as any).status,
        recipientsCount: Number((campaign as any).recipients_count || 0),
        deliveredCount: Number((campaign as any).delivered_count || 0),
        failedCount: Number((campaign as any).failed_count || 0),
        queuedCount: Number((campaign as any).queued_count || 0),
        startedAt: (campaign as any).started_at,
        completedAt: (campaign as any).completed_at,
        lastWorkerAt: (campaign as any).last_worker_at,
        scheduledAt: (campaign as any).scheduled_at,
        errorMessage: (campaign as any).error_message,
      },
      totals,
      errors: (errorRows as any[]).map((r) => ({
        code: r.error_code as string,
        count: Number(r.n),
      })),
    })
  } catch (e: any) {
    console.error('[broadcast/progress] error:', e)
    return json({ success: false, error: e?.message || 'progress error' }, 500)
  }
}
