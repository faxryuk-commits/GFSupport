import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const url = new URL(req.url)

  // GET - список сообщений
  if (req.method === 'GET') {
    try {
      const channelId = url.searchParams.get('channelId')
      const senderRole = url.searchParams.get('senderRole') // client, support, team
      const contentType = url.searchParams.get('contentType') // text, voice, video, etc
      const isProblem = url.searchParams.get('isProblem')
      const isRead = url.searchParams.get('isRead')
      const search = url.searchParams.get('search')
      const limit = parseInt(url.searchParams.get('limit') || '50')
      const offset = parseInt(url.searchParams.get('offset') || '0')

      const messages = await sql`
        SELECT 
          m.*,
          ch.name as channel_name,
          ch.telegram_chat_id
        FROM support_messages m
        LEFT JOIN support_channels ch ON m.channel_id = ch.id
        WHERE 1=1
          ${channelId ? sql`AND m.channel_id = ${channelId}` : sql``}
          ${senderRole ? sql`AND m.sender_role = ${senderRole}` : sql``}
          ${contentType ? sql`AND m.content_type = ${contentType}` : sql``}
          ${isProblem === 'true' ? sql`AND m.is_problem = true` : sql``}
          ${isRead === 'true' ? sql`AND m.is_read = true` : sql``}
          ${isRead === 'false' ? sql`AND m.is_read = false` : sql``}
          ${search ? sql`AND (m.text_content ILIKE ${'%' + search + '%'} OR m.transcript ILIKE ${'%' + search + '%'} OR m.ai_summary ILIKE ${'%' + search + '%'})` : sql``}
        ORDER BY m.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `

      const countResult = await sql`
        SELECT COUNT(*) as total FROM support_messages m
        WHERE 1=1
          ${channelId ? sql`AND m.channel_id = ${channelId}` : sql``}
          ${senderRole ? sql`AND m.sender_role = ${senderRole}` : sql``}
          ${contentType ? sql`AND m.content_type = ${contentType}` : sql``}
          ${isProblem === 'true' ? sql`AND m.is_problem = true` : sql``}
          ${isRead === 'true' ? sql`AND m.is_read = true` : sql``}
          ${isRead === 'false' ? sql`AND m.is_read = false` : sql``}
          ${search ? sql`AND (m.text_content ILIKE ${'%' + search + '%'} OR m.transcript ILIKE ${'%' + search + '%'} OR m.ai_summary ILIKE ${'%' + search + '%'})` : sql``}
      `

      const total = parseInt(countResult[0]?.total || '0')

      // Stats
      const statsResult = await sql`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE is_read = false) as unread,
          COUNT(*) FILTER (WHERE is_problem = true) as problems,
          COUNT(*) FILTER (WHERE sender_role = 'client') as from_clients,
          COUNT(*) FILTER (WHERE content_type = 'voice') as voice,
          COUNT(*) FILTER (WHERE content_type IN ('video', 'video_note')) as video
        FROM support_messages
      `
      const stats = statsResult[0] || {}

      return json({
        messages: messages.map((m: any) => ({
          id: m.id,
          channelId: m.channel_id,
          channelName: m.channel_name,
          caseId: m.case_id,
          telegramMessageId: m.telegram_message_id,
          senderId: m.sender_id,
          senderName: m.sender_name || 'Пользователь',
          senderUsername: m.sender_username,
          senderRole: m.is_from_client ? 'client' : (m.sender_role || 'support'),
          isFromClient: m.is_from_client,
          isFromTeam: !m.is_from_client,
          contentType: m.content_type,
          text: m.text_content || m.transcript || '', // Маппинг для фронтенда
          textContent: m.text_content,
          mediaUrl: m.media_url,
          mediaType: m.content_type !== 'text' ? m.content_type : undefined,
          transcript: m.transcript,
          aiSummary: m.ai_summary,
          aiCategory: m.ai_category,
          aiSentiment: m.ai_sentiment,
          aiIntent: m.ai_intent,
          aiUrgency: m.ai_urgency,
          aiEntities: m.ai_extracted_entities,
          isProblem: m.is_problem,
          isRead: m.is_read,
          readAt: m.read_at,
          replyToMessageId: m.reply_to_message_id,
          threadId: m.thread_id,
          threadName: m.thread_name,
          topicId: m.thread_id,
          topicName: m.thread_name,
          reactions: m.reactions || {},
          createdAt: m.created_at,
        })),
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
        stats: {
          total: parseInt(stats.total || 0),
          unread: parseInt(stats.unread || 0),
          problems: parseInt(stats.problems || 0),
          fromClients: parseInt(stats.from_clients || 0),
          voice: parseInt(stats.voice || 0),
          video: parseInt(stats.video || 0),
        }
      })

    } catch (e: any) {
      return json({ error: 'Failed to fetch messages', details: e.message }, 500)
    }
  }

  // PATCH - mark as read
  if (req.method === 'PATCH') {
    try {
      const body = await req.json()
      const { messageIds, channelId, markAsRead } = body

      if (messageIds && messageIds.length > 0) {
        // Mark specific messages
        await sql`
          UPDATE support_messages SET 
            is_read = ${markAsRead !== false},
            read_at = ${markAsRead !== false ? new Date().toISOString() : null}
          WHERE id = ANY(${messageIds})
        `
      } else if (channelId) {
        // Mark all messages in channel
        await sql`
          UPDATE support_messages SET 
            is_read = true,
            read_at = NOW()
          WHERE channel_id = ${channelId} AND is_read = false
        `
        // Reset unread count
        await sql`
          UPDATE support_channels SET unread_count = 0 WHERE id = ${channelId}
        `
      }

      return json({ success: true })

    } catch (e: any) {
      return json({ error: 'Failed to update messages', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
