import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { getRequestOrgId } from '../lib/org.js'

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'Unauthorized' }, 401)

  const sql = getSQL()
  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200)
  const offset = parseInt(url.searchParams.get('offset') || '0')
  const action = url.searchParams.get('action')
  const agentFilter = url.searchParams.get('agentId')

  if (ctx.isSuperAdmin || ctx.isGlobalAdmin) {
    const orgFilter = url.searchParams.get('orgId')

    let logs
    if (orgFilter && action) {
      logs = await sql`
        SELECT a.*, ag.name as agent_name
        FROM support_audit_log a
        LEFT JOIN support_agents ag ON ag.id = a.agent_id
        WHERE a.org_id = ${orgFilter} AND a.action = ${action}
        ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}
      `
    } else if (orgFilter) {
      logs = await sql`
        SELECT a.*, ag.name as agent_name
        FROM support_audit_log a
        LEFT JOIN support_agents ag ON ag.id = a.agent_id
        WHERE a.org_id = ${orgFilter}
        ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}
      `
    } else if (action) {
      logs = await sql`
        SELECT a.*, ag.name as agent_name
        FROM support_audit_log a
        LEFT JOIN support_agents ag ON ag.id = a.agent_id
        WHERE a.action = ${action}
        ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}
      `
    } else {
      logs = await sql`
        SELECT a.*, ag.name as agent_name
        FROM support_audit_log a
        LEFT JOIN support_agents ag ON ag.id = a.agent_id
        ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}
      `
    }

    return json({
      logs: logs.map(formatLog),
      limit,
      offset,
    })
  }

  // Non-superadmin: only see own org's logs
  const orgId = await getRequestOrgId(req)
  if (!ctx.isOrgAdmin) return json({ error: 'Admin access required' }, 403)

  const logs = await sql`
    SELECT a.*, ag.name as agent_name
    FROM support_audit_log a
    LEFT JOIN support_agents ag ON ag.id = a.agent_id
    WHERE a.org_id = ${orgId}
    ${agentFilter ? sql`AND a.agent_id = ${agentFilter}` : sql``}
    ${action ? sql`AND a.action = ${action}` : sql``}
    ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}
  `

  return json({ logs: logs.map(formatLog), limit, offset })
}

function formatLog(l: any) {
  return {
    id: l.id,
    orgId: l.org_id,
    agentId: l.agent_id,
    agentName: l.agent_name || null,
    action: l.action,
    targetType: l.target_type,
    targetId: l.target_id,
    details: l.details,
    ip: l.ip,
    createdAt: l.created_at,
  }
}
