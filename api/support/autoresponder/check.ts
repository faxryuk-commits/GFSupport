import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
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

// Проверка рабочего времени (Ташкент UTC+5)
function isWorkingHours(): boolean {
  const now = new Date()
  // UTC+5 для Ташкента
  const tashkentHour = (now.getUTCHours() + 5) % 24
  const dayOfWeek = now.getUTCDay() // 0 = Sunday, 6 = Saturday
  
  // Рабочие часы: 08:00 - 22:00, Пн-Сб
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 6
  const isWorkHour = tashkentHour >= 8 && tashkentHour < 22
  
  return isWeekday && isWorkHour
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  const sql = getSQL()
  
  try {
    // Проверяем настройки автоответчика
    const settings = await sql`
      SELECT value FROM support_settings WHERE key = 'autoresponder_enabled'
    `.catch(() => [])
    
    const autoresponderEnabled = settings[0]?.value === 'true'
    
    // Получаем онлайн агентов (через активные сессии)
    const onlineAgents = await sql`
      SELECT DISTINCT a.id, a.name 
      FROM support_agents a
      LEFT JOIN support_agent_sessions s ON s.agent_id = a.id
      WHERE a.status = 'online' 
        AND (s.ended_at IS NULL OR s.ended_at > NOW() - INTERVAL '10 minutes')
    `
    
    const allOffline = onlineAgents.length === 0
    const isNightOrWeekend = !isWorkingHours()
    
    // Получаем сообщения без ответа > 5 мин
    const unansweredMessages = await sql`
      SELECT 
        m.id,
        m.channel_id,
        m.text_content,
        m.sender_name,
        m.created_at,
        c.name as channel_name,
        c.telegram_chat_id,
        EXTRACT(EPOCH FROM (NOW() - m.created_at)) / 60 as waiting_minutes
      FROM support_messages m
      JOIN support_channels c ON c.id = m.channel_id
      WHERE m.is_from_client = true
        AND m.created_at > NOW() - INTERVAL '1 hour'
        AND NOT EXISTS (
          SELECT 1 FROM support_messages m2 
          WHERE m2.channel_id = m.channel_id 
            AND m2.is_from_client = false 
            AND m2.created_at > m.created_at
        )
      ORDER BY m.created_at ASC
    `
    
    // Фильтруем сообщения которые ждут > 5 минут
    const needsResponse = unansweredMessages.filter((m: any) => m.waiting_minutes >= 5)
    
    // Определяем нужен ли автоответ
    const shouldAutoRespond = autoresponderEnabled && (allOffline || isNightOrWeekend || needsResponse.length > 0)
    
    return json({
      success: true,
      status: {
        autoresponderEnabled,
        isWorkingHours: !isNightOrWeekend,
        onlineAgentsCount: onlineAgents.length,
        allOffline,
        shouldAutoRespond
      },
      unansweredMessages: needsResponse.map((m: any) => ({
        id: m.id,
        channelId: m.channel_id,
        channelName: m.channel_name,
        telegramChatId: m.telegram_chat_id,
        text: m.text_content?.slice(0, 200),
        senderName: m.sender_name,
        waitingMinutes: Math.round(m.waiting_minutes),
        createdAt: m.created_at
      }))
    })
    
  } catch (error: any) {
    console.error('[Autoresponder Check Error]', error)
    return json({ success: false, error: error.message }, 500)
  }
}
