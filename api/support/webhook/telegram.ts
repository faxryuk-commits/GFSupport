import { neon } from '@neondatabase/serverless'
import { identifySender, markChannelReadOnReply } from '../lib/identification.js'

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

// Generate unique ID
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// Extract user info from Telegram update
function extractUserInfo(from: any) {
  return {
    id: from?.id,
    firstName: from?.first_name || '',
    lastName: from?.last_name || '',
    username: from?.username || null,
    fullName: [from?.first_name, from?.last_name].filter(Boolean).join(' ') || 'Unknown',
  }
}

// Get or create channel for chat
async function getOrCreateChannel(sql: any, chat: any, user: any): Promise<string> {
  const chatId = String(chat.id)
  
  // Check existing channel
  const existing = await sql`
    SELECT id FROM support_channels WHERE telegram_chat_id = ${chatId} LIMIT 1
  `
  
  if (existing[0]) {
    return existing[0].id
  }
  
  // Create new channel
  const channelId = generateId('ch')
  const chatTitle = chat.title || user.fullName || `Chat ${chatId}`
  const channelType = chat.type === 'private' ? 'client' : 
                      chat.type === 'group' || chat.type === 'supergroup' ? 'partner' : 'client'
  
  await sql`
    INSERT INTO support_channels (
      id, telegram_chat_id, name, type, is_active, created_at
    ) VALUES (
      ${channelId}, ${chatId}, ${chatTitle}, ${channelType}, true, NOW()
    )
  `
  
  console.log(`[Webhook] Created new channel: ${channelId} for chat ${chatId}`)
  return channelId
}

// Save message to database
async function saveMessage(
  sql: any,
  channelId: string,
  telegramMessageId: number,
  user: any,
  role: 'client' | 'support' | 'team',
  content: {
    text?: string
    contentType: string
    mediaUrl?: string
    replyToId?: number
    threadId?: number
  }
): Promise<string> {
  const messageId = generateId('msg')
  const isFromClient = role === 'client'
  
  await sql`
    INSERT INTO support_messages (
      id, channel_id, telegram_message_id,
      sender_id, sender_name, sender_username, sender_role,
      is_from_client, content_type, text_content, media_url,
      reply_to_message_id, thread_id,
      is_read, created_at
    ) VALUES (
      ${messageId}, ${channelId}, ${telegramMessageId},
      ${String(user.id)}, ${user.fullName}, ${user.username}, ${role},
      ${isFromClient}, ${content.contentType}, ${content.text || null}, ${content.mediaUrl || null},
      ${content.replyToId ? String(content.replyToId) : null}, ${content.threadId ? String(content.threadId) : null},
      ${!isFromClient}, NOW()
    )
  `
  
  return messageId
}

// Update channel stats
async function updateChannelStats(sql: any, channelId: string, isFromClient: boolean) {
  if (isFromClient) {
    // Client message - increment unread, set awaiting_reply
    await sql`
      UPDATE support_channels SET
        unread_count = unread_count + 1,
        last_message_at = NOW(),
        awaiting_reply = true
      WHERE id = ${channelId}
    `
  } else {
    // Support/team message - mark as responded
    await sql`
      UPDATE support_channels SET
        last_message_at = NOW(),
        awaiting_reply = false
      WHERE id = ${channelId}
    `
    // Also mark client messages as read
    await markChannelReadOnReply(sql, channelId)
  }
}

// Handle incoming message reactions from Telegram
async function handleMessageReaction(sql: any, reaction: any): Promise<Response> {
  try {
    const chatId = String(reaction.chat.id)
    const messageId = reaction.message_id
    const user = extractUserInfo(reaction.user || reaction.actor_chat)
    
    // Find our message by telegram_message_id
    const msgResult = await sql`
      SELECT id, reactions FROM support_messages 
      WHERE telegram_message_id = ${messageId}
      LIMIT 1
    `
    
    if (msgResult.length === 0) {
      console.log('[Webhook] Reaction: message not found for telegram_message_id:', messageId)
      return json({ ok: true })
    }

    const ourMessageId = msgResult[0].id
    let reactions = msgResult[0].reactions || {}

    // Get new reactions (array of ReactionType objects)
    const newReactions = reaction.new_reaction || []
    const oldReactions = reaction.old_reaction || []

    // Process removed reactions
    for (const oldR of oldReactions) {
      const emoji = oldR.emoji
      if (emoji && reactions[emoji]) {
        reactions[emoji] = reactions[emoji].filter((u: string) => u !== user.fullName)
        if (reactions[emoji].length === 0) {
          delete reactions[emoji]
        }
      }
    }

    // Process added reactions
    for (const newR of newReactions) {
      const emoji = newR.emoji
      if (emoji) {
        if (!reactions[emoji]) {
          reactions[emoji] = []
        }
        if (!reactions[emoji].includes(user.fullName)) {
          reactions[emoji].push(user.fullName)
        }
      }
    }

    // Update in database
    await sql`
      UPDATE support_messages 
      SET reactions = ${JSON.stringify(reactions)}::jsonb
      WHERE id = ${ourMessageId}
    `

    console.log(`[Webhook] Updated reactions for message ${ourMessageId}:`, reactions)
    return json({ ok: true })

  } catch (e: any) {
    console.error('[Webhook] Reaction handling error:', e)
    return json({ ok: true }) // Don't fail webhook
  }
}

