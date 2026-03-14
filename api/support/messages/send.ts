import { neon } from '@neondatabase/serverless'
import { getOrgBotToken } from '../lib/db.js'
import { getRequestOrgId } from '../lib/org.js'

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

// Save dialog for AI learning
async function saveDialogForLearning(sql: any, channelId: string, answerText: string, answerBy: string, orgId: string) {
  try {
    // Find the last client message that this is responding to
    const lastClientMsg = await sql`
      SELECT text_content, ai_category
      FROM support_messages
      WHERE channel_id = ${channelId}
        AND org_id = ${orgId}
        AND sender_role = 'client'
        AND text_content IS NOT NULL
        AND LENGTH(text_content) > 5
      ORDER BY created_at DESC
      LIMIT 1
    `
    
    if (!lastClientMsg || lastClientMsg.length === 0 || !lastClientMsg[0].text_content) {
      return // No client message to pair with
    }
    
    const questionText = lastClientMsg[0].text_content
    const category = lastClientMsg[0].ai_category
    
    // Skip very short or greeting messages
    if (questionText.length < 10 || answerText.length < 20) {
      return
    }
    
    // Skip if answer is just emoji or very short
    if (/^[\p{Emoji}\s]+$/u.test(answerText.trim())) {
      return
    }
    
    // Call dialogs API to save (it handles deduplication and embeddings)
    const dialogsUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}/api/support/dialogs`
      : '/api/support/dialogs'
    
    // Just insert directly to avoid circular API calls
    const dialogId = `dlg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    
    // Simple hash for deduplication
    const normalized = questionText.toLowerCase().replace(/[^\wа-яёўқғҳ\s]/gi, '').replace(/\s+/g, ' ').trim()
    let hash = 0
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) - hash) + normalized.charCodeAt(i)
      hash = hash & hash
    }
    const questionHash = Math.abs(hash).toString(16).padStart(8, '0')
    
    // Check for existing
    const existing = await sql`
      SELECT id FROM support_dialogs WHERE question_hash = ${questionHash} LIMIT 1
    `
    
    if (existing.length > 0) {
      // Update existing
      await sql`
        UPDATE support_dialogs 
        SET used_count = used_count + 1, last_used_at = NOW()
        WHERE id = ${existing[0].id}
      `
      return
    }
    
    // Sanitize personal data
    const sanitize = (text: string) => text
      .replace(/\+?[0-9]{10,15}/g, '[PHONE]')
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    
    // Insert new dialog (without embedding - will be created on first search)
    await sql`
      INSERT INTO support_dialogs (
        id, channel_id, question_text, question_hash, question_category,
        answer_text, answer_by, answer_type
      ) VALUES (
        ${dialogId}, ${channelId}, ${sanitize(questionText)}, ${questionHash},
        ${category || null}, ${sanitize(answerText)}, ${answerBy}, 'manual'
      )
    `
    
    console.log(`Dialog saved for learning: ${dialogId}`)
    
  } catch (e: any) {
    // Don't fail the main request if learning save fails
    console.log('Dialog learning save error:', e.message)
  }
}

