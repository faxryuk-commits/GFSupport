import { getSQL } from './db.js'

export interface AgentContext {
  agentId: string | null
  orgId: string | null
  marketIds: string[]
  isGlobalAdmin: boolean
  isSuperAdmin: boolean
  isOrgAdmin: boolean
}

export async function extractAgentContext(req: Request): Promise<AgentContext> {
  const fallback: AgentContext = {
    agentId: null, orgId: null, marketIds: [],
    isGlobalAdmin: false, isSuperAdmin: false, isOrgAdmin: false,
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return fallback

  const token = authHeader.replace('Bearer ', '').trim()
  if (!token.startsWith('agent')) return fallback

  try {
    const sql = getSQL()

    // New format: token IS the agentId (e.g. agent_1772526727220_akc3)
    let [agentRow] = await sql`
      SELECT id, role, permissions, org_id FROM support_agents WHERE id = ${token} LIMIT 1
    `

    // Backward compat: old format agent_<agentId>_<timestamp>
    if (!agentRow && token.startsWith('agent_agent_')) {
      const inner = token.slice(6) // strip outer 'agent_' → agent_xxx_yyy_ts
      ;[agentRow] = await sql`
        SELECT id, role, permissions, org_id FROM support_agents
        WHERE ${inner} LIKE id || '%' ORDER BY LENGTH(id) DESC LIMIT 1
      `
    }

    const agentId = agentRow?.id || token
    if (!agentRow) return { ...fallback, agentId }

    const isSuperAdmin = Array.isArray(agentRow.permissions) && agentRow.permissions.includes('superadmin')
    const isGlobalAdmin = agentRow.role === 'admin'
      || isSuperAdmin
      || (Array.isArray(agentRow.permissions) && agentRow.permissions.includes('global_admin'))
    const isOrgAdmin = agentRow.role === 'admin' || agentRow.role === 'org_admin'

    const orgId = agentRow.org_id || null

    const marketRows = await sql`
      SELECT market_id FROM support_agent_markets WHERE agent_id = ${agentId}
    `
    const marketIds = marketRows.map((r: any) => r.market_id)

    return { agentId, orgId, marketIds, isGlobalAdmin, isSuperAdmin, isOrgAdmin }
  } catch {
    return { ...fallback, agentId }
  }
}

export function buildMarketFilter(ctx: AgentContext, selectedMarket?: string | null): string[] {
  if (ctx.isGlobalAdmin && !selectedMarket) return []
  if (selectedMarket && (ctx.isGlobalAdmin || ctx.marketIds.includes(selectedMarket))) {
    return [selectedMarket]
  }
  return ctx.marketIds
}
