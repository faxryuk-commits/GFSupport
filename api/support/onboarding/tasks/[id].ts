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
        'Access-Control-Allow-Methods': 'PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const url = new URL(req.url)
  const pathParts = url.pathname.split('/')
  const taskId = pathParts[pathParts.length - 1]

  if (!taskId || taskId === 'tasks') {
    return json({ error: 'Task ID required' }, 400)
  }

  const sql = getSQL()

  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { status, note, assigned_agent_id } = body

      const taskResult = await sql`SELECT * FROM onboarding_tasks WHERE id = ${taskId}`
      if (!taskResult.length) {
        return json({ error: 'Task not found' }, 404)
      }

      const task = taskResult[0]

      await sql`
        UPDATE onboarding_tasks SET
          status = COALESCE(${status || null}, status),
          note = COALESCE(${note !== undefined ? note : null}, note),
          assigned_agent_id = COALESCE(${assigned_agent_id || null}, assigned_agent_id),
          completed_at = CASE WHEN ${status || null} = 'completed' THEN NOW() ELSE completed_at END
        WHERE id = ${taskId}
      `

      let stageCanComplete = false

      if (status === 'completed') {
        const remaining = await sql`
          SELECT COUNT(*) as count FROM onboarding_tasks
          WHERE stage_id = ${task.stage_id} AND status != 'completed' AND id != ${taskId}
        `
        stageCanComplete = parseInt(remaining[0]?.count || '0') === 0
      }

      const updated = await sql`
        SELECT t.*, ag.name as agent_name
        FROM onboarding_tasks t
        LEFT JOIN support_agents ag ON t.assigned_agent_id = ag.id
        WHERE t.id = ${taskId}
      `

      return json({
        success: true,
        task: updated[0],
        stageCanComplete,
      })
    } catch (e: any) {
      console.error('Onboarding task update error:', e)
      return json({ error: 'Failed to update task', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
