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

// Convert Telegram file_id to downloadable URL
async function getFileUrl(fileId: string): Promise<string | null> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return null
  
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)
    const data = await response.json()
    
    if (data.ok && data.result?.file_path) {
      return `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`
    }
  } catch (e) {
    console.error('[Webhook] Failed to get file URL:', e)
  }
  
  return null
}

// Get chat photo URL from Telegram
async function getChatPhotoUrl(chatId: string): Promise<string | null> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return null
  
  try {
    const chatInfoRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getChat?chat_id=${chatId}`
    )
    const chatInfo = await chatInfoRes.json()
    
    if (chatInfo.ok && chatInfo.result?.photo?.small_file_id) {
      const fileRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getFile?file_id=${chatInfo.result.photo.small_file_id}`
      )
      const fileData = await fileRes.json()
      
      if (fileData.ok) {
        return `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`
      }
    }
  } catch (e) {
    console.log('[Webhook] Failed to get chat photo:', e)
  }
  return null
}

// Get or create channel for chat
async function getOrCreateChannel(sql: any, chat: any, user: any): Promise<string> {
  const chatId = String(chat.id)
  
  // Check existing channel
  const existing = await sql`
    SELECT id, photo_url FROM support_channels WHERE telegram_chat_id = ${chatId} LIMIT 1
  `
  
  if (existing[0]) {
    // Update photo if missing (async, don't wait)
    if (!existing[0].photo_url) {
      getChatPhotoUrl(chatId).then(async (photoUrl) => {
        if (photoUrl) {
          try {
            await sql`UPDATE support_channels SET photo_url = ${photoUrl} WHERE id = ${existing[0].id}`
            console.log(`[Webhook] Updated photo for channel ${existing[0].id}`)
          } catch (e) {
            console.log('[Webhook] Failed to update photo:', e)
          }
        }
      }).catch(() => {})
    }
    return existing[0].id
  }
  
  // Create new channel with photo
  const channelId = generateId('ch')
  const chatTitle = chat.title || user.fullName || `Chat ${chatId}`
  const channelType = chat.type === 'private' ? 'client' : 
                      chat.type === 'group' || chat.type === 'supergroup' ? 'partner' : 'client'
  
  // Try to get photo (but don't block on it)
  let photoUrl: string | null = null
  try {
    photoUrl = await getChatPhotoUrl(chatId)
  } catch (e) {
    console.log('[Webhook] Could not get photo for new channel')
  }
  
  await sql`
    INSERT INTO support_channels (
      id, telegram_chat_id, name, type, photo_url, is_active, created_at
    ) VALUES (
      ${channelId}, ${chatId}, ${chatTitle}, ${channelType}, ${photoUrl}, true, NOW()
    )
  `
  
  console.log(`[Webhook] Created new channel: ${channelId} for chat ${chatId}${photoUrl ? ' (with photo)' : ''}`)
  return channelId
}

// Upsert user in support_users table
async function upsertUser(sql: any, user: any, channelId: string, role: string) {
  if (!user.id) return
  
  const telegramId = String(user.id)
  
  try {
    // Check if user exists
    const existing = await sql`
      SELECT id, channels FROM support_users WHERE telegram_id = ${telegramId} LIMIT 1
    `
    
    if (existing[0]) {
      // Update existing user
      const channels = existing[0].channels || []
      if (!channels.includes(channelId)) {
        channels.push(channelId)
      }
      
      await sql`
        UPDATE support_users SET
          telegram_username = COALESCE(${user.username}, telegram_username),
          name = COALESCE(${user.fullName}, name),
          channels = ${JSON.stringify(channels)},
          last_seen_at = NOW(),
          updated_at = NOW()
        WHERE telegram_id = ${telegramId}
      `
    } else {
      // Create new user
      const userId = generateId('user')
      const userRole = role === 'client' ? 'client' : role === 'support' ? 'employee' : 'partner'
      
      await sql`
        INSERT INTO support_users (id, telegram_id, telegram_username, name, role, channels, first_seen_at, last_seen_at)
        VALUES (${userId}, ${telegramId}, ${user.username}, ${user.fullName}, ${userRole}, ${JSON.stringify([channelId])}, NOW(), NOW())
        ON CONFLICT (telegram_id) DO UPDATE SET
          telegram_username = COALESCE(EXCLUDED.telegram_username, support_users.telegram_username),
          name = COALESCE(EXCLUDED.name, support_users.name),
          last_seen_at = NOW()
      `
    }
  } catch (e) {
    console.error('[Webhook] Failed to upsert user:', e)
  }
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
    responseTimeMs?: number
  }
): Promise<string> {
  const messageId = generateId('msg')
  const isFromClient = role === 'client'
  
  // Save/update user info
  await upsertUser(sql, user, channelId, role)
  
  await sql`
    INSERT INTO support_messages (
      id, channel_id, telegram_message_id,
      sender_id, sender_name, sender_username, sender_role,
      is_from_client, content_type, text_content, media_url,
      reply_to_message_id, thread_id,
      is_read, response_time_ms, created_at
    ) VALUES (
      ${messageId}, ${channelId}, ${telegramMessageId},
      ${String(user.id)}, ${user.fullName}, ${user.username}, ${role},
      ${isFromClient}, ${content.contentType}, ${content.text || null}, ${content.mediaUrl || null},
      ${content.replyToId ? String(content.replyToId) : null}, ${content.threadId ? String(content.threadId) : null},
      ${!isFromClient}, ${content.responseTimeMs || null}, NOW()
    )
  `
  
  return messageId
}

