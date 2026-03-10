import { json, corsHeaders } from '../lib/db.js'
import { extractSuperAdminContext } from '../lib/sa-auth.js'
import { extractAgentContext } from '../lib/auth.js'
import { getRequestOrgId } from '../lib/org.js'
import { checkAgentQuota, checkChannelQuota, checkMessageQuota } from '../lib/quota.js'

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const sa = await extractSuperAdminContext(req)
  if (!sa.saId) {
    const ctx = await extractAgentContext(req)
    if (!ctx.agentId) return json({ error: 'Unauthorized' }, 401)
  }

  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId') || await getRequestOrgId(req)

  const [agents, channels, messages] = await Promise.all([
    checkAgentQuota(orgId),
    checkChannelQuota(orgId),
    checkMessageQuota(orgId),
  ])

  return json({
    orgId,
    agents: { current: agents.current, limit: agents.limit, percent: Math.round((agents.current / agents.limit) * 100) },
    channels: { current: channels.current, limit: channels.limit, percent: Math.round((channels.current / channels.limit) * 100) },
    messages: { current: messages.current, limit: messages.limit, percent: Math.round((messages.current / messages.limit) * 100) },
  })
}
