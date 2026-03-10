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
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

// Convert media URL to proxied URL to avoid CORS/expiry issues
function toProxyUrl(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null

  if (mediaUrl.startsWith('tg://')) {
    return `/api/support/media/proxy?tg=${encodeURIComponent(mediaUrl)}`
  }

  if (mediaUrl.includes('api.telegram.org/file/bot')) {
    return `/api/support/media/proxy?url=${encodeURIComponent(mediaUrl)}`
  }

  // Vercel Blob and other HTTPS URLs — pass through
  if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
    return mediaUrl
  }

  return mediaUrl
}

/**
 * GET /api/support/messages/channel?channelId=xxx&offset=0&limit=100
 * 
 * Детальный просмотр сообщений канала с пагинацией
 * - Период: 90 дней
 * - Лимит по умолчанию: 100 сообщений
 * - Поддержка lazy loading через offset
 * - Поддержка `since` для polling новых сообщений (ISO timestamp)
 * - Поддержка `mode=latest` для получения последних сообщений (для первой загрузки)
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const url = new URL(req.url)
  const channelId = url.searchParams.get('channelId')
  
  if (!channelId) {
    return json({ error: 'channelId is required' }, 400)
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 200)
  const since = url.searchParams.get('since') // ISO timestamp для polling новых сообщений
  const before = url.searchParams.get('before') // ISO timestamp для загрузки старых сообщений
  
  const sql = getSQL()

  try {
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS forwarded_from TEXT` } catch {}

    const channelResult = await sql`
      SELECT 
        id, name, type, is_forum, awaiting_reply, unread_count,
        last_message_at, last_sender_name, last_message_preview,
        photo_url
      FROM support_channels
      WHERE id = ${channelId}
    `
    
    const channel = channelResult[0]
    if (!channel) {
      return json({ error: 'Channel not found' }, 404)
    }

    let messages: any[]
    let mode = 'latest' // Для логирования

    // Режим polling: получить только НОВЫЕ сообщения после since
    if (since) {
      mode = 'polling'
      console.log(`[Channel Messages] POLLING mode, since=${since}`)
      messages = await sql`
        SELECT
          id, telegram_message_id, sender_id, sender_name, sender_username,
          sender_photo_url, sender_role, text_content, content_type, media_url,
          thumbnail_url, file_name, file_size, mime_type,
          transcript, ai_category, ai_urgency, ai_summary, ai_sentiment, ai_intent,
          is_read, is_problem, reactions, reply_to_message_id, reply_to_text, reply_to_sender,
          thread_id, thread_name, case_id, forwarded_from, created_at
        FROM support_messages
        WHERE channel_id = ${channelId}
          AND created_at > ${since}::timestamptz
        ORDER BY created_at ASC
        LIMIT 100
      `
    }
    // Загрузка СТАРЫХ сообщений (перед before timestamp) - для подгрузки истории
    else if (before) {
      mode = 'history'
      console.log(`[Channel Messages] HISTORY mode, before=${before}`)
      const olderMessages = await sql`
        SELECT
          id, telegram_message_id, sender_id, sender_name, sender_username,
          sender_photo_url, sender_role, text_content, content_type, media_url,
          thumbnail_url, file_name, file_size, mime_type,
          transcript, ai_category, ai_urgency, ai_summary, ai_sentiment, ai_intent,
          is_read, is_problem, reactions, reply_to_message_id, reply_to_text, reply_to_sender,
          thread_id, thread_name, case_id, forwarded_from, created_at
        FROM support_messages
        WHERE channel_id = ${channelId}
          AND created_at < ${before}::timestamptz
          AND created_at > NOW() - INTERVAL '90 days'
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
      // Разворачиваем чтобы старые были сначала
      messages = olderMessages.reverse()
    }
    // Первая загрузка: последние N сообщений
    else {
      mode = 'latest'
      console.log(`[Channel Messages] LATEST mode, limit=${limit}`)
      const latestMessages = await sql`
        SELECT
          id, telegram_message_id, sender_id, sender_name, sender_username,
          sender_photo_url, sender_role, text_content, content_type, media_url,
          thumbnail_url, file_name, file_size, mime_type,
          transcript, ai_category, ai_urgency, ai_summary, ai_sentiment, ai_intent,
          is_read, is_problem, reactions, reply_to_message_id, reply_to_text, reply_to_sender,
          thread_id, thread_name, case_id, forwarded_from, created_at
        FROM support_messages
        WHERE channel_id = ${channelId}
          AND created_at > NOW() - INTERVAL '90 days'
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
      // Разворачиваем чтобы старые были сначала (для отображения в чате)
      messages = latestMessages.reverse()
    }
    
    // Логируем результат
    if (messages.length > 0) {
      const first = messages[0]
      const last = messages[messages.length - 1]
      console.log(`[Channel Messages] ${mode}: found ${messages.length} msgs, first=${first.created_at}, last=${last.created_at}`)
    } else {
      console.log(`[Channel Messages] ${mode}: no messages found`)
    }

    // Get total count for pagination
    const countResult = await sql`
      SELECT COUNT(*) as total FROM support_messages
      WHERE channel_id = ${channelId}
        AND created_at > NOW() - INTERVAL '90 days'
    `
    const total = parseInt(countResult[0]?.total || '0')

    // Resolve reply quotes from loaded messages
    const messagesByTgId: Record<string, any> = {}
    for (const msg of messages) {
      if (msg.telegram_message_id) {
        messagesByTgId[msg.telegram_message_id] = msg
      }
    }

    // Convert media/thumbnail URLs to proxy URLs (synchronous, no API calls needed)
    const convertedMediaUrls = messages.map((m: any) => toProxyUrl(m.media_url))
    const convertedThumbUrls = messages.map((m: any) => toProxyUrl(m.thumbnail_url))

    const formattedMessages = messages.map((m: any, index: number) => {
      // Fill in missing reply text
      let replyToText = m.reply_to_text
      let replyToSender = m.reply_to_sender
      if (m.reply_to_message_id && !replyToText) {
        const replyMsg = messagesByTgId[m.reply_to_message_id]
        if (replyMsg) {
          replyToText = replyMsg.text_content || replyMsg.transcript || '[медиа]'
          replyToSender = replyMsg.sender_name
        }
      }

      return {
        id: m.id,
        telegramMessageId: m.telegram_message_id,
        senderId: m.sender_id,
        senderName: m.sender_name || 'Клиент',
        senderUsername: m.sender_username,
        // Use proxy URL for avatars to avoid expired Telegram URLs
        senderPhotoUrl: m.sender_id ? `/api/support/media/user-photo?userId=${m.sender_id}` : null,
        senderRole: m.sender_role || 'client',
        text: m.text_content || '',
        contentType: m.content_type || 'text',
        // mediaType для UI компонентов (аудио, видео, фото и т.д.)
        mediaType: m.content_type && m.content_type !== 'text' ? m.content_type : undefined,
        mediaUrl: convertedMediaUrls[index],
        thumbnailUrl: convertedThumbUrls[index],
        fileName: m.file_name,
        fileSize: m.file_size ? parseInt(m.file_size) : undefined,
        mimeType: m.mime_type,
        transcript: m.transcript,
        aiCategory: m.ai_category,
        aiUrgency: m.ai_urgency,
        aiSummary: m.ai_summary,
        aiSentiment: m.ai_sentiment,
        aiIntent: m.ai_intent,
        isRead: m.is_read,
        isProblem: m.is_problem,
        reactions: m.reactions || {},
        replyToMessageId: m.reply_to_message_id,
        replyToText,
        replyToSender,
        threadId: m.thread_id,
        threadName: m.thread_name,
        caseId: m.case_id,
        forwardedFrom: m.forwarded_from || null,
        createdAt: m.created_at,
      }
    })

    return json({
      channel: {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        isForum: channel.is_forum,
        awaitingReply: channel.awaiting_reply,
        unreadCount: parseInt(channel.unread_count || 0),
        lastMessageAt: channel.last_message_at,
        lastSenderName: channel.last_sender_name,
        lastMessagePreview: channel.last_message_preview,
        photoUrl: channel.photo_url,
      },
      messages: formattedMessages,
      // Для совместимости с фронтендом
      total,
      hasMore: messages.length >= limit,
      pagination: {
        total,
        limit,
        hasMore: messages.length >= limit,
      }
    })

  } catch (e: any) {
    console.error('[Channel Messages] Error:', e.message)
    return json({ error: 'Failed to fetch channel messages', details: e.message }, 500)
  }
}
