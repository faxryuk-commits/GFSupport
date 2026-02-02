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
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const sql = getSQL()

  // Ensure tables exist
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS support_agent_sessions (
        id VARCHAR(50) PRIMARY KEY,
        agent_id VARCHAR(50) NOT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMP,
        duration_minutes INTEGER,
        is_active BOOLEAN DEFAULT true
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS support_agent_activity (
        id VARCHAR(50) PRIMARY KEY,
        agent_id VARCHAR(50) NOT NULL,
        session_id VARCHAR(50),
        activity_type VARCHAR(50) NOT NULL,
        activity_at TIMESTAMP NOT NULL DEFAULT NOW(),
        metadata JSONB DEFAULT '{}'
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS idx_sessions_agent ON support_agent_sessions(agent_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_activity_agent ON support_agent_activity(agent_id)`
  } catch (e) { /* tables exist */ }

  const url = new URL(req.url)
  const agentId = url.searchParams.get('agentId')
  const period = url.searchParams.get('period') || 'day' // day, week, month

  // POST - Record activity (login, logout, action)
  if (req.method === 'POST') {
    try {
      const { agentId, action, metadata } = await req.json()

      if (!agentId || !action) {
        return json({ error: 'agentId and action are required' }, 400)
      }

      const activityId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

      if (action === 'login') {
        // Close any existing active sessions
        await sql`
          UPDATE support_agent_sessions 
          SET ended_at = NOW(), 
              is_active = false,
              duration_minutes = EXTRACT(EPOCH FROM (NOW() - started_at)) / 60
          WHERE agent_id = ${agentId} AND is_active = true
        `

        // Start new session
        const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        await sql`
          INSERT INTO support_agent_sessions (id, agent_id, started_at, is_active)
          VALUES (${sessionId}, ${agentId}, NOW(), true)
        `

        // Update agent status
        await sql`UPDATE support_agents SET status = 'online' WHERE id = ${agentId}`

        // Record activity
        await sql`
          INSERT INTO support_agent_activity (id, agent_id, session_id, activity_type, metadata)
          VALUES (${activityId}, ${agentId}, ${sessionId}, 'login', ${JSON.stringify(metadata || {})})
        `

        return json({ success: true, sessionId })

      } else if (action === 'logout') {
        // End active session
        const sessions = await sql`
          UPDATE support_agent_sessions 
          SET ended_at = NOW(), 
              is_active = false,
              duration_minutes = EXTRACT(EPOCH FROM (NOW() - started_at)) / 60
          WHERE agent_id = ${agentId} AND is_active = true
          RETURNING id, duration_minutes
        `

        // Update agent status
        await sql`UPDATE support_agents SET status = 'offline' WHERE id = ${agentId}`

        // Record activity
        await sql`
          INSERT INTO support_agent_activity (id, agent_id, session_id, activity_type, metadata)
          VALUES (${activityId}, ${agentId}, ${sessions[0]?.id || null}, 'logout', ${JSON.stringify(metadata || {})})
        `

        return json({ success: true, sessionDuration: sessions[0]?.duration_minutes || 0 })

      } else if (action === 'heartbeat' || action === 'activity') {
        // Record any activity (message sent, case handled, etc.)
        const activeSession = await sql`
          SELECT id FROM support_agent_sessions 
          WHERE agent_id = ${agentId} AND is_active = true 
          LIMIT 1
        `

        await sql`
          INSERT INTO support_agent_activity (id, agent_id, session_id, activity_type, metadata)
          VALUES (${activityId}, ${agentId}, ${activeSession[0]?.id || null}, ${action}, ${JSON.stringify(metadata || {})})
        `

        return json({ success: true })
      }

      return json({ error: 'Unknown action' }, 400)

    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  // GET - Get activity stats
  if (req.method === 'GET') {
    try {
      let intervalFilter = "NOW() - INTERVAL '1 day'"
      if (period === 'week') intervalFilter = "NOW() - INTERVAL '7 days'"
      if (period === 'month') intervalFilter = "NOW() - INTERVAL '30 days'"

      // Get all agents or specific agent
      const agentFilter = agentId ? sql`AND s.agent_id = ${agentId}` : sql``
      const agentFilterActivity = agentId ? sql`AND a.agent_id = ${agentId}` : sql``

      // Session stats (total work time)
      const sessionStats = await sql`
        SELECT 
          s.agent_id,
          ag.name as agent_name,
          COUNT(DISTINCT s.id) as total_sessions,
          COALESCE(SUM(s.duration_minutes), 0) as total_work_minutes,
          MIN(s.started_at) as first_login,
          MAX(COALESCE(s.ended_at, NOW())) as last_activity,
          COUNT(DISTINCT DATE(s.started_at)) as days_worked
        FROM support_agent_sessions s
        JOIN support_agents ag ON s.agent_id = ag.id
        WHERE s.started_at >= ${intervalFilter} ${agentFilter}
        GROUP BY s.agent_id, ag.name
      `

      // Activity stats (effective time - based on actual actions)
      const activityStats = await sql`
        SELECT 
          a.agent_id,
          COUNT(*) as total_actions,
          COUNT(DISTINCT DATE(a.activity_at)) as active_days,
          COUNT(*) FILTER (WHERE a.activity_type = 'message_sent') as messages_sent,
          COUNT(*) FILTER (WHERE a.activity_type = 'case_handled') as cases_handled,
          COUNT(*) FILTER (WHERE a.activity_type = 'heartbeat') as heartbeats
        FROM support_agent_activity a
        WHERE a.activity_at >= ${intervalFilter} ${agentFilterActivity}
        GROUP BY a.agent_id
      `

      // Daily breakdown for the period
      const dailyStats = await sql`
        SELECT 
          s.agent_id,
          DATE(s.started_at) as work_date,
          MIN(s.started_at) as first_login,
          MAX(COALESCE(s.ended_at, NOW())) as last_logout,
          SUM(s.duration_minutes) as work_minutes,
          COUNT(DISTINCT s.id) as sessions
        FROM support_agent_sessions s
        WHERE s.started_at >= ${intervalFilter} ${agentFilter}
        GROUP BY s.agent_id, DATE(s.started_at)
        ORDER BY work_date DESC
      `

      // Calculate effective time (time with actual activity, not just logged in)
      // Assume 5 min window between activities = active work
      const effectiveTimeQuery = await sql`
        WITH activity_gaps AS (
          SELECT 
            agent_id,
            activity_at,
            LAG(activity_at) OVER (PARTITION BY agent_id ORDER BY activity_at) as prev_activity
          FROM support_agent_activity
          WHERE activity_at >= ${intervalFilter} ${agentFilterActivity}
        )
        SELECT 
          agent_id,
          SUM(
            CASE 
              WHEN prev_activity IS NOT NULL 
                AND EXTRACT(EPOCH FROM (activity_at - prev_activity)) / 60 <= 10 
              THEN EXTRACT(EPOCH FROM (activity_at - prev_activity)) / 60
              ELSE 0
            END
          ) as effective_minutes
        FROM activity_gaps
        GROUP BY agent_id
      `

      // Combine stats
      const agents = sessionStats.map((s: any) => {
        const activity = activityStats.find((a: any) => a.agent_id === s.agent_id) || {}
        const effective = effectiveTimeQuery.find((e: any) => e.agent_id === s.agent_id) || {}
        const daily = dailyStats.filter((d: any) => d.agent_id === s.agent_id)

        const totalWorkMinutes = parseInt(s.total_work_minutes) || 0
        const effectiveMinutes = Math.round(parseFloat(effective.effective_minutes) || 0)
        const efficiency = totalWorkMinutes > 0 ? Math.round((effectiveMinutes / totalWorkMinutes) * 100) : 0

        return {
          agentId: s.agent_id,
          agentName: s.agent_name,
          period,
          summary: {
            totalSessions: parseInt(s.total_sessions) || 0,
            totalWorkMinutes,
            totalWorkFormatted: formatDuration(totalWorkMinutes),
            effectiveMinutes,
            effectiveFormatted: formatDuration(effectiveMinutes),
            efficiency: Math.min(efficiency, 100), // cap at 100%
            daysWorked: parseInt(s.days_worked) || 0,
            firstLogin: s.first_login,
            lastActivity: s.last_activity,
          },
          activity: {
            totalActions: parseInt(activity.total_actions) || 0,
            messagesSent: parseInt(activity.messages_sent) || 0,
            casesHandled: parseInt(activity.cases_handled) || 0,
            activeDays: parseInt(activity.active_days) || 0,
          },
          daily: daily.map((d: any) => ({
            date: d.work_date,
            firstLogin: d.first_login,
            lastLogout: d.last_logout,
            workMinutes: parseInt(d.work_minutes) || 0,
            workFormatted: formatDuration(parseInt(d.work_minutes) || 0),
            sessions: parseInt(d.sessions) || 0,
          })),
        }
      })

      return json({
        period,
        agents,
        totals: {
          totalAgents: agents.length,
          totalWorkMinutes: agents.reduce((sum: number, a: any) => sum + a.summary.totalWorkMinutes, 0),
          totalEffectiveMinutes: agents.reduce((sum: number, a: any) => sum + a.summary.effectiveMinutes, 0),
          avgEfficiency: agents.length > 0 
            ? Math.round(agents.reduce((sum: number, a: any) => sum + a.summary.efficiency, 0) / agents.length)
            : 0,
        }
      })

    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}м`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours < 24) return `${hours}ч ${mins}м`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days}д ${remainingHours}ч`
}
