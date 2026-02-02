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
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

  // GET - список автоматизаций
  if (req.method === 'GET') {
    try {
      const automations = await sql`
        SELECT * FROM support_automations
        ORDER BY priority DESC, created_at ASC
      `

      return json({
        automations: automations.map((a: any) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          triggerType: a.trigger_type,
          triggerConfig: a.trigger_config,
          actionType: a.action_type,
          actionConfig: a.action_config,
          isActive: a.is_active,
          priority: a.priority,
          executionsCount: a.executions_count,
          lastExecutedAt: a.last_executed_at,
          createdAt: a.created_at,
          updatedAt: a.updated_at,
        })),
        total: automations.length
      })

    } catch (e: any) {
      return json({ error: 'Failed to fetch automations', details: e.message }, 500)
    }
  }

  // POST - создать автоматизацию
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { name, description, triggerType, triggerConfig, actionType, actionConfig, priority } = body

      if (!name || !triggerType || !actionType) {
        return json({ error: 'name, triggerType, and actionType are required' }, 400)
      }

      const autoId = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

      await sql`
        INSERT INTO support_automations (
          id, name, description, trigger_type, trigger_config, action_type, action_config, priority
        ) VALUES (
          ${autoId},
          ${name},
          ${description || null},
          ${triggerType},
          ${JSON.stringify(triggerConfig || {})},
          ${actionType},
          ${JSON.stringify(actionConfig || {})},
          ${priority || 0}
        )
      `

      return json({
        success: true,
        automationId: autoId,
        message: 'Automation created'
      })

    } catch (e: any) {
      return json({ error: 'Failed to create automation', details: e.message }, 500)
    }
  }

  // PUT - обновить автоматизацию
  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { id, name, description, triggerConfig, actionConfig, isActive, priority } = body

      if (!id) {
        return json({ error: 'Automation ID required' }, 400)
      }

      await sql`
        UPDATE support_automations SET
          name = COALESCE(${name}, name),
          description = COALESCE(${description}, description),
          trigger_config = COALESCE(${triggerConfig ? JSON.stringify(triggerConfig) : null}, trigger_config),
          action_config = COALESCE(${actionConfig ? JSON.stringify(actionConfig) : null}, action_config),
          is_active = COALESCE(${isActive}, is_active),
          priority = COALESCE(${priority}, priority),
          updated_at = NOW()
        WHERE id = ${id}
      `

      return json({
        success: true,
        automationId: id,
        message: 'Automation updated'
      })

    } catch (e: any) {
      return json({ error: 'Failed to update automation', details: e.message }, 500)
    }
  }

  // DELETE - удалить автоматизацию
  if (req.method === 'DELETE') {
    try {
      const autoId = url.searchParams.get('id')
      
      if (!autoId) {
        return json({ error: 'Automation ID required' }, 400)
      }

      await sql`DELETE FROM support_automations WHERE id = ${autoId}`

      return json({
        success: true,
        message: 'Automation deleted'
      })

    } catch (e: any) {
      return json({ error: 'Failed to delete automation', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
