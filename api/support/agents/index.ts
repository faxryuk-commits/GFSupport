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
    // Авто-синхронизация из support_users (role='employee')
    try {
      await sql`
        INSERT INTO support_agents (id, name, username, telegram_id, role)
        SELECT
          'agent_' || u.telegram_id::text,
          u.name,
          REPLACE(COALESCE(u.telegram_username, ''), '@', ''),
          u.telegram_id::text,
          'agent'
        FROM support_users u
        WHERE u.role = 'employee'
          AND u.is_active = true
          AND u.telegram_id IS NOT NULL
          AND u.name IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM support_agents sa
            WHERE sa.telegram_id = u.telegram_id::text
          )
        ON CONFLICT (id) DO NOTHING
      `
    } catch (e) { /* user sync skipped */ }

    const rows = await sql`SELECT id, name, username, email, telegram_id, role, status, avatar_url, created_at, phone, position, department, permissions FROM support_agents ORDER BY name ASC`

    // Batch queries instead of N+1 per agent
    let activityMap: Record<string, { lastSeen: string }> = {}
    let metricsMap: Record<string, { messages: number; resolved: number; active: number }> = {}

    try {
      // One query for all agent activity (online check + last seen)
      const activityRows = await sql`
        SELECT agent_id, MAX(activity_at) as last_seen
        FROM support_agent_activity
        WHERE activity_at > NOW() - INTERVAL '24 hours'
        GROUP BY agent_id
      `
      for (const a of activityRows) {
        activityMap[a.agent_id] = { lastSeen: a.last_seen }
      }
    } catch (e) { /* table might not exist */ }

    try {
      // One query for message counts per agent
      const msgRows = await sql`
        SELECT 
          COALESCE(a.id, m.sender_id::text) as agent_id,
          COUNT(*) as msg_count,
          COUNT(DISTINCT m.channel_id) FILTER (WHERE c.awaiting_reply = false) as resolved_count,
          COUNT(DISTINCT m.channel_id) FILTER (WHERE c.awaiting_reply = true AND m.created_at > NOW() - INTERVAL '7 days') as active_count
        FROM support_messages m
        JOIN support_channels c ON c.id = m.channel_id
        LEFT JOIN support_agents a ON (
          a.telegram_id::text = m.sender_id::text
          OR a.id::text = m.sender_id::text
          OR LOWER(a.username) = LOWER(m.sender_username)
          OR LOWER(a.name) = LOWER(m.sender_name)
        )
        WHERE (m.sender_role IN ('support', 'team', 'agent') OR m.is_from_client = false)
          AND m.created_at > NOW() - INTERVAL '30 days'
        GROUP BY COALESCE(a.id, m.sender_id::text)
      `
      for (const m of msgRows) {
        metricsMap[m.agent_id] = {
          messages: parseInt(m.msg_count),
          resolved: parseInt(m.resolved_count),
          active: parseInt(m.active_count),
        }
      }
    } catch (e) { /* table might not exist */ }

    const now = Date.now()
    const THREE_MINUTES_MS = 3 * 60 * 1000

    const agentsWithMetrics = rows.map((r: any) => {
      const activity = activityMap[r.id]
      const metrics = metricsMap[r.id] || { messages: 0, resolved: 0, active: 0 }

      const lastSeenAt = activity?.lastSeen || null
      const isOnline = lastSeenAt 
        ? (now - new Date(lastSeenAt).getTime()) < THREE_MINUTES_MS
        : false
      const finalStatus = isOnline ? 'online' : 'offline'
      
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
        assignedChannels: metrics.resolved,
        activeChats: metrics.active,
        metrics: {
          totalConversations: metrics.messages,
          resolvedConversations: metrics.resolved,
          avgFirstResponseMin: 0,
          avgResolutionMin: 0,
          satisfactionScore: '0',
          messagesHandled: metrics.messages,
          escalations: 0
        }
      }
    })

    return json({ agents: agentsWithMetrics })
  } catch (e: any) {
    if (e.message?.includes('does not exist')) {
      return json({ agents: [] })
    }
    return json({ error: e.message }, 500)
  }
}
