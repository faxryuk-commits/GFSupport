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
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
      const status = url.searchParams.get('status')
      const stage = url.searchParams.get('stage')
      const assignedTo = url.searchParams.get('assignedTo')
      const ball = url.searchParams.get('ball')
      const search = url.searchParams.get('search')
      const limit = parseInt(url.searchParams.get('limit') || '50')
      const offset = parseInt(url.searchParams.get('offset') || '0')

      let connections = await sql`
        SELECT
          c.*,
          s.name as current_stage_name,
          s.sort_order as current_stage_order,
          s.started_at as stage_started_at,
          s.planned_days as stage_planned_days,
          a.name as manager_name,
          (SELECT COUNT(*) FROM onboarding_stages WHERE connection_id = c.id) as total_stages,
          (SELECT COUNT(*) FROM onboarding_stages WHERE connection_id = c.id AND status = 'completed') as completed_stages,
          (SELECT COUNT(*) FROM onboarding_tasks WHERE connection_id = c.id) as total_tasks,
          (SELECT COUNT(*) FROM onboarding_tasks WHERE connection_id = c.id AND status = 'completed') as completed_tasks
        FROM onboarding_connections c
        LEFT JOIN onboarding_stages s ON c.current_stage_id = s.id
        LEFT JOIN support_agents a ON c.manager_id = a.id
        WHERE c.status != 'cancelled'
        ORDER BY c.created_at DESC
      `

      if (status && status !== 'all') {
        const statuses = status.split(',').map(s => s.trim())
        connections = connections.filter((c: any) => statuses.includes(c.status))
      }

      if (stage) {
        connections = connections.filter((c: any) => c.current_stage_name === stage)
      }

      if (assignedTo) {
        connections = connections.filter((c: any) => c.manager_id === assignedTo)
      }

      if (search) {
        const q = search.toLowerCase()
        connections = connections.filter((c: any) =>
          c.client_name?.toLowerCase().includes(q) ||
          c.client_contact?.toLowerCase().includes(q) ||
          c.client_phone?.includes(q)
        )
      }

      const ballTasks = await sql`
        SELECT t.connection_id, t.status
        FROM onboarding_tasks t
        JOIN onboarding_stages s ON t.stage_id = s.id
        JOIN onboarding_connections c ON c.current_stage_id = s.id AND c.id = t.connection_id
        WHERE t.status != 'completed'
      `
      const ballMap: Record<string, string> = {}
      for (const t of ballTasks) {
        const connId = t.connection_id
        if (t.status === 'waiting_client') ballMap[connId] = 'client'
        else if (t.status === 'waiting_partner') {
          if (ballMap[connId] !== 'client') ballMap[connId] = 'partner'
        } else {
          if (!ballMap[connId]) ballMap[connId] = 'us'
        }
      }

      let enriched = connections.map((c: any) => {
        const now = Date.now()
        const stageStarted = c.stage_started_at ? new Date(c.stage_started_at).getTime() : now
        const daysOnStage = Math.floor((now - stageStarted) / 86400000)
        const isOverdue = c.planned_deadline ? new Date(c.planned_deadline).getTime() < now : false
        const daysToDeadline = c.planned_deadline
          ? Math.ceil((new Date(c.planned_deadline).getTime() - now) / 86400000)
          : null

        let urgency: 'red' | 'yellow' | 'green' = 'green'
        if (isOverdue || (daysToDeadline !== null && daysToDeadline < 0)) urgency = 'red'
        else if (daysToDeadline !== null && daysToDeadline <= 2) urgency = 'yellow'

        const currentBall = ballMap[c.id] || 'us'

        return {
          id: c.id,
          channelId: c.channel_id || null,
          clientName: c.client_name,
          clientContact: c.client_contact,
          clientPhone: c.client_phone,
          templateId: c.template_id,
          status: c.status,
          pauseReason: c.pause_reason,
          managerId: c.manager_id,
          managerName: c.manager_name,
          team: c.team || {},
          currentStageId: c.current_stage_id,
          currentStageName: c.current_stage_name,
          currentStageOrder: c.current_stage_order,
          plannedDeadline: c.planned_deadline,
          startedAt: c.started_at,
          completedAt: c.completed_at,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          totalStages: parseInt(c.total_stages || '0'),
          completedStages: parseInt(c.completed_stages || '0'),
          totalTasks: parseInt(c.total_tasks || '0'),
          completedTasks: parseInt(c.completed_tasks || '0'),
          daysOnStage,
          daysToDeadline,
          isOverdue,
          urgency,
          ball: currentBall,
        }
      })

      if (ball) {
        enriched = enriched.filter((c: any) => c.ball === ball)
      }

      enriched.sort((a: any, b: any) => {
        const order = { red: 0, yellow: 1, green: 2 }
        return (order[a.urgency as keyof typeof order] ?? 2) - (order[b.urgency as keyof typeof order] ?? 2)
      })

      const total = enriched.length
      const paged = enriched.slice(offset, offset + limit)

      const statsResult = await sql`
        SELECT status, COUNT(*) as count
        FROM onboarding_connections
        GROUP BY status
      `
      const stats = Object.fromEntries(statsResult.map((s: any) => [s.status, parseInt(s.count)]))

      return json({ connections: paged, total, limit, offset, stats })
    } catch (e: any) {
      console.error('Onboarding connections fetch error:', e)
      return json({ error: 'Failed to fetch connections', details: e.message }, 500)
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { channel_id, client_name, template_id, client_contact, client_phone, manager_id, team, planned_deadline } = body

      if (!client_name || !template_id) {
        return json({ error: 'client_name and template_id are required' }, 400)
      }

      const template = await sql`SELECT * FROM onboarding_templates WHERE id = ${template_id}`
      if (!template.length) {
        return json({ error: 'Template not found' }, 404)
      }

      const connId = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const teamJson = team || {}

      const deadline = planned_deadline || null

      await sql`
        INSERT INTO onboarding_connections (
          id, channel_id, client_name, client_contact, client_phone, template_id,
          manager_id, team, planned_deadline, created_by
        ) VALUES (
          ${connId}, ${channel_id || null}, ${client_name}, ${client_contact || null}, ${client_phone || null},
          ${template_id}, ${manager_id || null}, ${JSON.stringify(teamJson)}, ${deadline}, ${manager_id || null}
        )
      `

      const templateStages = await sql`
        SELECT * FROM onboarding_template_stages
        WHERE template_id = ${template_id}
        ORDER BY sort_order ASC
      `

      let firstStageId: string | null = null

      for (let i = 0; i < templateStages.length; i++) {
        const ts = templateStages[i]
        const stageId = `stg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${i}`
        const isFirst = i === 0

        if (isFirst) firstStageId = stageId

        await sql`
          INSERT INTO onboarding_stages (
            id, connection_id, template_stage_id, name, sort_order,
            planned_days, assigned_role, status, started_at
          ) VALUES (
            ${stageId}, ${connId}, ${ts.id}, ${ts.name}, ${ts.sort_order},
            ${ts.planned_days}, ${ts.default_role}, ${isFirst ? 'in_progress' : 'pending'},
            ${isFirst ? new Date().toISOString() : null}
          )
        `

        const items = ts.items || []
        for (let j = 0; j < items.length; j++) {
          const item = items[j]
          const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${i}_${j}`
          const assignedAgentId = item.role && teamJson[item.role] ? teamJson[item.role] : null

          await sql`
            INSERT INTO onboarding_tasks (
              id, stage_id, connection_id, name, assigned_role, assigned_agent_id
            ) VALUES (
              ${taskId}, ${stageId}, ${connId}, ${item.name}, ${item.role || null}, ${assignedAgentId}
            )
          `
        }
      }

      if (firstStageId) {
        await sql`UPDATE onboarding_connections SET current_stage_id = ${firstStageId} WHERE id = ${connId}`
      }

      const commentId = `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      await sql`
        INSERT INTO onboarding_comments (id, connection_id, agent_id, text, is_system)
        VALUES (${commentId}, ${connId}, ${manager_id || null}, 'Подключение создано', true)
      `

      const created = await sql`SELECT * FROM onboarding_connections WHERE id = ${connId}`
      const stages = await sql`
        SELECT * FROM onboarding_stages WHERE connection_id = ${connId} ORDER BY sort_order ASC
      `

      return json({
        success: true,
        connection: created[0],
        stages,
      })
    } catch (e: any) {
      console.error('Onboarding connection create error:', e)
      return json({ error: 'Failed to create connection', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
