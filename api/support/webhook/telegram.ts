import { neon } from '@neondatabase/serverless'
import { identifySender, markChannelReadOnReply, autoBindTelegramId } from '../lib/identification.js'
import OpenAI from 'openai'

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

// Transcribe audio/voice message using OpenAI Whisper
async function transcribeAudio(audioUrl: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !audioUrl) return null
  
  try {
    console.log('[Webhook] Transcribing audio:', audioUrl)
    
    // Download audio file
    const audioResponse = await fetch(audioUrl)
    if (!audioResponse.ok) {
      console.log('[Webhook] Failed to download audio:', audioResponse.status)
      return null
    }
    
    const audioBlob = await audioResponse.blob()
    
    // Create form data for OpenAI
    const formData = new FormData()
    formData.append('file', audioBlob, 'audio.ogg')
    formData.append('model', 'whisper-1')
    formData.append('language', 'ru') // Support Russian primarily
    
    // Call OpenAI Whisper API
    const transcriptionResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    })
    
    if (!transcriptionResponse.ok) {
      console.log('[Webhook] Whisper API error:', transcriptionResponse.status)
      return null
    }
    
    const result = await transcriptionResponse.json()
    const transcription = result.text?.trim()
    
    if (transcription) {
      console.log('[Webhook] Transcription result:', transcription.slice(0, 100))
      return transcription
    }
    
    return null
  } catch (e: any) {
    console.error('[Webhook] Transcription error:', e.message)
    return null
  }
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
    thumbnailUrl?: string
    fileName?: string
    fileSize?: number
    mimeType?: string
    replyToId?: number
    threadId?: number
    responseTimeMs?: number
  }
): Promise<string> {
  const messageId = generateId('msg')
  const isFromClient = role === 'client'
  
  // Save/update user info
  await upsertUser(sql, user, channelId, role)
  
  // Ensure columns exist (will be ignored if they already exist)
  try {
    await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`
    await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS file_name TEXT`
    await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS file_size BIGINT`
    await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS mime_type TEXT`
  } catch (e) { /* columns exist */ }
  
  await sql`
    INSERT INTO support_messages (
      id, channel_id, telegram_message_id,
      sender_id, sender_name, sender_username, sender_role,
      is_from_client, content_type, text_content, media_url,
      thumbnail_url, file_name, file_size, mime_type,
      reply_to_message_id, thread_id,
      is_read, response_time_ms, created_at
    ) VALUES (
      ${messageId}, ${channelId}, ${telegramMessageId},
      ${String(user.id)}, ${user.fullName}, ${user.username}, ${role},
      ${isFromClient}, ${content.contentType}, ${content.text || null}, ${content.mediaUrl || null},
      ${content.thumbnailUrl || null}, ${content.fileName || null}, ${content.fileSize || null}, ${content.mimeType || null},
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

// Record agent activity with system agent ID mapping
async function recordAgentActivity(
  sql: any, 
  telegramUserId: string, 
  userName: string, 
  channelId: string,
  systemAgentId?: string | null
) {
  try {
    // Create activity table if not exists
    await sql`
      CREATE TABLE IF NOT EXISTS support_agent_activity (
        id VARCHAR(100) PRIMARY KEY,
        agent_id VARCHAR(100),
        system_agent_id VARCHAR(100),
        telegram_user_id VARCHAR(100),
        agent_name VARCHAR(255),
        activity_type VARCHAR(50),
        channel_id VARCHAR(100),
        activity_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS idx_agent_activity_agent ON support_agent_activity(agent_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_agent_activity_system_agent ON support_agent_activity(system_agent_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_agent_activity_time ON support_agent_activity(activity_at)`
    
    // Try to find system agent by telegram_id
    let resolvedSystemAgentId = systemAgentId
    if (!resolvedSystemAgentId && telegramUserId) {
      const agent = await sql`
        SELECT id FROM support_agents WHERE telegram_id = ${telegramUserId} LIMIT 1
      `
      if (agent[0]) {
        resolvedSystemAgentId = agent[0].id
      }
    }
    
    await sql`
      INSERT INTO support_agent_activity (
        id, agent_id, system_agent_id, telegram_user_id, agent_name, activity_type, channel_id, activity_at, created_at
      ) VALUES (
        ${generateId('act')}, ${telegramUserId}, ${resolvedSystemAgentId || null}, ${telegramUserId}, ${userName}, 'telegram_reply', ${channelId}, NOW(), NOW()
      )
    `
    
    // Also update support_agent_sessions to track activity
    if (resolvedSystemAgentId) {
      await sql`
        INSERT INTO support_agent_sessions (id, agent_id, started_at, is_active, source)
        VALUES (${generateId('sess')}, ${resolvedSystemAgentId}, NOW(), true, 'telegram')
        ON CONFLICT (agent_id, is_active) WHERE is_active = true
        DO UPDATE SET last_activity_at = NOW()
      `.catch(() => {
        // Session tracking may not be supported, ignore
      })
    }
    
    console.log(`[Webhook] Recorded activity: agent=${userName}, system_id=${resolvedSystemAgentId || 'unknown'}`)
  } catch (e) {
    // Activity table may not exist or have different schema
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

    // Auto-bind telegram_id to agent if identified by username but telegram_id not set
    // This allows employees using Telegram to be synced with system profiles
    if (identification.agentId && identification.source === 'username' && user.id) {
      const bound = await autoBindTelegramId(sql, identification.agentId, user.id)
      if (bound) {
        console.log(`[Webhook] Auto-bound telegram_id ${user.id} to agent ${identification.agentId}`)
      }
    }

    // Get or create channel
    const channelId = await getOrCreateChannel(sql, chat, user)

    // Determine content type and extract text/media
    let contentType = 'text'
    let text = message.text || message.caption || ''
    let mediaUrl: string | undefined
    let thumbnailUrl: string | undefined
    let fileName: string | undefined
    let fileSize: number | undefined
    let mimeType: string | undefined

    if (message.photo) {
      contentType = 'photo'
      // Get largest photo
      const photo = message.photo[message.photo.length - 1]
      mediaUrl = await getFileUrl(photo.file_id) || `tg://photo/${photo.file_id}`
      fileSize = photo.file_size
      // For photos, the media itself is the preview
      thumbnailUrl = mediaUrl
    } else if (message.animation) {
      // GIF/Animation - handle before document!
      contentType = 'animation'
      const anim = message.animation
      mediaUrl = await getFileUrl(anim.file_id) || `tg://animation/${anim.file_id}`
      fileName = anim.file_name
      fileSize = anim.file_size
      mimeType = anim.mime_type
      // Get thumbnail
      if (anim.thumbnail?.file_id) {
        thumbnailUrl = await getFileUrl(anim.thumbnail.file_id) || undefined
      }
    } else if (message.video) {
      contentType = 'video'
      const video = message.video
      mediaUrl = await getFileUrl(video.file_id) || `tg://video/${video.file_id}`
      fileName = video.file_name
      fileSize = video.file_size
      mimeType = video.mime_type
      // Get thumbnail
      if (video.thumbnail?.file_id) {
        thumbnailUrl = await getFileUrl(video.thumbnail.file_id) || undefined
      }
    } else if (message.video_note) {
      contentType = 'video_note'
      const vn = message.video_note
      mediaUrl = await getFileUrl(vn.file_id) || `tg://video_note/${vn.file_id}`
      fileSize = vn.file_size
      // Get thumbnail
      if (vn.thumbnail?.file_id) {
        thumbnailUrl = await getFileUrl(vn.thumbnail.file_id) || undefined
      }
    } else if (message.voice) {
      contentType = 'voice'
      const voice = message.voice
      mediaUrl = await getFileUrl(voice.file_id) || `tg://voice/${voice.file_id}`
      fileSize = voice.file_size
      mimeType = voice.mime_type
    } else if (message.audio) {
      contentType = 'audio'
      const audio = message.audio
      mediaUrl = await getFileUrl(audio.file_id) || `tg://audio/${audio.file_id}`
      fileName = audio.file_name || audio.title
      fileSize = audio.file_size
      mimeType = audio.mime_type
      // Audio can have album art thumbnail
      if (audio.thumbnail?.file_id) {
        thumbnailUrl = await getFileUrl(audio.thumbnail.file_id) || undefined
      }
    } else if (message.document) {
      contentType = 'document'
      const doc = message.document
      mediaUrl = await getFileUrl(doc.file_id) || `tg://document/${doc.file_id}`
      fileName = doc.file_name
      fileSize = doc.file_size
      mimeType = doc.mime_type
      // Documents can have thumbnails (PDFs, images, etc)
      if (doc.thumbnail?.file_id) {
        thumbnailUrl = await getFileUrl(doc.thumbnail.file_id) || undefined
      }
    } else if (message.sticker) {
      contentType = 'sticker'
      const sticker = message.sticker
      mediaUrl = await getFileUrl(sticker.file_id) || `tg://sticker/${sticker.file_id}`
      fileSize = sticker.file_size
      // Sticker thumbnail
      if (sticker.thumbnail?.file_id) {
        thumbnailUrl = await getFileUrl(sticker.thumbnail.file_id) || mediaUrl
      }
      text = sticker.emoji || '🎭'
    }
    
    console.log(`[Webhook] Media: type=${contentType}, file=${fileName}, thumb=${thumbnailUrl ? 'yes' : 'no'}`)

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
      thumbnailUrl,
      fileName,
      fileSize,
      mimeType,
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
      await recordAgentActivity(sql, String(user.id), user.fullName, channelId, identification.agentId)
      
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

    // Trigger AI analysis for ALL messages (clients AND team can report problems)
    // But auto-reply only for clients
    
    // For voice/audio messages, transcribe first
    let analysisText = text
    let transcribedText: string | null = null
    
    if ((contentType === 'voice' || contentType === 'audio') && mediaUrl) {
      transcribedText = await transcribeAudio(mediaUrl)
      if (transcribedText) {
        analysisText = transcribedText
        // Update message with transcription
        await sql`
          UPDATE support_messages 
          SET text_content = ${transcribedText}, transcription = ${transcribedText}
          WHERE id = ${messageId}
        `.catch(() => {
          // transcription column may not exist, try adding it
          sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS transcription TEXT`.catch(() => {})
        })
        console.log(`[Webhook] Transcribed voice message: ${transcribedText.slice(0, 100)}`)
      }
    }
    
    // For media without text, create context description for AI
    if (!analysisText && contentType !== 'text') {
      const mediaDescriptions: Record<string, string> = {
        photo: 'Клиент отправил фото/скриншот (возможно демонстрация проблемы)',
        video: 'Клиент отправил видео (возможно демонстрация проблемы)',
        document: fileName ? `Клиент отправил документ: ${fileName}` : 'Клиент отправил документ',
        voice: 'Клиент отправил голосовое сообщение (не удалось транскрибировать)',
        video_note: 'Клиент отправил видеосообщение',
        sticker: 'Стикер',
        animation: 'GIF/Анимация',
      }
      analysisText = mediaDescriptions[contentType] || `Медиа: ${contentType}`
    }
    
    // Analyze if we have content
    if (analysisText && analysisText.length > 2) {
      // Get base URL from request or environment
      const requestUrl = new URL(req.url)
      const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}`
        : `${requestUrl.protocol}//${requestUrl.host}`
      
      const analyzeUrl = `${baseUrl}/api/support/ai/analyze`
      console.log(`[Webhook] Calling AI analyze at: ${analyzeUrl}`)
      
      // Must await to ensure it runs in Edge runtime
      try {
        const analyzeResponse = await fetch(analyzeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            messageId, 
            text: analysisText,
            originalText: text || null,
            transcription: transcribedText || null,
            contentType,
            channelId,
            telegramChatId: String(chat.id),
            senderName: user.fullName,
            telegramId: user.id ? String(user.id) : null,
            // Pass sender role so analyze can decide on auto-reply
            senderRole: identification.role,
          }),
        })
        const analyzeResult = await analyzeResponse.json()
        console.log(`[Webhook] AI analyze result: isProblem=${analyzeResult.analysis?.isProblem}, ticket=${analyzeResult.ticket?.success}`)
      } catch (e: any) {
        console.log(`[Webhook] AI analyze call failed: ${e.message}`)
      }
    }

    return json({ ok: true, messageId, role: identification.role })

  } catch (e: any) {
    console.error('[Webhook] Error processing update:', e.message, e.stack)
    // Always return 200 to Telegram to prevent retries
    return json({ ok: true, error: e.message })
  }
}
