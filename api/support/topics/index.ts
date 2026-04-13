import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const channelId = url.searchParams.get('channelId')
    
    if (!channelId) {
      return json({ error: 'channelId is required' }, 400)
    }

    try {
      // Get topics for channel
      const topics = await sql`
        SELECT 
          t.*,
          (SELECT COUNT(*) FROM support_messages WHERE channel_id = t.channel_id AND thread_id = t.thread_id AND is_read = false AND org_id = ${orgId}) as unread_count,
          (SELECT COUNT(*) FROM support_messages WHERE channel_id = t.channel_id AND thread_id = t.thread_id AND is_from_client = true AND org_id = ${orgId} AND created_at > COALESCE(
            (SELECT MAX(created_at) FROM support_messages WHERE channel_id = t.channel_id AND thread_id = t.thread_id AND is_from_client = false AND org_id = ${orgId}),
            '1970-01-01'
          )) as awaiting_reply_count
        FROM support_topics t
        WHERE t.channel_id = ${channelId} AND t.org_id = ${orgId}
        ORDER BY t.last_message_at DESC NULLS LAST
      `

      // Get recent messages for each topic
      const topicsWithMessages = await Promise.all(topics.map(async (topic: any) => {
        const recentMessages = await sql`
          SELECT id, sender_name, sender_role, text_content, content_type, created_at, is_from_client
          FROM support_messages
          WHERE channel_id = ${channelId} AND thread_id = ${topic.thread_id} AND org_id = ${orgId}
          ORDER BY created_at DESC
          LIMIT 5
        `

        return {
          id: topic.id,
          threadId: topic.thread_id,
          name: topic.name || `Topic ${topic.thread_id}`,
          iconColor: topic.icon_color,
          isClosed: topic.is_closed,
          messagesCount: topic.messages_count,
          unreadCount: parseInt(topic.unread_count || 0),
          awaitingReply: parseInt(topic.awaiting_reply_count || 0) > 0,
          lastMessageAt: topic.last_message_at,
          lastSenderName: topic.last_sender_name,
          createdAt: topic.created_at,
          recentMessages: recentMessages.map((m: any) => ({
            id: m.id,
            senderName: m.sender_name,
            senderRole: m.sender_role,
            text: m.text_content?.slice(0, 100),
            contentType: m.content_type,
            isFromClient: m.is_from_client,
            createdAt: m.created_at,
          })),
        }
      }))

      return json({
        topics: topicsWithMessages,
        total: topics.length,
      })

    } catch (e: any) {
      return json({ error: 'Failed to fetch topics' }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
