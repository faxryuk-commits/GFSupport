import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'
import { resolveRegion } from '../lib/sales-amo.js'

export const config = { runtime: 'edge' }

/**
 * Список сделок: таблица, канбан и блок «требуют внимания».
 *
 * GET ?pipeline=sales&stage=&owner=&market=&q=&view=&from=&to=&limit=&offset=
 *
 *   view=mine       — только свои
 *   view=attention  — то, что собрал движок: сорванная каденция, нет следующего
 *                     шага, превышен норматив этапа
 *
 * Канбан и таблица берут одни и те же данные: это одно представление, а не два
 * разных списка, иначе цифры начнут расходиться.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  // Рынок приходит из переключателя в шапке приложения. Выбран — работаем с
  // его воронкой, «все рынки» — показываем всё, но колонки берём из общей
  const market = await resolveRegion(sql, orgId, url)
  const pipeline = url.searchParams.get('pipeline')
    || (market ? `sales_${market}` : null)
  const view = url.searchParams.get('view') || 'all'
  const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '100', 10))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10))

  // Динамический WHERE через параметризованный запрос — как в журнале «Подключений»
  const conds: string[] = ['d.org_id = $1', "d.pipeline <> 'partner'"]
  const params: any[] = [orgId]
  if (pipeline) {
    params.push(pipeline)
    conds.push(`d.pipeline = $${params.length}`)
  }
  const add = (cond: string, value: any) => {
    params.push(value)
    conds.push(cond.replace('?', `$${params.length}`))
  }

  const stage = url.searchParams.get('stage')
  const owner = url.searchParams.get('owner')
  const q = url.searchParams.get('q')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  if (stage) add('s.key = ?', stage)
  if (owner) add('d.owner_agent_id = ?', owner)
  if (market) add('d.market_id = ?', market)
  if (q) {
    // Поиск идёт по двум колонкам одним текстом — поэтому два плейсхолдера
    params.push(`%${q}%`, `%${q}%`)
    conds.push(`(d.title ILIKE $${params.length - 1} OR a.name ILIKE $${params.length})`)
  }
  if (from) add('d.created_at >= ?::timestamptz', `${from}T00:00:00+05:00`)
  if (to) add('d.created_at <= ?::timestamptz', `${to}T23:59:59+05:00`)

  if (view === 'mine') add('d.owner_agent_id = ?', ctx.agentId)
  if (view === 'open') conds.push('d.won_at IS NULL AND d.lost_at IS NULL')
  if (view === 'attention') {
    // Ровно те признаки, по которым крон помечает сделку проблемной
    conds.push(`d.won_at IS NULL AND d.lost_at IS NULL AND (
      d.stalled_at IS NOT NULL
      OR d.next_step_at IS NULL
      OR (s.sla_hours IS NOT NULL AND d.stage_since < NOW() - (s.sla_hours * INTERVAL '1 hour'))
    )`)
  }
  if (view === 'reactivation') conds.push('d.reactivate_at IS NOT NULL AND d.reactivate_at <= NOW()')
  if (view === 'archive') conds.push('(d.won_at IS NOT NULL OR d.lost_at IS NOT NULL)')
  if (view === 'all') conds.push('d.won_at IS NULL AND d.lost_at IS NULL')

  const where = conds.join(' AND ')
  params.push(limit + 1, offset)

  const rows = await sql.query(
    `SELECT d.id, d.title, d.monthly_amount, d.onetime_amount, d.currency, d.points,
            d.stage_since, d.stalled_at, d.next_step, d.next_step_at, d.expected_close_at,
            d.won_at, d.lost_at, d.created_at, d.market_id,
            s.key AS stage_key, s.label AS stage, s.probability, s.sla_hours,
            a.name AS account, a.city,
            ag.name AS owner_name,
            src.label AS source,
            (SELECT MAX(doc.opened_count) FROM sales_documents doc WHERE doc.deal_id = d.id) AS doc_opens
     FROM sales_deals d
     LEFT JOIN sales_stages s ON s.id = d.stage_id
     LEFT JOIN sales_accounts a ON a.id = d.account_id
     LEFT JOIN support_agents ag ON ag.id = d.owner_agent_id
     LEFT JOIN sales_leads l ON l.id = d.source_lead_id
     LEFT JOIN sales_sources src ON src.id = l.source_id
     WHERE ${where}
     ORDER BY d.stage_since ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  ) as any[]

  const hasMore = rows.length > limit
  if (hasMore) rows.pop()

  // Сводка по этапам для канбана — по всем открытым сделкам воронки,
  // независимо от фильтра вида, чтобы колонки не пустели при переключении
  const summary = await sql`
    SELECT s.key, s.label, s.sort_order, s.probability,
           COUNT(d.id)::int AS deals,
           COALESCE(SUM(d.monthly_amount), 0) AS amount
    FROM sales_stages s
    LEFT JOIN sales_deals d ON d.won_at IS NULL AND d.lost_at IS NULL
      AND d.org_id = s.org_id AND d.stage_id = s.id
    WHERE s.org_id = ${orgId} AND s.pipeline = ${pipeline || 'sales'}
      AND s.kind = 'open' AND s.is_active = true
    GROUP BY s.key, s.label, s.sort_order, s.probability
    ORDER BY s.sort_order
  `

  const [totals] = await sql`
    SELECT COUNT(*)::int AS open_deals,
           COALESCE(SUM(monthly_amount), 0) AS pipeline_amount,
           COUNT(*) FILTER (WHERE stalled_at IS NOT NULL)::int AS stalled,
           COUNT(*) FILTER (WHERE next_step_at IS NULL)::int AS no_next_step
    FROM sales_deals
    WHERE org_id = ${orgId} AND pipeline <> 'partner' AND won_at IS NULL AND lost_at IS NULL
      AND (${market || ''} = '' OR market_id = ${market || ''})
  `

  const owners = await sql`
    SELECT DISTINCT ag.id, ag.name
    FROM sales_deals d JOIN support_agents ag ON ag.id = d.owner_agent_id
    WHERE d.org_id = ${orgId} AND d.pipeline <> 'partner'
    ORDER BY ag.name
  `

  return json({ deals: rows, summary, totals: totals || {}, owners, hasMore, offset, limit })
}
