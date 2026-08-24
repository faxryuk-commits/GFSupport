import { getRequestOrgId } from './lib/org.js'
import { getSQL, json, corsHeaders } from './lib/db.js'
import { extractAgentContext } from './lib/auth.js'

export const config = { runtime: 'edge' }

/**
 * Четыре числа для сайдбара: непрочитанные, открытые кейсы, обещания, кто в сети.
 *
 * Раньше их считал фронт, вытаскивая четыре полных списка: тысячу каналов
 * (55 кБ) ради суммы непрочитанных, пятьсот кейсов ради длины массива, все
 * обещания и всех агентов. Шестьдесят пять килобайт и до 2,8 секунды на
 * каждое обновление счётчиков — на каждой странице, каждые полминуты.
 * Считать это должна база: она умеет COUNT, и ответ помещается в строку.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  // Рынок пробрасываем тем же параметром, что и остальные экраны: счётчик
  // обязан считать ровно то, что человек увидит, открыв раздел
  const market = url.searchParams.get('market') || ''

  // Счётчики — естественный пульс: приложение зовёт их каждые полминуты,
  // пока вкладка открыта. Отмечаем активность звонящего и гасим протухший
  // «онлайн» (статус ставился при входе и жил вечно — в сети «были» 13
  // человек при одном реальном). Правдивый статус чинит заодно и теги
  // агента: «онлайн» в списках снова значит «в сети сейчас»
  const [, , chats, cases, commitments, agents] = await sql.transaction([
    sql`
      UPDATE support_agents SET last_active_at = NOW(), status = 'online'
      WHERE id = ${ctx.agentId} AND org_id = ${orgId}
    `,
    sql`
      UPDATE support_agents SET status = 'offline'
      WHERE org_id = ${orgId} AND status <> 'offline'
        AND (last_active_at IS NULL OR last_active_at < NOW() - INTERVAL '15 minutes')
    `,
    sql`
      SELECT COALESCE(SUM(unread_count), 0)::int AS unread
      FROM support_channels
      WHERE org_id = ${orgId} AND is_active = true
        AND (${market} = '' OR market_id = ${market})
    `,
    sql`
      SELECT COUNT(*)::int AS open FROM support_cases
      WHERE org_id = ${orgId}
        AND status IN ('detected', 'in_progress', 'waiting', 'blocked')
        AND (${market} = '' OR market_id = ${market})
    `,
    sql`
      SELECT COUNT(*)::int AS pending FROM support_commitments
      WHERE org_id = ${orgId} AND status = 'pending'
    `,
    sql`
      SELECT COUNT(*)::int AS online FROM support_agents
      WHERE org_id = ${orgId} AND status = 'online' AND is_active = true
    `,
  ]) as any[]

  return json({
    unreadChats: (chats as any[])[0]?.unread || 0,
    openCases: (cases as any[])[0]?.open || 0,
    pendingCommitments: (commitments as any[])[0]?.pending || 0,
    onlineAgents: (agents as any[])[0]?.online || 0,
  })
}
