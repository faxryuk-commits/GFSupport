import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { ensureSalesSchema } from '../_lib/sales-schema.js'
import { resolveRegionScoped } from '../_lib/sales-amo.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

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
  const market = await resolveRegionScoped(sql, orgId, url, ctx)
  const pipeline = market ? `sales_${market}` : 'sales'
  const fromTs = `${from}T00:00:00+05:00`
  const toTs = `${to}T23:59:59+05:00`

  // Прошлый период той же длины — чтобы цифра отвечала на «лучше или хуже»,
  // а не висела в воздухе
  const days = Math.max(1, Math.round(
    (new Date(toTs).getTime() - new Date(fromTs).getTime()) / 86400000))
  const prevFrom = new Date(new Date(fromTs).getTime() - days * 86400000).toISOString()
  const prevTo = fromTs

  // ─── Пульс продаж: главный экран отчётов одним заходом ────────────────────
  // KPI периода, воронка с долями источников, потенциал, тренд, источники,
  // причины потерь, портфель по сейлзам. Периоды: закрытия и воронка — по
  // выбранному диапазону, потенциал и портфель — состояние на сейчас
  if (url.searchParams.get('action') === 'pulse') {
    const [kpi, openNow, reach, wonSrc, potential, monthly, srcRows, losses, portfolio] = await Promise.all([
      sql`
        SELECT
          COUNT(*) FILTER (WHERE won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz)::int AS won,
          COUNT(*) FILTER (WHERE lost_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz)::int AS lost,
          COALESCE(SUM(monthly_amount) FILTER (WHERE currency = 'UZS'
            AND won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz), 0)::bigint AS won_amt,
          COALESCE(percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (won_at - created_at)) / 86400)
            FILTER (WHERE won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz), 0)::int AS cycle_med
        FROM sales_deals
        WHERE org_id = ${orgId} AND archived_at IS NULL AND pipeline <> 'partner'
          AND (${market} = '' OR market_id = ${market} OR market_id IS NULL)
      `,
      sql`
        SELECT COUNT(*)::int AS open,
          COUNT(*) FILTER (WHERE COALESCE(monthly_amount, 0) > 0)::int AS with_amt
        FROM sales_deals
        WHERE org_id = ${orgId} AND archived_at IS NULL AND won_at IS NULL AND lost_at IS NULL
          AND pipeline <> 'partner'
          AND (${market} = '' OR market_id = ${market} OR market_id IS NULL)
      `,
      // Воронка достижения этапов за период + доля источников (стек)
      sql`
        SELECT sn.key AS stage, COALESCE(ss.label, 'История Amo') AS src,
               COUNT(DISTINCT e.deal_id)::int AS n
        FROM sales_deal_events e
        JOIN sales_stages sn ON sn.id = e.new_stage_id
        JOIN sales_deals d ON d.id = e.deal_id
        LEFT JOIN sales_leads l ON l.id = d.source_lead_id
        LEFT JOIN sales_sources ss ON ss.id = l.source_id
        WHERE e.org_id = ${orgId} AND sn.pipeline LIKE 'sales%' AND sn.kind = 'open'
          AND e.changed_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          AND d.archived_at IS NULL
          AND (${market} = '' OR d.market_id = ${market} OR d.market_id IS NULL)
        GROUP BY 1, 2
      `,
      // Выигрыш — по факту won_at, не по событиям: событие могло откатиться,
      // сделка — уехать в архив, и воронка расходилась с KPI
      sql`
        SELECT 'won' AS stage, COALESCE(ss.label, 'История Amo') AS src, COUNT(*)::int AS n
        FROM sales_deals d
        LEFT JOIN sales_leads l ON l.id = d.source_lead_id
        LEFT JOIN sales_sources ss ON ss.id = l.source_id
        WHERE d.org_id = ${orgId} AND d.archived_at IS NULL AND d.pipeline <> 'partner'
          AND d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          AND (${market} = '' OR d.market_id = ${market} OR d.market_id IS NULL)
        GROUP BY 1, 2
      `,
      sql`
        SELECT s.key, MIN(s.label) AS label, MIN(s.sort_order) AS sort, MIN(s.probability) AS prob,
               COUNT(d.id)::int AS cnt,
               COALESCE(SUM(d.monthly_amount) FILTER (WHERE d.currency = 'UZS'), 0)::bigint AS amt
        FROM sales_stages s
        LEFT JOIN sales_deals d ON d.stage_id = s.id
          AND d.archived_at IS NULL AND d.won_at IS NULL AND d.lost_at IS NULL
          AND (${market} = '' OR d.market_id = ${market} OR d.market_id IS NULL)
        WHERE s.org_id = ${orgId} AND s.kind = 'open' AND s.is_active = true
          AND s.pipeline LIKE 'sales%'
        GROUP BY s.key ORDER BY MIN(s.sort_order)
      `,
      sql`
        SELECT to_char(won_at, 'YYYY-MM') AS mon, COUNT(*)::int AS n,
               COALESCE(SUM(monthly_amount) FILTER (WHERE currency = 'UZS'), 0)::bigint AS amt
        FROM sales_deals
        WHERE org_id = ${orgId} AND archived_at IS NULL AND pipeline <> 'partner'
          AND won_at > NOW() - INTERVAL '12 months'
          AND (${market} = '' OR market_id = ${market} OR market_id IS NULL)
        GROUP BY 1 ORDER BY 1
      `,
      sql`
        SELECT COALESCE(s.label, 'прочее') AS src, COUNT(*)::int AS leads,
               COUNT(*) FILTER (WHERE l.status = 'converted')::int AS converted
        FROM sales_leads l
        LEFT JOIN sales_sources s ON s.id = l.source_id
        WHERE l.org_id = ${orgId}
          AND l.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          AND (${market} = '' OR l.market_id = ${market} OR l.market_id IS NULL)
        GROUP BY 1 ORDER BY leads DESC LIMIT 8
      `,
      sql`
        SELECT COALESCE(lr.label, 'без причины') AS reason, COUNT(*)::int AS n
        FROM sales_deals d
        LEFT JOIN sales_lost_reasons lr ON lr.id = d.lost_reason_id
        WHERE d.org_id = ${orgId} AND d.archived_at IS NULL
          AND d.lost_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          AND (${market} = '' OR d.market_id = ${market} OR d.market_id IS NULL)
        GROUP BY 1 ORDER BY n DESC LIMIT 8
      `,
      sql`
        SELECT ag.name, COUNT(*)::int AS cnt,
               COALESCE(SUM(d.monthly_amount) FILTER (WHERE d.currency = 'UZS'), 0)::bigint AS amt,
               COUNT(*) FILTER (WHERE d.next_step_at IS NULL)::int AS no_step
        FROM sales_deals d
        JOIN support_agents ag ON ag.id = d.owner_agent_id
        WHERE d.org_id = ${orgId} AND d.archived_at IS NULL
          AND d.won_at IS NULL AND d.lost_at IS NULL AND d.pipeline <> 'partner'
          AND (${market} = '' OR d.market_id = ${market} OR d.market_id IS NULL)
        GROUP BY ag.name ORDER BY cnt DESC LIMIT 10
      `,
    ]) as any[]

    const pot = (potential as any[]).map(p => ({
      ...p, weighted: Math.round(Number(p.amt) * Number(p.prob || 0) / 100),
    }))
    return json({
      period: { from, to, days },
      kpi: {
        ...(kpi as any[])[0],
        open: (openNow as any[])[0]?.open || 0,
        withAmount: (openNow as any[])[0]?.with_amt || 0,
        weighted: pot.reduce((s2, p) => s2 + p.weighted, 0),
      },
      reach: [...(reach as any[]), ...(wonSrc as any[])],
      potential: pot,
      monthly,
      sources: srcRows,
      losses,
      portfolio,
    })
  }

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
