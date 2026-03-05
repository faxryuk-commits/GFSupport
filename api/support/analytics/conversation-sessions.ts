import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge', maxDuration: 30 }

function getSQL() {
  const cs = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!cs) throw new Error('No database URL')
  return neon(cs)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const sql = getSQL()
  const url = new URL(req.url)
  const market = url.searchParams.get('market') || null
  const days = parseInt(url.searchParams.get('days') || '14')

  const marketFilter = market
    ? sql`AND c.market_id = ${market}`
    : sql``

  try {
    // 1. Общая статистика сообщений
    const [msgStats] = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE m.is_from_client = true) as from_clients,
        COUNT(*) FILTER (WHERE m.is_from_client = false) as from_agents,
        COUNT(*) FILTER (WHERE m.response_time_ms IS NOT NULL) as with_response,
        AVG(m.response_time_ms) FILTER (WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms < 86400000) as avg_response_ms,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m.response_time_ms)
          FILTER (WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms < 86400000) as median_response_ms,
        COUNT(DISTINCT m.channel_id) as active_channels
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.created_at > NOW() - INTERVAL '1 day' * ${days}
        ${marketFilter}
    `

    // 2. Каналы без ответа (ожидают > 30 мин)
    const unanswered = await sql`
      SELECT c.id, c.name, c.source, c.last_message_at,
        EXTRACT(EPOCH FROM (NOW() - c.last_message_at)) / 60 as waiting_minutes,
        (SELECT text_content FROM support_messages
         WHERE channel_id = c.id ORDER BY created_at DESC LIMIT 1) as last_text
      FROM support_channels c
      WHERE c.awaiting_reply = true
        AND c.last_message_at > NOW() - INTERVAL '7 day'
        AND c.is_active = true
        ${marketFilter}
      ORDER BY c.last_message_at ASC
      LIMIT 15
    `

    // 3. Скорость и нагрузка по сотрудникам
    const agentStats = await sql`
      SELECT
        a.name as agent_name,
        a.position,
        COUNT(*) as messages_sent,
        COUNT(DISTINCT m.channel_id) as channels_active,
        AVG(m.response_time_ms) FILTER (WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms < 86400000) as avg_response_ms,
        MIN(m.response_time_ms) FILTER (WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms > 0) as min_response_ms,
        MAX(m.response_time_ms) FILTER (WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms < 86400000) as max_response_ms,
        AVG(LENGTH(m.text_content)) FILTER (WHERE m.text_content IS NOT NULL AND LENGTH(m.text_content) > 0) as avg_message_length
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      JOIN support_agents a ON (
        LOWER(a.username) = LOWER(REPLACE(m.sender_username, '@', ''))
        OR LOWER(a.name) = LOWER(m.sender_name)
      )
      WHERE m.created_at > NOW() - INTERVAL '1 day' * ${days}
        AND m.is_from_client = false
        ${marketFilter}
      GROUP BY a.name, a.position
      ORDER BY messages_sent DESC
    `

    // 4. Нагрузка по часам (для определения пиков)
    const hourlyLoad = await sql`
      SELECT
        EXTRACT(HOUR FROM m.created_at AT TIME ZONE 'Asia/Tashkent') as hour,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE m.is_from_client = true) as client_msgs,
        COUNT(*) FILTER (WHERE m.is_from_client = false) as agent_msgs
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.created_at > NOW() - INTERVAL '1 day' * ${days}
        ${marketFilter}
      GROUP BY hour
      ORDER BY hour
    `

    // 5. Нагрузка по дням недели
    const weekdayLoad = await sql`
      SELECT
        EXTRACT(DOW FROM m.created_at AT TIME ZONE 'Asia/Tashkent') as dow,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE m.is_from_client = true) as client_msgs,
        COUNT(*) FILTER (WHERE m.is_from_client = false) as agent_msgs,
        AVG(m.response_time_ms) FILTER (WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms < 86400000) as avg_response_ms
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.created_at > NOW() - INTERVAL '1 day' * ${days}
        ${marketFilter}
      GROUP BY dow
      ORDER BY dow
    `

    // 6. Топ каналов по активности
    const topChannels = await sql`
      SELECT
        c.id, c.name, c.source,
        COUNT(*) as total_messages,
        COUNT(*) FILTER (WHERE m.is_from_client = true) as client_messages,
        COUNT(*) FILTER (WHERE m.is_from_client = false) as agent_messages,
        AVG(m.response_time_ms) FILTER (WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms < 86400000) as avg_response_ms,
        MAX(m.created_at) as last_activity
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.created_at > NOW() - INTERVAL '1 day' * ${days}
        ${marketFilter}
      GROUP BY c.id, c.name, c.source
      ORDER BY total_messages DESC
      LIMIT 10
    `

    // 7. Тренд по дням (сообщения + время ответа)
    const dailyTrend = await sql`
      SELECT
        DATE(m.created_at AT TIME ZONE 'Asia/Tashkent') as day,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE m.is_from_client = true) as incoming,
        COUNT(*) FILTER (WHERE m.is_from_client = false) as outgoing,
        AVG(m.response_time_ms) FILTER (WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms < 86400000) as avg_response_ms
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.created_at > NOW() - INTERVAL '1 day' * ${days}
        ${marketFilter}
      GROUP BY day
      ORDER BY day
    `

    // 8. Распределение тональности
    const sentimentStats = await sql`
      SELECT
        COALESCE(m.ai_sentiment, 'unknown') as sentiment,
        COUNT(*) as count
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.created_at > NOW() - INTERVAL '1 day' * ${days}
        AND m.is_from_client = true
        AND m.ai_sentiment IS NOT NULL
        ${marketFilter}
      GROUP BY sentiment
      ORDER BY count DESC
    `

    const avgResponseMin = msgStats.avg_response_ms
      ? Math.round(parseFloat(msgStats.avg_response_ms) / 60000)
      : null
    const medianResponseMin = msgStats.median_response_ms
      ? Math.round(parseFloat(msgStats.median_response_ms) / 60000)
      : null

    const DOW_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

    return json({
      overview: {
        totalMessages: parseInt(msgStats.total),
        fromClients: parseInt(msgStats.from_clients),
        fromAgents: parseInt(msgStats.from_agents),
        activeChannels: parseInt(msgStats.active_channels),
        avgResponseMin,
        medianResponseMin,
        unansweredCount: unanswered.length,
      },
      unanswered: unanswered.map((ch: any) => ({
        id: ch.id,
        name: ch.name || 'Без названия',
        source: ch.source || 'telegram',
        waitingMinutes: Math.round(parseFloat(ch.waiting_minutes) || 0),
        lastText: (ch.last_text || '').slice(0, 80),
      })),
      agentStats: agentStats.map((a: any) => ({
        name: a.agent_name,
        position: a.position || '',
        messagesSent: parseInt(a.messages_sent),
        channelsActive: parseInt(a.channels_active),
        avgResponseMin: a.avg_response_ms ? Math.round(parseFloat(a.avg_response_ms) / 60000) : null,
        minResponseMin: a.min_response_ms ? Math.round(parseFloat(a.min_response_ms) / 60000) : null,
        maxResponseMin: a.max_response_ms ? Math.round(parseFloat(a.max_response_ms) / 60000) : null,
        avgMessageLength: a.avg_message_length ? Math.round(parseFloat(a.avg_message_length)) : 0,
      })),
      hourlyLoad: hourlyLoad.map((h: any) => ({
        hour: parseInt(h.hour),
        total: parseInt(h.total),
        clientMsgs: parseInt(h.client_msgs),
        agentMsgs: parseInt(h.agent_msgs),
      })),
      weekdayLoad: weekdayLoad.map((w: any) => ({
        dow: parseInt(w.dow),
        label: DOW_NAMES[parseInt(w.dow)] || '?',
        total: parseInt(w.total),
        clientMsgs: parseInt(w.client_msgs),
        agentMsgs: parseInt(w.agent_msgs),
        avgResponseMin: w.avg_response_ms ? Math.round(parseFloat(w.avg_response_ms) / 60000) : null,
      })),
      topChannels: topChannels.map((ch: any) => ({
        id: ch.id,
        name: ch.name || 'Без названия',
        source: ch.source || 'telegram',
        totalMessages: parseInt(ch.total_messages),
        clientMessages: parseInt(ch.client_messages),
        agentMessages: parseInt(ch.agent_messages),
        avgResponseMin: ch.avg_response_ms ? Math.round(parseFloat(ch.avg_response_ms) / 60000) : null,
        lastActivity: ch.last_activity,
      })),
      dailyTrend: dailyTrend.map((d: any) => ({
        day: d.day,
        total: parseInt(d.total),
        incoming: parseInt(d.incoming),
        outgoing: parseInt(d.outgoing),
        avgResponseMin: d.avg_response_ms ? Math.round(parseFloat(d.avg_response_ms) / 60000) : null,
      })),
      sentimentStats: sentimentStats.map((s: any) => ({
        sentiment: s.sentiment,
        count: parseInt(s.count),
      })),
    })
  } catch (e: any) {
    console.error('[CommAnalytics]', e.message)
    return json({ error: e.message || 'Internal error' }, 500)
  }
}
