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

  // Этот endpoint вызывается cron job или вручную
  // Проверяем cron secret если настроен
  const url = new URL(req.url)
  const cronSecret = url.searchParams.get('secret')
  const expectedSecret = process.env.CRON_SECRET

  // Если CRON_SECRET настроен, проверяем его
  if (expectedSecret && cronSecret !== expectedSecret) {
    // Также проверяем Authorization header для ручного вызова
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401)
    }
  }

  const sql = getSQL()

  try {
    // Находим все pending рассылки, время которых наступило
    const pendingBroadcasts = await sql`
      SELECT * FROM support_broadcast_scheduled 
      WHERE status = 'pending' 
        AND scheduled_at <= NOW()
      ORDER BY scheduled_at ASC
      LIMIT 10
    `

    if (pendingBroadcasts.length === 0) {
      return json({
        success: true,
        message: 'No pending broadcasts to execute',
        executed: 0
      })
    }

    const results: any[] = []

    for (const scheduled of pendingBroadcasts) {
      try {
        // Помечаем как "в процессе" чтобы избежать дублирования
        await sql`
          UPDATE support_broadcast_scheduled 
          SET status = 'processing'
          WHERE id = ${scheduled.id} AND status = 'pending'
        `

        // Получаем каналы для рассылки
        let channels
        if (scheduled.filter_type === 'selected' && scheduled.selected_channels?.length > 0) {
          channels = await sql`
            SELECT id, telegram_chat_id, name
            FROM support_channels
            WHERE id = ANY(${scheduled.selected_channels})
              AND telegram_chat_id IS NOT NULL
          `
        } else if (scheduled.filter_type === 'active') {
          channels = await sql`
            SELECT id, telegram_chat_id, name
            FROM support_channels
            WHERE telegram_chat_id IS NOT NULL
              AND last_message_at > NOW() - INTERVAL '30 days'
          `
        } else {
          // all
          channels = await sql`
            SELECT id, telegram_chat_id, name
            FROM support_channels
            WHERE telegram_chat_id IS NOT NULL
          `
        }

        if (channels.length === 0) {
          await sql`
            UPDATE support_broadcast_scheduled 
            SET status = 'failed', error_message = 'No channels found'
            WHERE id = ${scheduled.id}
          `
          results.push({
            scheduledId: scheduled.id,
            success: false,
            error: 'No channels found'
          })
          continue
        }

        // Создаём broadcast ID
        const broadcastId = `bc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

        // Форматируем сообщение
        const typeEmoji = {
          announcement: '📢',
          update: '🔄',
          warning: '⚠️'
        }
        const emoji = typeEmoji[scheduled.message_type as keyof typeof typeEmoji] || '📢'
        const typeName = scheduled.message_type === 'announcement' ? 'Объявление' 
          : scheduled.message_type === 'update' ? 'Обновление' 
          : 'Предупреждение'
        
        const formattedMessage = `${emoji} <b>${typeName}</b>\n\n${scheduled.message_text}\n\n<i>— ${scheduled.created_by || 'Support'}</i>`

        // Отправляем в каналы
        let successful = 0
        let failed = 0

        for (const channel of channels) {
          try {
            const result = await sendTelegramMessage(channel.telegram_chat_id, formattedMessage)
            
            if (result.ok) {
              successful++
              
              // Сохраняем сообщение в БД
              const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
              await sql`
                INSERT INTO support_messages (
                  id, channel_id, telegram_message_id, sender_name, sender_role,
                  content_type, text_content, created_at
                ) VALUES (
                  ${msgId}, ${channel.id}, ${result.result?.message_id}, 
                  ${scheduled.created_by || 'Broadcast'}, 'broadcast',
                  'text', ${scheduled.message_text}, NOW()
                )
              `.catch(() => {})
            } else {
              failed++
            }
          } catch {
            failed++
          }
          
          // Небольшая задержка между сообщениями
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        // Записываем в историю рассылок
        await sql`
          INSERT INTO support_broadcasts (
            id, message_type, message_text, filter_type, sender_name,
            channels_count, successful_count, failed_count, created_at
          ) VALUES (
            ${broadcastId}, ${scheduled.message_type}, ${scheduled.message_text},
            ${scheduled.filter_type}, ${scheduled.created_by || 'Scheduled'},
            ${channels.length}, ${successful}, ${failed}, NOW()
          )
        `.catch(() => {})

        // Обновляем статус запланированной рассылки
        await sql`
          UPDATE support_broadcast_scheduled 
          SET status = 'sent', sent_at = NOW(), broadcast_id = ${broadcastId}
          WHERE id = ${scheduled.id}
        `

        results.push({
          scheduledId: scheduled.id,
          broadcastId,
          success: true,
          channels: channels.length,
          successful,
          failed
        })

      } catch (e: any) {
        // Откатываем статус на failed
        await sql`
          UPDATE support_broadcast_scheduled 
          SET status = 'failed', error_message = ${e.message}
          WHERE id = ${scheduled.id}
        `
        
        results.push({
          scheduledId: scheduled.id,
          success: false,
          error: e.message
        })
      }
    }

    return json({
      success: true,
      message: `Executed ${results.length} scheduled broadcasts`,
      executed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    })

  } catch (e: any) {
    console.error('[Broadcast Execute Error]', e)
    return json({ success: false, error: e.message }, 500)
  }
}
