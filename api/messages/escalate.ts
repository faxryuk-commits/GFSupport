import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

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

  try {
    const sql = getSQL()
    const { messageId, reason = 'manual' } = await req.json()

    if (!messageId) {
      return json({ error: 'messageId required' }, 400)
    }

    // Get message details
    const msgResult = await sql`
      SELECT m.*, c.name as channel_name, c.telegram_chat_id
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.id = ${messageId}
    `

    if (msgResult.length === 0) {
      return json({ error: 'Message not found' }, 404)
    }

    const msg = msgResult[0]

    // Update message urgency to max
    await sql`
      UPDATE support_messages 
      SET ai_urgency = 5, is_problem = true
      WHERE id = ${messageId}
    `

    // Update channel - set awaiting_reply and increment urgency indicator
    await sql`
      UPDATE support_channels
      SET awaiting_reply = true, unread_count = COALESCE(unread_count, 0) + 1
      WHERE id = ${msg.channel_id}
    `

    const escalationId = `esc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

    // Send notification to Telegram (if configured)
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const notifyChatId = process.env.SUPPORT_NOTIFY_CHAT_ID

    if (botToken && notifyChatId) {
      const alertText = `🚨 *ЭСКАЛАЦИЯ*\n\nКанал: ${msg.channel_name}\nОт: ${msg.sender_name}\n\n"${(msg.text_content || '').slice(0, 200)}"\n\nПричина: ${reason}`
      
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: notifyChatId,
          text: alertText,
          parse_mode: 'Markdown'
        })
      })
    }

    return json({
      success: true,
      escalationId,
      message: 'Message escalated successfully'
    })

  } catch (e: any) {
    console.error('Escalation error:', e)
    return json({ error: e.message }, 500)
  }
}
