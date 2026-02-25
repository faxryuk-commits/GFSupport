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

/**
 * SLA Report API - Детальный отчёт по времени ответа и решению тикетов
 * 
 * GET /api/support/analytics/sla-report?from=2026-02-01&to=2026-02-10&sla_minutes=10
 */
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

  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const sql = getSQL()
  const url = new URL(req.url)
  
  // Parse parameters
  const fromDate = url.searchParams.get('from') || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const toDate = url.searchParams.get('to') || new Date().toISOString().split('T')[0]
  const slaMinutes = parseInt(url.searchParams.get('sla_minutes') || '10')
  
  const fromDateTime = `${fromDate}T00:00:00+05:00` // Tashkent timezone
  const toDateTime = `${toDate}T23:59:59+05:00`
  
  try {
    // =============================================
    // 1. ВРЕМЯ ПЕРВОГО ОТВЕТА - детальный список
    // =============================================
    const firstResponseData = await sql`
      WITH all_msgs AS (
        SELECT 
          m.id,
          m.channel_id,
          m.sender_name,
          m.text_content,
          m.created_at,
          m.sender_role,
          m.is_from_client,
          c.name as channel_name,
          LAG(m.sender_role) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_sender_role,
          LAG(m.is_from_client) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_is_from_client
        FROM support_messages m
        JOIN support_channels c ON c.id = m.channel_id
        WHERE m.created_at >= ${fromDateTime}::timestamptz - INTERVAL '24 hours'
          AND m.created_at <= ${toDateTime}::timestamptz
      ),
      client_messages AS (
        SELECT id, channel_id, sender_name as client_name, text_content, created_at as message_at, channel_name
        FROM all_msgs
        WHERE sender_role = 'client' AND is_from_client = true
          AND created_at >= ${fromDateTime}::timestamptz
          AND (
            prev_sender_role IS NULL
            OR prev_sender_role IN ('support', 'team', 'agent')
            OR prev_is_from_client = false
          )
          AND NOT (
            COALESCE(LENGTH(text_content), 0) <= 50
            AND LOWER(COALESCE(text_content, '')) ~ '(^|\\s)(хоп|ок|окей|рахмат|спасибо|тушунарли|хорошо|понял|ладно|rahmat|ok|okay|tushunarli|hop|хоп рахмат|ок рахмат|рахмат катта|катта рахмат|болди|хо[пр]|да|нет|йук|ха|хн|понятно|good|thanks|thank you|aни|hozir|тушундим)(\\s|$)'
          )
      ),
      first_responses AS (
        SELECT 
          cm.id as client_msg_id,
          cm.channel_id,
          cm.channel_name,
          cm.client_name,
          cm.text_content,
          cm.message_at,
          (
            SELECT m2.created_at 
            FROM support_messages m2 
            WHERE m2.channel_id = cm.channel_id
              AND m2.is_from_client = false
              AND m2.sender_role IN ('support', 'team', 'agent')
              AND m2.created_at > cm.message_at
              AND m2.created_at <= cm.message_at + INTERVAL '4 hours'
            ORDER BY m2.created_at ASC
            LIMIT 1
          ) as response_at,
          (
            SELECT m2.sender_name 
            FROM support_messages m2 
            WHERE m2.channel_id = cm.channel_id
              AND m2.is_from_client = false
              AND m2.sender_role IN ('support', 'team', 'agent')
              AND m2.created_at > cm.message_at
              AND m2.created_at <= cm.message_at + INTERVAL '4 hours'
            ORDER BY m2.created_at ASC
            LIMIT 1
          ) as responder_name
        FROM client_messages cm
      )
      SELECT 
        client_msg_id,
        channel_id,
        channel_name,
        client_name,
        text_content,
        message_at,
        response_at,
        responder_name,
        CASE 
          WHEN response_at IS NOT NULL 
          THEN ROUND(EXTRACT(EPOCH FROM (response_at - message_at)) / 60.0, 1)
          ELSE NULL 
        END as response_minutes
      FROM first_responses
      ORDER BY message_at DESC
      LIMIT 500
    `
    
    // =============================================
    // 2. ВРЕМЯ РЕШЕНИЯ ТИКЕТОВ - детальный список
    // =============================================
    const caseResolutionData = await sql`
      SELECT 
        c.id,
        c.ticket_number,
        c.title,
        c.status,
        c.priority,
        c.category,
        c.assigned_to,
        c.created_at,
        c.first_response_at,
        c.resolved_at,
        ch.name as channel_name,
        a.name as agent_name,
        CASE 
          WHEN c.first_response_at IS NOT NULL 
          THEN ROUND(EXTRACT(EPOCH FROM (c.first_response_at - c.created_at)) / 60.0, 1)
          ELSE NULL 
        END as first_response_minutes,
        CASE 
          WHEN c.resolved_at IS NOT NULL 
          THEN ROUND(EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)) / 60.0, 1)
          ELSE NULL 
        END as resolution_minutes,
        CASE 
          WHEN c.resolved_at IS NOT NULL 
          THEN ROUND(EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)) / 3600.0, 1)
          ELSE NULL 
        END as resolution_hours
      FROM support_cases c
      LEFT JOIN support_channels ch ON ch.id = c.channel_id
      LEFT JOIN support_agents a ON a.id::text = c.assigned_to::text
      WHERE c.created_at >= ${fromDateTime}::timestamptz
        AND c.created_at <= ${toDateTime}::timestamptz
      ORDER BY c.created_at DESC
      LIMIT 200
    `
    
    // =============================================
    // 3. СТАТИСТИКА ПО СОТРУДНИКАМ
    // =============================================
    const agentStatsData = await sql`
      SELECT 
        COALESCE(a.name, m.sender_name) as agent_name,
        COUNT(*) as total_responses,
        COUNT(DISTINCT m.channel_id) as channels_served,
        COUNT(DISTINCT DATE(m.created_at)) as active_days,
        AVG(
          CASE WHEN m.response_time_ms IS NOT NULL 
          THEN m.response_time_ms / 60000.0 
          ELSE NULL END
        ) as avg_response_minutes
      FROM support_messages m
      LEFT JOIN support_agents a ON a.telegram_id::text = m.sender_id::text OR a.id::text = m.sender_id::text
      WHERE m.is_from_client = false
        AND m.sender_role IN ('support', 'team', 'agent')
        AND m.created_at >= ${fromDateTime}::timestamptz
        AND m.created_at <= ${toDateTime}::timestamptz
      GROUP BY COALESCE(a.name, m.sender_name)
      ORDER BY total_responses DESC
    `
    
    // Детальная статистика по каждому сотруднику - время ответов
    const agentResponseTimes: Record<string, number[]> = {}
    
    for (const r of firstResponseData) {
      if (r.responder_name && r.response_minutes !== null) {
        if (!agentResponseTimes[r.responder_name]) {
          agentResponseTimes[r.responder_name] = []
        }
        agentResponseTimes[r.responder_name].push(parseFloat(r.response_minutes))
      }
    }
    
    const agentDetails = Object.entries(agentResponseTimes).map(([name, times]) => {
      const sorted = times.sort((a, b) => a - b)
      const withinSLA = times.filter(t => t <= slaMinutes).length
      return {
        name,
        totalResponses: times.length,
        withinSLA,
        violatedSLA: times.length - withinSLA,
        slaCompliance: times.length > 0 ? Math.round((withinSLA / times.length) * 100) : 100,
        avgMinutes: times.length > 0 ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10 : 0,
        minMinutes: sorted[0] || 0,
        maxMinutes: sorted[sorted.length - 1] || 0,
        medianMinutes: sorted[Math.floor(sorted.length / 2)] || 0,
      }
    }).sort((a, b) => b.totalResponses - a.totalResponses)
    
    // =============================================
    // 4. РАСЧЁТ МЕТРИК
    // =============================================
    const totalClientMessages = firstResponseData.length
    const respondedMessages = firstResponseData.filter((r: any) => r.response_at !== null)
    const withinSLA = respondedMessages.filter((r: any) => parseFloat(r.response_minutes) <= slaMinutes)
    const violatedSLA = respondedMessages.filter((r: any) => parseFloat(r.response_minutes) > slaMinutes)
    const noResponse = firstResponseData.filter((r: any) => r.response_at === null)
    
    const allResponseMinutes = respondedMessages.map((r: any) => parseFloat(r.response_minutes))
    const avgResponseMinutes = allResponseMinutes.length > 0
      ? Math.round((allResponseMinutes.reduce((a: number, b: number) => a + b, 0) / allResponseMinutes.length) * 10) / 10
      : 0
    
    const sortedTimes = [...allResponseMinutes].sort((a, b) => a - b)
    const medianResponseMinutes = sortedTimes.length > 0 
      ? sortedTimes[Math.floor(sortedTimes.length / 2)] 
      : 0
    
    // Метрики по кейсам
    const totalCases = caseResolutionData.length
    const resolvedCases = caseResolutionData.filter((c: any) => c.status === 'resolved' || c.status === 'closed')
    const openCases = caseResolutionData.filter((c: any) => c.status !== 'resolved' && c.status !== 'closed')
    
    const resolutionTimes = resolvedCases
      .filter((c: any) => c.resolution_minutes !== null)
      .map((c: any) => parseFloat(c.resolution_minutes))
    
    const avgResolutionMinutes = resolutionTimes.length > 0
      ? Math.round((resolutionTimes.reduce((a: number, b: number) => a + b, 0) / resolutionTimes.length) * 10) / 10
      : 0
    
    const avgResolutionHours = Math.round((avgResolutionMinutes / 60) * 10) / 10
    
    // =============================================
    // 5. ПОСЛЕДНИЕ СООБЩЕНИЯ БЕЗ ОТВЕТА
    // =============================================
    const unansweredMessages = noResponse.slice(0, 30).map((r: any) => ({
      channelName: r.channel_name,
      clientName: r.client_name,
      messagePreview: (r.text_content || '').slice(0, 100),
      messageAt: r.message_at,
      waitingMinutes: Math.round((Date.now() - new Date(r.message_at).getTime()) / 60000),
    }))
    
    // =============================================
    // 6. НАРУШЕНИЯ SLA - детальный список
    // =============================================
    const slaViolations = violatedSLA.slice(0, 50).map((r: any) => ({
      channelName: r.channel_name,
      clientName: r.client_name,
      messagePreview: (r.text_content || '').slice(0, 80),
      messageAt: r.message_at,
      responseAt: r.response_at,
      responseMinutes: parseFloat(r.response_minutes),
      responder: r.responder_name,
      exceededBy: Math.round((parseFloat(r.response_minutes) - slaMinutes) * 10) / 10,
    }))
    
    // =============================================
    // 7. ОТКРЫТЫЕ КЕЙСЫ - ожидающие решения
    // =============================================
    const pendingCases = openCases.slice(0, 30).map((c: any) => ({
      ticketNumber: c.ticket_number ? `CASE-${c.ticket_number}` : c.id,
      title: c.title,
      status: c.status,
      priority: c.priority,
      channelName: c.channel_name,
      agentName: c.agent_name,
      createdAt: c.created_at,
      waitingHours: Math.round((Date.now() - new Date(c.created_at).getTime()) / 3600000 * 10) / 10,
    }))
    
    // =============================================
    // 8. РАСПРЕДЕЛЕНИЕ ВРЕМЕНИ ОТВЕТА
    // =============================================
    const distribution = {
      within1min: respondedMessages.filter((r: any) => parseFloat(r.response_minutes) <= 1).length,
      within5min: respondedMessages.filter((r: any) => parseFloat(r.response_minutes) > 1 && parseFloat(r.response_minutes) <= 5).length,
      within10min: respondedMessages.filter((r: any) => parseFloat(r.response_minutes) > 5 && parseFloat(r.response_minutes) <= 10).length,
      within30min: respondedMessages.filter((r: any) => parseFloat(r.response_minutes) > 10 && parseFloat(r.response_minutes) <= 30).length,
      within60min: respondedMessages.filter((r: any) => parseFloat(r.response_minutes) > 30 && parseFloat(r.response_minutes) <= 60).length,
      over60min: respondedMessages.filter((r: any) => parseFloat(r.response_minutes) > 60).length,
      noResponse: noResponse.length,
    }

    return json({
      period: {
        from: fromDate,
        to: toDate,
        slaMinutes,
        timezone: 'Asia/Tashkent (UTC+5)',
      },
      
      // Сводка по времени ответа
      responseTimeSummary: {
        totalClientMessages,
        responded: respondedMessages.length,
        withinSLA: withinSLA.length,
        violatedSLA: violatedSLA.length,
        noResponse: noResponse.length,
        slaCompliancePercent: totalClientMessages > 0 
          ? Math.round((withinSLA.length / totalClientMessages) * 1000) / 10
          : 100,
        avgResponseMinutes,
        medianResponseMinutes: Math.round(medianResponseMinutes * 10) / 10,
        minResponseMinutes: sortedTimes[0] ? Math.round(sortedTimes[0] * 10) / 10 : 0,
        maxResponseMinutes: sortedTimes[sortedTimes.length - 1] ? Math.round(sortedTimes[sortedTimes.length - 1] * 10) / 10 : 0,
      },
      
      // Сводка по решению кейсов
      caseResolutionSummary: {
        totalCases,
        resolved: resolvedCases.length,
        open: openCases.length,
        resolutionRatePercent: totalCases > 0 
          ? Math.round((resolvedCases.length / totalCases) * 1000) / 10
          : 100,
        avgResolutionMinutes,
        avgResolutionHours,
      },
      
      // Распределение времени ответа
      responseDistribution: distribution,
      
      // Детализация по сотрудникам
      agentPerformance: agentDetails,
      
      // Нарушения SLA
      slaViolations,
      
      // Сообщения без ответа
      unansweredMessages,
      
      // Открытые кейсы
      pendingCases,
      
      // Решённые кейсы с временем
      resolvedCasesDetails: resolvedCases.slice(0, 30).map((c: any) => ({
        ticketNumber: c.ticket_number ? `CASE-${c.ticket_number}` : c.id,
        title: c.title,
        priority: c.priority,
        channelName: c.channel_name,
        agentName: c.agent_name,
        createdAt: c.created_at,
        resolvedAt: c.resolved_at,
        resolutionMinutes: c.resolution_minutes,
        resolutionHours: c.resolution_hours,
      })),
    })
    
  } catch (e: any) {
    console.error('[SLA Report] Error:', e)
    return json({ error: e.message }, 500)
  }
}
