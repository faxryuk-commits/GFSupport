import { neon } from '@neondatabase/serverless'
import { getRequestOrgId } from '../lib/org.js'
import { checkAgentQuota } from '../lib/quota.js'
import { hashPassword } from '../lib/password.js'

export const config = {
  runtime: 'edge',
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

function json(data: any, status = 200, cacheSeconds = 0) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  }
  if (cacheSeconds > 0) {
    headers['Cache-Control'] = `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`
  }
  return new Response(JSON.stringify(data), { status, headers })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)

  // POST - Create new agent
  if (req.method === 'POST') {
    try {
      const { name, username, email, telegramId, role, password, phone, position, department, permissions } = await req.json()

      if (!name) {
        return json({ error: 'Name is required' }, 400)
      }

      const quota = await checkAgentQuota(orgId)
      if (!quota.allowed) return json({ error: quota.message, quotaExceeded: true }, 403)

      const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const passwordHash = password ? await hashPassword(password) : null
      const permissionsJson = permissions ? JSON.stringify(permissions) : '[]'

      await sql`
        INSERT INTO support_agents (id, name, username, email, telegram_id, role, status, password_hash, phone, position, department, permissions, org_id)
        VALUES (${id}, ${name}, ${username || null}, ${email || null}, ${telegramId || null}, ${role || 'agent'}, 'offline', ${passwordHash}, ${phone || null}, ${position || null}, ${department || null}, ${permissionsJson}::jsonb, ${orgId})
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
        WHERE id = ${id} AND org_id = ${orgId}
      `

      if (password) {
        const passwordHash = await hashPassword(password)
        await sql`UPDATE support_agents SET password_hash = ${passwordHash} WHERE id = ${id} AND org_id = ${orgId}`
      }

      // Update permissions if provided
      if (permissions !== undefined) {
        const permissionsJson = JSON.stringify(permissions)
        await sql`UPDATE support_agents SET permissions = ${permissionsJson}::jsonb WHERE id = ${id} AND org_id = ${orgId}`
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

      await sql`DELETE FROM support_agents WHERE id = ${agentId} AND org_id = ${orgId}`
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
      const agents = await sql`SELECT id, name, username, telegram_id FROM support_agents WHERE telegram_id IS NULL AND org_id = ${orgId}`
      
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
            WHERE id = ${agent.id} AND org_id = ${orgId}
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
    const rows = await sql`
      SELECT id, name, username, email, telegram_id, role, status,
             avatar_url, created_at, phone, position, department, permissions
      FROM support_agents WHERE org_id = ${orgId} ORDER BY name ASC
    `

    const agentIds = rows.map((r: any) => r.id)
    if (agentIds.length === 0) return json({ agents: [] }, 200, 5)

    const [activityRows, msgRows, responseRows, escalationRows] = await Promise.all([
      sql`
        SELECT agent_id, MAX(activity_at) as last_seen
        FROM support_agent_activity
        WHERE activity_at > NOW() - INTERVAL '24 hours'
          AND agent_id = ANY(${agentIds})
        GROUP BY agent_id
      `.catch(() => []),

      sql`
        WITH agent_msgs AS (
          SELECT
            COALESCE(a.id, m.sender_id::text) as agent_id,
            m.channel_id, c.awaiting_reply, m.created_at
          FROM support_messages m
          JOIN support_channels c ON c.id = m.channel_id
          LEFT JOIN support_agents a ON a.telegram_id::text = m.sender_id::text
                                     AND a.org_id = ${orgId}
          WHERE m.is_from_client = false
            AND m.created_at > NOW() - INTERVAL '30 days'
            AND m.org_id = ${orgId}
        )
        SELECT
          agent_id,
          COUNT(*) as msg_count,
          COUNT(DISTINCT channel_id) FILTER (WHERE awaiting_reply = false) as resolved_count,
          COUNT(DISTINCT channel_id) FILTER (WHERE awaiting_reply = true
            AND created_at > NOW() - INTERVAL '7 days') as active_count
        FROM agent_msgs
        WHERE agent_id = ANY(${agentIds})
        GROUP BY agent_id
      `.catch(() => []),

      sql`
        WITH client_msgs AS (
          SELECT channel_id, created_at as client_at
          FROM support_messages
          WHERE is_from_client = true AND org_id = ${orgId}
            AND created_at > NOW() - INTERVAL '30 days'
        ),
        agent_responses AS (
          SELECT
            COALESCE(a.id, m.sender_id::text) as agent_id,
            m.channel_id,
            m.created_at as agent_at,
            (SELECT MAX(cm.client_at) FROM client_msgs cm
             WHERE cm.channel_id = m.channel_id AND cm.client_at < m.created_at) as prev_client_at
          FROM support_messages m
          LEFT JOIN support_agents a ON a.telegram_id::text = m.sender_id::text
                                     AND a.org_id = ${orgId}
          WHERE m.is_from_client = false AND m.org_id = ${orgId}
            AND m.created_at > NOW() - INTERVAL '30 days'
        )
        SELECT agent_id,
          ROUND(AVG(EXTRACT(EPOCH FROM (agent_at - prev_client_at)) / 60))::int as avg_resp_min
        FROM agent_responses
        WHERE prev_client_at IS NOT NULL
          AND agent_id = ANY(${agentIds})
        GROUP BY agent_id
      `.catch(() => []),

      sql`
        SELECT
          COALESCE(tag_agent_id, 'unknown') as agent_id,
          COUNT(*) FILTER (WHERE action = 'escalate') as escalations,
          COUNT(*) FILTER (WHERE feedback_correct = true) as correct,
          COUNT(*) FILTER (WHERE feedback_correct IS NOT NULL) as total_feedback
        FROM support_agent_decisions
        WHERE org_id = ${orgId} AND created_at > NOW() - INTERVAL '30 days'
          AND tag_agent_id = ANY(${agentIds})
        GROUP BY COALESCE(tag_agent_id, 'unknown')
      `.catch(() => []),
    ])

    const activityMap: Record<string, string> = {}
    for (const a of activityRows) activityMap[a.agent_id] = a.last_seen

    const metricsMap: Record<string, any> = {}
    for (const m of msgRows) {
      metricsMap[m.agent_id] = {
        messages: parseInt(m.msg_count), resolved: parseInt(m.resolved_count),
        active: parseInt(m.active_count),
      }
    }

    const respMap: Record<string, number> = {}
    for (const r of responseRows) respMap[r.agent_id] = parseInt(r.avg_resp_min) || 0

    const escMap: Record<string, { escalations: number; satisfaction: number }> = {}
    for (const e of escalationRows) {
      const total = parseInt(e.total_feedback) || 0
      escMap[e.agent_id] = {
        escalations: parseInt(e.escalations) || 0,
        satisfaction: total > 0 ? parseInt(e.correct) / total : 0,
      }
    }

    const now = Date.now()
    const THREE_MIN = 3 * 60 * 1000

    const agentsWithMetrics = rows.map((r: any) => {
      const lastSeenAt = activityMap[r.id] || null
      const isOnline = lastSeenAt ? (now - new Date(lastSeenAt).getTime()) < THREE_MIN : false
      const m = metricsMap[r.id] || { messages: 0, resolved: 0, active: 0 }
      const avgResp = respMap[r.id] || 0
      const esc = escMap[r.id] || { escalations: 0, satisfaction: 0 }

      let permissions: string[] = []
      try {
        if (r.permissions) {
          permissions = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions
        }
      } catch { /* invalid json */ }

      return {
        id: r.id, name: r.name, username: r.username, email: r.email,
        telegramId: r.telegram_id, role: r.role || 'agent',
        status: isOnline ? 'online' : 'offline',
        avatarUrl: r.avatar_url, createdAt: r.created_at,
        lastSeenAt, phone: r.phone, position: r.position,
        department: r.department, permissions,
        assignedChannels: m.resolved, activeChats: m.active,
        points: m.messages + m.resolved * 5 + (esc.escalations > 0 ? 0 : 10),
        metrics: {
          totalConversations: m.messages,
          resolvedConversations: m.resolved,
          avgFirstResponseMin: avgResp,
          avgResolutionMin: 0,
          satisfactionScore: esc.satisfaction.toFixed(2),
          messagesHandled: m.messages,
          escalations: esc.escalations,
        },
      }
    })

    return json({ agents: agentsWithMetrics, _v: 2 }, 200, 5)
  } catch (e: any) {
    if (e.message?.includes('does not exist')) {
      return json({ agents: [] })
    }
    return json({ error: e.message }, 500)
  }
}