// Update channel stats
async function updateChannelStats(
  sql: any, 
  channelId: string, 
  isFromClient: boolean,
  senderName?: string,
  messagePreview?: string
) {
  // Truncate preview to 100 chars
  const preview = messagePreview ? messagePreview.slice(0, 100) : null
  
  if (isFromClient) {
    // Client message - increment unread, set awaiting_reply
    await sql`
      UPDATE support_channels SET
        unread_count = unread_count + 1,
        last_message_at = NOW(),
        last_sender_name = COALESCE(${senderName}, last_sender_name),
        last_message_preview = COALESCE(${preview}, last_message_preview),
        awaiting_reply = true
      WHERE id = ${channelId}
    `
  } else {
    // Support/team message - mark as responded
    await sql`
      UPDATE support_channels SET
        last_message_at = NOW(),
        last_team_message_at = NOW(),
        last_sender_name = COALESCE(${senderName}, last_sender_name),
        last_message_preview = COALESCE(${preview}, last_message_preview),
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
    
    console.log(`[Webhook] Processing reaction: chat=${chatId}, msg=${messageId}, user=${user.fullName}`)
    
    // First find channel by telegram_chat_id
    const channelResult = await sql`
      SELECT id FROM support_channels WHERE telegram_chat_id = ${chatId} LIMIT 1
    `
    
    if (channelResult.length === 0) {
      console.log('[Webhook] Reaction: channel not found for chat_id:', chatId)
      return json({ ok: true })
    }
    
    const channelId = channelResult[0].id
    
    // Find our message by telegram_message_id AND channel_id
    const msgResult = await sql`
      SELECT id, reactions FROM support_messages 
      WHERE telegram_message_id = ${messageId}
        AND channel_id = ${channelId}
      LIMIT 1
    `
    
    if (msgResult.length === 0) {
      console.log('[Webhook] Reaction: message not found for telegram_message_id:', messageId, 'in channel:', channelId)
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

// Answer callback query (acknowledge button press)
async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return
  
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text: text || '',
    }),
  })
}

// Handle callback query (inline button clicks)
async function handleCallbackQuery(sql: any, callbackQuery: any): Promise<Response> {
  try {
    const { id, data, from, message } = callbackQuery
    console.log(`[Webhook] Callback query: ${data} from ${from?.first_name}`)
    
    // Acknowledge the button press immediately
    await answerCallbackQuery(id)
    
    // Parse callback data: format is "action:caseId:value"
    const parts = data?.split(':') || []
    const action = parts[0]
    const caseId = parts[1]
    const value = parts[2]
    
    if (action === 'case_resolved' && caseId) {
      // Call resolve-notify API
      const resolveUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}/api/support/cases/resolve-notify`
        : null
      
      if (resolveUrl) {
        const feedbackAction = value === 'yes' ? 'feedback_yes' : 'feedback_no'
        
        try {
          const response = await fetch(resolveUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              caseId, 
              action: feedbackAction 
            }),
          })
          const result = await response.json()
          console.log(`[Webhook] Case feedback result: ${JSON.stringify(result)}`)
        } catch (e: any) {
          console.log(`[Webhook] Case feedback call failed: ${e.message}`)
        }
      }
      
      // Edit the original message to remove buttons (optional UX improvement)
      const botToken = process.env.TELEGRAM_BOT_TOKEN
      if (botToken && message?.chat?.id && message?.message_id) {
        try {
          await fetch(`https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: message.chat.id,
              message_id: message.message_id,
              reply_markup: { inline_keyboard: [] }
            }),
          })
        } catch (e) {
          // Ignore error - message might be too old
        }
      }
    }
    
    return json({ ok: true })
    
  } catch (e: any) {
    console.error('[Webhook] Callback query error:', e)
    return json({ ok: true }) // Don't fail webhook
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

    // Handle callback queries (inline button clicks)
    if (update.callback_query) {
      return handleCallbackQuery(sql, update.callback_query)
    }

    // Handle different update types
    const message = update.message || update.edited_message || update.channel_post
    
    if (!message) {
      // Could be other update types
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
      mediaUrl = await getFileUrl(photo.file_id) || `tg://photo/${photo.file_id}`
    } else if (message.video) {
      contentType = 'video'
      mediaUrl = await getFileUrl(message.video.file_id) || `tg://video/${message.video.file_id}`
    } else if (message.video_note) {
      contentType = 'video_note'
      mediaUrl = await getFileUrl(message.video_note.file_id) || `tg://video_note/${message.video_note.file_id}`
    } else if (message.voice) {
      contentType = 'voice'
      mediaUrl = await getFileUrl(message.voice.file_id) || `tg://voice/${message.voice.file_id}`
    } else if (message.audio) {
      contentType = 'audio'
      mediaUrl = await getFileUrl(message.audio.file_id) || `tg://audio/${message.audio.file_id}`
    } else if (message.document) {
      contentType = 'document'
      mediaUrl = await getFileUrl(message.document.file_id) || `tg://document/${message.document.file_id}`
    } else if (message.sticker) {
      contentType = 'sticker'
      mediaUrl = await getFileUrl(message.sticker.file_id) || `tg://sticker/${message.sticker.file_id}`
      text = message.sticker.emoji || '🎭'
    }

    // Calculate response time for client messages
    let responseTimeMs: number | undefined = undefined
    
    if (identification.role === 'client') {
      // Get last_agent_message_at to calculate client response time
      const channelData = await sql`
        SELECT last_agent_message_at FROM support_channels WHERE id = ${channelId}
      `
      if (channelData[0]?.last_agent_message_at) {
        const lastAgentTime = new Date(channelData[0].last_agent_message_at).getTime()
        responseTimeMs = Date.now() - lastAgentTime
        console.log(`[Webhook] Client response time: ${Math.round(responseTimeMs / 1000)}s`)
      }
    }

    // Save message
    const messageId = await saveMessage(sql, channelId, message.message_id, user, identification.role, {
      text,
      contentType,
      mediaUrl,
      replyToId: message.reply_to_message?.message_id,
      threadId: message.message_thread_id,
      responseTimeMs,
    })

    console.log(`[Webhook] Saved message ${messageId} from ${identification.role}`)

    // Create message preview for channel
    let messagePreview = text || ''
    if (!messagePreview && contentType !== 'text') {
      const typeLabels: Record<string, string> = {
        photo: '[Фото]',
        video: '[Видео]',
        voice: '[Голосовое]',
        video_note: '[Видеосообщение]',
        audio: '[Аудио]',
        document: '[Документ]',
        sticker: '[Стикер]'
      }
      messagePreview = typeLabels[contentType] || '[Медиа]'
    }

    // Update channel stats with preview
    await updateChannelStats(sql, channelId, identification.role === 'client', user.fullName, messagePreview)

    // Update response time tracking
    if (identification.role === 'client' && responseTimeMs) {
      // Update client average response time (incremental average)
      await sql`
        UPDATE support_channels SET
          client_avg_response_ms = CASE 
            WHEN client_response_count = 0 THEN ${responseTimeMs}
            ELSE ((COALESCE(client_avg_response_ms, 0) * client_response_count) + ${responseTimeMs}) / (client_response_count + 1)
          END,
          client_response_count = COALESCE(client_response_count, 0) + 1,
          response_comparison = jsonb_set(
            COALESCE(response_comparison, '{}'::jsonb),
            '{client_avg}',
            to_jsonb(CASE 
              WHEN client_response_count = 0 THEN ${responseTimeMs}
              ELSE ((COALESCE(client_avg_response_ms, 0) * client_response_count) + ${responseTimeMs}) / (client_response_count + 1)
            END)
          )
        WHERE id = ${channelId}
      `
      console.log(`[Webhook] Updated client avg response time for channel ${channelId}`)
    }

    // If support/team replied, record activity and mark messages as read
    if (identification.role !== 'client') {
      await recordAgentActivity(sql, String(user.id), user.fullName, channelId)
      
      // Update last_agent_message_at for client response time tracking
      await sql`
        UPDATE support_channels SET 
          last_agent_message_at = NOW()
        WHERE id = ${channelId}
      `
      
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
      // Call AI analyze endpoint asynchronously (includes auto-reply logic)
      const analyzeUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}/api/support/ai/analyze`
        : null
      
      if (analyzeUrl) {
        fetch(analyzeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            messageId, 
            text, 
            channelId,
            telegramChatId: String(chat.id),
            senderName: user.fullName,
            telegramId: user.id ? String(user.id) : null,
          }),
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
