import { neon } from '@neondatabase/serverless'
import { cachedQuery, CACHE_TTL } from '../lib/cache'

export const config = {
  runtime: 'edge',
}

// Reuse connection
let sqlInstance: ReturnType<typeof neon> | null = null
function getSQL() {
  if (!sqlInstance) {
    const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
    if (!connectionString) throw new Error('Database connection string not found')
    sqlInstance = neon(connectionString)
  }
  return sqlInstance
}

function json(data: any, status = 200, cacheSeconds = 5) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`,
    },
  })
}

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

  const url = new URL(req.url)
  const debug = url.searchParams.get('debug') === 'true'

  // Allow debug without auth for diagnostics
  if (!debug) {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401, 0)
    }
  }

  const sql = getSQL()
  const noCache = url.searchParams.get('nocache') === 'true'

  if (req.method === 'GET') {
    try {
      // Debug mode - direct DB query without cache
      if (debug) {
        const channelCount = await sql`SELECT COUNT(*) as count FROM support_channels WHERE is_active = true`
        const messageCount = await sql`SELECT COUNT(*) as count FROM support_messages`
        const recentMessages = await sql`
          SELECT id, channel_id, sender_name, text_content, created_at 
          FROM support_messages 
          ORDER BY created_at DESC 
          LIMIT 5
        `
        return json({
          debug: true,
          channels: channelCount[0]?.count || 0,
          messages: messageCount[0]?.count || 0,
          recentMessages
        }, 200, 0)
      }

      // Use cache for channels list (changes less frequently)
      // First ensure photo_url column exists
      try {
        await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS photo_url TEXT`
      } catch (e) { /* column may already exist */ }
      
      // Динамический лимит - показать ВСЕ активные каналы
      const channels = noCache 
        ? await sql`
          SELECT 
            ch.id, ch.name, ch.type, ch.is_forum, ch.awaiting_reply,
            COALESCE(ch.unread_count, 0) as unread_count,
            ch.last_message_at, ch.last_sender_name, ch.last_message_preview,
            ch.last_client_message_at, ch.last_team_message_at,
            ch.photo_url,
            comp.name as company_name
          FROM support_channels ch
          LEFT JOIN crm_companies comp ON ch.company_id = comp.id
          WHERE ch.is_active = true
          ORDER BY ch.last_message_at DESC NULLS LAST
        `
        : await cachedQuery('grouped:channels', CACHE_TTL.CHANNELS, async () => {
        return await sql`
          SELECT 
            ch.id,
            ch.name,
            ch.type,
            ch.is_forum,
            ch.awaiting_reply,
            COALESCE(ch.unread_count, 0) as unread_count,
            ch.last_message_at,
            ch.last_sender_name,
            ch.last_message_preview,
            ch.last_client_message_at,
            ch.last_team_message_at,
            ch.photo_url,
            comp.name as company_name
          FROM support_channels ch
          LEFT JOIN crm_companies comp ON ch.company_id = comp.id
          WHERE ch.is_active = true
          ORDER BY ch.last_message_at DESC NULLS LAST
        `
      })

      if (channels.length === 0) {
        return json({ channels: [], stats: { total: 0, unread: 0, problems: 0, urgent: 0, channelsWithMessages: 0 } })
      }

      const channelIds = channels.map((c: any) => c.id)

      // Ensure ai_suggestion column exists
      try {
        await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS ai_suggestion TEXT`
        await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS ai_sentiment VARCHAR(50)`
        await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS ai_intent VARCHAR(50)`
      } catch (e) { /* columns may already exist */ }

      // Динамический лимит: ~100 сообщений на канал
      const messageLimit = Math.max(5000, channels.length * 100)
      
      // Optimized: Single query with index hints, shorter time window for speed
      const allMessages = await cachedQuery(`grouped:messages:${channelIds.slice(0, 10).join(',')}:${channels.length}`, CACHE_TTL.MESSAGES, async () => {
        return await sql`
          SELECT 
            id, channel_id, telegram_message_id, sender_name, sender_username, sender_photo_url, sender_role,
            text_content, content_type, media_url, transcript,
            ai_category, ai_urgency, ai_summary, ai_image_analysis, ai_suggestion, ai_sentiment, ai_intent,
            is_read, reactions, reply_to_message_id, reply_to_text, reply_to_sender, case_id, created_at
          FROM support_messages
          WHERE channel_id = ANY(${channelIds})
            AND created_at > NOW() - INTERVAL '90 days'
          ORDER BY created_at DESC
          LIMIT ${messageLimit}
        `
      })

      // Create lookup map by telegram_message_id for reply resolution
      const messagesByTelegramId: Record<string, any> = {}
      for (const msg of allMessages) {
        if (msg.telegram_message_id) {
          messagesByTelegramId[msg.telegram_message_id] = msg
        }
      }

      // Group messages by channel and resolve reply quotes
      const messagesByChannel: Record<string, any[]> = {}
      for (const msg of allMessages) {
        // Fill in missing reply_to_text/sender from loaded messages
        if (msg.reply_to_message_id && !msg.reply_to_text) {
          const replyMsg = messagesByTelegramId[msg.reply_to_message_id]
          if (replyMsg) {
            msg.reply_to_text = replyMsg.text_content || replyMsg.transcript || '[медиа]'
            msg.reply_to_sender = replyMsg.sender_name
          }
        }
        
        if (!messagesByChannel[msg.channel_id]) {
          messagesByChannel[msg.channel_id] = []
        }
        messagesByChannel[msg.channel_id].push(msg)
      }

      // Build result - up to 100 messages per channel for 90 days history
      const result = channels.map((ch: any) => {
        const channelMessages = (messagesByChannel[ch.id] || []).slice(0, 100)
        
        return {
          id: ch.id,
          name: ch.name,
          type: ch.type,
          isForum: ch.is_forum,
          companyName: ch.company_name,
          awaitingReply: ch.awaiting_reply,
          unreadCount: parseInt(ch.unread_count || 0),
          messagesCount: channelMessages.length,
          problemCount: 0,
          maxUrgency: Math.max(...channelMessages.map((m: any) => m.ai_urgency || 0), 0),
          lastMessageAt: ch.last_message_at,
          lastSenderName: ch.last_sender_name,
          lastMessagePreview: ch.last_message_preview,
          lastClientMessageAt: ch.last_client_message_at,
          lastTeamMessageAt: ch.last_team_message_at,
          photoUrl: ch.photo_url,
          topics: [],
          categories: [],
          recentMessages: channelMessages.map((m: any) => ({
            id: m.id,
            telegramMessageId: m.telegram_message_id,
            senderName: m.sender_name,
            senderUsername: m.sender_username,
            senderPhoto: m.sender_photo_url,
            senderRole: m.sender_role,
            text: m.text_content,
            contentType: m.content_type,
            mediaUrl: m.media_url,
            transcript: m.transcript,
            category: m.ai_category,
            urgency: m.ai_urgency || 0,
            aiSummary: m.ai_summary,
            aiImageAnalysis: m.ai_image_analysis,
            aiSuggestion: m.ai_suggestion,
            aiSentiment: m.ai_sentiment,
            aiIntent: m.ai_intent,
            isRead: m.is_read,
            reactions: m.reactions || {},
            createdAt: m.created_at,
            replyToMessageId: m.reply_to_message_id,
            replyToText: m.reply_to_text,
            replyToSender: m.reply_to_sender,
            caseId: m.case_id,
          })),
        }
      })

      // Stats from already loaded data (fast)
      const totalUnread = result.reduce((sum: number, ch: any) => sum + ch.unreadCount, 0)

      return json({
        channels: result,
        stats: {
          total: allMessages.length,
          unread: totalUnread,
          problems: 0,
          urgent: result.filter((ch: any) => ch.maxUrgency >= 4).length,
          channelsWithMessages: channels.length,
        }
      }, 200, 5) // Cache for 5 seconds

    } catch (e: any) {
      return json({ error: 'Failed to fetch grouped messages', details: e.message }, 500, 0)
    }
  }

  return json({ error: 'Method not allowed' }, 405, 0)
}
