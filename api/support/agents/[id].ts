import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

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

export default async function handler(req: Request, { params }: { params: { id: string } }): Promise<Response> {
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

  const sql = getSQL()
  const agentId = params.id

  // GET - получить агента по ID
  if (req.method === 'GET') {
    try {
      const [agent] = await sql`
        SELECT 
          id, name, username, email, telegram_id, telegram_username,
          role, status, position, department, phone, avatar_url,
          created_at, last_active_at,
          (SELECT COUNT(*) FROM support_messages WHERE sender_role = 'support' AND sender_name = support_agents.name AND created_at > NOW() - INTERVAL '30 days') as messages_last_30d,
          (SELECT COUNT(*) FROM support_cases WHERE assigned_to = support_agents.id AND status IN ('resolved', 'closed')) as cases_resolved
        FROM support_agents 
        WHERE id = ${agentId}
      `

      if (!agent) {
        return json({ error: 'Agent not found' }, 404)
      }

      return json({
        agent: {
          id: agent.id,
          name: agent.name,
          username: agent.username,
          email: agent.email,
          telegramId: agent.telegram_id,
          telegramUsername: agent.telegram_username,
          role: agent.role || 'support',
          status: agent.status || 'active',
          position: agent.position,
          department: agent.department,
          phone: agent.phone,
          avatarUrl: agent.avatar_url,
          createdAt: agent.created_at,
          lastActiveAt: agent.last_active_at,
          metrics: {
            messagesLast30d: parseInt(agent.messages_last_30d || '0'),
            casesResolved: parseInt(agent.cases_resolved || '0'),
          }
        }
      })

    } catch (e: any) {
      console.error('Agent fetch error:', e)
      return json({ error: 'Failed to fetch agent', details: e.message }, 500)
    }
  }

  // PUT - обновить агента
  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { name, username, email, phone, position, department, role, status, avatarUrl } = body

      await sql`
        UPDATE support_agents SET
          name = COALESCE(${name}, name),
          username = COALESCE(${username}, username),
          email = COALESCE(${email}, email),
          phone = COALESCE(${phone}, phone),
          position = COALESCE(${position}, position),
          department = COALESCE(${department}, department),
          role = COALESCE(${role}, role),
          status = COALESCE(${status}, status),
          avatar_url = COALESCE(${avatarUrl}, avatar_url)
        WHERE id = ${agentId}
      `

      // Возвращаем обновленного агента
      const [updated] = await sql`
        SELECT * FROM support_agents WHERE id = ${agentId}
      `

      return json({
        success: true,
        agent: {
          id: updated.id,
          name: updated.name,
          username: updated.username,
          email: updated.email,
          telegramId: updated.telegram_id,
          role: updated.role,
          status: updated.status,
          position: updated.position,
          department: updated.department,
        }
      })

    } catch (e: any) {
      console.error('Agent update error:', e)
      return json({ error: 'Failed to update agent', details: e.message }, 500)
    }
  }

  // DELETE - деактивировать агента
  if (req.method === 'DELETE') {
    try {
      await sql`
        UPDATE support_agents SET status = 'inactive' WHERE id = ${agentId}
      `

      return json({ success: true, message: 'Agent deactivated' })

    } catch (e: any) {
      console.error('Agent delete error:', e)
      return json({ error: 'Failed to deactivate agent', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
