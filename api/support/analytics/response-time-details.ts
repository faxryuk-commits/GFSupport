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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const sql = getSQL()
  const url = new URL(req.url)
  const bucket = url.searchParams.get('bucket') || 'all' // 5min, 10min, 30min, 60min, 60plus, all
  const period = url.searchParams.get('period') || '30d'
  const limit = parseInt(url.searchParams.get('limit') || '50')
  
  const periodDays = period === '7d' ? 7 : period === '90d' ? 90 : 30
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - periodDays)

  try {
    // Определяем границы интервала в минутах
    let minMinutes = 0
    let maxMinutes = 999999
    
    switch (bucket) {
      case '5min':
      case 'до 5 мин':
        maxMinutes = 5
        break
      case '10min':
      case 'до 10 мин':
        minMinutes = 5
        maxMinutes = 10
        break
      case '30min':
      case 'до 30 мин':
        minMinutes = 10
        maxMinutes = 30
        break
      case '60min':
      case 'до 1 часа':
        minMinutes = 30
        maxMinutes = 60
        break
      case '60plus':
      case 'более 1 часа':
        minMinutes = 60
        break
    }

    // Получаем детальные данные о времени первого ответа
    const details = await sql`
      WITH client_messages AS (
        -- Все сообщения от клиентов за период
        SELECT 
          m.id as client_message_id,
          m.channel_id,
          m.text as client_message,
          m.created_at as client_msg_at,
          m.sender_name as client_name,
          m.sender_id as client_sender_id
        FROM support_messages m
        WHERE m.created_at >= ${startDate.toISOString()}
          AND (m.sender_role = 'client' OR m.is_from_client = true)
      ),
      response_times AS (
        -- Находим первый ответ от команды на каждое сообщение клиента
        SELECT 
          cm.client_message_id,
          cm.channel_id,
          cm.client_message,
          cm.client_msg_at,
          cm.client_name,
          (
            SELECT sm.id
            FROM support_messages sm
            WHERE sm.channel_id = cm.channel_id
              AND sm.created_at > cm.client_msg_at
              AND (sm.sender_role IN ('support', 'team', 'agent') OR sm.is_from_client = false)
            ORDER BY sm.created_at ASC
            LIMIT 1
          ) as response_message_id,
          (
            SELECT MIN(created_at)
            FROM support_messages sm
            WHERE sm.channel_id = cm.channel_id
              AND sm.created_at > cm.client_msg_at
              AND (sm.sender_role IN ('support', 'team', 'agent') OR sm.is_from_client = false)
          ) as response_at
        FROM client_messages cm
      )
      SELECT 
        rt.client_message_id,
        rt.channel_id,
        ch.name as channel_name,
        ch.company_name,
        ch.photo_url as channel_photo,
        rt.client_name,
        rt.client_message,
        rt.client_msg_at,
        rm.text as response_message,
        rm.sender_name as responder_name,
        rm.sender_id as responder_id,
        rt.response_at,
        EXTRACT(EPOCH FROM (rt.response_at - rt.client_msg_at)) / 60 as response_minutes,
        CASE 
          WHEN rm.text ILIKE '%эскал%' OR rm.text ILIKE '%передаю%' OR rm.text ILIKE '%перенаправ%'
          THEN true 
          ELSE false 
        END as was_escalated
      FROM response_times rt
      JOIN support_channels ch ON rt.channel_id = ch.id
      LEFT JOIN support_messages rm ON rm.id = rt.response_message_id
      WHERE rt.response_at IS NOT NULL
        AND EXTRACT(EPOCH FROM (rt.response_at - rt.client_msg_at)) / 60 >= ${minMinutes}
        AND EXTRACT(EPOCH FROM (rt.response_at - rt.client_msg_at)) / 60 < ${maxMinutes}
      ORDER BY response_minutes DESC
      LIMIT ${limit}
    `

    // Статистика по интервалу
    const statsResult = await sql`
      WITH client_messages AS (
        SELECT 
          m.id,
          m.channel_id,
          m.created_at as client_msg_at,
          m.sender_name
        FROM support_messages m
        WHERE m.created_at >= ${startDate.toISOString()}
          AND (m.sender_role = 'client' OR m.is_from_client = true)
      ),
      response_times AS (
        SELECT 
          cm.id,
          cm.channel_id,
          cm.sender_name,
          (
            SELECT MIN(created_at)
            FROM support_messages sm
            WHERE sm.channel_id = cm.channel_id
              AND sm.created_at > cm.client_msg_at
              AND (sm.sender_role IN ('support', 'team', 'agent') OR sm.is_from_client = false)
          ) as response_at,
          (
            SELECT sender_name
            FROM support_messages sm
            WHERE sm.channel_id = cm.channel_id
              AND sm.created_at > cm.client_msg_at
              AND (sm.sender_role IN ('support', 'team', 'agent') OR sm.is_from_client = false)
            ORDER BY sm.created_at ASC
            LIMIT 1
          ) as responder_name,
          cm.client_msg_at
        FROM client_messages cm
      ),
      filtered_responses AS (
        SELECT 
          *,
          EXTRACT(EPOCH FROM (response_at - client_msg_at)) / 60 as response_minutes
        FROM response_times
        WHERE response_at IS NOT NULL
          AND EXTRACT(EPOCH FROM (response_at - client_msg_at)) / 60 >= ${minMinutes}
          AND EXTRACT(EPOCH FROM (response_at - client_msg_at)) / 60 < ${maxMinutes}
      )
      SELECT 
        COUNT(*) as total_count,
        AVG(response_minutes) as avg_minutes,
        MIN(response_minutes) as min_minutes,
        MAX(response_minutes) as max_minutes,
        COUNT(DISTINCT responder_name) as unique_responders,
        COUNT(DISTINCT channel_id) as unique_channels
      FROM filtered_responses
    `

    const stats = statsResult[0] || {}

    // Топ операторов в этом интервале
    const topResponders = await sql`
      WITH client_messages AS (
        SELECT 
          m.id,
          m.channel_id,
          m.created_at as client_msg_at
        FROM support_messages m
        WHERE m.created_at >= ${startDate.toISOString()}
          AND (m.sender_role = 'client' OR m.is_from_client = true)
      ),
      response_times AS (
        SELECT 
          cm.id,
          cm.channel_id,
          (
            SELECT sender_name
            FROM support_messages sm
            WHERE sm.channel_id = cm.channel_id
              AND sm.created_at > cm.client_msg_at
              AND (sm.sender_role IN ('support', 'team', 'agent') OR sm.is_from_client = false)
            ORDER BY sm.created_at ASC
            LIMIT 1
          ) as responder_name,
          (
            SELECT MIN(created_at)
            FROM support_messages sm
            WHERE sm.channel_id = cm.channel_id
              AND sm.created_at > cm.client_msg_at
              AND (sm.sender_role IN ('support', 'team', 'agent') OR sm.is_from_client = false)
          ) as response_at,
          cm.client_msg_at
        FROM client_messages cm
      ),
      filtered_responses AS (
        SELECT 
          responder_name,
          EXTRACT(EPOCH FROM (response_at - client_msg_at)) / 60 as response_minutes
        FROM response_times
        WHERE response_at IS NOT NULL
          AND responder_name IS NOT NULL
          AND EXTRACT(EPOCH FROM (response_at - client_msg_at)) / 60 >= ${minMinutes}
          AND EXTRACT(EPOCH FROM (response_at - client_msg_at)) / 60 < ${maxMinutes}
      )
      SELECT 
        responder_name,
        COUNT(*) as response_count,
        AVG(response_minutes) as avg_minutes
      FROM filtered_responses
      GROUP BY responder_name
      ORDER BY response_count DESC
      LIMIT 10
    `

    return json({
      bucket,
      period,
      periodDays,
      stats: {
        totalCount: parseInt(stats.total_count || '0'),
        avgMinutes: Math.round(parseFloat(stats.avg_minutes || '0')),
        minMinutes: Math.round(parseFloat(stats.min_minutes || '0')),
        maxMinutes: Math.round(parseFloat(stats.max_minutes || '0')),
        uniqueResponders: parseInt(stats.unique_responders || '0'),
        uniqueChannels: parseInt(stats.unique_channels || '0'),
      },
      topResponders: topResponders.map((r: any) => ({
        name: r.responder_name,
        count: parseInt(r.response_count),
        avgMinutes: Math.round(parseFloat(r.avg_minutes || '0')),
      })),
      details: details.map((d: any) => ({
        id: d.client_message_id,
        channelId: d.channel_id,
        channelName: d.channel_name || 'Неизвестный канал',
        companyName: d.company_name || d.channel_name || 'Неизвестная компания',
        channelPhoto: d.channel_photo,
        clientName: d.client_name || 'Клиент',
        clientMessage: d.client_message || '',
        clientMessageTime: d.client_msg_at,
        responderName: d.responder_name || 'Оператор',
        responseMessage: d.response_message || '',
        responseTime: d.response_at,
        responseMinutes: Math.round(parseFloat(d.response_minutes || '0')),
        wasEscalated: d.was_escalated || false,
      })),
    })
  } catch (error: any) {
    console.error('Response time details error:', error)
    return json({ 
      error: 'Internal server error', 
      message: error.message,
      bucket,
      period 
    }, 500)
  }
}
