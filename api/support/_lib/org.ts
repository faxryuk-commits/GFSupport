import { getSQL } from './db.js'
import { extractAgentContext } from './auth.js'

export interface OrgContext {
  orgId: string
  orgSlug: string
  orgName: string
  plan: string
  isActive: boolean
  settings: Record<string, any>
  telegramBotToken: string | null
  telegramBotUsername: string | null
  whatsappBridgeUrl: string | null
  whatsappBridgeSecret: string | null
  openaiApiKey: string | null
  aiModel: string
  maxAgents: number
  maxChannels: number
  maxMessagesPerMonth: number
}

const orgCache = new Map<string, { org: OrgContext; ts: number }>()
const ORG_CACHE_TTL = 30_000

async function loadOrg(orgId: string): Promise<OrgContext | null> {
  const cached = orgCache.get(orgId)
  if (cached && Date.now() - cached.ts < ORG_CACHE_TTL) return cached.org

  const sql = getSQL()
  const [row] = await sql`
    SELECT id, slug, name, plan, is_active,
           settings, telegram_bot_token, telegram_bot_username,
           whatsapp_bridge_url, whatsapp_bridge_secret,
           openai_api_key, ai_model,
           max_agents, max_channels, max_messages_per_month
    FROM support_organizations
    WHERE id = ${orgId} AND is_active = true
    LIMIT 1
  `
  if (!row) return null

  const org: OrgContext = {
    orgId: row.id,
    orgSlug: row.slug,
    orgName: row.name,
    plan: row.plan || 'starter',
    isActive: row.is_active,
    settings: row.settings || {},
    telegramBotToken: row.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || null,
    telegramBotUsername: row.telegram_bot_username || null,
    whatsappBridgeUrl: row.whatsapp_bridge_url || process.env.WHATSAPP_BRIDGE_URL || null,
    whatsappBridgeSecret: row.whatsapp_bridge_secret || process.env.WHATSAPP_BRIDGE_SECRET || null,
    openaiApiKey: row.openai_api_key || process.env.OPENAI_API_KEY || null,
    aiModel: row.ai_model || 'gpt-4o-mini',
    maxAgents: row.max_agents || 5,
    maxChannels: row.max_channels || 50,
    maxMessagesPerMonth: row.max_messages_per_month || 10000,
  }

  orgCache.set(orgId, { org, ts: Date.now() })
  return org
}

async function loadOrgBySlug(slug: string): Promise<OrgContext | null> {
  const sql = getSQL()
  const [row] = await sql`
    SELECT id FROM support_organizations WHERE slug = ${slug} AND is_active = true LIMIT 1
  `
  if (!row) return null
  return loadOrg(row.id)
}

/**
 * Extract org context from request. Resolution order:
 * 1. X-Org-Id header (set by frontend)
 * 2. Agent's org_id (from DB, after auth)
 * 3. Subdomain (delever.gfsupport.app → slug "delever")
 * 4. Fallback to org_delever (transition period)
 */
export async function extractOrgContext(req: Request, agentOrgId?: string | null): Promise<OrgContext | null> {
  // 1. Explicit header
  const headerOrgId = req.headers.get('X-Org-Id')
  if (headerOrgId) {
    return loadOrg(headerOrgId)
  }

  // 2. From agent record
  if (agentOrgId) {
    return loadOrg(agentOrgId)
  }

  // 3. From subdomain
  const host = req.headers.get('host') || ''
  const parts = host.split('.')
  if (parts.length >= 3) {
    const sub = parts[0]
    const reserved = ['www', 'app', 'admin', 'api', 'mail', 'smtp', 'static', 'cdn']
    if (!reserved.includes(sub)) {
      const org = await loadOrgBySlug(sub)
      if (org) return org
    }
  }

  // 4. Fallback for transition period
  return loadOrg('org_delever')
}

export function getOrgBotToken(org: OrgContext): string | null {
  return org.telegramBotToken
}

export function getOrgOpenAIKey(org: OrgContext): string | null {
  return org.openaiApiKey
}

export function getOrgSetting(org: OrgContext, key: string, fallback?: string): string | undefined {
  return org.settings?.[key] ?? fallback
}

export function invalidateOrgCache(orgId?: string) {
  if (orgId) orgCache.delete(orgId)
  else orgCache.clear()
}

/**
 * Lightweight helper: returns just the orgId string for SQL WHERE clauses.
 * Resolution: X-Org-Id header → agent DB record → subdomain → fallback 'org_delever'.
 */
export async function getRequestOrgId(req: Request): Promise<string> {
  const header = req.headers.get('X-Org-Id')

  // Организация сотрудника берётся из его учётной записи, а не из заголовка.
  // Заголовок ставит наш же фронт, но подделать его может кто угодно: пока
  // он принимался как есть, учётная запись демо-организации читала боевые
  // данные Delever, просто подставив чужой идентификатор.
  // Платформенному админу межорганизационный доступ нужен по работе.
  const ctx = await extractAgentContext(req)
  if (ctx.agentId) {
    if (ctx.isSuperAdmin && header) return header
    if (ctx.orgId) return ctx.orgId
  }

  // Без входа (вебхуки, публичные формы) организацию по-прежнему подсказывает
  // заголовок или поддомен: там нет учётной записи, от которой отталкиваться
  if (header) return header

  const host = req.headers.get('host') || ''
  const hostParts = host.split('.')
  if (hostParts.length >= 3) {
    const sub = hostParts[0]
    const reserved = ['www', 'app', 'admin', 'api', 'mail', 'static', 'cdn']
    if (!reserved.includes(sub)) {
      try {
        const sql = getSQL()
        const [row] = await sql`SELECT id FROM support_organizations WHERE slug = ${sub} AND is_active = true LIMIT 1`
        if (row?.id) return row.id
      } catch {}
    }
  }

  return 'org_delever'
}
