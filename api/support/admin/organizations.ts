import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { invalidateOrgCache } from '../lib/org.js'
import { writeAuditLog } from '../lib/audit.js'

export const config = { runtime: 'edge' }

function requireSuperAdmin(ctx: Awaited<ReturnType<typeof extractAgentContext>>) {
  return ctx.isSuperAdmin || ctx.isGlobalAdmin
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'Unauthorized' }, 401)
  if (!requireSuperAdmin(ctx)) return json({ error: 'Superadmin access required' }, 403)

  const sql = getSQL()
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const orgId = url.searchParams.get('id')

    if (orgId) {
      const [org] = await sql`SELECT * FROM support_organizations WHERE id = ${orgId}`
      if (!org) return json({ error: 'Organization not found' }, 404)

      const [agentCount] = await sql`SELECT COUNT(*)::int as c FROM support_agents WHERE org_id = ${orgId}`
      const [channelCount] = await sql`SELECT COUNT(*)::int as c FROM support_channels WHERE org_id = ${orgId}`
      const [msgCount] = await sql`SELECT COUNT(*)::int as c FROM support_messages WHERE org_id = ${orgId} AND created_at > NOW() - INTERVAL '30 days'`
      const [caseCount] = await sql`SELECT COUNT(*)::int as c FROM support_cases WHERE org_id = ${orgId}`

      return json({
        org: formatOrg(org),
        stats: {
          agents: agentCount?.c || 0,
          channels: channelCount?.c || 0,
          messagesLast30d: msgCount?.c || 0,
          cases: caseCount?.c || 0,
        },
      })
    }

    const orgs = await sql`
      SELECT o.*,
        (SELECT COUNT(*)::int FROM support_agents WHERE org_id = o.id) as agent_count,
        (SELECT COUNT(*)::int FROM support_channels WHERE org_id = o.id) as channel_count,
        (SELECT COUNT(*)::int FROM support_messages WHERE org_id = o.id AND created_at > NOW() - INTERVAL '30 days') as msg_count_30d
      FROM support_organizations o
      ORDER BY o.created_at DESC
    `

    return json({
      organizations: orgs.map((o: any) => ({
        ...formatOrg(o),
        stats: {
          agents: o.agent_count || 0,
          channels: o.channel_count || 0,
          messagesLast30d: o.msg_count_30d || 0,
        },
      })),
      total: orgs.length,
    })
  }

  if (req.method === 'POST') {
    const body = await req.json()
    const { name, slug, plan, maxAgents, maxChannels, maxMessagesPerMonth, telegramBotToken, whatsappBridgeUrl, whatsappBridgeSecret, openaiApiKey } = body

    if (!name || !slug) return json({ error: 'name and slug are required' }, 400)
    if (!/^[a-z0-9-]+$/.test(slug)) return json({ error: 'slug must be lowercase alphanumeric with hyphens' }, 400)

    const existing = await sql`SELECT id FROM support_organizations WHERE slug = ${slug}`
    if (existing.length > 0) return json({ error: 'Organization with this slug already exists' }, 409)

    const orgId = `org_${slug}`

    await sql`
      INSERT INTO support_organizations (
        id, name, slug, plan,
        max_agents, max_channels, max_messages_per_month,
        telegram_bot_token, whatsapp_bridge_url, whatsapp_bridge_secret, openai_api_key,
        is_active, created_at, updated_at
      ) VALUES (
        ${orgId}, ${name}, ${slug}, ${plan || 'starter'},
        ${maxAgents || 5}, ${maxChannels || 50}, ${maxMessagesPerMonth || 10000},
        ${telegramBotToken || null}, ${whatsappBridgeUrl || null}, ${whatsappBridgeSecret || null}, ${openaiApiKey || null},
        true, NOW(), NOW()
      )
    `

    writeAuditLog({ orgId, agentId: ctx.agentId!, action: 'org.create', details: { name, slug } })

    return json({ success: true, orgId, message: `Organization "${name}" created` }, 201)
  }

  if (req.method === 'PUT') {
    const body = await req.json()
    const { id, name, plan, isActive, maxAgents, maxChannels, maxMessagesPerMonth, telegramBotToken, telegramBotUsername, whatsappBridgeUrl, whatsappBridgeSecret, openaiApiKey, aiModel, logoUrl, settings } = body

    if (!id) return json({ error: 'id is required' }, 400)

    const [existing] = await sql`SELECT id FROM support_organizations WHERE id = ${id}`
    if (!existing) return json({ error: 'Organization not found' }, 404)

    await sql`
      UPDATE support_organizations SET
        name = COALESCE(${name ?? null}, name),
        plan = COALESCE(${plan ?? null}, plan),
        is_active = COALESCE(${isActive ?? null}, is_active),
        max_agents = COALESCE(${maxAgents ?? null}, max_agents),
        max_channels = COALESCE(${maxChannels ?? null}, max_channels),
        max_messages_per_month = COALESCE(${maxMessagesPerMonth ?? null}, max_messages_per_month),
        telegram_bot_token = COALESCE(${telegramBotToken ?? null}, telegram_bot_token),
        telegram_bot_username = COALESCE(${telegramBotUsername ?? null}, telegram_bot_username),
        whatsapp_bridge_url = COALESCE(${whatsappBridgeUrl ?? null}, whatsapp_bridge_url),
        whatsapp_bridge_secret = COALESCE(${whatsappBridgeSecret ?? null}, whatsapp_bridge_secret),
        openai_api_key = COALESCE(${openaiApiKey ?? null}, openai_api_key),
        ai_model = COALESCE(${aiModel ?? null}, ai_model),
        logo_url = COALESCE(${logoUrl ?? null}, logo_url),
        settings = COALESCE(${settings ? JSON.stringify(settings) : null}::jsonb, settings),
        updated_at = NOW()
      WHERE id = ${id}
    `

    invalidateOrgCache(id)
    writeAuditLog({ orgId: id, agentId: ctx.agentId!, action: 'org.update', details: body })

    return json({ success: true, message: 'Organization updated' })
  }

  if (req.method === 'DELETE') {
    const orgId = url.searchParams.get('id')
    if (!orgId) return json({ error: 'id is required' }, 400)
    if (orgId === 'org_delever') return json({ error: 'Cannot delete the primary organization' }, 403)

    await sql`UPDATE support_organizations SET is_active = false, updated_at = NOW() WHERE id = ${orgId}`
    invalidateOrgCache(orgId)
    writeAuditLog({ orgId, agentId: ctx.agentId!, action: 'org.deactivate' })

    return json({ success: true, message: 'Organization deactivated' })
  }

  return json({ error: 'Method not allowed' }, 405)
}

function formatOrg(o: any) {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    plan: o.plan,
    logoUrl: o.logo_url,
    isActive: o.is_active,
    maxAgents: o.max_agents,
    maxChannels: o.max_channels,
    maxMessagesPerMonth: o.max_messages_per_month,
    hasTelegram: !!o.telegram_bot_token,
    telegramBotUsername: o.telegram_bot_username,
    hasWhatsApp: !!o.whatsapp_bridge_url,
    hasOpenAI: !!o.openai_api_key,
    aiModel: o.ai_model,
    ownerAgentId: o.owner_agent_id,
    trialEndsAt: o.trial_ends_at,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  }
}
