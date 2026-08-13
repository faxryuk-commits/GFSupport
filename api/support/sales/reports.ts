import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'
import { resolveRegion } from '../lib/sales-amo.js'

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
  // Регион из переключателя в шапке: пусто — сводка по всем рынкам
  const market = await resolveRegion(sql, orgId, url)
  const pipeline = market ? `sales_${market}` : 'sales'
  const fromTs = `${from}T00:00:00+05:00`
  const toTs = `${to}T23:59:59+05:00`

  // Прошлый период той же длины — чтобы цифра отвечала на «лучше или хуже»,
  // а не висела в воздухе
  const days = Math.max(1, Math.round(
    (new Date(toTs).getTime() - new Date(fromTs).getTime()) / 86400000))
  const prevFrom = new Date(new Date(fromTs).getTime() - days * 86400000).toISOString()
  const prevTo = fromTs

  const [funnel, money, sources, icp, team, cohort, daily, prev, byRegion] = await Promise.all([
    // Воронка по когорте: сделки, СОЗДАННЫЕ в периоде, доведённые до конца.
    // Считать «прошёл этап» надо по журналу, иначе сделка, проскочившая этап,
    // выпадет из статистики
    sql`
      WITH scope AS (
        SELECT d.id FROM sales_deals d
        WHERE d.org_id = ${orgId} AND d.pipeline <> 'partner'
          AND (${market} = '' OR d.market_id = ${market})
          AND d.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
      )
      SELECT s.key, s.label, s.sort_order,
             COUNT(DISTINCT e.deal_id)::int AS reached
      FROM sales_stages s
      LEFT JOIN sales_deal_events e ON e.new_stage_id = s.id AND e.deal_id IN (SELECT id FROM scope)
      WHERE s.org_id = ${orgId} AND s.pipeline = ${pipeline} AND s.is_active = true
      GROUP BY s.key, s.label, s.sort_order ORDER BY s.sort_order
    `,
    // Деньги в воронке: суммы предложений по этапам и взвешенный прогноз
    sql`
      SELECT s.key, s.label, s.probability, COUNT(d.id)::int AS deals,
             COALESCE(SUM(d.monthly_amount), 0) AS amount,
             COALESCE(SUM(d.monthly_amount * s.probability / 100.0), 0) AS weighted
      FROM sales_stages s
      LEFT JOIN sales_deals d ON d.stage_id = s.id AND d.won_at IS NULL AND d.lost_at IS NULL
        AND d.archived_at IS NULL
        AND (${market} = '' OR d.market_id = ${market})
      WHERE s.org_id = ${orgId} AND s.pipeline = ${pipeline} AND s.kind = 'open' AND s.is_active = true
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
        AND (${market} = '' OR l.market_id = ${market})
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
        AND (${market} = '' OR d.market_id = ${market})
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
      WHERE d.org_id = ${orgId} AND d.archived_at IS NULL
        AND (${market} = '' OR d.market_id = ${market})
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
      WHERE d.org_id = ${orgId} AND (${market} = '' OR d.market_id = ${market})
        AND d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
    `,
    // Движение по дням: сколько заводили, выигрывали и теряли
    sql`
      SELECT day::date AS day,
             COUNT(*) FILTER (WHERE kind = 'created')::int AS created,
             COUNT(*) FILTER (WHERE kind = 'won')::int AS won,
             COUNT(*) FILTER (WHERE kind = 'lost')::int AS lost,
             COALESCE(SUM(amount) FILTER (WHERE kind = 'won'), 0) AS won_amount
      FROM (
        SELECT (d.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent') AS day,
               'created' AS kind, 0::numeric AS amount
        FROM sales_deals d
        WHERE d.org_id = ${orgId} AND d.archived_at IS NULL
          AND (${market} = '' OR d.market_id = ${market})
          AND d.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        UNION ALL
        SELECT (d.won_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent'), 'won',
               COALESCE(d.monthly_amount, 0)
        FROM sales_deals d
        WHERE d.org_id = ${orgId} AND (${market} = '' OR d.market_id = ${market})
          AND d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        UNION ALL
        SELECT (d.lost_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent'), 'lost', 0
        FROM sales_deals d
        WHERE d.org_id = ${orgId} AND (${market} = '' OR d.market_id = ${market})
          AND d.lost_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
      ) t
      GROUP BY 1 ORDER BY 1
    `,
    // Тот же набор цифр за прошлый период
    sql`
      SELECT COUNT(*) FILTER (WHERE d.created_at BETWEEN ${prevFrom}::timestamptz AND ${prevTo}::timestamptz)::int AS created,
             COUNT(*) FILTER (WHERE d.won_at BETWEEN ${prevFrom}::timestamptz AND ${prevTo}::timestamptz)::int AS won,
             COUNT(*) FILTER (WHERE d.lost_at BETWEEN ${prevFrom}::timestamptz AND ${prevTo}::timestamptz)::int AS lost,
             COALESCE(SUM(d.monthly_amount) FILTER (
               WHERE d.won_at BETWEEN ${prevFrom}::timestamptz AND ${prevTo}::timestamptz), 0) AS won_amount,
             (SELECT COUNT(*)::int FROM sales_leads l WHERE l.org_id = ${orgId}
                AND (${market} = '' OR l.market_id = ${market})
                AND l.created_at BETWEEN ${prevFrom}::timestamptz AND ${prevTo}::timestamptz) AS leads
      FROM sales_deals d
      WHERE d.org_id = ${orgId} AND d.archived_at IS NULL
        AND (${market} = '' OR d.market_id = ${market})
    `,
    // Разрез по регионам: одна таблица вместо семи переключений фильтра
    sql`
      SELECT COALESCE(d.market_id, '—') AS market,
             COUNT(*) FILTER (WHERE d.won_at IS NULL AND d.lost_at IS NULL AND d.archived_at IS NULL)::int AS open,
             COUNT(*) FILTER (WHERE d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz)::int AS won,
             COUNT(*) FILTER (WHERE d.lost_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz)::int AS lost,
             COALESCE(SUM(d.monthly_amount) FILTER (
               WHERE d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz), 0) AS won_amount,
             COALESCE(SUM(d.monthly_amount) FILTER (
               WHERE d.won_at IS NULL AND d.lost_at IS NULL AND d.archived_at IS NULL), 0) AS pipeline
      FROM sales_deals d
      WHERE d.org_id = ${orgId} AND d.pipeline <> 'partner' AND d.archived_at IS NULL
      GROUP BY 1 ORDER BY won DESC
    `,
  ])

  return json({
    period: { from, to, days }, market,
    daily, byRegion,
    prev: (prev as any[])[0] || {},
    funnel, money, sources, icp, team,
    launch: cohort[0] || {},
  })
}
