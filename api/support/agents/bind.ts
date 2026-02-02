/**
 * API for binding telegram_id to support agents
 * 
 * POST - Manual bind telegram_id to agent
 * GET - List agents without telegram_id (need binding)
 * DELETE - Remove telegram_id binding from agent
 */

import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

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
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  // Auth check
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()

  // GET - List agents without telegram_id
  if (req.method === 'GET') {
    try {
      // Get agents without telegram_id
      const unboundAgents = await sql`
        SELECT 
          id, name, username, email, role, status,
          telegram_id, created_at
        FROM support_agents
        WHERE telegram_id IS NULL OR telegram_id = ''
        ORDER BY name
      `

      // Get agents with telegram_id (for reference)
      const boundAgents = await sql`
        SELECT 
          id, name, username, email, role, status,
          telegram_id, created_at
        FROM support_agents
        WHERE telegram_id IS NOT NULL AND telegram_id != ''
        ORDER BY name
      `

      // Also get crm_managers binding status
      const unboundManagers = await sql`
        SELECT 
          id, name, telegram_username, role,
          telegram_id
        FROM crm_managers
        WHERE telegram_id IS NULL OR telegram_id = ''
        ORDER BY name
      `

      const boundManagers = await sql`
        SELECT 
          id, name, telegram_username, role,
          telegram_id
        FROM crm_managers
        WHERE telegram_id IS NOT NULL AND telegram_id != ''
        ORDER BY name
      `

      return json({
        agents: {
          unbound: unboundAgents.map((a: any) => ({
            id: a.id,
            name: a.name,
            username: a.username,
            email: a.email,
            role: a.role,
            status: a.status,
            telegramId: a.telegram_id,
            createdAt: a.created_at,
          })),
          bound: boundAgents.map((a: any) => ({
            id: a.id,
            name: a.name,
            username: a.username,
            email: a.email,
            role: a.role,
            status: a.status,
            telegramId: a.telegram_id,
            createdAt: a.created_at,
          })),
        },
        managers: {
          unbound: unboundManagers.map((m: any) => ({
            id: m.id,
            name: m.name,
            telegramUsername: m.telegram_username,
            role: m.role,
            telegramId: m.telegram_id,
          })),
          bound: boundManagers.map((m: any) => ({
            id: m.id,
            name: m.name,
            telegramUsername: m.telegram_username,
            role: m.role,
            telegramId: m.telegram_id,
          })),
        },
        stats: {
          totalAgents: unboundAgents.length + boundAgents.length,
          boundAgents: boundAgents.length,
          unboundAgents: unboundAgents.length,
          totalManagers: unboundManagers.length + boundManagers.length,
          boundManagers: boundManagers.length,
          unboundManagers: unboundManagers.length,
        }
      })
    } catch (e: any) {
      return json({ error: 'Failed to fetch binding status', details: e.message }, 500)
    }
  }

  // POST - Bind telegram_id to agent
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { agentId, managerId, telegramId, telegramUsername } = body

      if (!telegramId && !telegramUsername) {
        return json({ error: 'telegramId or telegramUsername is required' }, 400)
      }

      if (!agentId && !managerId) {
        return json({ error: 'agentId or managerId is required' }, 400)
      }

      // Check if telegram_id already bound to another agent
      if (telegramId) {
        const existingAgent = await sql`
          SELECT id, name FROM support_agents 
          WHERE telegram_id = ${String(telegramId)}
          LIMIT 1
        `
        if (existingAgent[0] && existingAgent[0].id !== agentId) {
          return json({ 
            error: 'Telegram ID already bound to another agent',
            boundTo: existingAgent[0].name
          }, 409)
        }

        const existingManager = await sql`
          SELECT id, name FROM crm_managers 
          WHERE telegram_id = ${String(telegramId)}
          LIMIT 1
        `
        if (existingManager[0] && existingManager[0].id !== managerId) {
          return json({ 
            error: 'Telegram ID already bound to another manager',
            boundTo: existingManager[0].name
          }, 409)
        }
      }

      // Bind to agent
      if (agentId) {
        const updates: any = {}
        if (telegramId) updates.telegram_id = String(telegramId)
        if (telegramUsername) updates.username = telegramUsername.replace('@', '')

        if (telegramId && telegramUsername) {
          await sql`
            UPDATE support_agents 
            SET telegram_id = ${String(telegramId)}, 
                username = ${telegramUsername.replace('@', '')}
            WHERE id = ${agentId}
          `
        } else if (telegramId) {
          await sql`
            UPDATE support_agents 
            SET telegram_id = ${String(telegramId)}
            WHERE id = ${agentId}
          `
        } else if (telegramUsername) {
          await sql`
            UPDATE support_agents 
            SET username = ${telegramUsername.replace('@', '')}
            WHERE id = ${agentId}
          `
        }

        // Get updated agent
        const updated = await sql`
          SELECT id, name, username, telegram_id FROM support_agents WHERE id = ${agentId}
        `

        return json({
          success: true,
          message: 'Agent telegram binding updated',
          agent: updated[0] ? {
            id: updated[0].id,
            name: updated[0].name,
            username: updated[0].username,
            telegramId: updated[0].telegram_id,
          } : null
        })
      }

      // Bind to manager
      if (managerId) {
        if (telegramId && telegramUsername) {
          await sql`
            UPDATE crm_managers 
            SET telegram_id = ${String(telegramId)}, 
                telegram_username = ${telegramUsername.replace('@', '')}
            WHERE id = ${managerId}
          `
        } else if (telegramId) {
          await sql`
            UPDATE crm_managers 
            SET telegram_id = ${String(telegramId)}
            WHERE id = ${managerId}
          `
        } else if (telegramUsername) {
          await sql`
            UPDATE crm_managers 
            SET telegram_username = ${telegramUsername.replace('@', '')}
            WHERE id = ${managerId}
          `
        }

        const updated = await sql`
          SELECT id, name, telegram_username, telegram_id FROM crm_managers WHERE id = ${managerId}
        `

        return json({
          success: true,
          message: 'Manager telegram binding updated',
          manager: updated[0] ? {
            id: updated[0].id,
            name: updated[0].name,
            telegramUsername: updated[0].telegram_username,
            telegramId: updated[0].telegram_id,
          } : null
        })
      }

      return json({ error: 'No valid target specified' }, 400)

    } catch (e: any) {
      return json({ error: 'Failed to bind telegram_id', details: e.message }, 500)
    }
  }

  // DELETE - Remove telegram_id binding
  if (req.method === 'DELETE') {
    try {
      const url = new URL(req.url)
      const agentId = url.searchParams.get('agentId')
      const managerId = url.searchParams.get('managerId')
      const field = url.searchParams.get('field') || 'telegram_id' // telegram_id or username

      if (!agentId && !managerId) {
        return json({ error: 'agentId or managerId is required' }, 400)
      }

      if (agentId) {
        if (field === 'username') {
          await sql`
            UPDATE support_agents SET username = NULL WHERE id = ${agentId}
          `
        } else {
          await sql`
            UPDATE support_agents SET telegram_id = NULL WHERE id = ${agentId}
          `
        }
        return json({ success: true, message: `Agent ${field} binding removed` })
      }

      if (managerId) {
        if (field === 'telegram_username') {
          await sql`
            UPDATE crm_managers SET telegram_username = NULL WHERE id = ${managerId}
          `
        } else {
          await sql`
            UPDATE crm_managers SET telegram_id = NULL WHERE id = ${managerId}
          `
        }
        return json({ success: true, message: `Manager ${field} binding removed` })
      }

      return json({ error: 'No valid target specified' }, 400)

    } catch (e: any) {
      return json({ error: 'Failed to remove binding', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
