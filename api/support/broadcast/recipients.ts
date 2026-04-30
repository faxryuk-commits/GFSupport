import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { ensureBroadcastSchema } from '../lib/broadcast-schema.js'

export const config = {
  runtime: 'edge',
}

/**
 * Список получателей кампании с фильтром по статусу.
 * Используется в модалке деталей: «Кому не доставлено и почему».
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

  const status = url.searchParams.get('status') // queued | sending | delivered | failed | skipped | all
  const search = (url.searchParams.get('search') || '').trim()
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 100))
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
  const searchPattern = search ? `%${search.toLowerCase()}%` : null

  try {
    const statusFilter = status && status !== 'all' ? status : null
    const rows = await sql`
      SELECT id, channel_id, channel_name, status, attempts,
             error_code, error_message, last_attempt_at, delivered_at, telegram_message_id
      FROM support_broadcast_recipients
      WHERE broadcast_id = ${id} AND org_id = ${orgId}
        ${statusFilter ? sql`AND status = ${statusFilter}` : sql``}
        ${searchPattern ? sql`AND LOWER(COALESCE(channel_name, channel_id)) LIKE ${searchPattern}` : sql``}
      ORDER BY
        CASE status
          WHEN 'failed' THEN 1
          WHEN 'queued' THEN 2
          WHEN 'sending' THEN 3
          WHEN 'delivered' THEN 4
          ELSE 5
        END,
        updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const [{ total }] = (await sql`
      SELECT COUNT(*)::int AS total
      FROM support_broadcast_recipients
      WHERE broadcast_id = ${id} AND org_id = ${orgId}
        ${statusFilter ? sql`AND status = ${statusFilter}` : sql``}
        ${searchPattern ? sql`AND LOWER(COALESCE(channel_name, channel_id)) LIKE ${searchPattern}` : sql``}
    `) as any[]

    return json({
      success: true,
      total: Number(total || 0),
      items: (rows as any[]).map((r) => ({
        id: r.id,
        channelId: r.channel_id,
        channelName: r.channel_name,
        status: r.status,
        attempts: Number(r.attempts || 0),
        errorCode: r.error_code,
        errorMessage: r.error_message,
        lastAttemptAt: r.last_attempt_at,
        deliveredAt: r.delivered_at,
        telegramMessageId: r.telegram_message_id,
      })),
    })
  } catch (e: any) {
    console.error('[broadcast/recipients] error:', e)
    return json({ success: false, error: e?.message || 'recipients error' }, 500)
  }
}
