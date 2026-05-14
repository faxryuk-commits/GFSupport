/**
 * Ответы клиентов на outreach-кампанию.
 *
 * GET /api/support/broadcast/responses?id=<broadcast_id>[&window_hours=168]
 *
 * Для каждого получателя кампании ищет первое сообщение клиента из того же
 * канала, отправленное ПОСЛЕ нашего delivered_at в окне window_hours
 * (по умолчанию 7 дней). Возвращает enriched recipients с reply-полями.
 *
 * Сводка: total / delivered / responded / response_rate.
 *
 * Используется в OutreachModal (после отправки → «посмотреть ответы»)
 * и в перспективе на странице /broadcast для каждой кампании.
 */

import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { ensureBroadcastSchema } from '../lib/broadcast-schema.js'

export const config = {
  runtime: 'edge',
}

interface ResponseRow {
  channel_id: string
  channel_name: string | null
  status: string
  delivered_at: string | null
  telegram_message_id: string | null
  first_reply_at: string | null
  first_reply_text: string | null
  first_reply_sentiment: string | null
  reply_count: string | number
}

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

  const windowHours = Math.max(1, Math.min(720, parseInt(url.searchParams.get('window_hours') || '168')))

  try {
    // Метаданные кампании (для отображения contexts: messageText, scheduledAt)
    const [campaign] = (await sql`
      SELECT id, message_text, scheduled_at, status, recipients_count, delivered_count
      FROM support_broadcast_scheduled
      WHERE id = ${id} AND org_id = ${orgId}
      LIMIT 1
    `) as Array<{
      id: string
      message_text: string
      scheduled_at: string
      status: string
      recipients_count: number
      delivered_count: number
    }>

    if (!campaign) return json({ error: 'campaign_not_found' }, 404)

    // Recipients enriched первой ответной репликой
    const rows = (await sql`
      SELECT
        br.channel_id,
        br.channel_name,
        br.status,
        br.delivered_at,
        br.telegram_message_id,
        (
          SELECT m.created_at FROM support_messages m
          WHERE m.channel_id = br.channel_id
            AND m.org_id = ${orgId}
            AND m.is_from_client = true
            AND br.delivered_at IS NOT NULL
            AND m.created_at > br.delivered_at
            AND m.created_at <= br.delivered_at + INTERVAL '1 hour' * ${windowHours}
          ORDER BY m.created_at ASC LIMIT 1
        ) AS first_reply_at,
        (
          SELECT m.text_content FROM support_messages m
          WHERE m.channel_id = br.channel_id
            AND m.org_id = ${orgId}
            AND m.is_from_client = true
            AND br.delivered_at IS NOT NULL
            AND m.created_at > br.delivered_at
            AND m.created_at <= br.delivered_at + INTERVAL '1 hour' * ${windowHours}
          ORDER BY m.created_at ASC LIMIT 1
        ) AS first_reply_text,
        (
          SELECT LOWER(m.ai_sentiment) FROM support_messages m
          WHERE m.channel_id = br.channel_id
            AND m.org_id = ${orgId}
            AND m.is_from_client = true
            AND br.delivered_at IS NOT NULL
            AND m.created_at > br.delivered_at
            AND m.created_at <= br.delivered_at + INTERVAL '1 hour' * ${windowHours}
          ORDER BY m.created_at ASC LIMIT 1
        ) AS first_reply_sentiment,
        (
          SELECT COUNT(*) FROM support_messages m
          WHERE m.channel_id = br.channel_id
            AND m.org_id = ${orgId}
            AND m.is_from_client = true
            AND br.delivered_at IS NOT NULL
            AND m.created_at > br.delivered_at
            AND m.created_at <= br.delivered_at + INTERVAL '1 hour' * ${windowHours}
        )::int AS reply_count
      FROM support_broadcast_recipients br
      WHERE br.broadcast_id = ${id} AND br.org_id = ${orgId}
      ORDER BY
        CASE WHEN br.delivered_at IS NOT NULL AND br.status = 'delivered' THEN 0 ELSE 1 END,
        (SELECT MAX(m.created_at) FROM support_messages m
           WHERE m.channel_id = br.channel_id
             AND m.org_id = ${orgId}
             AND m.is_from_client = true
             AND br.delivered_at IS NOT NULL
             AND m.created_at > br.delivered_at) DESC NULLS LAST
    `) as ResponseRow[]

    const delivered = rows.filter((r) => r.status === 'delivered').length
    const responded = rows.filter((r) => r.first_reply_at !== null).length
    const sentimentBreakdown = rows.reduce(
      (acc, r) => {
        const s = r.first_reply_sentiment || 'unknown'
        acc[s] = (acc[s] ?? 0) + (r.first_reply_at ? 1 : 0)
        return acc
      },
      {} as Record<string, number>,
    )

    return json({
      campaign: {
        id: campaign.id,
        messageText: campaign.message_text,
        scheduledAt: campaign.scheduled_at,
        status: campaign.status,
      },
      summary: {
        total: rows.length,
        delivered,
        responded,
        responseRate: delivered > 0 ? Math.round((responded / delivered) * 1000) / 10 : 0,
        sentimentBreakdown: {
          positive: sentimentBreakdown.positive ?? 0,
          neutral: sentimentBreakdown.neutral ?? 0,
          negative: sentimentBreakdown.negative ?? 0,
          frustrated: sentimentBreakdown.frustrated ?? 0,
          unscored: (sentimentBreakdown.unknown ?? 0) + (sentimentBreakdown.null ?? 0),
        },
        windowHours,
      },
      recipients: rows.map((r) => {
        const replyMinutesAfter =
          r.delivered_at && r.first_reply_at
            ? Math.round(
                (new Date(r.first_reply_at).getTime() - new Date(r.delivered_at).getTime()) / 60000,
              )
            : null
        return {
          channelId: r.channel_id,
          channelName: r.channel_name,
          status: r.status,
          deliveredAt: r.delivered_at,
          replied: r.first_reply_at !== null,
          firstReplyAt: r.first_reply_at,
          firstReplyText: r.first_reply_text ? r.first_reply_text.slice(0, 500) : null,
          firstReplySentiment: r.first_reply_sentiment,
          replyCount:
            typeof r.reply_count === 'string' ? parseInt(r.reply_count) : r.reply_count,
          replyMinutesAfter,
        }
      }),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[broadcast/responses]', msg, e instanceof Error ? e.stack : undefined)
    return json({ error: msg, where: 'broadcast/responses' }, 500)
  }
}
