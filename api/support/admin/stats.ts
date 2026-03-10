import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'Unauthorized' }, 401)
  if (!ctx.isSuperAdmin && !ctx.isGlobalAdmin) return json({ error: 'Superadmin access required' }, 403)

  const sql = getSQL()

  try {
    const [orgsTotal, orgsActive, agentsTotal, channelsTotal, msgsToday, msgs30d, casesOpen] = await Promise.all([
      sql`SELECT COUNT(*)::int as c FROM support_organizations`,
      sql`SELECT COUNT(*)::int as c FROM support_organizations WHERE is_active = true`,
      sql`SELECT COUNT(*)::int as c FROM support_agents`,
      sql`SELECT COUNT(*)::int as c FROM support_channels`,
      sql`SELECT COUNT(*)::int as c FROM support_messages WHERE created_at > NOW() - INTERVAL '1 day'`,
      sql`SELECT COUNT(*)::int as c FROM support_messages WHERE created_at > NOW() - INTERVAL '30 days'`,
      sql`SELECT COUNT(*)::int as c FROM support_cases WHERE status NOT IN ('resolved', 'closed')`,
    ])

    const perOrg = await sql`
      SELECT 
        o.id, o.name, o.slug, o.plan, o.is_active,
        (SELECT COUNT(*)::int FROM support_agents WHERE org_id = o.id) as agents,
        (SELECT COUNT(*)::int FROM support_channels WHERE org_id = o.id) as channels,
        (SELECT COUNT(*)::int FROM support_messages WHERE org_id = o.id AND created_at > NOW() - INTERVAL '1 day') as msgs_today,
        (SELECT COUNT(*)::int FROM support_messages WHERE org_id = o.id AND created_at > NOW() - INTERVAL '30 days') as msgs_30d,
        (SELECT COUNT(*)::int FROM support_cases WHERE org_id = o.id AND status NOT IN ('resolved', 'closed')) as open_cases
      FROM support_organizations o
      ORDER BY o.created_at
    `

    const dailyTrend = await sql`
      SELECT DATE(created_at) as day, COUNT(*)::int as messages
      FROM support_messages
      WHERE created_at > NOW() - INTERVAL '14 days'
      GROUP BY DATE(created_at)
      ORDER BY day
    `

    return json({
      global: {
        organizations: { total: orgsTotal[0]?.c || 0, active: orgsActive[0]?.c || 0 },
        agents: agentsTotal[0]?.c || 0,
        channels: channelsTotal[0]?.c || 0,
        messages: { today: msgsToday[0]?.c || 0, last30d: msgs30d[0]?.c || 0 },
        openCases: casesOpen[0]?.c || 0,
      },
      perOrg: perOrg.map((o: any) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        plan: o.plan,
        isActive: o.is_active,
        agents: o.agents,
        channels: o.channels,
        msgsToday: o.msgs_today,
        msgs30d: o.msgs_30d,
        openCases: o.open_cases,
      })),
      dailyTrend: dailyTrend.map((d: any) => ({ day: d.day, messages: d.messages })),
    })
  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
