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

  const sql = getSQL()
  const url = new URL(req.url)

  if (req.method === 'GET') {
    try {
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')

      const dateFrom = from || '2000-01-01'
      const dateTo = to || '2099-12-31'

      const totalResult = await sql`
        SELECT COUNT(*) as total FROM onboarding_connections
        WHERE created_at >= ${dateFrom} AND created_at <= ${dateTo}
      `
      const totalConnections = parseInt(totalResult[0]?.total || '0')

      const activeResult = await sql`
        SELECT COUNT(*) as count FROM onboarding_connections
        WHERE status = 'active' AND created_at >= ${dateFrom} AND created_at <= ${dateTo}
      `
      const activeCount = parseInt(activeResult[0]?.count || '0')

      const launchedResult = await sql`
        SELECT
          COUNT(*) as count,
          AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 86400) as avg_days
        FROM onboarding_connections
        WHERE status = 'launched' AND created_at >= ${dateFrom} AND created_at <= ${dateTo}
      `
      const avgLaunchDays = Math.round(parseFloat(launchedResult[0]?.avg_days || '0') * 10) / 10

      const onTimeResult = await sql`
        SELECT
          COUNT(*) FILTER (WHERE completed_at <= planned_deadline + INTERVAL '1 day') as on_time,
          COUNT(*) as total
        FROM onboarding_connections
        WHERE status = 'launched' AND planned_deadline IS NOT NULL
          AND created_at >= ${dateFrom} AND created_at <= ${dateTo}
      `
      const onTimeTotal = parseInt(onTimeResult[0]?.total || '0')
      const onTimeCount = parseInt(onTimeResult[0]?.on_time || '0')
      const onTimePercentage = onTimeTotal > 0 ? Math.round((onTimeCount / onTimeTotal) * 100) : 0

      const overdueResult = await sql`
        SELECT COUNT(*) as count FROM onboarding_connections
        WHERE status = 'active' AND planned_deadline < NOW()
          AND created_at >= ${dateFrom} AND created_at <= ${dateTo}
      `
      const overdueCount = parseInt(overdueResult[0]?.count || '0')

      const byStageResult = await sql`
        SELECT
          s.name,
          COUNT(*) as count,
          AVG(
            CASE WHEN s.completed_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (s.completed_at - s.started_at)) / 86400
              ELSE EXTRACT(EPOCH FROM (NOW() - s.started_at)) / 86400
            END
          ) as avg_days
        FROM onboarding_stages s
        JOIN onboarding_connections c ON s.connection_id = c.id
        WHERE s.started_at IS NOT NULL
          AND c.created_at >= ${dateFrom} AND c.created_at <= ${dateTo}
        GROUP BY s.name
        ORDER BY avg_days DESC
      `
      const byStage = byStageResult.map((s: any) => ({
        name: s.name,
        count: parseInt(s.count || '0'),
        avgDays: Math.round(parseFloat(s.avg_days || '0') * 10) / 10,
      }))

      const ballTasks = await sql`
        SELECT
          t.status,
          COUNT(DISTINCT t.connection_id) as conn_count
        FROM onboarding_tasks t
        JOIN onboarding_stages s ON t.stage_id = s.id
        JOIN onboarding_connections c ON c.current_stage_id = s.id AND c.id = t.connection_id
        WHERE t.status != 'completed' AND c.status = 'active'
          AND c.created_at >= ${dateFrom} AND c.created_at <= ${dateTo}
        GROUP BY t.status
      `
      const ballDistribution: Record<string, number> = { us: 0, client: 0, partner: 0 }
      for (const t of ballTasks) {
        if (t.status === 'waiting_client') ballDistribution.client += parseInt(t.conn_count)
        else if (t.status === 'waiting_partner') ballDistribution.partner += parseInt(t.conn_count)
        else ballDistribution.us += parseInt(t.conn_count)
      }

      const bottlenecks = byStageResult
        .filter((s: any) => parseFloat(s.avg_days || '0') > 0)
        .slice(0, 5)
        .map((s: any) => ({
          stage: s.name,
          avgDays: Math.round(parseFloat(s.avg_days || '0') * 10) / 10,
          count: parseInt(s.count || '0'),
        }))

      const agentResult = await sql`
        SELECT
          a.id,
          a.name,
          COUNT(DISTINCT c.id) as connections_count,
          AVG(
            CASE WHEN c.status = 'launched' AND c.completed_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (c.completed_at - c.started_at)) / 86400
              ELSE NULL
            END
          ) as avg_days,
          COUNT(DISTINCT c.id) FILTER (
            WHERE c.status = 'launched' AND c.planned_deadline IS NOT NULL
              AND c.completed_at <= c.planned_deadline + INTERVAL '1 day'
          ) as on_time_count,
          COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'launched' AND c.planned_deadline IS NOT NULL) as launched_with_deadline
        FROM support_agents a
        JOIN onboarding_connections c ON c.manager_id = a.id
        WHERE c.created_at >= ${dateFrom} AND c.created_at <= ${dateTo}
        GROUP BY a.id, a.name
        ORDER BY connections_count DESC
      `
      const agentEfficiency = agentResult.map((a: any) => {
        const launchedWithDeadline = parseInt(a.launched_with_deadline || '0')
        const onTime = parseInt(a.on_time_count || '0')
        return {
          agentId: a.id,
          agentName: a.name,
          connectionsCount: parseInt(a.connections_count || '0'),
          avgDays: Math.round(parseFloat(a.avg_days || '0') * 10) / 10,
          onTimePercentage: launchedWithDeadline > 0 ? Math.round((onTime / launchedWithDeadline) * 100) : 0,
        }
      })

      return json({
        totalConnections,
        avgLaunchDays,
        onTimePercentage,
        activeCount,
        overdueCount,
        byStage,
        ballDistribution,
        bottlenecks,
        agentEfficiency,
      })
    } catch (e: any) {
      console.error('Onboarding analytics error:', e)
      return json({ error: 'Failed to fetch analytics', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