// Commitment detection for tracking promises
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
    autoDeadline: new Date(now.getTime() + 4 * 60 * 60 * 1000)
  }

  const lowerText = text.toLowerCase()

  // Concrete time patterns
  const concretePatterns = [
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
    { pattern: /завтра/i, hours: 24 },
    { pattern: /сегодня/i, hours: 4 },
  ]

  for (const p of concretePatterns) {
    const match = lowerText.match(p.pattern)
    if (match) {
      result.hasCommitment = true
      result.isVague = false
      result.commitmentType = 'time'
      result.commitmentText = match[0]
      
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
      return result
    }
  }

  // Vague promise patterns
  const vaguePatterns = [
    /сейчас\s+(проверю|посмотрю|уточню|узнаю)/i,
    /минуточку/i,
    /подождите/i,
    /сделаем/i,
    /решим/i,
    /разберусь/i,
    /скоро/i,
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

// Create reminder from commitment
async function createReminder(
  sql: any,
  commitment: CommitmentDetection,
  channelId: string,
  messageId: string,
  senderName: string
): Promise<string | null> {
  if (!commitment.hasCommitment) return null

  const reminderId = `rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const deadline = (commitment.detectedDeadline || commitment.autoDeadline).toISOString()

  try {
    // Try to insert directly first
    await sql`
      INSERT INTO support_reminders (
        id, channel_id, message_id, commitment_text, commitment_type,
        is_vague, deadline, status, created_by
      ) VALUES (
        ${reminderId},
        ${channelId},
        ${messageId},
        ${commitment.commitmentText},
        ${commitment.commitmentType},
        ${commitment.isVague},
        ${deadline}::timestamptz,
        'active',
        ${senderName}
      )
    `
    return reminderId
  } catch (e: any) {
    // If table doesn't exist, create it and retry
    if (e.message?.includes('does not exist')) {
      try {
        await sql`
          CREATE TABLE IF NOT EXISTS support_reminders (
            id VARCHAR(50) PRIMARY KEY,
            channel_id VARCHAR(50) NOT NULL,
            message_id VARCHAR(50),
            commitment_text TEXT,
            commitment_type VARCHAR(20),
            is_vague BOOLEAN DEFAULT false,
            deadline TIMESTAMPTZ,
            status VARCHAR(20) DEFAULT 'active',
            created_by VARCHAR(255),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            escalated_at TIMESTAMPTZ
          )
        `
        await sql`
          INSERT INTO support_reminders (
            id, channel_id, message_id, commitment_text, commitment_type,
            is_vague, deadline, status, created_by
          ) VALUES (
            ${reminderId},
            ${channelId},
            ${messageId},
            ${commitment.commitmentText},
            ${commitment.commitmentType},
            ${commitment.isVague},
            ${deadline}::timestamptz,
            'active',
            ${senderName}
          )
        `
        return reminderId
      } catch (e2) {
        console.error('Failed to create reminder after table creation:', e2)
        return null
      }
    }
    console.error('Failed to create reminder:', e)
    return null
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const botToken = await getOrgBotToken(orgId)
  if (!botToken) {
    return json({ error: 'Bot not configured' }, 500)
  }

  try {
    const body = await req.json()
    const { channelId, text, threadId, replyToMessageId, senderName, senderId, senderUsername } = body

    if (!channelId || !text) {
      return json({ error: 'channelId and text are required' }, 400)
    }

    // Get channel info
    const channelResult = await sql`
      SELECT * FROM support_channels WHERE id = ${channelId} AND org_id = ${orgId}
    `
    
    if (channelResult.length === 0) {
      return json({ error: 'Channel not found' }, 404)
    }

    const channel = channelResult[0]
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const messagePreview = text.slice(0, 100)
    let externalMessageId: number | null = null

    if (channel.source === 'whatsapp') {
      const bridgeUrl = process.env.WHATSAPP_BRIDGE_URL
      const bridgeSecret = process.env.WHATSAPP_BRIDGE_SECRET
      if (!bridgeUrl || !bridgeSecret) {
        return json({ error: 'WhatsApp bridge not configured' }, 500)
      }

      const bridgeRes = await fetch(`${bridgeUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bridgeSecret}` },
        body: JSON.stringify({ chatId: channel.external_chat_id, text }),
      })
      const bridgeData = await bridgeRes.json() as any
      if (!bridgeData.success) {
        return json({ error: 'WhatsApp send failed', details: bridgeData.error }, 500)
      }

      await sql`
        INSERT INTO support_messages (
          id, channel_id, org_id, sender_id, sender_name, sender_username, sender_role,
          is_from_client, content_type, text_content, is_read, created_at
        ) VALUES (
          ${messageId}, ${channelId}, ${orgId}, ${senderId || null}, ${senderName || 'Support'},
          ${senderUsername || null}, 'support', false, 'text', ${text}, true, NOW()
        )
      `
    } else {
      const chatId = channel.telegram_chat_id
      const hasMarkdownChars = /[_*\[\]()~`>#+\-=|{}.!]/.test(text)
      const telegramPayload: any = { chat_id: chatId, text }
      if (!hasMarkdownChars) {
        telegramPayload.parse_mode = 'Markdown'
      }

      if (threadId && channel.is_forum) {
        telegramPayload.message_thread_id = threadId
      }
      if (replyToMessageId) {
        telegramPayload.reply_to_message_id = replyToMessageId
      }

      const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telegramPayload),
      })

      const telegramData = await telegramRes.json()
      if (!telegramData.ok) {
        return json({ error: 'Failed to send Telegram message', details: telegramData.description }, 500)
      }

      const sentMessage = telegramData.result
      externalMessageId = sentMessage.message_id

      let threadName = null
      if (threadId) {
        const topicResult = await sql`
          SELECT name FROM support_topics WHERE channel_id = ${channelId} AND thread_id = ${threadId} AND org_id = ${orgId}
        `
        threadName = topicResult[0]?.name
      }

      await sql`
        INSERT INTO support_messages (
          id, channel_id, org_id, telegram_message_id, sender_id, sender_name, sender_username, sender_role,
          is_from_client, content_type, text_content, is_processed, is_read,
          reply_to_message_id, thread_id, thread_name
        ) VALUES (
          ${messageId}, ${channelId}, ${orgId}, ${sentMessage.message_id},
          ${senderId || null}, ${senderName || 'Support'}, ${senderUsername || null},
          'support', false, 'text', ${text}, true, true,
          ${replyToMessageId || null}, ${threadId || null}, ${threadName}
        )
      `

      if (threadId) {
        await sql`
          UPDATE support_topics SET
            messages_count = messages_count + 1,
            last_message_at = NOW(),
            last_sender_name = ${senderName || 'Support'}
          WHERE channel_id = ${channelId} AND thread_id = ${threadId} AND org_id = ${orgId}
        `
      }
    }

    await sql`
      UPDATE support_channels SET
        last_message_at = NOW(),
        last_team_message_at = NOW(),
        last_sender_name = ${senderName || 'Support'},
        last_message_preview = ${messagePreview},
        awaiting_reply = false
      WHERE id = ${channelId} AND org_id = ${orgId}
    `

    const commitment = detectCommitment(text)
    let reminderId = null
    if (commitment.hasCommitment) {
      reminderId = await createReminder(sql, commitment, channelId, messageId, senderName || 'Support')
    }

    saveDialogForLearning(sql, channelId, text, senderName || 'Support', orgId).catch(() => {})

    return json({
      success: true,
      messageId,
      telegramMessageId: externalMessageId,
      sentAt: new Date().toISOString(),
      commitment: commitment.hasCommitment ? {
        type: commitment.commitmentType,
        text: commitment.commitmentText,
        deadline: commitment.detectedDeadline || commitment.autoDeadline,
        reminderId
      } : null
    })

  } catch (e: any) {
    console.error('Send message error:', e)
    return json({ error: 'Failed to send message', details: e.message }, 500)
  }
}
