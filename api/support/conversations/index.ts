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
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default async function handler(): Promise<Response> {
  const sql = getSQL()
  
  try {
    // Query conversations with channel info
    const rows = await sql`
      SELECT c.*, 
             ch.name as channel_name, 
             ch.type as channel_type,
             a.name as agent_name
      FROM support_conversations c
      LEFT JOIN support_channels ch ON c.channel_id = ch.id
      LEFT JOIN support_agents a ON c.agent_id = a.id
      ORDER BY c.started_at DESC 
      LIMIT 50
    `

    // Calculate metrics by channel type
    const metricsByType: Record<string, { frt: number, rt: number, frtCount: number, rtCount: number, total: number, resolved: number, active: number }> = {
      all: { frt: 0, rt: 0, frtCount: 0, rtCount: 0, total: 0, resolved: 0, active: 0 },
      client: { frt: 0, rt: 0, frtCount: 0, rtCount: 0, total: 0, resolved: 0, active: 0 },
      partner: { frt: 0, rt: 0, frtCount: 0, rtCount: 0, total: 0, resolved: 0, active: 0 },
      internal: { frt: 0, rt: 0, frtCount: 0, rtCount: 0, total: 0, resolved: 0, active: 0 }
    }

    for (const r of rows) {
      const channelType = r.channel_type || 'client'
      const types = ['all', channelType]
      
      for (const t of types) {
        if (!metricsByType[t]) metricsByType[t] = { frt: 0, rt: 0, frtCount: 0, rtCount: 0, total: 0, resolved: 0, active: 0 }
        
        metricsByType[t].total++
        if (r.status === 'resolved') metricsByType[t].resolved++
        if (r.status === 'active') metricsByType[t].active++
        
        if (r.first_response_at && r.started_at) {
          metricsByType[t].frt += (new Date(r.first_response_at).getTime() - new Date(r.started_at).getTime()) / 60000
          metricsByType[t].frtCount++
        }
        if (r.ended_at && r.started_at) {
          metricsByType[t].rt += (new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 60000
          metricsByType[t].rtCount++
        }
      }
    }

    // Format metrics
    const formatMetrics = (m: typeof metricsByType.all) => ({
      avgFirstResponseMin: m.frtCount > 0 ? Math.round(m.frt / m.frtCount) : 0,
      avgResolutionMin: m.rtCount > 0 ? Math.round(m.rt / m.rtCount) : 0,
      totalConversations: m.total,
      resolvedTotal: m.resolved,
      activeNow: m.active
    })

    return json({
      conversations: rows.map((r: any) => ({
        id: r.id,
        channelId: r.channel_id,
        channelName: r.channel_name || 'Неизвестный канал',
        channelType: r.channel_type || 'client',
        agentName: r.agent_name,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        status: r.status,
        firstResponseAt: r.first_response_at,
        firstResponseTimeMin: r.first_response_at && r.started_at 
          ? Math.round((new Date(r.first_response_at).getTime() - new Date(r.started_at).getTime()) / 60000)
          : null,
        resolutionTimeMin: r.ended_at && r.started_at
          ? Math.round((new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 60000)
          : null,
        messageCount: r.message_count
      })),
      metrics: formatMetrics(metricsByType.all),
      metricsByType: {
        all: formatMetrics(metricsByType.all),
        clients: formatMetrics(metricsByType.client),
        partners: formatMetrics(metricsByType.partner),
        internal: formatMetrics(metricsByType.internal)
      }
    })
  } catch (e: any) {
    const emptyMetrics = { avgFirstResponseMin: 0, avgResolutionMin: 0, totalConversations: 0, resolvedTotal: 0, activeNow: 0 }
    return json({ 
      conversations: [], 
      metrics: emptyMetrics,
      metricsByType: { all: emptyMetrics, clients: emptyMetrics, partners: emptyMetrics, internal: emptyMetrics },
      error: e.message 
    })
  }
}
