import { getSQL } from './db.js'
import { TOKEN_PREFIX, resolveSession } from './session.js'

export interface AgentContext {
  agentId: string | null
  orgId: string | null
  marketIds: string[]
  isGlobalAdmin: boolean
  isSuperAdmin: boolean
  isOrgAdmin: boolean
  /** Руководящая роль: админы, CCO, тимлиды. Право на разрушающие действия. */
  isLead: boolean
  /**
   * Токен старого образца (идентификатор сотрудника). Обработчик обменяет
   * его на сессию и вернёт новый заголовком, чтобы команда не оказалась
   * разом выброшена из системы.
   */
  legacyToken?: string | null
}

/** Роли с правом руководителя: удаление, настройки команды, чужие задачи. */
const LEAD_ROLES = ['admin', 'org_admin', 'cco', 'team_lead', 'lead']

/**
 * Пускать ли токены старого образца, где токеном был сам идентификатор
 * сотрудника. Такой идентификатор система отдаёт в обычных ответах — значит
 * это не пароль, а публичное значение. Выключается переменной
 * LEGACY_AGENT_TOKENS=off, когда команда переехала на сессии.
 */
const LEGACY_OK = String(process.env.LEGACY_AGENT_TOKENS || 'on').toLowerCase() !== 'off'

export async function extractAgentContext(req: Request): Promise<AgentContext> {
  const fallback: AgentContext = {
    agentId: null, orgId: null, marketIds: [],
    isGlobalAdmin: false, isSuperAdmin: false, isOrgAdmin: false, isLead: false,
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return fallback

  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return fallback

  try {
    const sql = getSQL()
    let agentRow: any = null
    let legacyToken: string | null = null

    if (token.startsWith(TOKEN_PREFIX)) {
      agentRow = await resolveSession(sql, token)
    } else if (token.startsWith('agent') && LEGACY_OK) {
      // Старый образец: токеном был идентификатор сотрудника
      ;[agentRow] = await sql`
        SELECT id, role, permissions, org_id FROM support_agents WHERE id = ${token} LIMIT 1
      `
      if (!agentRow && token.startsWith('agent_agent_')) {
        const inner = token.slice(6)
        ;[agentRow] = await sql`
          SELECT id, role, permissions, org_id FROM support_agents
          WHERE ${inner} LIKE id || '%' ORDER BY LENGTH(id) DESC LIMIT 1
        `
      }
      if (agentRow) legacyToken = token
    }

    // Токен не опознан — гость. Раньше здесь возвращался сам токен в роли
    // идентификатора, и любая строка, начинающаяся с «agent», проходила
    // проверку `if (!ctx.agentId)` во всех обработчиках: систему можно было
    // читать вообще без учётной записи
    if (!agentRow?.id) return fallback

    const agentId = String(agentRow.id)
    const isSuperAdmin = Array.isArray(agentRow.permissions) && agentRow.permissions.includes('superadmin')
    const isGlobalAdmin = agentRow.role === 'admin'
      || isSuperAdmin
      || (Array.isArray(agentRow.permissions) && agentRow.permissions.includes('global_admin'))
    const isOrgAdmin = agentRow.role === 'admin' || agentRow.role === 'org_admin'
    const isLead = isGlobalAdmin || isOrgAdmin || LEAD_ROLES.includes(String(agentRow.role))

    const orgId = agentRow.org_id || null

    const marketRows = await sql`
      SELECT market_id FROM support_agent_markets WHERE agent_id = ${agentId}
    `
    const marketIds = marketRows.map((r: any) => r.market_id)

    return { agentId, orgId, marketIds, isGlobalAdmin, isSuperAdmin, isOrgAdmin, isLead, legacyToken }
  } catch {
    // База не ответила — это не повод пускать: раньше здесь выдавался доступ
    return fallback
  }
}

export function buildMarketFilter(ctx: AgentContext, selectedMarket?: string | null): string[] {
  if (ctx.isGlobalAdmin && !selectedMarket) return []
  if (selectedMarket && (ctx.isGlobalAdmin || ctx.marketIds.includes(selectedMarket))) {
    return [selectedMarket]
  }
  return ctx.marketIds
}
