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

/**
 * POST /api/support/messages/reaction
 * 
 * Установить реакцию на сообщение (отправляется в Telegram)
 * Body: { messageId, emoji, channelId }
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return json({ error: 'Bot not configured' }, 500)
  }

  const sql = getSQL()

  try {
    const body = await req.json()
    const { messageId, emoji, channelId } = body

    if (!messageId || !emoji) {
      return json({ error: 'messageId and emoji are required' }, 400)
    }

    // Get message info including channel
    const msgResult = await sql`
      SELECT m.telegram_message_id, m.channel_id, ch.telegram_chat_id
      FROM support_messages m
      JOIN support_channels ch ON m.channel_id = ch.id
      WHERE m.id = ${messageId}
    `
    
    if (msgResult.length === 0) {
      return json({ error: 'Message not found' }, 404)
    }

    const telegramMessageId = msgResult[0].telegram_message_id
    const chatId = msgResult[0].telegram_chat_id
    const msgChannelId = msgResult[0].channel_id

    // Если channelId передан, проверяем что совпадает
    if (channelId && channelId !== msgChannelId) {
      return json({ error: 'Channel ID mismatch' }, 400)
    }

    // Send reaction via Telegram Bot API
    // Note: setMessageReaction requires Bot API 7.0+
    const telegramPayload = {
      chat_id: chatId,
      message_id: telegramMessageId,
      reaction: [{ type: 'emoji', emoji }],
      is_big: false
    }

    const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telegramPayload),
    })

    const telegramData = await telegramRes.json()

    if (!telegramData.ok) {
      console.log('[Reaction] Telegram API error:', telegramData)
      // Even if Telegram fails, save locally
    }

    // Update reactions in database
    // Get current reactions
    const currentReactions = await sql`
      SELECT reactions FROM support_messages WHERE id = ${messageId}
    `
    
    let reactions = currentReactions[0]?.reactions || {}
    
    // Add or update reaction
    if (!reactions[emoji]) {
      reactions[emoji] = []
    }
    
    // Get agent name from token or use default
    const agentName = 'Support'
    
    if (!reactions[emoji].includes(agentName)) {
      reactions[emoji].push(agentName)
    }

    // Save updated reactions
    await sql`
      UPDATE support_messages 
      SET reactions = ${JSON.stringify(reactions)}::jsonb
      WHERE id = ${messageId}
    `

    return json({
      success: true,
      telegramSent: telegramData.ok,
      reactions,
    })

  } catch (e: any) {
    console.error('Reaction error:', e)
    return json({ error: 'Failed to set reaction', details: e.message }, 500)
  }
}
