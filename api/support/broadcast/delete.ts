import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
  maxDuration: 60,
}

async function getActiveBotToken(): Promise<string | null> {
  try {
    const sql = getSQL()
    const rows = await sql`SELECT value FROM support_settings WHERE key = 'telegram_bot_token' LIMIT 1`
    if (rows[0]?.value) return rows[0].value
  } catch {}
  return process.env.TELEGRAM_BOT_TOKEN || null
}

async function deleteTelegramMessage(chatId: string | number, messageId: number, botToken: string) {
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  
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
        AND m.org_id = ${orgId}
        AND m.telegram_message_id IS NOT NULL
    `
    
    if (messages.length === 0) {
      return json({ 
        success: false, 
        error: 'No messages found for this broadcast',
        broadcastId 
      }, 404)
    }
    
    const botToken = await getActiveBotToken()
    if (!botToken) return json({ success: false, error: 'Telegram bot token не настроен' }, 400)

    const results: { channelName: string; success: boolean; error?: string }[] = []
    let deletedCount = 0
    let failedCount = 0
    
    for (const msg of messages) {
      try {
        const result = await deleteTelegramMessage(msg.telegram_chat_id, msg.telegram_message_id, botToken)
        
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
            WHERE id = ${msg.id} AND org_id = ${orgId}
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
      WHERE id = ${broadcastId} AND org_id = ${orgId}
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
