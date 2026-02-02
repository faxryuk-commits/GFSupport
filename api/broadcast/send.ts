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

// Telegram Bot API
async function sendTelegramMessage(chatId: string | number, text: string, parseMode = 'HTML') {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN not found')
  
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
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
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const sql = getSQL()
  
  try {
    const body = await req.json()
    const { 
      message, 
      type = 'announcement', // announcement, update, warning
      filter = 'all', // all, active, tags
      tags = [],
      excludeChannels = [],
      senderName = 'Delever Support'
    } = body
    
    if (!message || message.trim().length === 0) {
      return json({ error: 'Message is required' }, 400)
    }
    
    // Создаём таблицу истории рассылок если не существует
    await sql`
      CREATE TABLE IF NOT EXISTS support_broadcasts (
        id VARCHAR(50) PRIMARY KEY,
        message_type VARCHAR(30),
        message_text TEXT,
        filter_type VARCHAR(30),
        sender_name VARCHAR(255),
        channels_count INTEGER DEFAULT 0,
        successful_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        views_count INTEGER DEFAULT 0,
        clicks_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `.catch(() => {})
    
    // Get channels based on filter (без is_active - может быть не установлен)
    let channels
    if (filter === 'active') {
      // Channels with activity in last 30 days
      channels = await sql`
        SELECT id, telegram_chat_id, name
        FROM support_channels
        WHERE telegram_chat_id IS NOT NULL
          AND last_message_at > NOW() - INTERVAL '30 days'
        ORDER BY last_message_at DESC
      `
    } else if (filter === 'tags' && tags.length > 0) {
      channels = await sql`
        SELECT id, telegram_chat_id, name
        FROM support_channels
        WHERE telegram_chat_id IS NOT NULL
          AND tags && ${tags}
        ORDER BY name
      `
    } else {
      // All channels with telegram_chat_id
      channels = await sql`
        SELECT id, telegram_chat_id, name
        FROM support_channels
        WHERE telegram_chat_id IS NOT NULL
        ORDER BY name
      `
    }
    
    // Filter out excluded channels
    const filteredChannels = channels.filter(
      (ch: any) => !excludeChannels.includes(ch.id)
    )
    
    if (filteredChannels.length === 0) {
      return json({ error: 'No channels match the filter' }, 400)
    }
    
    // Создаём ID рассылки заранее для трекинга
    const broadcastId = `bc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    
    // Функция для замены ссылок на трекинг-ссылки
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'https://delever.io'
    
    function addTracking(text: string): string {
      // Находим все URL в тексте
      const urlRegex = /(https?:\/\/[^\s<>"]+)/gi
      let linkIndex = 0
      return text.replace(urlRegex, (url) => {
        linkIndex++
        const trackUrl = `${baseUrl}/api/support/broadcast/track?b=${broadcastId}&l=${linkIndex}&url=${encodeURIComponent(url)}`
        return trackUrl
      })
    }
    
    // Format message based on type
    const typeEmoji = {
      announcement: '📢',
      update: '🔄',
      warning: '⚠️'
    }
    const emoji = typeEmoji[type as keyof typeof typeEmoji] || '📢'
    
    // Добавляем трекинг к ссылкам в сообщении
    const trackedMessage = addTracking(message)
    const formattedMessage = `${emoji} <b>${type === 'announcement' ? 'Объявление' : type === 'update' ? 'Обновление' : 'Предупреждение'}</b>\n\n${trackedMessage}\n\n<i>— ${senderName}</i>`
    
    // Send to all channels
    const results: { channelId: string; channelName: string; success: boolean; error?: string }[] = []
    
    for (const channel of filteredChannels) {
      try {
        const result = await sendTelegramMessage(channel.telegram_chat_id, formattedMessage)
        
        if (result.ok) {
          // Save message to database with broadcast_id for tracking
          const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          await sql`
            INSERT INTO support_messages (
              id, channel_id, telegram_message_id, sender_name, sender_role, is_from_client,
              content_type, text_content, broadcast_id, created_at
            ) VALUES (
              ${msgId}, ${channel.id}, ${result.result?.message_id}, ${senderName}, 'broadcast', false,
              'text', ${message}, ${broadcastId}, NOW()
            )
          `.catch(() => {
            // broadcast_id column might not exist, try without it
            sql`
              INSERT INTO support_messages (
                id, channel_id, telegram_message_id, sender_name, sender_role, is_from_client,
                content_type, text_content, created_at
              ) VALUES (
                ${msgId}, ${channel.id}, ${result.result?.message_id}, ${senderName}, 'broadcast', false,
                'text', ${message}, NOW()
              )
            `.catch(() => {})
          })
          
          results.push({
            channelId: channel.id,
            channelName: channel.name,
            success: true
          })
        } else {
          results.push({
            channelId: channel.id,
            channelName: channel.name,
            success: false,
            error: result.description || 'Unknown error'
          })
        }
      } catch (e: any) {
        results.push({
          channelId: channel.id,
          channelName: channel.name,
          success: false,
          error: e.message
        })
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    // Log broadcast to history
    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length
    
    await sql`
      INSERT INTO support_broadcasts (
        id, message_type, message_text, filter_type, sender_name,
        channels_count, successful_count, failed_count, views_count, clicks_count, created_at
      )
      VALUES (
        ${broadcastId},
        ${type},
        ${message},
        ${filter},
        ${senderName},
        ${results.length},
        ${successful},
        ${failed},
        0,
        0,
        NOW()
      )
    `.catch((e) => {
      console.error('[Broadcast Log Error]', e)
    })
    
    return json({
      success: true,
      broadcastId,
      stats: {
        total: results.length,
        successful,
        failed
      },
      results
    })
    
  } catch (error: any) {
    console.error('[Broadcast Error]', error)
    return json({ success: false, error: error.message }, 500)
  }
}
