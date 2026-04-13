import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = { runtime: 'edge' }

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

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  try { await sql`CREATE TABLE IF NOT EXISTS support_markets (
    id VARCHAR(50) PRIMARY KEY, name VARCHAR(255) NOT NULL, code VARCHAR(10) UNIQUE NOT NULL,
    country VARCHAR(100), timezone VARCHAR(50) DEFAULT 'Asia/Tashkent', is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  )` } catch {}
  try { await sql`CREATE TABLE IF NOT EXISTS support_agent_markets (
    agent_id VARCHAR(50) NOT NULL, market_id VARCHAR(50) NOT NULL,
    role VARCHAR(50) DEFAULT 'member', created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (agent_id, market_id)
  )` } catch {}
  try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS market_id VARCHAR(50)` } catch {}
  try { await sql`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS market_id VARCHAR(50)` } catch {}
  try { await sql`ALTER TABLE support_users ADD COLUMN IF NOT EXISTS market_id VARCHAR(50)` } catch {}

  if (req.method === 'GET') {
    if (action === 'agents') {
      const marketId = url.searchParams.get('marketId')
      if (!marketId) return json({ error: 'marketId required' }, 400)
      const agents = await sql`
        SELECT a.id, am.role, a.name, a.username, a.position, a.status
        FROM support_agent_markets am
        JOIN support_agents a ON a.id = am.agent_id
        WHERE am.market_id = ${marketId}
          AND am.org_id = ${orgId}
        ORDER BY a.name
      `
      return json({ agents })
    }

    if (action === 'channels') {
      const marketId = url.searchParams.get('marketId')
      if (!marketId) return json({ error: 'marketId required' }, 400)
      const channels = await sql`
        SELECT id, name, source, type, is_active, last_message_at
        FROM support_channels WHERE market_id = ${marketId}
          AND org_id = ${orgId}
        ORDER BY last_message_at DESC NULLS LAST
      `
      return json({ channels })
    }

    const markets = await sql`SELECT * FROM support_markets WHERE org_id = ${orgId} ORDER BY name`

    const counts = await sql`
      SELECT market_id, COUNT(*)::int as count FROM support_channels
      WHERE market_id IS NOT NULL AND org_id = ${orgId} GROUP BY market_id
    `
    const agentCounts = await sql`
      SELECT market_id, COUNT(*)::int as count FROM support_agent_markets WHERE org_id = ${orgId} GROUP BY market_id
    `
    const channelMap = Object.fromEntries(counts.map((r: any) => [r.market_id, r.count]))
    const agentMap = Object.fromEntries(agentCounts.map((r: any) => [r.market_id, r.count]))

    const unassigned = await sql`
      SELECT COUNT(*)::int as count FROM support_channels WHERE market_id IS NULL AND org_id = ${orgId}
    `

    return json({
      markets: markets.map((m: any) => ({
        id: m.id,
        name: m.name,
        code: m.code,
        country: m.country,
        timezone: m.timezone,
        isActive: m.is_active,
        createdAt: m.created_at,
        channelsCount: channelMap[m.id] || 0,
        agentsCount: agentMap[m.id] || 0,
      })),
      unassignedChannels: unassigned[0]?.count || 0,
    })
  }

  if (req.method === 'POST') {
    const body = await req.json()

    if (action === 'assign-agents') {
      const { marketId, agentIds, role } = body
      if (!marketId || !agentIds?.length) return json({ error: 'marketId and agentIds required' }, 400)
      for (const agentId of agentIds) {
        await sql`
          INSERT INTO support_agent_markets (agent_id, market_id, role, org_id)
          VALUES (${agentId}, ${marketId}, ${role || 'member'}, ${orgId})
          ON CONFLICT (agent_id, market_id) DO UPDATE SET role = ${role || 'member'}
        `
      }
      return json({ success: true, assigned: agentIds.length })
    }

    if (action === 'assign-channels') {
      const { marketId, channelIds } = body
      if (!marketId || !channelIds?.length) return json({ error: 'marketId and channelIds required' }, 400)
      for (const chId of channelIds) {
        await sql`UPDATE support_channels SET market_id = ${marketId} WHERE id = ${chId} AND org_id = ${orgId}`
      }
      return json({ success: true, assigned: channelIds.length })
    }

    if (action === 'remove-agent') {
      const { marketId, agentId } = body
      if (!marketId || !agentId) return json({ error: 'marketId and agentId required' }, 400)
      await sql`DELETE FROM support_agent_markets WHERE agent_id = ${agentId} AND market_id = ${marketId} AND org_id = ${orgId}`
      return json({ success: true })
    }

    const { name, code, country, timezone } = body
    if (!name || !code) return json({ error: 'name and code required' }, 400)

    const id = `market_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    await sql`
      INSERT INTO support_markets (id, name, code, country, timezone, org_id)
      VALUES (${id}, ${name}, ${code.toLowerCase()}, ${country || null}, ${timezone || 'Asia/Tashkent'}, ${orgId})
    `
    return json({ success: true, marketId: id })
  }

  if (req.method === 'PUT') {
    const body = await req.json()
    const { id, name, code, country, timezone, isActive } = body
    if (!id) return json({ error: 'Market ID required' }, 400)
    await sql`
      UPDATE support_markets SET
        name = COALESCE(${name || null}, name),
        code = COALESCE(${code || null}, code),
        country = COALESCE(${country || null}, country),
        timezone = COALESCE(${timezone || null}, timezone),
        is_active = COALESCE(${isActive ?? null}, is_active)
      WHERE id = ${id}
        AND org_id = ${orgId}
    `
    return json({ success: true })
  }

  if (req.method === 'DELETE') {
    const marketId = url.searchParams.get('id')
    if (!marketId) return json({ error: 'Market ID required' }, 400)
    await sql`DELETE FROM support_agent_markets WHERE market_id = ${marketId} AND org_id = ${orgId}`
    await sql`UPDATE support_channels SET market_id = NULL WHERE market_id = ${marketId} AND org_id = ${orgId}`
    await sql`DELETE FROM support_markets WHERE id = ${marketId} AND org_id = ${orgId}`
    return json({ success: true })
  }

  return json({ error: 'Method not allowed' }, 405)
}