// Record agent activity
async function recordAgentActivity(sql: any, userId: string, userName: string, channelId: string) {
  try {
    await sql`
      INSERT INTO support_agent_activity (
        id, agent_id, agent_name, activity_type, channel_id, created_at
      ) VALUES (
        ${generateId('act')}, ${userId}, ${userName}, 'message_sent', ${channelId}, NOW()
      )
    `
  } catch (e) {
    // Activity table may not exist
    console.log('[Webhook] Could not record agent activity:', e)
  }
}

// Main webhook handler
export default async function handler(req: Request): Promise<Response> {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return json({ ok: true, message: 'Webhook endpoint ready' })
  }

  const sql = getSQL()

  try {
    const update = await req.json()
    console.log('[Webhook] Received update:', JSON.stringify(update).slice(0, 500))

    // Handle message reactions
    if (update.message_reaction) {
      return handleMessageReaction(sql, update.message_reaction)
    }

    // Handle different update types
    const message = update.message || update.edited_message || update.channel_post
    
    if (!message) {
      // Could be callback_query, etc.
      console.log('[Webhook] Non-message update, ignoring')
      return json({ ok: true })
    }

    const chat = message.chat
    const from = message.from
    
    if (!chat || !from) {
      console.log('[Webhook] Missing chat or from')
      return json({ ok: true })
    }

    // Extract user info
    const user = extractUserInfo(from)
    
    // Identify sender role (client vs support vs team)
    const identification = await identifySender(sql, {
      telegramId: user.id,
      username: user.username,
      senderName: user.fullName,
    })
    
    console.log(`[Webhook] Identified sender: ${user.fullName} (${user.id}) as ${identification.role} via ${identification.source}`)

    // Get or create channel
    const channelId = await getOrCreateChannel(sql, chat, user)

    // Determine content type and extract text/media
    let contentType = 'text'
    let text = message.text || message.caption || ''
    let mediaUrl: string | undefined

    if (message.photo) {
      contentType = 'photo'
      // Get largest photo
      const photo = message.photo[message.photo.length - 1]
      mediaUrl = `tg://photo/${photo.file_id}`
    } else if (message.video) {
      contentType = 'video'
      mediaUrl = `tg://video/${message.video.file_id}`
    } else if (message.video_note) {
      contentType = 'video_note'
      mediaUrl = `tg://video_note/${message.video_note.file_id}`
    } else if (message.voice) {
      contentType = 'voice'
      mediaUrl = `tg://voice/${message.voice.file_id}`
    } else if (message.audio) {
      contentType = 'audio'
      mediaUrl = `tg://audio/${message.audio.file_id}`
    } else if (message.document) {
      contentType = 'document'
      mediaUrl = `tg://document/${message.document.file_id}`
    } else if (message.sticker) {
      contentType = 'sticker'
      mediaUrl = `tg://sticker/${message.sticker.file_id}`
      text = message.sticker.emoji || '🎭'
    }

    // Save message
    const messageId = await saveMessage(sql, channelId, message.message_id, user, identification.role, {
      text,
      contentType,
      mediaUrl,
      replyToId: message.reply_to_message?.message_id,
      threadId: message.message_thread_id,
    })

    console.log(`[Webhook] Saved message ${messageId} from ${identification.role}`)

    // Update channel stats
    await updateChannelStats(sql, channelId, identification.role === 'client')

    // If support/team replied, record activity and mark messages as read
    if (identification.role !== 'client') {
      await recordAgentActivity(sql, String(user.id), user.fullName, channelId)
      
      // When staff replies via Telegram, they've seen the messages
      // Mark all unread client messages as read
      await sql`
        UPDATE support_messages 
        SET is_read = true, read_at = NOW()
        WHERE channel_id = ${channelId}
          AND is_read = false
          AND is_from_client = true
      `
      
      // Reset unread count
      await sql`
        UPDATE support_channels SET unread_count = 0 WHERE id = ${channelId}
      `
      
      console.log(`[Webhook] Staff ${user.fullName} replied via Telegram - marked messages as read`)
    }

    // Trigger AI analysis for client messages (async, don't wait)
    if (identification.role === 'client' && text && text.length > 3) {
      // Call AI analyze endpoint asynchronously
      const analyzeUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}/api/support/ai/analyze`
        : null
      
      if (analyzeUrl) {
        fetch(analyzeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, text, channelId }),
        }).catch(e => console.log('[Webhook] AI analyze call failed:', e.message))
      }
    }

    return json({ ok: true, messageId, role: identification.role })

  } catch (e: any) {
    console.error('[Webhook] Error processing update:', e.message, e.stack)
    // Always return 200 to Telegram to prevent retries
    return json({ ok: true, error: e.message })
  }
}
