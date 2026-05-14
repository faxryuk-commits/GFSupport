/**
 * Список существующих ролей в support_agents для org — нужен фронту,
 * чтобы заполнить dropdown фильтра «по роли» в DetailTab/Pulse.
 *
 * GET /api/support/analytics/agent-roles
 *
 * Возвращает массив { role, count } где count — сколько агентов с такой
 * ролью в этой org. Роли отсортированы по убыванию count.
 *
 * Также возвращает массив пресетов — какие наборы ролей считать
 * «командой поддержки» по умолчанию (на случай если в БД встречаются
 * варианты вроде 'support', 'Support', 'support_agent', 'agent').
 */

import { getSQL, json } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'

export const config = {
  runtime: 'edge',
}

// Роли, которые мы по умолчанию считаем «командой поддержки» — клиентоориентированные,
// отвечают на сообщения покупателей. Все варианты в lower-case.
const SUPPORT_ROLE_KEYWORDS = [
  'support',
  'support_agent',
  'agent',
  'team_lead',
  'team lead',
  'team_leader',
  'helpdesk',
  'agent_support',
]

interface RoleRow {
  role: string | null
  count: string | number
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const ctx = await extractAgentContext(req)
  if (!ctx.orgId) return json({ error: 'Unauthorized' }, 401)

  const sql = getSQL()
  try {
    const rows = (await sql`
      SELECT role, COUNT(*)::int AS count
      FROM support_agents
      WHERE org_id = ${ctx.orgId}
      GROUP BY role
      ORDER BY COUNT(*) DESC, role NULLS LAST
    `) as RoleRow[]

    const items = rows.map((r) => ({
      role: r.role,
      count: typeof r.count === 'string' ? parseInt(r.count) : r.count,
    }))

    // Какие из существующих ролей подпадают под пресет «команда поддержки»
    const supportPreset = items
      .map((i) => i.role)
      .filter((r): r is string => !!r && SUPPORT_ROLE_KEYWORDS.includes(r.toLowerCase()))

    return json(
      {
        roles: items,
        presets: {
          support: supportPreset,
        },
      },
      200,
      300,
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[agent-roles]', msg, e instanceof Error ? e.stack : undefined)
    return json({ error: msg, where: 'agent-roles' }, 500)
  }
}
