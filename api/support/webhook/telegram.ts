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

// Update cases when staff replies via Telegram
async function updateCasesOnStaffReply(
  sql: any,
  channelId: string,
  agentTelegramId: string,
  agentName: string,
  systemAgentId?: string | null,
  messageText?: string
) {
  try {
    // Find open cases for this channel
    const openCases = await sql`
      SELECT id, status, assigned_to, title
      FROM support_cases 
      WHERE channel_id = ${channelId}
        AND status IN ('detected', 'in_progress', 'waiting')
      ORDER BY created_at DESC
    `
    
    if (openCases.length === 0) {
      return { updated: 0 }
    }
    
    // Determine if this is a resolution message (simple heuristics)
    const textLower = (messageText || '').toLowerCase()
    const isResolution = 
      textLower.includes('решено') ||
      textLower.includes('исправлено') ||
      textLower.includes('готово') ||
      textLower.includes('сделано') ||
      textLower.includes('fixed') ||
      textLower.includes('resolved') ||
      textLower.includes('done') ||
      textLower.includes('выполнено') ||
      textLower.includes('закрыто')
    
    let updatedCount = 0
    
    for (const caseItem of openCases) {
      // Determine new status
      let newStatus = caseItem.status
      
      if (caseItem.status === 'detected') {
        // First response - move to in_progress
        newStatus = 'in_progress'
      } else if (isResolution && caseItem.status === 'in_progress') {
        // Resolution message - mark as resolved
        newStatus = 'resolved'
      }
      
      // Determine assigned agent
      const assignTo = caseItem.assigned_to || systemAgentId || null
      
      // Update case
      await sql`
        UPDATE support_cases SET
          status = ${newStatus},
          assigned_to = COALESCE(${assignTo}, assigned_to),
          updated_at = NOW(),
          updated_by = ${agentName},
          first_response_at = COALESCE(first_response_at, NOW()),
          resolved_at = ${newStatus === 'resolved' ? sql`NOW()` : sql`resolved_at`}
        WHERE id = ${caseItem.id}
      `
      
      // Add activity log
      await sql`
        INSERT INTO support_case_activity (
          id, case_id, activity_type, actor_name, actor_id, details, created_at
        ) VALUES (
          ${`act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`},
          ${caseItem.id},
          ${newStatus === 'resolved' ? 'resolved' : 'replied'},
          ${agentName},
          ${systemAgentId || agentTelegramId},
          ${JSON.stringify({ via: 'telegram', previousStatus: caseItem.status, newStatus })},
          NOW()
        )
      `.catch(() => {
        // Activity table may not exist
      })
      
      updatedCount++
      console.log(`[Webhook] Updated case ${caseItem.id}: ${caseItem.status} -> ${newStatus}`)
    }
    
    return { updated: updatedCount }
  } catch (e: any) {
    console.error('[Webhook] Error updating cases on staff reply:', e.message)
    return { updated: 0, error: e.message }
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


// Commitment detection for tracking promises made by staff
interface CommitmentDetection {
  hasCommitment: boolean
  isVague: boolean
  commitmentText: string | null
  commitmentType: 'time' | 'action' | 'vague' | null
  detectedDeadline: Date | null
  autoDeadline: Date
}

function detectCommitment(text: string): CommitmentDetection {
  const now = new Date()
  const result: CommitmentDetection = {
    hasCommitment: false,
    isVague: false,
    commitmentText: null,
    commitmentType: null,
    detectedDeadline: null,
    autoDeadline: new Date(now.getTime() + 4 * 60 * 60 * 1000) // default 4 hours
  }

  const lowerText = text.toLowerCase()

  // Concrete time patterns - including "завтра с утра", "завтра утром"
  // Also includes Uzbek (O'zbek) patterns
  const concretePatterns = [
    // Russian patterns
    { pattern: /через\s+пол\s*часа/i, minutes: 30 },
    { pattern: /через\s+час/i, minutes: 60 },
    { pattern: /через\s+(\d+)\s*мин/i, minutes: null },
    { pattern: /через\s+(\d+)\s*час/i, hours: null },
    { pattern: /(\d+)\s*мин/i, minutes: null },
    { pattern: /будет\s+готово\s+через/i, minutes: 30 },
    { pattern: /5\s*минут/i, minutes: 5 },
    { pattern: /10\s*минут/i, minutes: 10 },
    { pattern: /15\s*минут/i, minutes: 15 },
    { pattern: /20\s*минут/i, minutes: 20 },
    { pattern: /завтра\s+(с\s+)?утра|завтра\s+утром/i, hours: null, nextMorning: true },
    { pattern: /завтра/i, hours: 24 },
    { pattern: /сегодня/i, hours: 4 },
    { pattern: /с\s+утра/i, hours: null, morning: true },
    { pattern: /в\s+ближайшее\s+время/i, hours: 2 },           // "в ближайшее время"
    { pattern: /ближайшее\s+время/i, hours: 2 },               // "ближайшее время"
    { pattern: /до\s+конца\s+дня/i, hours: 8 },                // "до конца дня"
    { pattern: /к\s+вечеру/i, hours: 6 },                      // "к вечеру"
    { pattern: /к\s+обеду/i, hours: 4 },                       // "к обеду"
    
    // Uzbek time patterns (O'zbek)
    { pattern: /ertaga\s+ertalab/i, hours: null, nextMorning: true }, // завтра утром
    { pattern: /ertaga/i, hours: 24 },                                 // завтра
    { pattern: /bugun/i, hours: 4 },                                   // сегодня
    { pattern: /bir\s+soat(da|dan\s+keyin)/i, minutes: 60 },          // через час
    { pattern: /yarim\s+soat(da|dan\s+keyin)/i, minutes: 30 },        // через полчаса
    { pattern: /(\d+)\s*daqiqa(da|dan\s+keyin)?/i, minutes: null },   // X минут
    { pattern: /(\d+)\s*soat(da|dan\s+keyin)?/i, hours: null },       // X часов
    { pattern: /ertalab/i, hours: null, morning: true },               // утром
    { pattern: /kechqurun(gacha)?/i, hours: 8 },                       // к вечеру
    { pattern: /tushlik(gacha)?/i, hours: 4 },                         // к обеду
    { pattern: /yaqin\s+vaqt(da)?/i, hours: 2 },                       // в ближайшее время
  ]

  for (const p of concretePatterns) {
    const match = lowerText.match(p.pattern)
    if (match) {
      result.hasCommitment = true
      result.isVague = false
      result.commitmentType = 'time'
      result.commitmentText = match[0]
      
      let deadline: Date
      
      if ((p as any).nextMorning) {
        // "завтра с утра" - set to next day 9:00 AM
        deadline = new Date(now)
        deadline.setDate(deadline.getDate() + 1)
        deadline.setHours(9, 0, 0, 0)
        result.detectedDeadline = deadline
        result.autoDeadline = deadline
      } else if ((p as any).morning) {
        // "с утра" - if after 6 PM, set to next day 9 AM, else set to today 12 PM
        deadline = new Date(now)
        if (now.getHours() >= 18) {
          deadline.setDate(deadline.getDate() + 1)
          deadline.setHours(9, 0, 0, 0)
        } else {
          deadline.setHours(12, 0, 0, 0)
        }
        result.detectedDeadline = deadline
        result.autoDeadline = deadline
      } else {
        let totalMinutes = 0
        if (p.minutes !== null && p.minutes !== undefined) {
          totalMinutes = p.minutes
        } else if ((p as any).hours !== null && (p as any).hours !== undefined) {
          totalMinutes = (p as any).hours * 60
        } else if (match[1]) {
          const num = parseInt(match[1])
          if (p.pattern.toString().includes('час')) {
            totalMinutes = num * 60
          } else {
            totalMinutes = num
          }
        }
        
        if (totalMinutes > 0) {
          result.detectedDeadline = new Date(now.getTime() + totalMinutes * 60 * 1000)
          result.autoDeadline = result.detectedDeadline
        }
      }
      return result
    }
  }

  // Action patterns - explicit promises to do something
  // Includes variations: singular/plural, future tense forms
  // Russian + Uzbek patterns
  const actionPatterns = [
    // Russian action patterns
    /сформирую\s+тикет/i,
    /создам\s+тикет/i,
    /возьм[уе]тся\s+за\s+решение/i,
    /возьмутся\s+за/i,
    /займ[уе]сь/i,
    /займ[уе]тся/i,
    /отработа[юетм]/i,     // отработаю, отработает, отработаем, отработают
    /отработать/i,         // "отработать завтра"
    /исправ[люяиет]/i,     // исправлю, исправят, исправит, исправим
    /поправ[люяиет]/i,     // поправлю, поправят, поправит
    /сделаю/i,
    /сделаем/i,
    /сделают/i,
    /будет\s+сделано/i,    // "завтра будет сделано"
    /будет\s+готово/i,     // "к вечеру будет готово"
    /будет\s+исправлено/i, // "будет исправлено"
    /будет\s+решено/i,     // "будет решено"
    /решу/i,
    /решим/i,
    /решат/i,
    /проверю/i,
    /проверим/i,
    /проверят/i,
    /проверить/i,          // "надо проверить" / "завтра проверить"
    /уточню/i,
    /уточним/i,
    /узнаю/i,
    /узнаем/i,
    /передам/i,
    /передадим/i,
    /свяжусь/i,
    /свяжемся/i,
    /перезвоню/i,
    /перезвоним/i,
    /отвечу/i,
    /ответим/i,
    /ребята.*отработа/i,   // "ребята отработают"
    /думаю.*отработа/i,    // "думаю отработают"
    /думаю.*завтра.*отработа/i, // "думаю ребята завтра отработают"
    /завтра.*отработа/i,   // "завтра отработают" 
    /обработа[юетм]/i,     // обработаю, обработают
    /постараюсь/i,         // "постараюсь сделать"
    /постараемся/i,        // "постараемся"
    /выполн[юиет]/i,       // выполню, выполним, выполнят
    /посмотрю/i,           // "посмотрю"
    /посмотрим/i,          // "посмотрим", "скоро посмотрим"
    /посмотрят/i,          // "посмотрят"
    /надо.*проверить/i,    // "надо проверить"
    /нужно.*проверить/i,   // "нужно проверить"
    /надо.*сделать/i,      // "надо сделать"
    /нужно.*сделать/i,     // "нужно сделать"
    /срочно.*проверить/i,  // "срочно проверить"
    /срочно.*сделать/i,    // "срочно сделать"
    
    // Uzbek action patterns (O'zbek)
    /qilaman/i,            // сделаю
    /qilamiz/i,            // сделаем
    /qilishadi/i,          // сделают
    /tekshiraman/i,        // проверю
    /tekshiramiz/i,        // проверим
    /to'g'irlayman/i,      // исправлю
    /to'g'irlaymiz/i,      // исправим
    /tuzataman/i,          // исправлю/починю
    /tuzatamiz/i,          // исправим/починим
    /hal\s+qilaman/i,      // решу
    /hal\s+qilamiz/i,      // решим
    /yechaman/i,           // решу (проблему)
    /yechamiz/i,           // решим
    /bog'lanaman/i,        // свяжусь
    /bog'lanamiz/i,        // свяжемся
    /xabar\s+beraman/i,    // сообщу
    /xabar\s+beramiz/i,    // сообщим
    /javob\s+beraman/i,    // отвечу
    /javob\s+beramiz/i,    // ответим
    /ishlab\s+chiqaman/i,  // отработаю
    /ishlab\s+chiqamiz/i,  // отработаем
    /tayyor\s+bo'ladi/i,   // будет готово
    /amalga\s+oshiriladi/i, // будет выполнено
    /bajariladi/i,         // будет сделано
    /ko'raman/i,           // посмотрю
    /ko'ramiz/i,           // посмотрим
    /aniqlayman/i,         // уточню
    /aniqlaymiz/i,         // уточним
    /harakat\s+qilaman/i,  // постараюсь
    /harakat\s+qilamiz/i,  // постараемся
    /bajaraman/i,          // выполню
    /bajaramiz/i,          // выполним
  ]

  for (const pattern of actionPatterns) {
    const match = lowerText.match(pattern)
    if (match) {
      result.hasCommitment = true
      result.isVague = false
      result.commitmentType = 'action'
      result.commitmentText = match[0]
      // Action without time = 4 hour deadline
      result.autoDeadline = new Date(now.getTime() + 4 * 60 * 60 * 1000)
      return result
    }
  }

  // Vague promise patterns (Russian + Uzbek)
  const vaguePatterns = [
    // Russian vague patterns
    /сейчас\s+(проверю|посмотрю|уточню|узнаю)/i,
    /минуточку/i,
    /подождите/i,
    /сделаем/i,
    /решим/i,
    /разберусь/i,
    /разберёмся/i,
    /скоро/i,
    /очень\s+скоро/i,      // "очень скоро посмотрим"
    /попозже/i,            // "попозже"
    /чуть\s+позже/i,       // "чуть позже"
    /позже/i,              // "позже"
    /в\s+процессе/i,       // "в процессе"
    /работаем/i,           // "работаем над этим"
    /разбираемся/i,        // "разбираемся"
    /займёмся/i,           // "займёмся"
    /возьмёмся/i,          // "возьмёмся"
    
    // Uzbek vague patterns
    /hozir/i,              // сейчас
    /kutib\s+turing/i,     // подождите
    /bir\s+daqiqa/i,       // минуточку
    /tez\s+orada/i,        // скоро
    /yaqinda/i,            // скоро/в ближайшее время
    /keyinroq/i,           // позже
    /ishlaymiz/i,          // работаем
  ]

  for (const pattern of vaguePatterns) {
    const match = lowerText.match(pattern)
    if (match) {
      result.hasCommitment = true
      result.isVague = true
      result.commitmentType = 'vague'
      result.commitmentText = match[0]
      result.autoDeadline = new Date(now.getTime() + 30 * 60 * 1000) // 30 min for vague
      return result
    }
  }

  return result
}

// Create commitment/reminder from detected promise
async function createCommitmentReminder(
  sql: any,
  channelId: string,
  messageId: string,
  commitment: CommitmentDetection,
  senderName: string,
  agentId?: string,
  senderRole?: string
): Promise<string | null> {
  if (!commitment.hasCommitment) return null

  const commitmentId = generateId('commit')
  const deadline = commitment.detectedDeadline || commitment.autoDeadline
  const deadlineStr = deadline.toISOString()
  
  // Set reminder 1 hour before deadline, or 30 mins for vague commitments
  const reminderOffset = commitment.isVague ? 30 * 60 * 1000 : 60 * 60 * 1000
  const reminderAt = new Date(deadline.getTime() - reminderOffset)
  
  // Determine priority based on commitment type and deadline
  let priority = 'medium'
  const hoursUntilDeadline = (deadline.getTime() - Date.now()) / (1000 * 60 * 60)
  if (commitment.commitmentType === 'time' && hoursUntilDeadline <= 2) {
    priority = 'high'
  } else if (commitment.isVague) {
    priority = 'low'
  }

  try {
    // Use unified support_commitments table with extended fields
    await sql`
      CREATE TABLE IF NOT EXISTS support_commitments (
        id VARCHAR(50) PRIMARY KEY,
        channel_id VARCHAR(100) NOT NULL,
        case_id VARCHAR(100),
        message_id VARCHAR(100),
        agent_id VARCHAR(100),
        agent_name VARCHAR(255),
        sender_role VARCHAR(30),
        commitment_text TEXT NOT NULL,
        commitment_type VARCHAR(30) DEFAULT 'promise',
        is_vague BOOLEAN DEFAULT false,
        priority VARCHAR(20) DEFAULT 'medium',
        due_date TIMESTAMPTZ,
        reminder_at TIMESTAMPTZ,
        reminder_sent BOOLEAN DEFAULT false,
        status VARCHAR(20) DEFAULT 'pending',
        notes TEXT,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
    
    // Add missing columns if needed
    await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS sender_role VARCHAR(30)`.catch(() => {})
    await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS reminder_at TIMESTAMPTZ`.catch(() => {})
    await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT false`.catch(() => {})
    await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium'`.catch(() => {})
    await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS case_id VARCHAR(100)`.catch(() => {})
    await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS notes TEXT`.catch(() => {})
    await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`.catch(() => {})

    await sql`
      INSERT INTO support_commitments (
        id, channel_id, message_id, agent_id, agent_name, sender_role,
        commitment_text, commitment_type, is_vague, priority, due_date, reminder_at, status, created_at, updated_at
      ) VALUES (
        ${commitmentId}, ${channelId}, ${messageId}, ${agentId || null}, ${senderName}, ${senderRole || 'unknown'},
        ${commitment.commitmentText}, ${commitment.commitmentType}, ${commitment.isVague}, ${priority},
        ${deadlineStr}::timestamptz, ${reminderAt.toISOString()}::timestamptz, 'pending', NOW(), NOW()
      )
    `
    
    console.log(`[Webhook] Created commitment: ${commitmentId} by ${senderRole}/${senderName} - "${commitment.commitmentText}" (${priority}) due: ${deadlineStr}`)
    return commitmentId
  } catch (e: any) {
    console.error('[Webhook] Failed to create commitment:', e.message)
    return null
  }
}

// Send message to Telegram chat
async function sendTelegramMessage(
  chatId: string, 
  text: string, 
  replyToMessageId?: number
): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return false
  
  try {
    const payload: any = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }
    if (replyToMessageId) {
      payload.reply_to_message_id = replyToMessageId
    }
    
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    return data.ok === true
  } catch (e) {
    console.error('[Webhook] Failed to send Telegram message:', e)
    return false
  }
}

// Check if message is a ticket creation command
function isTicketCommand(text: string, botUsername?: string): boolean {
  const lowerText = text.toLowerCase().trim()
  
  // Direct commands
  const directCommands = [
    'создай тикет',
    'создать тикет',
    'новый тикет',
    '/ticket',
    '/тикет',
    '/createticket',
    'тикет',
  ]
  
  for (const cmd of directCommands) {
    if (lowerText.includes(cmd)) return true
  }
  
  // Bot mention commands like "@bot создай тикет"
  if (botUsername) {
    const mentionPattern = new RegExp(`@${botUsername}\\s+(создай|создать|новый)?\\s*тикет`, 'i')
    if (mentionPattern.test(text)) return true
  }
  
  // Check for any bot mention with ticket command
  if (/@\w+\s*(создай|создать|новый)?\s*тикет/i.test(text)) return true
  
  return false
}

// Create ticket from quoted/replied message
async function createTicketFromReply(
  sql: any,
  channelId: string,
  replyToMessage: any,
  requestedBy: { name: string; id: number },
  chatId: string,
  originalMessageId: number
): Promise<{ success: boolean; ticketNumber?: string; caseId?: string; error?: string }> {
  try {
    // First try to find the message in our DB by telegram_message_id
    const existingMsg = await sql`
      SELECT id, text_content, sender_name, ai_category, ai_urgency, ai_sentiment, is_problem
      FROM support_messages 
      WHERE channel_id = ${channelId} AND telegram_message_id = ${replyToMessage.message_id}
      LIMIT 1
    `
    
    let messageId: string
    let messageText: string
    let senderName: string
    let aiCategory: string | null = null
    let aiUrgency: number = 3
    
    if (existingMsg[0]) {
      // Message found in DB
      messageId = existingMsg[0].id
      messageText = existingMsg[0].text_content || replyToMessage.text || replyToMessage.caption || ''
      senderName = existingMsg[0].sender_name
      aiCategory = existingMsg[0].ai_category
      aiUrgency = parseInt(existingMsg[0].ai_urgency) || 3
    } else {
      // Message not in DB - save it first
      const user = extractUserInfo(replyToMessage.from)
      messageId = generateId('msg')
      messageText = replyToMessage.text || replyToMessage.caption || '[Медиа контент]'
      senderName = user.fullName
      
      // Determine content type
      let contentType = 'text'
      if (replyToMessage.photo) contentType = 'photo'
      else if (replyToMessage.video) contentType = 'video'
      else if (replyToMessage.document) contentType = 'document'
      else if (replyToMessage.voice) contentType = 'voice'
      
      await sql`
        INSERT INTO support_messages (
          id, channel_id, telegram_message_id, sender_id, sender_name, sender_role,
          is_from_client, content_type, text_content, is_read, created_at
        ) VALUES (
          ${messageId}, ${channelId}, ${replyToMessage.message_id},
          ${String(user.id)}, ${senderName}, 'client',
          true, ${contentType}, ${messageText}, true, NOW()
        )
        ON CONFLICT DO NOTHING
      `
    }
    
    // Check if case already exists for this message
    const existingCase = await sql`
      SELECT id, ticket_number FROM support_cases WHERE source_message_id = ${messageId} LIMIT 1
    `
    
    if (existingCase[0]) {
      return { 
        success: false, 
        error: `Тикет уже существует: #${existingCase[0].ticket_number || existingCase[0].id}` 
      }
    }
    
    // Create the case
    const caseId = generateId('case')
    const title = messageText.slice(0, 100) || 'Тикет из чата'
    
    // Determine priority
    let priority = 'medium'
    if (aiUrgency >= 5) priority = 'urgent'
    else if (aiUrgency >= 4) priority = 'high'
    else if (aiUrgency <= 2) priority = 'low'
    
    // Generate ticket number - get max ticket_number and increment
    const maxTicketResult = await sql`
      SELECT COALESCE(MAX(ticket_number), 0) as max_num FROM support_cases
    `
    const ticketNumber = parseInt(maxTicketResult[0]?.max_num || 0) + 1
    
    // Ensure created_by column exists
    await sql`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS created_by VARCHAR(255)`.catch(() => {})
    
    await sql`
      INSERT INTO support_cases (
        id, channel_id, title, description, category, priority, status,
        source_message_id, ticket_number, created_by, created_at
      ) VALUES (
        ${caseId}, ${channelId}, ${title}, ${messageText},
        ${aiCategory || 'general'}, ${priority}, 'detected',
        ${messageId}, ${ticketNumber}, ${requestedBy.name}, NOW()
      )
    `
    
    // Link message to case
    await sql`UPDATE support_messages SET case_id = ${caseId} WHERE id = ${messageId}`
    
    // Log activity
    await sql`
      INSERT INTO support_case_activity (id, case_id, activity_type, actor_name, details, created_at)
      VALUES (
        ${generateId('act')}, ${caseId}, 'created_via_command',
        ${requestedBy.name},
        ${JSON.stringify({ via: 'telegram_command', chatId, originalMessageId })},
        NOW()
      )
    `.catch(() => {})
    
    console.log(`[Webhook] Created ticket #${ticketNumber} from reply by ${requestedBy.name}`)
    
    // Return formatted ticket number for display
    return { success: true, ticketNumber: `CASE-${ticketNumber}`, caseId }
    
  } catch (e: any) {
    console.error('[Webhook] Create ticket from reply error:', e.message)
    return { success: false, error: e.message }
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

    // Check for ticket creation command BEFORE processing regular message
    const messageText = message.text || message.caption || ''
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'delever_sales_bot'
    
    if (isTicketCommand(messageText, botUsername) && message.reply_to_message) {
      // This is a ticket creation command with a quoted message
      console.log(`[Webhook] Ticket command detected from ${user.fullName}`)
      
      const result = await createTicketFromReply(
        sql,
        channelId,
        message.reply_to_message,
        { name: user.fullName, id: user.id },
        String(chat.id),
        message.message_id
      )
      
      // Send confirmation message
      if (result.success) {
        const confirmText = `✅ <b>Тикет создан!</b>\n\n` +
          `📋 Номер: <code>${result.ticketNumber}</code>\n` +
          `👤 Создал: ${user.fullName}\n\n` +
          `Тикет будет обработан в ближайшее время.`
        
        await sendTelegramMessage(String(chat.id), confirmText, message.message_id)
      } else {
        const errorText = `⚠️ ${result.error || 'Не удалось создать тикет'}`
        await sendTelegramMessage(String(chat.id), errorText, message.message_id)
      }
      
      // Still save the command message itself
      await saveMessage(sql, channelId, message.message_id, user, identification.role, {
        text: messageText,
        contentType: 'text',
      })
      
      return json({ 
        ok: true, 
        ticketCreated: result.success,
        ticketNumber: result.ticketNumber 
      })
    }
    
    // Also check for ticket command WITHOUT reply - send instructions
    if (isTicketCommand(messageText, botUsername) && !message.reply_to_message) {
      const instructionText = `💡 <b>Как создать тикет:</b>\n\n` +
        `1. Найдите сообщение с проблемой\n` +
        `2. Ответьте на него (Reply/Цитата)\n` +
        `3. Напишите: <code>создай тикет</code>\n\n` +
        `Тикет будет создан из цитируемого сообщения.`
      
      await sendTelegramMessage(String(chat.id), instructionText, message.message_id)
      return json({ ok: true, instruction: true })
    }

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

    // If support/team replied, record activity, mark messages as read, and update cases
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
      
      // Update open cases for this channel
      // - Move 'detected' cases to 'in_progress'
      // - Assign agent if not assigned
      // - Mark as 'resolved' if message contains resolution keywords
      const casesResult = await updateCasesOnStaffReply(
        sql, 
        channelId, 
        String(user.id), 
        user.fullName, 
        identification.agentId,
        text
      )
      
      console.log(`[Webhook] Staff ${user.fullName} replied via Telegram - messages read, ${casesResult.updated} cases updated`)
    }

    // ========================================
    // COMMITMENT DETECTION - FOR ALL PARTICIPANTS
    // ========================================
    // Обязательства собираются от ВСЕХ участников: staff, client, partner
    // Примеры: "завтра сделаю", "через час будет", "до конца дня исправим"
    if (text && text.length > 3) {
      const commitment = detectCommitment(text)
      if (commitment.hasCommitment) {
        const commitmentId = await createCommitmentReminder(
          sql, 
          channelId, 
          messageId, 
          commitment, 
          user.fullName, 
          identification.agentId,
          identification.role // Pass role to track who made the commitment
        )
        if (commitmentId) {
          console.log(`[Webhook] Commitment detected from ${identification.role} "${user.fullName}": "${commitment.commitmentText}" (${commitment.commitmentType}) - ${commitmentId}`)
        }
      }
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
