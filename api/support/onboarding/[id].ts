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
        'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
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
  const connId = pathParts[pathParts.length - 1]

  if (!connId || connId === 'onboarding') {
    return json({ error: 'Connection ID required' }, 400)
  }

  const sql = getSQL()

  if (req.method === 'GET') {
    try {
      const connResult = await sql`
        SELECT
          c.*,
          a.name as manager_name
        FROM onboarding_connections c
        LEFT JOIN support_agents a ON c.manager_id = a.id
        WHERE c.id = ${connId}
      `

      if (!connResult.length) {
        return json({ error: 'Connection not found' }, 404)
      }

      const conn = connResult[0]

      const stages = await sql`
        SELECT * FROM onboarding_stages
        WHERE connection_id = ${connId}
        ORDER BY sort_order ASC
      `

      const tasks = await sql`
        SELECT
          t.*,
          ag.name as agent_name
        FROM onboarding_tasks t
        LEFT JOIN support_agents ag ON t.assigned_agent_id = ag.id
        WHERE t.connection_id = ${connId}
        ORDER BY t.created_at ASC
      `

      const tasksByStage: Record<string, any[]> = {}
      for (const t of tasks) {
        if (!tasksByStage[t.stage_id]) tasksByStage[t.stage_id] = []
        tasksByStage[t.stage_id].push({
          id: t.id,
          stageId: t.stage_id,
          name: t.name,
          assignedRole: t.assigned_role,
          assignedAgentId: t.assigned_agent_id,
          agentName: t.agent_name,
          status: t.status,
          note: t.note,
          completedAt: t.completed_at,
          createdAt: t.created_at,
        })
      }

      const stagesWithTasks = stages.map((s: any) => ({
        id: s.id,
        name: s.name,
        sortOrder: s.sort_order,
        plannedDays: s.planned_days,
        assignedRole: s.assigned_role,
        status: s.status,
        startedAt: s.started_at,
        completedAt: s.completed_at,
        tasks: tasksByStage[s.id] || [],
      }))

      const comments = await sql`
        SELECT
          cm.*,
          ag.name as agent_name
        FROM onboarding_comments cm
        LEFT JOIN support_agents ag ON cm.agent_id = ag.id
        WHERE cm.connection_id = ${connId}
        ORDER BY cm.created_at DESC
        LIMIT 50
      `

      const totalTasks = tasks.length
      const completedTasks = tasks.filter((t: any) => t.status === 'completed').length
      const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

      return json({
        connection: {
          id: conn.id,
          clientName: conn.client_name,
          clientContact: conn.client_contact,
          clientPhone: conn.client_phone,
          templateId: conn.template_id,
          status: conn.status,
          pauseReason: conn.pause_reason,
          managerId: conn.manager_id,
          managerName: conn.manager_name,
          team: conn.team || {},
          currentStageId: conn.current_stage_id,
          plannedDeadline: conn.planned_deadline,
          startedAt: conn.started_at,
          completedAt: conn.completed_at,
          createdBy: conn.created_by,
          createdAt: conn.created_at,
          updatedAt: conn.updated_at,
        },
        stages: stagesWithTasks,
        comments: comments.map((cm: any) => ({
          id: cm.id,
          agentId: cm.agent_id,
          agentName: cm.agent_name,
          text: cm.text,
          isSystem: cm.is_system,
          createdAt: cm.created_at,
        })),
        stats: {
          totalTasks,
          completedTasks,
          progress,
        },
      })
    } catch (e: any) {
      console.error('Onboarding connection fetch error:', e)
      return json({ error: 'Failed to fetch connection', details: e.message }, 500)
    }
  }

  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const {
        status, pause_reason, manager_id, team, planned_deadline,
        current_stage_id, client_name, client_contact, client_phone,
      } = body

      const current = await sql`SELECT * FROM onboarding_connections WHERE id = ${connId}`
      if (!current.length) {
        return json({ error: 'Connection not found' }, 404)
      }

      const oldStatus = current[0].status

      await sql`
        UPDATE onboarding_connections SET
          status = COALESCE(${status || null}, status),
          pause_reason = COALESCE(${pause_reason !== undefined ? pause_reason : null}, pause_reason),
          manager_id = COALESCE(${manager_id || null}, manager_id),
          team = COALESCE(${team ? JSON.stringify(team) : null}, team),
          planned_deadline = COALESCE(${planned_deadline || null}, planned_deadline),
          current_stage_id = COALESCE(${current_stage_id || null}, current_stage_id),
          client_name = COALESCE(${client_name || null}, client_name),
          client_contact = COALESCE(${client_contact || null}, client_contact),
          client_phone = COALESCE(${client_phone || null}, client_phone),
          completed_at = CASE WHEN ${status || null} = 'launched' THEN NOW() ELSE completed_at END,
          updated_at = NOW()
        WHERE id = ${connId}
      `

      if (status && status !== oldStatus) {
        let commentText = ''
        if (status === 'paused') commentText = `Подключение приостановлено${pause_reason ? ': ' + pause_reason : ''}`
        else if (status === 'launched') commentText = 'Подключение запущено!'
        else if (status === 'frozen') commentText = 'Подключение заморожено'
        else if (status === 'active') commentText = 'Подключение возобновлено'
        else commentText = `Статус изменён на: ${status}`

        const cmtId = `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        await sql`
          INSERT INTO onboarding_comments (id, connection_id, text, is_system)
          VALUES (${cmtId}, ${connId}, ${commentText}, true)
        `
      }

      const updated = await sql`SELECT * FROM onboarding_connections WHERE id = ${connId}`
      return json({ success: true, connection: updated[0] })
    } catch (e: any) {
      console.error('Onboarding connection update error:', e)
      return json({ error: 'Failed to update connection', details: e.message }, 500)
    }
  }

  if (req.method === 'DELETE') {
    try {
      const exists = await sql`SELECT id FROM onboarding_connections WHERE id = ${connId}`
      if (!exists.length) {
        return json({ error: 'Connection not found' }, 404)
      }

      await sql`UPDATE onboarding_connections SET status = 'cancelled', updated_at = NOW() WHERE id = ${connId}`

      const cmtId = `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      await sql`
        INSERT INTO onboarding_comments (id, connection_id, text, is_system)
        VALUES (${cmtId}, ${connId}, 'Подключение отменено', true)
      `

      return json({ success: true, message: 'Connection cancelled' })
    } catch (e: any) {
      console.error('Onboarding connection delete error:', e)
      return json({ error: 'Failed to cancel connection', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
