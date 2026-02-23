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
  const bucket = url.searchParams.get('bucket') || 'all'
  const period = url.searchParams.get('period') || '30d'
  const limit = parseInt(url.searchParams.get('limit') || '50')
  const slaCategory = url.searchParams.get('sla_category') || null
  const customFrom = url.searchParams.get('from')
  const customTo = url.searchParams.get('to')
  
  let startDate: Date
  let endDate: Date = new Date()
  
  if (customFrom && customTo) {
    startDate = new Date(customFrom)
    endDate = new Date(customTo)
    endDate.setHours(23, 59, 59, 999)
  } else {
    let periodDays: number
    switch (period) {
      case 'today': periodDays = 1; break
      case 'yesterday': periodDays = 2; break
      case 'week':
      case '7d': periodDays = 7; break
      case 'month':
      case '30d': periodDays = 30; break
      case '90d': periodDays = 90; break
      default: periodDays = 30
    }
    startDate = new Date()
    startDate.setDate(startDate.getDate() - periodDays)
  }

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

    // Если есть фильтр по SLA категории, получаем ID каналов
    let channelFilter: string[] = []
    if (slaCategory) {
      const catChannels = await sql`
        SELECT id FROM support_channels WHERE sla_category = ${slaCategory}
      `
      channelFilter = catChannels.map((c: any) => c.id)
      if (channelFilter.length === 0) {
        return json({ bucket, period, slaCategory, stats: {}, topResponders: [], details: [], messages: [] })
      }
    }

    // Получаем детальные данные о времени первого ответа
    // Считаем только ПЕРВОЕ сообщение клиента в серии (до ответа сотрудника)
    const useChannelFilter = channelFilter.length > 0
    const details = await sql`
      WITH all_channel_messages AS (
        SELECT 
          m.id,
          m.channel_id,
          m.text_content,
          m.created_at,
          m.sender_name,
          m.sender_id,
          m.sender_role,
          m.is_from_client,
          LAG(m.sender_role) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_sender_role,
          LAG(m.is_from_client) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_is_from_client
        FROM support_messages m
        WHERE m.created_at >= ${startDate.toISOString()}
          AND m.created_at <= ${endDate.toISOString()}
          AND (${!useChannelFilter} OR m.channel_id = ANY(${channelFilter.length > 0 ? channelFilter : ['__none__']}))
      ),
      client_messages AS (
        SELECT 
          id as client_message_id,
          channel_id,
          text_content as client_message,
          created_at as client_msg_at,
          sender_name as client_name,
          sender_id as client_sender_id
        FROM all_channel_messages
        WHERE sender_role = 'client'
          AND is_from_client = true
          AND (
            prev_sender_role IS NULL
            OR prev_sender_role IN ('support', 'team', 'agent')
            OR prev_is_from_client = false
          )
      ),
      response_times AS (
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
              AND sm.created_at <= cm.client_msg_at + INTERVAL '24 hours'
              AND sm.sender_role IN ('support', 'team', 'agent')
              AND sm.is_from_client = false
            ORDER BY sm.created_at ASC
            LIMIT 1
          ) as response_message_id,
          (
            SELECT MIN(created_at)
            FROM support_messages sm
            WHERE sm.channel_id = cm.channel_id
              AND sm.created_at > cm.client_msg_at
              AND sm.created_at <= cm.client_msg_at + INTERVAL '24 hours'
              AND sm.sender_role IN ('support', 'team', 'agent')
              AND sm.is_from_client = false
          ) as response_at
        FROM client_messages cm
      )
      SELECT 
        rt.client_message_id,
        rt.channel_id,
        ch.name as channel_name,
        ch.photo_url as channel_photo,
        rt.client_name,
        rt.client_message,
        rt.client_msg_at,
        rm.text_content as response_message,
        rm.sender_name as responder_name,
        rm.sender_id as responder_id,
        rt.response_at,
        EXTRACT(EPOCH FROM (rt.response_at - rt.client_msg_at)) / 60 as response_minutes,
        CASE 
          WHEN rm.text_content ILIKE '%эскал%' OR rm.text_content ILIKE '%передаю%' OR rm.text_content ILIKE '%перенаправ%'
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

    // Статистика по интервалу (только первое сообщение клиента в серии)
    const statsResult = await sql`
      WITH all_msgs AS (
        SELECT 
          m.id, m.channel_id, m.created_at, m.sender_name, m.sender_role, m.is_from_client,
          LAG(m.sender_role) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_role,
          LAG(m.is_from_client) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_client
        FROM support_messages m
        WHERE m.created_at >= ${startDate.toISOString()}
          AND m.created_at <= ${endDate.toISOString()}
      ),
      first_client AS (
        SELECT id, channel_id, created_at as client_msg_at, sender_name
        FROM all_msgs
        WHERE sender_role = 'client' AND is_from_client = true
          AND (prev_role IS NULL OR prev_role IN ('support', 'team', 'agent') OR prev_client = false)
      ),
      response_times AS (
        SELECT 
          cm.id, cm.channel_id, cm.sender_name,
          (SELECT MIN(created_at) FROM support_messages sm
           WHERE sm.channel_id = cm.channel_id AND sm.created_at > cm.client_msg_at
             AND sm.created_at <= cm.client_msg_at + INTERVAL '24 hours'
             AND sm.sender_role IN ('support', 'team', 'agent') AND sm.is_from_client = false
          ) as response_at,
          (SELECT sender_name FROM support_messages sm
           WHERE sm.channel_id = cm.channel_id AND sm.created_at > cm.client_msg_at
             AND sm.created_at <= cm.client_msg_at + INTERVAL '24 hours'
             AND sm.sender_role IN ('support', 'team', 'agent') AND sm.is_from_client = false
           ORDER BY sm.created_at ASC LIMIT 1
          ) as responder_name,
          cm.client_msg_at
        FROM first_client cm
      ),
      filtered_responses AS (
        SELECT *, EXTRACT(EPOCH FROM (response_at - client_msg_at)) / 60 as response_minutes
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

    // Топ операторов в этом интервале (только первое сообщение клиента в серии)
    const topResponders = await sql`
      WITH all_msgs AS (
        SELECT 
          m.id, m.channel_id, m.created_at, m.sender_role, m.is_from_client,
          LAG(m.sender_role) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_role,
          LAG(m.is_from_client) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_client
        FROM support_messages m
        WHERE m.created_at >= ${startDate.toISOString()}
          AND m.created_at <= ${endDate.toISOString()}
      ),
      first_client AS (
        SELECT id, channel_id, created_at as client_msg_at
        FROM all_msgs
        WHERE sender_role = 'client' AND is_from_client = true
          AND (prev_role IS NULL OR prev_role IN ('support', 'team', 'agent') OR prev_client = false)
      ),
      response_times AS (
        SELECT 
          cm.id, cm.channel_id,
          (SELECT sender_name FROM support_messages sm
           WHERE sm.channel_id = cm.channel_id AND sm.created_at > cm.client_msg_at
             AND sm.created_at <= cm.client_msg_at + INTERVAL '24 hours'
             AND sm.sender_role IN ('support', 'team', 'agent') AND sm.is_from_client = false
           ORDER BY sm.created_at ASC LIMIT 1
          ) as responder_name,
          (SELECT MIN(created_at) FROM support_messages sm
           WHERE sm.channel_id = cm.channel_id AND sm.created_at > cm.client_msg_at
             AND sm.created_at <= cm.client_msg_at + INTERVAL '24 hours'
             AND sm.sender_role IN ('support', 'team', 'agent') AND sm.is_from_client = false
          ) as response_at,
          cm.client_msg_at
        FROM first_client cm
      ),
      filtered_responses AS (
        SELECT responder_name,
          EXTRACT(EPOCH FROM (response_at - client_msg_at)) / 60 as response_minutes
        FROM response_times
        WHERE response_at IS NOT NULL AND responder_name IS NOT NULL
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

    const mappedDetails = details.map((d: any) => ({
      id: d.client_message_id,
      channelId: d.channel_id,
      channelName: d.channel_name || 'Неизвестный канал',
      companyName: d.channel_name || 'Неизвестная компания',
      channelPhoto: d.channel_photo,
      clientName: d.client_name || 'Клиент',
      clientMessage: d.client_message || '',
      clientMessageTime: d.client_msg_at,
      responderName: d.responder_name || 'Оператор',
      responseMessage: d.response_message || '',
      responseTime: d.response_at,
      responseMinutes: Math.round(parseFloat(d.response_minutes || '0')),
      wasEscalated: d.was_escalated || false,
      // Alias fields for SLA category modal
      senderName: d.client_name || 'Клиент',
      textPreview: (d.client_message || '').slice(0, 80),
      messageAt: d.client_msg_at,
      respondedAt: d.response_at,
      responderNameShort: d.responder_name || '-',
    }))

    return json({
      bucket,
      period,
      slaCategory,
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
      details: mappedDetails,
      messages: mappedDetails,
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
