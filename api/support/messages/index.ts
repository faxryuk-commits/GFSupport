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
  // mode=hot: операционный режим (7 дней, только активные каналы, 50 msg/канал)
  // mode=detail: детальный просмотр (90 дней, 200 msg)
  // mode=all: все сообщения (30 дней, стандартный режим)
  if (req.method === 'GET') {
    try {
      const channelId = url.searchParams.get('channelId')
      const mode = url.searchParams.get('mode') || 'all'
      const limit = parseInt(url.searchParams.get('limit') || (mode === 'hot' ? '50' : '100'))
      const offset = parseInt(url.searchParams.get('offset') || '0')

      // Настройки режимов
      const modeConfig: Record<string, { period: string; maxChannels: number; priorityOnly: boolean }> = {
        hot: { period: '7 days', maxChannels: 200, priorityOnly: true },
        detail: { period: '90 days', maxChannels: 1000, priorityOnly: false },
        all: { period: '30 days', maxChannels: 500, priorityOnly: false },
      }
      const config = modeConfig[mode] || modeConfig.all

      console.log('[Messages API] mode:', mode, 'channelId:', channelId, 'limit:', limit, 'period:', config.period)

      let messages: any[]
      let countResult: any[]

      if (channelId) {
        // Детальный просмотр одного канала
        const periodInterval = mode === 'detail' ? '90 days' : '30 days'
        messages = await sql`
          SELECT 
            m.*,
            ch.name as channel_name,
            ch.telegram_chat_id
          FROM support_messages m
          LEFT JOIN support_channels ch ON m.channel_id = ch.id
          WHERE m.channel_id = ${channelId}
            AND m.created_at > NOW() - INTERVAL '90 days'
          ORDER BY m.created_at ASC
          LIMIT ${limit} OFFSET ${offset}
        `
        
        countResult = await sql`
          SELECT COUNT(*) as total FROM support_messages
          WHERE channel_id = ${channelId}
            AND created_at > NOW() - INTERVAL '90 days'
        `
      } else if (mode === 'hot') {
        // Hot mode: только активные каналы (awaiting_reply или unread)
        // Сначала получаем приоритетные каналы
        const priorityChannels = await sql`
          SELECT id FROM support_channels 
          WHERE is_active = true 
            AND (awaiting_reply = true OR unread_count > 0)
          ORDER BY last_message_at DESC NULLS LAST
          LIMIT ${config.maxChannels}
        `
        const channelIds = priorityChannels.map((c: any) => c.id)
        
        if (channelIds.length > 0) {
          messages = await sql`
            SELECT 
              m.*,
              ch.name as channel_name,
              ch.telegram_chat_id,
              ch.awaiting_reply,
              ch.unread_count
            FROM support_messages m
            LEFT JOIN support_channels ch ON m.channel_id = ch.id
            WHERE m.channel_id = ANY(${channelIds})
              AND m.created_at > NOW() - INTERVAL '7 days'
            ORDER BY m.created_at DESC
            LIMIT ${limit * Math.min(channelIds.length, 50)}
          `
        } else {
          messages = []
        }
        
        countResult = [{ total: messages.length }]
      } else {
        // Standard mode
        messages = await sql`
          SELECT 
            m.*,
            ch.name as channel_name,
            ch.telegram_chat_id
          FROM support_messages m
          LEFT JOIN support_channels ch ON m.channel_id = ch.id
          WHERE m.created_at > NOW() - INTERVAL '30 days'
          ORDER BY m.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
        
        countResult = await sql`
          SELECT COUNT(*) as total FROM support_messages
          WHERE created_at > NOW() - INTERVAL '30 days'
        `
      }

      console.log('[Messages API] Found', messages.length, 'messages')

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
          senderName: m.sender_name || 'Клиент',
          senderUsername: m.sender_username,
          // Используем proxy URL для фото пользователей
          senderPhotoUrl: m.sender_id ? `/api/support/media/user-photo?userId=${m.sender_id}` : null,
          senderRole: m.sender_role || 'client',
          isFromClient: m.is_from_client ?? (m.sender_role === 'client'),
          isFromTeam: m.sender_role === 'support' || m.sender_role === 'team',
          contentType: m.content_type || 'text',
          text: m.text_content || '',
          textContent: m.text_content,
          mediaUrl: m.media_url,
          mediaType: m.content_type !== 'text' ? m.content_type : undefined,
          thumbnailUrl: m.thumbnail_url,
          fileName: m.file_name,
          fileSize: m.file_size ? parseInt(m.file_size) : undefined,
          mimeType: m.mime_type,
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
          replyToText: m.reply_to_text,
          replyToSender: m.reply_to_sender,
          threadId: m.thread_id,
          topicId: m.thread_id,
          threadName: m.thread_name,
          topicName: m.thread_name,
          reactions: m.reactions || {},
          createdAt: m.created_at,
          timestamp: m.created_at,
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
      console.error('[Messages API] Error:', e.message, e.stack)
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
      console.error('[Messages API] PATCH Error:', e.message)
      return json({ error: 'Failed to update messages', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
