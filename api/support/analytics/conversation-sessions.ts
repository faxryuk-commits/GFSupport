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

async function safeQuery(sql: any, query: Promise<any[]>, fallback: any = []): Promise<any> {
  try { return await query } catch (e: any) { console.error('[CommQ]', e.message); return fallback }
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

  try {
    // 1. Общая статистика
    const msgStatsRows = await safeQuery(sql, sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE m.is_from_client = true)::int as from_clients,
        COUNT(*) FILTER (WHERE m.is_from_client = false)::int as from_agents,
        ROUND(AVG(m.response_time_ms) FILTER (WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms < 86400000))::int as avg_response_ms,
        COUNT(DISTINCT m.channel_id)::int as active_channels
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.created_at > NOW() - INTERVAL '1 day' * ${days}
        AND (${market}::text IS NULL OR c.market_id = ${market})
    `, [{}])
    const ms = msgStatsRows[0] || {}

    // 2. Каналы без ответа
    const unanswered = await safeQuery(sql, sql`
      SELECT c.id, c.name,
        COALESCE(c.source, 'telegram') as source,
        ROUND(EXTRACT(EPOCH FROM (NOW() - c.last_message_at)) / 60)::int as waiting_minutes
      FROM support_channels c
      WHERE COALESCE(c.awaiting_reply, false) = true
        AND c.last_message_at > NOW() - INTERVAL '7 day'
        AND COALESCE(c.is_active, true) = true
        AND (${market}::text IS NULL OR c.market_id = ${market})
      ORDER BY c.last_message_at ASC
      LIMIT 15
    `)

    // 3. По сотрудникам
    const agentStats = await safeQuery(sql, sql`
      SELECT
        a.name as agent_name,
        COALESCE(a.position, '') as position,
        COUNT(*)::int as messages_sent,
        COUNT(DISTINCT m.channel_id)::int as channels_active,
        ROUND(AVG(m.response_time_ms) FILTER (WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms < 86400000))::int as avg_response_ms,
        ROUND(MIN(m.response_time_ms) FILTER (WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms > 0))::int as min_response_ms,
        ROUND(MAX(m.response_time_ms) FILTER (WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms < 86400000))::int as max_response_ms,
        ROUND(AVG(LENGTH(COALESCE(m.text_content, ''))) FILTER (WHERE m.text_content IS NOT NULL AND LENGTH(m.text_content) > 0))::int as avg_msg_len
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      JOIN support_agents a ON LOWER(a.name) = LOWER(m.sender_name)
      WHERE m.created_at > NOW() - INTERVAL '1 day' * ${days}
        AND m.is_from_client = false
        AND (${market}::text IS NULL OR c.market_id = ${market})
      GROUP BY a.name, a.position
      ORDER BY messages_sent DESC
      LIMIT 20
    `)

    // 4. По часам
    const hourlyLoad = await safeQuery(sql, sql`
      SELECT
        EXTRACT(HOUR FROM m.created_at AT TIME ZONE 'Asia/Tashkent')::int as hour,
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE m.is_from_client = true)::int as client_msgs,
        COUNT(*) FILTER (WHERE m.is_from_client = false)::int as agent_msgs
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.created_at > NOW() - INTERVAL '1 day' * ${days}
        AND (${market}::text IS NULL OR c.market_id = ${market})
      GROUP BY 1 ORDER BY 1
    `)

    // 5. По дням недели
    const weekdayLoad = await safeQuery(sql, sql`
      SELECT
        EXTRACT(DOW FROM m.created_at AT TIME ZONE 'Asia/Tashkent')::int as dow,
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE m.is_from_client = true)::int as client_msgs,
        COUNT(*) FILTER (WHERE m.is_from_client = false)::int as agent_msgs,
        ROUND(AVG(m.response_time_ms) FILTER (WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms < 86400000))::int as avg_response_ms
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.created_at > NOW() - INTERVAL '1 day' * ${days}
        AND (${market}::text IS NULL OR c.market_id = ${market})
      GROUP BY 1 ORDER BY 1
    `)

    // 6. Топ каналов
    const topChannels = await safeQuery(sql, sql`
      SELECT
        c.id, c.name, COALESCE(c.source, 'telegram') as source,
        COUNT(*)::int as total_messages,
        COUNT(*) FILTER (WHERE m.is_from_client = true)::int as client_messages,
        COUNT(*) FILTER (WHERE m.is_from_client = false)::int as agent_messages,
        ROUND(AVG(m.response_time_ms) FILTER (WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms < 86400000))::int as avg_response_ms
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.created_at > NOW() - INTERVAL '1 day' * ${days}
        AND (${market}::text IS NULL OR c.market_id = ${market})
      GROUP BY c.id, c.name, c.source
      ORDER BY total_messages DESC
      LIMIT 10
    `)

    // 7. Тренд по дням
    const dailyTrend = await safeQuery(sql, sql`
      SELECT
        TO_CHAR(DATE(m.created_at AT TIME ZONE 'Asia/Tashkent'), 'YYYY-MM-DD') as day,
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE m.is_from_client = true)::int as incoming,
        COUNT(*) FILTER (WHERE m.is_from_client = false)::int as outgoing,
        ROUND(AVG(m.response_time_ms) FILTER (WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms < 86400000))::int as avg_response_ms
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.created_at > NOW() - INTERVAL '1 day' * ${days}
        AND (${market}::text IS NULL OR c.market_id = ${market})
      GROUP BY 1 ORDER BY 1
    `)

    const DOW_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
    const avgRespMs = parseInt(ms.avg_response_ms) || 0

    return json({
      overview: {
        totalMessages: parseInt(ms.total) || 0,
        fromClients: parseInt(ms.from_clients) || 0,
        fromAgents: parseInt(ms.from_agents) || 0,
        activeChannels: parseInt(ms.active_channels) || 0,
        avgResponseMin: avgRespMs > 0 ? Math.round(avgRespMs / 60000) : null,
        unansweredCount: unanswered.length,
      },
      unanswered: unanswered.map((ch: any) => ({
        id: ch.id,
        name: ch.name || 'Без названия',
        source: ch.source || 'telegram',
        waitingMinutes: parseInt(ch.waiting_minutes) || 0,
      })),
      agentStats: agentStats.map((a: any) => ({
        name: a.agent_name,
        position: a.position || '',
        messagesSent: parseInt(a.messages_sent) || 0,
        channelsActive: parseInt(a.channels_active) || 0,
        avgResponseMin: a.avg_response_ms ? Math.round(parseInt(a.avg_response_ms) / 60000) : null,
        minResponseMin: a.min_response_ms ? Math.round(parseInt(a.min_response_ms) / 60000) : null,
        maxResponseMin: a.max_response_ms ? Math.round(parseInt(a.max_response_ms) / 60000) : null,
        avgMessageLength: parseInt(a.avg_msg_len) || 0,
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
        avgResponseMin: w.avg_response_ms ? Math.round(parseInt(w.avg_response_ms) / 60000) : null,
      })),
      topChannels: topChannels.map((ch: any) => ({
        id: ch.id,
        name: ch.name || 'Без названия',
        source: ch.source || 'telegram',
        totalMessages: parseInt(ch.total_messages),
        clientMessages: parseInt(ch.client_messages),
        agentMessages: parseInt(ch.agent_messages),
        avgResponseMin: ch.avg_response_ms ? Math.round(parseInt(ch.avg_response_ms) / 60000) : null,
      })),
      dailyTrend: dailyTrend.map((d: any) => ({
        day: d.day,
        total: parseInt(d.total),
        incoming: parseInt(d.incoming),
        outgoing: parseInt(d.outgoing),
        avgResponseMin: d.avg_response_ms ? Math.round(parseInt(d.avg_response_ms) / 60000) : null,
      })),
    })
  } catch (e: any) {
    console.error('[CommAnalytics] Fatal:', e.message)
    return json({ error: e.message || 'Internal error' }, 500)
  }
}
