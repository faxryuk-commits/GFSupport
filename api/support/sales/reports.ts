import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'

export const config = { runtime: 'edge' }

/**
 * Отчёты продаж. Пять штук, больше на старте не нужно:
 * воронка по когорте, деньги в воронке, источники, портрет покупателя, команда.
 *
 * GET ?from=2026-05-01&to=2026-08-31&market=
 *
 * Финансовых метрик здесь нет: «деньги в воронке» — это суммы предложений и
 * взвешенный прогноз, то есть обещания. Факт выручки живёт в админке и план-факте.
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

  // По умолчанию — 90 дней: короче окно не даёт статистики по закрытым сделкам
  const from = url.searchParams.get('from') || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10)
  const fromTs = `${from}T00:00:00+05:00`
  const toTs = `${to}T23:59:59+05:00`

  const [funnel, money, sources, icp, team, cohort] = await Promise.all([
    // Воронка по когорте: сделки, СОЗДАННЫЕ в периоде, доведённые до конца.
    // Считать «прошёл этап» надо по журналу, иначе сделка, проскочившая этап,
    // выпадет из статистики
    sql`
      WITH scope AS (
        SELECT d.id FROM sales_deals d
        WHERE d.org_id = ${orgId} AND d.pipeline = 'sales'
          AND d.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
      )
      SELECT s.key, s.label, s.sort_order,
             COUNT(DISTINCT e.deal_id)::int AS reached
      FROM sales_stages s
      LEFT JOIN sales_deal_events e ON e.new_stage_id = s.id AND e.deal_id IN (SELECT id FROM scope)
      WHERE s.org_id = ${orgId} AND s.pipeline = 'sales' AND s.is_active = true
      GROUP BY s.key, s.label, s.sort_order ORDER BY s.sort_order
    `,
    // Деньги в воронке: суммы предложений по этапам и взвешенный прогноз
    sql`
      SELECT s.key, s.label, s.probability, COUNT(d.id)::int AS deals,
             COALESCE(SUM(d.monthly_amount), 0) AS amount,
             COALESCE(SUM(d.monthly_amount * s.probability / 100.0), 0) AS weighted
      FROM sales_stages s
      LEFT JOIN sales_deals d ON d.stage_id = s.id AND d.won_at IS NULL AND d.lost_at IS NULL
      WHERE s.org_id = ${orgId} AND s.pipeline = 'sales' AND s.kind = 'open' AND s.is_active = true
      GROUP BY s.key, s.label, s.probability, s.sort_order ORDER BY s.sort_order
    `,
    // Источники: сколько лидов, сколько дошло до сделки и до победы
    sql`
      SELECT s.label, s.kind,
             COUNT(l.id)::int AS leads,
             COUNT(l.id) FILTER (WHERE l.status = 'converted')::int AS converted,
             COUNT(d.id) FILTER (WHERE d.won_at IS NOT NULL)::int AS won
      FROM sales_sources s
      LEFT JOIN sales_leads l ON l.source_id = s.id
        AND l.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
      LEFT JOIN sales_deals d ON d.source_lead_id = l.id
      WHERE s.org_id = ${orgId}
      GROUP BY s.label, s.kind HAVING COUNT(l.id) > 0
      ORDER BY leads DESC
    `,
    // Портрет покупателя: по POS — самый сильный признак покупки
    sql`
      SELECT COALESCE(NULLIF(d.pos, ''), 'не указан') AS value,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE d.won_at IS NOT NULL)::int AS won
      FROM sales_deals d
      WHERE d.org_id = ${orgId} AND (d.won_at IS NOT NULL OR d.lost_at IS NOT NULL)
      GROUP BY 1 HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) FILTER (WHERE d.won_at IS NOT NULL)::float / COUNT(*) DESC
      LIMIT 12
    `,
    // Качество ведения: не количество звонков, а как ведут сделки
    sql`
      SELECT ag.name,
             COUNT(d.id)::int AS deals,
             COUNT(d.id) FILTER (WHERE d.won_at IS NOT NULL)::int AS won,
             COUNT(d.id) FILTER (WHERE d.lost_at IS NOT NULL)::int AS lost,
             COUNT(d.id) FILTER (WHERE d.next_step_at IS NULL
               AND d.won_at IS NULL AND d.lost_at IS NULL)::int AS no_next_step,
             COUNT(d.id) FILTER (WHERE d.pos IS NOT NULL AND d.pain IS NOT NULL)::int AS qualified,
             COALESCE(SUM(d.monthly_amount) FILTER (WHERE d.won_at IS NOT NULL), 0) AS won_amount
      FROM sales_deals d
      JOIN support_agents ag ON ag.id = d.owner_agent_id
      WHERE d.org_id = ${orgId}
        AND d.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
      GROUP BY ag.name ORDER BY won DESC
    `,
    // Сколько выигранных дошло до первого заказа — метрика качества продаж,
    // а не финансов: подпись без запуска победой не считается
    sql`
      SELECT COUNT(*)::int AS won,
             COUNT(*) FILTER (WHERE a.first_order_at IS NOT NULL)::int AS launched,
             AVG(EXTRACT(EPOCH FROM (a.first_order_at - d.won_at)) / 86400)
               FILTER (WHERE a.first_order_at IS NOT NULL) AS avg_days
      FROM sales_deals d
      JOIN sales_accounts a ON a.id = d.account_id
      WHERE d.org_id = ${orgId} AND d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
    `,
  ])

  return json({
    period: { from, to },
    funnel, money, sources, icp, team,
    launch: cohort[0] || {},
  })
}
