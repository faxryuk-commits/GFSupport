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

  const token = authHeader.replace('Bearer ', '')
  const sql = getSQL()

  if (req.method === 'GET') {
    try {
      const agentResult = await sql`
        SELECT id, name FROM support_agents WHERE token = ${token} LIMIT 1
      `
      if (!agentResult.length) {
        return json({ error: 'Agent not found for this token' }, 403)
      }

      const agent = agentResult[0]

      const tasks = await sql`
        SELECT
          t.*,
          s.name as stage_name,
          s.status as stage_status,
          s.planned_days,
          s.started_at as stage_started_at,
          c.id as connection_id,
          c.client_name,
          c.planned_deadline,
          c.status as connection_status
        FROM onboarding_tasks t
        JOIN onboarding_stages s ON t.stage_id = s.id
        JOIN onboarding_connections c ON t.connection_id = c.id
        WHERE t.assigned_agent_id = ${agent.id}
          AND t.status != 'completed'
          AND c.status = 'active'
        ORDER BY c.planned_deadline ASC NULLS LAST, s.sort_order ASC
      `

      const now = Date.now()
      const todayEnd = new Date()
      todayEnd.setHours(23, 59, 59, 999)

      const overdue: any[] = []
      const today: any[] = []
      const upcoming: any[] = []

      for (const t of tasks) {
        const stageStarted = t.stage_started_at ? new Date(t.stage_started_at).getTime() : now
        const stageDays = Math.floor((now - stageStarted) / 86400000)
        const isStageOverdue = t.planned_days && stageDays > t.planned_days
        const isDeadlineOverdue = t.planned_deadline && new Date(t.planned_deadline).getTime() < now

        const mapped = {
          id: t.id,
          name: t.name,
          status: t.status,
          note: t.note,
          assignedRole: t.assigned_role,
          connectionId: t.connection_id,
          clientName: t.client_name,
          stageId: t.stage_id,
          stageName: t.stage_name,
          stageStatus: t.stage_status,
          plannedDeadline: t.planned_deadline,
          connectionStatus: t.connection_status,
        }

        if (isStageOverdue || isDeadlineOverdue) {
          overdue.push(mapped)
        } else if (t.planned_days && stageDays >= t.planned_days - 1) {
          today.push(mapped)
        } else {
          upcoming.push(mapped)
        }
      }

      return json({
        agent: { id: agent.id, name: agent.name },
        overdue,
        today,
        upcoming,
        total: tasks.length,
      })
    } catch (e: any) {
      console.error('My tasks fetch error:', e)
      return json({ error: 'Failed to fetch my tasks', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
