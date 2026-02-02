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
    headers: { 'Content-Type': 'application/json' }
  })
}

// Simple hash for password (in production use bcrypt)
function hashPassword(password: string): string {
  let hash = 0
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return `h${Math.abs(hash).toString(36)}${password.length}`
}

export default async function handler(req: Request): Promise<Response> {
  const sql = getSQL()
  const url = new URL(req.url)

  // Ensure columns exist
  try {
    await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`
    await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS email VARCHAR(255)`
  } catch (e) { /* columns exist or table doesn't exist yet */ }

  // POST - Create new agent
  if (req.method === 'POST') {
    try {
      const { name, username, email, telegramId, role, password } = await req.json()

      if (!name) {
        return json({ error: 'Name is required' }, 400)
      }

      const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const passwordHash = password ? hashPassword(password) : null

      await sql`
        INSERT INTO support_agents (id, name, username, email, telegram_id, role, status, password_hash)
        VALUES (${id}, ${name}, ${username || null}, ${email || null}, ${telegramId || null}, ${role || 'agent'}, 'offline', ${passwordHash})
      `

      return json({ success: true, agentId: id })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  // PUT - Update agent
  if (req.method === 'PUT') {
    try {
      const { id, name, username, email, telegramId, role, password, status } = await req.json()

      if (!id) {
        return json({ error: 'Agent ID is required' }, 400)
      }

      // Update basic fields
      await sql`
        UPDATE support_agents SET
          name = COALESCE(${name || null}, name),
          username = COALESCE(${username || null}, username),
          email = COALESCE(${email || null}, email),
          telegram_id = COALESCE(${telegramId || null}, telegram_id),
          role = COALESCE(${role || null}, role),
          status = COALESCE(${status || null}, status)
        WHERE id = ${id}
      `

      // Update password if provided
      if (password) {
        const passwordHash = hashPassword(password)
        await sql`UPDATE support_agents SET password_hash = ${passwordHash} WHERE id = ${id}`
      }

      return json({ success: true })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  // DELETE - Remove agent
  if (req.method === 'DELETE') {
    try {
      const agentId = url.searchParams.get('id')
      if (!agentId) {
        return json({ error: 'Agent ID is required' }, 400)
      }

      await sql`DELETE FROM support_agents WHERE id = ${agentId}`
      return json({ success: true })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  // GET - List agents with real metrics
  try {
    const rows = await sql`SELECT id, name, username, email, telegram_id, role, status, avatar_url, created_at FROM support_agents ORDER BY name ASC`

    // Calculate metrics for each agent
    const agentsWithMetrics = await Promise.all(rows.map(async (r: any) => {
      // Count messages sent by this agent (by name or username match)
      let messagesCount = 0
      let resolvedCount = 0
      let isOnline = false
      
      try {
        // Messages sent by this agent
        const msgResult = await sql`
          SELECT COUNT(*) as count 
          FROM support_messages 
          WHERE (sender_name ILIKE ${r.name} OR sender_username = ${r.username})
            AND sender_role = 'support'
            AND created_at > NOW() - INTERVAL '30 days'
        `
        messagesCount = parseInt(msgResult[0]?.count || 0)
        
        // Conversations resolved (where agent was last responder before resolution)
        const resolvedResult = await sql`
          SELECT COUNT(DISTINCT c.id) as count
          FROM support_conversations c
          JOIN support_messages m ON m.channel_id = c.channel_id
          WHERE c.status = 'resolved'
            AND c.ended_at > NOW() - INTERVAL '30 days'
            AND (m.sender_name ILIKE ${r.name} OR m.sender_username = ${r.username})
            AND m.sender_role = 'support'
        `
        resolvedCount = parseInt(resolvedResult[0]?.count || 0)
        
        // Check if agent is online based on recent activity (last 10 minutes)
        const activityResult = await sql`
          SELECT COUNT(*) as count 
          FROM support_agent_activity 
          WHERE agent_id = ${r.id} 
            AND activity_at > NOW() - INTERVAL '10 minutes'
        `
        const hasRecentActivity = parseInt(activityResult[0]?.count || 0) > 0
        
        // Also check active sessions
        const sessionResult = await sql`
          SELECT COUNT(*) as count 
          FROM support_agent_sessions 
          WHERE agent_id = ${r.id} 
            AND is_active = true
            AND started_at > NOW() - INTERVAL '8 hours'
        `
        const hasActiveSession = parseInt(sessionResult[0]?.count || 0) > 0
        
        isOnline = hasRecentActivity || hasActiveSession
      } catch (e) {
        // Tables might not exist yet
      }
      
      // Get last seen time (last activity or last session end)
      let lastSeenAt = null
      try {
        const lastActivityResult = await sql`
          SELECT activity_at FROM support_agent_activity 
          WHERE agent_id = ${r.id} 
          ORDER BY activity_at DESC LIMIT 1
        `
        if (lastActivityResult[0]?.activity_at) {
          lastSeenAt = lastActivityResult[0].activity_at
        } else {
          // Try sessions table
          const lastSessionResult = await sql`
            SELECT COALESCE(ended_at, started_at) as last_time 
            FROM support_agent_sessions 
            WHERE agent_id = ${r.id} 
            ORDER BY started_at DESC LIMIT 1
          `
          if (lastSessionResult[0]?.last_time) {
            lastSeenAt = lastSessionResult[0].last_time
          }
        }
      } catch (e) {
        // Tables might not exist
      }
      
      return {
        id: r.id,
        name: r.name,
        username: r.username,
        email: r.email,
        telegramId: r.telegram_id,
        role: r.role || 'agent',
        status: isOnline ? 'online' : 'offline',
        avatarUrl: r.avatar_url,
        createdAt: r.created_at,
        lastSeenAt: lastSeenAt,
        assignedChannels: 0,
        activeChats: 0,
        metrics: {
          totalConversations: messagesCount,
          resolvedConversations: resolvedCount,
          avgFirstResponseMin: 0,
          avgResolutionMin: 0,
          satisfactionScore: '0',
          messagesHandled: messagesCount,
          escalations: 0
        }
      }
    }))

    return json({ agents: agentsWithMetrics })
  } catch (e: any) {
    if (e.message?.includes('does not exist')) {
      return json({ agents: [] })
    }
    return json({ error: e.message }, 500)
  }
}
