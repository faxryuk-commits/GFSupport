import { getSQL } from './db.js'

export interface AgentContext {
  agentId: string | null
  marketIds: string[]
  isGlobalAdmin: boolean
}

export async function extractAgentContext(req: Request): Promise<AgentContext> {
  const fallback: AgentContext = { agentId: null, marketIds: [], isGlobalAdmin: false }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return fallback

  const token = authHeader.replace('Bearer ', '')
  const parts = token.split('_')
  if (parts.length < 3 || parts[0] !== 'agent') return fallback

  const agentId = `${parts[0]}_${parts[1]}_${parts[2]}`

  try {
    const sql = getSQL()
    const [agentRow] = await sql`
      SELECT id, role, permissions FROM support_agents WHERE id = ${agentId} LIMIT 1
    `
    if (!agentRow) return { ...fallback, agentId }

    const isGlobalAdmin = agentRow.role === 'admin'
      || (Array.isArray(agentRow.permissions) && agentRow.permissions.includes('global_admin'))

    const marketRows = await sql`
      SELECT market_id FROM support_agent_markets WHERE agent_id = ${agentId}
    `
    const marketIds = marketRows.map((r: any) => r.market_id)

    return { agentId, marketIds, isGlobalAdmin }
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
