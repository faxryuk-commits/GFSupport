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
    }
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
    await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`
    await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS position VARCHAR(100)`
    await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS department VARCHAR(100)`
    await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'::jsonb`
  } catch (e) { /* columns exist or table doesn't exist yet */ }

  // POST - Create new agent
  if (req.method === 'POST') {
    try {
      const { name, username, email, telegramId, role, password, phone, position, department, permissions } = await req.json()

      if (!name) {
        return json({ error: 'Name is required' }, 400)
      }

      const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const passwordHash = password ? hashPassword(password) : null
      const permissionsJson = permissions ? JSON.stringify(permissions) : '[]'

      await sql`
        INSERT INTO support_agents (id, name, username, email, telegram_id, role, status, password_hash, phone, position, department, permissions)
        VALUES (${id}, ${name}, ${username || null}, ${email || null}, ${telegramId || null}, ${role || 'agent'}, 'offline', ${passwordHash}, ${phone || null}, ${position || null}, ${department || null}, ${permissionsJson}::jsonb)
      `

      return json({ success: true, agentId: id })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  // PUT - Update agent
  if (req.method === 'PUT') {
    try {
      const { id, name, username, email, telegramId, role, password, status, phone, position, department, permissions } = await req.json()

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
          status = COALESCE(${status || null}, status),
          phone = COALESCE(${phone || null}, phone),
          position = COALESCE(${position || null}, position),
          department = COALESCE(${department || null}, department)
        WHERE id = ${id}
      `

      // Update password if provided
      if (password) {
        const passwordHash = hashPassword(password)
        await sql`UPDATE support_agents SET password_hash = ${passwordHash} WHERE id = ${id}`
      }

      // Update permissions if provided
      if (permissions !== undefined) {
        const permissionsJson = JSON.stringify(permissions)
        await sql`UPDATE support_agents SET permissions = ${permissionsJson}::jsonb WHERE id = ${id}`
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
  // ?action=sync - Sync telegram_id from messages
  const action = url.searchParams.get('action')
  
  if (action === 'sync') {
    // Auto-sync telegram_id from support_messages based on username match
    try {
      const agents = await sql`SELECT id, name, username, telegram_id FROM support_agents WHERE telegram_id IS NULL`
      
      let synced = 0
      for (const agent of agents) {
        if (!agent.username) continue
        
        // Find sender_id from messages matching this username
        const match = await sql`
          SELECT DISTINCT sender_id, sender_name
          FROM support_messages 
          WHERE LOWER(sender_username) = LOWER(${agent.username})
            AND sender_id IS NOT NULL
            AND (sender_role IN ('support', 'team', 'agent') OR is_from_client = false)
          LIMIT 1
        `
        
        if (match.length > 0 && match[0].sender_id) {
          await sql`
            UPDATE support_agents 
            SET telegram_id = ${match[0].sender_id}::text
            WHERE id = ${agent.id}
          `
          synced++
          console.log(`[Agents Sync] Updated ${agent.name}: telegram_id = ${match[0].sender_id}`)
        }
      }
      
      return json({ success: true, synced, message: `Synced ${synced} agents` })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }
  
  try {
    const rows = await sql`SELECT id, name, username, email, telegram_id, role, status, avatar_url, created_at, phone, position, department, permissions FROM support_agents ORDER BY name ASC`

    // Calculate metrics for each agent
    const agentsWithMetrics = await Promise.all(rows.map(async (r: any) => {
      // Count messages sent by this agent
      // Match by: telegram_id, username, or name (partial match)
      let messagesCount = 0
      let resolvedCount = 0
      let activeChatsCount = 0
      let isOnline = false
      
      try {
        // Build matching conditions for this agent
        // Match by: telegram_id, username, or exact/similar name
        const agentName = r.name || ''
        const agentUsername = r.username || ''
        const agentTelegramId = r.telegram_id || ''
        
        const msgResult = await sql`
          SELECT COUNT(*) as count 
          FROM support_messages 
          WHERE (sender_role IN ('support', 'team', 'agent') OR is_from_client = false)
            AND created_at > NOW() - INTERVAL '30 days'
            AND (
              -- Match by telegram_id
              (${agentTelegramId} != '' AND sender_id::text = ${agentTelegramId})
              -- Match by username (case insensitive)
              OR (${agentUsername} != '' AND LOWER(sender_username) = LOWER(${agentUsername}))
              -- Match by exact name
              OR (${agentName} != '' AND sender_name = ${agentName})
              -- Match by similar name (contains)
              OR (${agentName} != '' AND LENGTH(${agentName}) >= 3 AND sender_name ILIKE ${`%${agentName}%`})
            )
        `
        messagesCount = parseInt(msgResult[0]?.count || 0)
        
        // Conversations resolved - count unique channels where this agent responded
        const resolvedResult = await sql`
          SELECT COUNT(DISTINCT m.channel_id) as count
          FROM support_messages m
          JOIN support_channels c ON c.id = m.channel_id
          WHERE (m.sender_role IN ('support', 'team', 'agent') OR m.is_from_client = false)
            AND m.created_at > NOW() - INTERVAL '30 days'
            AND c.awaiting_reply = false
            AND (
              (${agentTelegramId} != '' AND m.sender_id::text = ${agentTelegramId})
              OR (${agentUsername} != '' AND LOWER(m.sender_username) = LOWER(${agentUsername}))
              OR (${agentName} != '' AND m.sender_name = ${agentName})
              OR (${agentName} != '' AND LENGTH(${agentName}) >= 3 AND m.sender_name ILIKE ${`%${agentName}%`})
            )
        `
        resolvedCount = parseInt(resolvedResult[0]?.count || 0)
        
        // Active chats - channels awaiting reply where this agent participated
        const activeChatsResult = await sql`
          SELECT COUNT(DISTINCT m.channel_id) as count
          FROM support_messages m
          JOIN support_channels c ON c.id = m.channel_id
          WHERE (m.sender_role IN ('support', 'team', 'agent') OR m.is_from_client = false)
            AND m.created_at > NOW() - INTERVAL '7 days'
            AND c.awaiting_reply = true
            AND (
              (${agentTelegramId} != '' AND m.sender_id::text = ${agentTelegramId})
              OR (${agentUsername} != '' AND LOWER(m.sender_username) = LOWER(${agentUsername}))
              OR (${agentName} != '' AND m.sender_name = ${agentName})
              OR (${agentName} != '' AND LENGTH(${agentName}) >= 3 AND m.sender_name ILIKE ${`%${agentName}%`})
            )
        `
        activeChatsCount = parseInt(activeChatsResult[0]?.count || 0)
        
        // Check if agent is online based on recent activity (last 3 minutes for more accuracy)
        const activityResult = await sql`
          SELECT COUNT(*) as count 
          FROM support_agent_activity 
          WHERE agent_id = ${r.id} 
            AND activity_at > NOW() - INTERVAL '3 minutes'
        `
        const hasRecentActivity = parseInt(activityResult[0]?.count || 0) > 0
        
        // Also check active sessions with recent activity (within 5 minutes)
        const sessionResult = await sql`
          SELECT COUNT(*) as count 
          FROM support_agent_sessions s
          WHERE s.agent_id = ${r.id} 
            AND s.is_active = true
            AND EXISTS (
              SELECT 1 FROM support_agent_activity a 
              WHERE a.session_id = s.id 
                AND a.activity_at > NOW() - INTERVAL '5 minutes'
            )
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
      
      // Use status from DB if it's 'online', otherwise use computed isOnline
      const finalStatus = r.status === 'online' ? 'online' : (isOnline ? 'online' : 'offline')
      
      // Parse permissions
      let permissions: string[] = []
      try {
        if (r.permissions) {
          permissions = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions
        }
      } catch (e) { /* invalid json */ }

      return {
        id: r.id,
        name: r.name,
        username: r.username,
        email: r.email,
        telegramId: r.telegram_id,
        role: r.role || 'agent',
        status: finalStatus,
        avatarUrl: r.avatar_url,
        createdAt: r.created_at,
        lastSeenAt: lastSeenAt,
        phone: r.phone,
        position: r.position,
        department: r.department,
        permissions: permissions,
        assignedChannels: resolvedCount,
        activeChats: activeChatsCount,
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
