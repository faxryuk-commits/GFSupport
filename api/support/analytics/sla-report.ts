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
 * SLA Report API
 * 
 * GET /api/support/analytics/sla-report?from=2026-02-01&to=2026-02-10&sla_minutes=10
 * 
 * Returns:
 * - Overall SLA compliance (% of responses within SLA)
 * - Response time distribution
 * - Per-agent breakdown
 * - Case resolution stats
 * - Channels/clients with SLA violations
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
  
  // Add time to dates for proper range
  const fromDateTime = `${fromDate}T00:00:00Z`
  const toDateTime = `${toDate}T23:59:59Z`
  
  try {
    // 1. Calculate first response times for all client messages in period
    const responseTimeData = await sql`
      WITH client_messages AS (
        SELECT 
          m.id,
          m.channel_id,
          m.sender_name as client_name,
          m.created_at as message_at,
          c.name as channel_name
        FROM support_messages m
        JOIN support_channels c ON c.id = m.channel_id
        WHERE m.is_from_client = true
          AND m.created_at >= ${fromDateTime}::timestamptz
          AND m.created_at <= ${toDateTime}::timestamptz
      ),
      first_responses AS (
        SELECT 
          cm.id as client_msg_id,
          cm.channel_id,
          cm.channel_name,
          cm.client_name,
          cm.message_at,
          MIN(m.created_at) as response_at,
          MIN(m.sender_name) as responder_name
        FROM client_messages cm
        LEFT JOIN support_messages m ON m.channel_id = cm.channel_id
          AND m.is_from_client = false
          AND m.sender_role IN ('support', 'team', 'agent')
          AND m.created_at > cm.message_at
          AND m.created_at < cm.message_at + INTERVAL '24 hours'
        GROUP BY cm.id, cm.channel_id, cm.channel_name, cm.client_name, cm.message_at
      )
      SELECT 
        client_msg_id,
        channel_id,
        channel_name,
        client_name,
        message_at,
        response_at,
        responder_name,
        CASE 
          WHEN response_at IS NOT NULL 
          THEN EXTRACT(EPOCH FROM (response_at - message_at)) / 60.0
          ELSE NULL 
        END as response_minutes
      FROM first_responses
      ORDER BY message_at DESC
    `
    
    // 2. Calculate SLA metrics
    const totalMessages = responseTimeData.length
    const respondedMessages = responseTimeData.filter((r: any) => r.response_at !== null)
    const withinSLA = respondedMessages.filter((r: any) => r.response_minutes <= slaMinutes)
    const violatedSLA = respondedMessages.filter((r: any) => r.response_minutes > slaMinutes)
    const noResponse = responseTimeData.filter((r: any) => r.response_at === null)
    
    const avgResponseMinutes = respondedMessages.length > 0
      ? respondedMessages.reduce((sum: number, r: any) => sum + r.response_minutes, 0) / respondedMessages.length
      : 0
    
    const slaCompliance = totalMessages > 0 
      ? (withinSLA.length / totalMessages) * 100 
      : 100
    
    // 3. Per-agent breakdown
    const agentStats: Record<string, { total: number; withinSLA: number; totalMinutes: number }> = {}
    
    for (const r of respondedMessages) {
      const agent = r.responder_name || 'Unknown'
      if (!agentStats[agent]) {
        agentStats[agent] = { total: 0, withinSLA: 0, totalMinutes: 0 }
      }
      agentStats[agent].total++
      agentStats[agent].totalMinutes += r.response_minutes
      if (r.response_minutes <= slaMinutes) {
        agentStats[agent].withinSLA++
      }
    }
    
    const agentBreakdown = Object.entries(agentStats)
      .map(([name, stats]) => ({
        name,
        totalResponses: stats.total,
        withinSLA: stats.withinSLA,
        slaCompliance: stats.total > 0 ? Math.round((stats.withinSLA / stats.total) * 100) : 100,
        avgResponseMinutes: stats.total > 0 ? Math.round((stats.totalMinutes / stats.total) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.totalResponses - a.totalResponses)
    
    // 4. Response time distribution
    const distribution = {
      within5min: respondedMessages.filter((r: any) => r.response_minutes <= 5).length,
      within10min: respondedMessages.filter((r: any) => r.response_minutes > 5 && r.response_minutes <= 10).length,
      within30min: respondedMessages.filter((r: any) => r.response_minutes > 10 && r.response_minutes <= 30).length,
      within60min: respondedMessages.filter((r: any) => r.response_minutes > 30 && r.response_minutes <= 60).length,
      over60min: respondedMessages.filter((r: any) => r.response_minutes > 60).length,
      noResponse: noResponse.length,
    }
    
    // 5. Case resolution stats
    const caseStats = await sql`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status IN ('resolved', 'closed') THEN 1 END) as resolved,
        COUNT(CASE WHEN status IN ('detected', 'in_progress', 'waiting') THEN 1 END) as open
      FROM support_cases
      WHERE created_at >= ${fromDateTime}::timestamptz
        AND created_at <= ${toDateTime}::timestamptz
    `
    
    const cases = caseStats[0] || { total: 0, resolved: 0, open: 0 }
    const caseResolutionRate = parseInt(cases.total) > 0 
      ? Math.round((parseInt(cases.resolved) / parseInt(cases.total)) * 100) 
      : 100
    
    // 6. Channels with SLA violations (top 10)
    const channelViolations: Record<string, { name: string; violations: number; total: number }> = {}
    
    for (const r of responseTimeData) {
      if (!channelViolations[r.channel_id]) {
        channelViolations[r.channel_id] = { name: r.channel_name, violations: 0, total: 0 }
      }
      channelViolations[r.channel_id].total++
      if (r.response_at === null || r.response_minutes > slaMinutes) {
        channelViolations[r.channel_id].violations++
      }
    }
    
    const topViolations = Object.entries(channelViolations)
      .filter(([_, stats]) => stats.violations > 0)
      .map(([channelId, stats]) => ({
        channelId,
        channelName: stats.name,
        violations: stats.violations,
        total: stats.total,
        violationRate: Math.round((stats.violations / stats.total) * 100),
      }))
      .sort((a, b) => b.violations - a.violations)
      .slice(0, 10)
    
    // 7. Hourly distribution (when do violations happen?)
    const hourlyStats: Record<number, { total: number; violations: number }> = {}
    for (let h = 0; h < 24; h++) {
      hourlyStats[h] = { total: 0, violations: 0 }
    }
    
    for (const r of responseTimeData) {
      const hour = new Date(r.message_at).getUTCHours()
      // Adjust to Tashkent (UTC+5)
      const tashkentHour = (hour + 5) % 24
      hourlyStats[tashkentHour].total++
      if (r.response_at === null || r.response_minutes > slaMinutes) {
        hourlyStats[tashkentHour].violations++
      }
    }
    
    const hourlyDistribution = Object.entries(hourlyStats).map(([hour, stats]) => ({
      hour: parseInt(hour),
      total: stats.total,
      violations: stats.violations,
      violationRate: stats.total > 0 ? Math.round((stats.violations / stats.total) * 100) : 0,
    }))
    
    // 8. Recent SLA violations (for review)
    const recentViolations = violatedSLA
      .slice(0, 20)
      .map((r: any) => ({
        channelId: r.channel_id,
        channelName: r.channel_name,
        clientName: r.client_name,
        messageAt: r.message_at,
        responseAt: r.response_at,
        responseMinutes: Math.round(r.response_minutes * 10) / 10,
        responder: r.responder_name,
      }))
    
    return json({
      period: {
        from: fromDate,
        to: toDate,
        slaMinutes,
      },
      
      summary: {
        totalMessages,
        responded: respondedMessages.length,
        withinSLA: withinSLA.length,
        violatedSLA: violatedSLA.length,
        noResponse: noResponse.length,
        slaCompliance: Math.round(slaCompliance * 10) / 10,
        avgResponseMinutes: Math.round(avgResponseMinutes * 10) / 10,
      },
      
      distribution,
      
      cases: {
        total: parseInt(cases.total),
        resolved: parseInt(cases.resolved),
        open: parseInt(cases.open),
        resolutionRate: caseResolutionRate,
      },
      
      agentBreakdown,
      topViolations,
      hourlyDistribution,
      recentViolations,
    })
    
  } catch (e: any) {
    console.error('[SLA Report] Error:', e)
    return json({ error: e.message }, 500)
  }
}
