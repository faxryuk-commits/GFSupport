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

  const sql = getSQL()
  
  try {
    // Ensure columns exist FIRST
    try {
      await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false`
      await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`
    } catch (e) {
      // Columns may exist
    }
    
    const body = await req.json()
    const { messageId, telegramMessageId } = body
    
    if (!messageId) {
      return json({ error: 'Message ID required' }, 400)
    }
    
    // Get message to verify ownership and get channel info
    const message = await sql`
      SELECT m.*, c.telegram_chat_id
      FROM support_messages m
      LEFT JOIN support_channels c ON m.channel_id = c.id
      WHERE m.id = ${messageId}
    `
    
    if (!message || message.length === 0) {
      return json({ error: 'Message not found' }, 404)
    }
    
    const msg = message[0]
    
    // Only allow deleting non-client messages (support/team/bot/system/agent)
    const allowedRoles = ['support', 'team', 'bot', 'system', 'agent', 'ai', 'autoresponder']
    if (msg.sender_role === 'client') {
      return json({ error: 'Нельзя удалить сообщения клиента' }, 403)
    }
    
    // Delete from Telegram if we have the telegram message ID
    const telegramMsgId = telegramMessageId || msg.telegram_message_id
    if (telegramMsgId && msg.telegram_chat_id) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN
      if (botToken) {
        try {
          const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: msg.telegram_chat_id,
              message_id: telegramMsgId
            })
          })
          
          const result = await telegramRes.json()
          if (!result.ok) {
            console.log('Telegram delete failed:', result.description)
            // Continue anyway - message may be too old to delete
          }
        } catch (e) {
          console.error('Telegram delete error:', e)
        }
      }
    }
    
    // Mark as deleted in database (soft delete)
    await sql`
      UPDATE support_messages 
      SET 
        text_content = '[Сообщение удалено]',
        is_deleted = true,
        deleted_at = NOW()
      WHERE id = ${messageId}
    `
    
    return json({ 
      success: true, 
      message: 'Сообщение удалено',
      telegramDeleted: !!telegramMsgId
    })
    
  } catch (e: any) {
    console.error('Delete message error:', e)
    return json({ error: e.message || 'Server error' }, 500)
  }
}
