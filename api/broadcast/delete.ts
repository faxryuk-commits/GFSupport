import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
  maxDuration: 60,
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

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

// Telegram Bot API - удаление сообщения
async function deleteTelegramMessage(chatId: string | number, messageId: number) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN not found')
  
  const response = await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
    }),
  })
  
  return response.json()
}

export default async function handler(req: Request) {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const sql = getSQL()
  
  try {
    const body = await req.json()
    const { broadcastId } = body
    
    if (!broadcastId) {
      return json({ error: 'Broadcast ID is required' }, 400)
    }
    
    // Получаем все сообщения этой рассылки
    const messages = await sql`
      SELECT m.id, m.telegram_message_id, c.telegram_chat_id, c.name as channel_name
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.broadcast_id = ${broadcastId}
        AND m.telegram_message_id IS NOT NULL
    `
    
    if (messages.length === 0) {
      return json({ 
        success: false, 
        error: 'No messages found for this broadcast',
        broadcastId 
      }, 404)
    }
    
    // Удаляем каждое сообщение
    const results: { channelName: string; success: boolean; error?: string }[] = []
    let deletedCount = 0
    let failedCount = 0
    
    for (const msg of messages) {
      try {
        const result = await deleteTelegramMessage(msg.telegram_chat_id, msg.telegram_message_id)
        
        if (result.ok) {
          deletedCount++
          results.push({
            channelName: msg.channel_name,
            success: true
          })
          
          // Помечаем сообщение как удалённое в БД
          await sql`
            UPDATE support_messages 
            SET content_type = 'deleted', text_content = '[Сообщение удалено]'
            WHERE id = ${msg.id}
          `.catch(() => {})
          
        } else {
          failedCount++
          results.push({
            channelName: msg.channel_name,
            success: false,
            error: result.description || 'Failed to delete'
          })
        }
      } catch (e: any) {
        failedCount++
        results.push({
          channelName: msg.channel_name,
          success: false,
          error: e.message
        })
      }
      
      // Небольшая задержка чтобы не превысить лимит API
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    
    // Обновляем статус рассылки
    await sql`
      UPDATE support_broadcasts 
      SET 
        message_type = 'deleted',
        successful_count = ${deletedCount}
      WHERE id = ${broadcastId}
    `.catch(() => {})
    
    return json({
      success: true,
      broadcastId,
      stats: {
        total: messages.length,
        deleted: deletedCount,
        failed: failedCount
      },
      results
    })
    
  } catch (error: any) {
    console.error('[Broadcast Delete Error]', error)
    return json({ success: false, error: error.message }, 500)
  }
}
