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
    const { messageId, emoji, action = 'toggle' } = body // action: 'add' | 'remove' | 'toggle'

    if (!messageId || !emoji) {
      return json({ error: 'messageId and emoji are required' }, 400)
    }

    // Get message info
    const msgResult = await sql`
      SELECT m.*, ch.telegram_chat_id
      FROM support_messages m
      JOIN support_channels ch ON m.channel_id = ch.id
      WHERE m.id = ${messageId}
    `

    if (msgResult.length === 0) {
      return json({ error: 'Message not found' }, 404)
    }

    const msg = msgResult[0]

    // Check if bot already has this reaction
    const existingReaction = await sql`
      SELECT id FROM support_reactions 
      WHERE message_id = ${messageId} AND emoji = ${emoji} AND is_from_bot = true
      LIMIT 1
    `
    
    const hasReaction = existingReaction.length > 0
    const shouldAdd = action === 'add' || (action === 'toggle' && !hasReaction)
    const shouldRemove = action === 'remove' || (action === 'toggle' && hasReaction)

    if (shouldRemove && hasReaction) {
      // Remove reaction from Telegram (send empty reaction array)
      const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: msg.telegram_chat_id,
          message_id: msg.telegram_message_id,
          reaction: [], // Empty array removes all bot reactions
          is_big: false
        }),
      })
      
      const telegramData = await telegramRes.json()
      if (!telegramData.ok) {
        console.log('Telegram remove reaction response:', telegramData)
      }

      // Remove from our DB
      await sql`
        DELETE FROM support_reactions 
        WHERE message_id = ${messageId} AND emoji = ${emoji} AND is_from_bot = true
      `

    } else if (shouldAdd && !hasReaction) {
      // Add reaction via Telegram Bot API
      const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: msg.telegram_chat_id,
          message_id: msg.telegram_message_id,
          reaction: [{ type: 'emoji', emoji }],
          is_big: false
        }),
      })

      const telegramData = await telegramRes.json()

      if (!telegramData.ok) {
        return json({ 
          error: 'Failed to set reaction', 
          details: telegramData.description 
        }, 500)
      }

      // Save reaction to our DB
      const reactionId = `react_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      await sql`
        INSERT INTO support_reactions (id, message_id, channel_id, telegram_message_id, emoji, is_from_bot, user_name)
        VALUES (
          ${reactionId},
          ${messageId},
          ${msg.channel_id},
          ${msg.telegram_message_id},
          ${emoji},
          true,
          'Вы'
        )
      `
    }

    // Update aggregated reactions
    const reactionsAgg = await sql`
      SELECT emoji, COUNT(*) as count, array_agg(COALESCE(user_name, 'Bot')) as users
      FROM support_reactions WHERE message_id = ${messageId}
      GROUP BY emoji
    `
    
    const reactionsJson: Record<string, { count: number; users: string[] }> = {}
    for (const r of reactionsAgg) {
      reactionsJson[r.emoji] = { count: parseInt(r.count), users: r.users }
    }

    await sql`
      UPDATE support_messages SET reactions = ${JSON.stringify(reactionsJson)} WHERE id = ${messageId}
    `

    return json({
      success: true,
      action: shouldRemove ? 'removed' : shouldAdd ? 'added' : 'unchanged',
      emoji,
      reactions: reactionsJson
    })

  } catch (e: any) {
    console.error('React error:', e)
    return json({ error: 'Failed to react', details: e.message }, 500)
  }
}
