import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

/**
 * GET /api/support/analytics/support-health
 * Сводка «где у нас болит»: топ категорий и root_cause с ростом, hot-каналы,
 * застрявшие кейсы, повторяющиеся проблемы, статистика периода.
 *
 * Query params:
 *   - period: 7d | 30d | 90d  (default 7d)
 *   - market: опциональный фильтр
 */
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

  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const orgId = await getRequestOrgId(req)
  const sql = getSQL()
  const url = new URL(req.url)

  const period = url.searchParams.get('period') || '7d'
  const market = url.searchParams.get('market') || null
  const days = period === '30d' ? 30 : period === '90d' ? 90 : 7

  const now = new Date()
  const toDate = now.toISOString()
  const fromDate = new Date(now.getTime() - days * 86400000).toISOString()
  const prevFromDate = new Date(now.getTime() - 2 * days * 86400000).toISOString()

  try {
    // 1. Топ категорий + WoW дельта
    const topCategories = await sql`
      WITH curr AS (
        SELECT COALESCE(NULLIF(category, ''), 'general') as cat, COUNT(*)::int as cnt
        FROM support_cases
        WHERE org_id = ${orgId}
          AND created_at >= ${fromDate}::timestamptz AND created_at < ${toDate}::timestamptz
          AND (${market}::text IS NULL OR market_id = ${market})
        GROUP BY cat
      ),
      prev AS (
        SELECT COALESCE(NULLIF(category, ''), 'general') as cat, COUNT(*)::int as cnt
        FROM support_cases
        WHERE org_id = ${orgId}
          AND created_at >= ${prevFromDate}::timestamptz AND created_at < ${fromDate}::timestamptz
          AND (${market}::text IS NULL OR market_id = ${market})
        GROUP BY cat
      )
      SELECT
        c.cat as category,
        c.cnt as cases,
        COALESCE(p.cnt, 0) as prev_cases,
        (c.cnt - COALESCE(p.cnt, 0)) as delta,
        ROUND(
          CASE WHEN COALESCE(p.cnt, 0) = 0 THEN NULL
               ELSE ((c.cnt - p.cnt)::numeric / p.cnt) * 100 END,
          0
        ) as delta_pct
      FROM curr c
      LEFT JOIN prev p ON p.cat = c.cat
      ORDER BY c.cnt DESC
      LIMIT 5
    `

    // 2. Топ root_cause с impact_mrr
    const topRootCauses = await sql`
      SELECT
        COALESCE(NULLIF(root_cause, ''), 'Не указано') as root_cause,
        COUNT(*)::int as cases,
        ROUND(COALESCE(SUM(impact_mrr), 0)::numeric, 2)::float as impact_mrr
      FROM support_cases
      WHERE org_id = ${orgId}
        AND created_at >= ${fromDate}::timestamptz AND created_at < ${toDate}::timestamptz
        AND (${market}::text IS NULL OR market_id = ${market})
        AND root_cause IS NOT NULL AND root_cause <> ''
      GROUP BY root_cause
      ORDER BY cases DESC
      LIMIT 5
    `

    // 3. Повторяющиеся проблемы (is_recurring=true) по категориям
    const recurring = await sql`
      SELECT
        COALESCE(NULLIF(category, ''), 'general') as category,
        COUNT(*)::int as cases,
        COUNT(DISTINCT channel_id)::int as channels_count
      FROM support_cases
      WHERE org_id = ${orgId}
        AND created_at >= ${fromDate}::timestamptz AND created_at < ${toDate}::timestamptz
        AND (${market}::text IS NULL OR market_id = ${market})
        AND is_recurring = true
      GROUP BY category
      ORDER BY cases DESC
      LIMIT 5
    `

    // 4. Hot-каналы: кто грузит поддержку больше всех (всего кейсов + открытых + средний возраст)
    const hotChannels = await sql`
      SELECT
        c.channel_id,
        ch.name as channel_name,
        COUNT(*)::int as total_cases,
        SUM(CASE WHEN c.status NOT IN ('resolved','closed','cancelled') THEN 1 ELSE 0 END)::int as open_cases,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 3600)::numeric, 1)::float as avg_age_hours
      FROM support_cases c
      LEFT JOIN support_channels ch ON ch.id = c.channel_id AND ch.org_id = ${orgId}
      WHERE c.org_id = ${orgId}
        AND c.created_at >= ${fromDate}::timestamptz AND c.created_at < ${toDate}::timestamptz
        AND (${market}::text IS NULL OR c.market_id = ${market})
        AND c.channel_id IS NOT NULL
      GROUP BY c.channel_id, ch.name
      ORDER BY total_cases DESC, open_cases DESC
      LIMIT 5
    `

    // 5. Застрявшие открытые кейсы (> 24ч без смены статуса)
    const stuckCases = await sql`
      WITH last_status_change AS (
        SELECT DISTINCT ON (case_id) case_id, created_at as changed_at
        FROM support_case_activities
        WHERE type = 'status_change'
        ORDER BY case_id, created_at DESC
      )
      SELECT
        c.id,
        c.ticket_number,
        c.title,
        c.status,
        c.priority,
        ch.name as channel_name,
        a.name as assignee_name,
        COALESCE(lsc.changed_at, c.created_at) as in_status_since,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(lsc.changed_at, c.created_at))) / 3600 as hours_in_status
      FROM support_cases c
      LEFT JOIN support_channels ch ON ch.id = c.channel_id AND ch.org_id = ${orgId}
      LEFT JOIN support_agents a ON a.id = c.assigned_to
      LEFT JOIN last_status_change lsc ON lsc.case_id = c.id
      WHERE c.org_id = ${orgId}
        AND c.status NOT IN ('resolved','closed','cancelled')
        AND (${market}::text IS NULL OR c.market_id = ${market})
        AND COALESCE(lsc.changed_at, c.created_at) < NOW() - INTERVAL '24 hours'
      ORDER BY hours_in_status DESC
      LIMIT 10
    `

    // 6. Общая статистика периода
    const statsRow = await sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= ${fromDate}::timestamptz AND created_at < ${toDate}::timestamptz)::int as total_created,
        COUNT(*) FILTER (WHERE resolved_at >= ${fromDate}::timestamptz AND resolved_at < ${toDate}::timestamptz)::int as total_resolved,
        ROUND(AVG(resolution_time_minutes) FILTER (
          WHERE resolved_at >= ${fromDate}::timestamptz AND resolved_at < ${toDate}::timestamptz
            AND resolution_time_minutes IS NOT NULL
        )::numeric / 60.0, 1)::float as avg_resolution_hours,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed','cancelled'))::int as open_now,
        COUNT(*) FILTER (
          WHERE status NOT IN ('resolved','closed','cancelled') AND (assigned_to IS NULL OR assigned_to = '')
        )::int as unassigned_now
      FROM support_cases
      WHERE org_id = ${orgId}
        AND (${market}::text IS NULL OR market_id = ${market})
    `

    // 7. Предыдущий период — для дельт на общих метриках
    const prevStatsRow = await sql`
      SELECT
        COUNT(*)::int as total_created
      FROM support_cases
      WHERE org_id = ${orgId}
        AND created_at >= ${prevFromDate}::timestamptz AND created_at < ${fromDate}::timestamptz
        AND (${market}::text IS NULL OR market_id = ${market})
    `

    const stats = statsRow[0] || {}
    const prevStats = prevStatsRow[0] || {}

    return json(
      {
        period: { from: fromDate, to: toDate, days, prevFrom: prevFromDate },
        topCategories: topCategories.map((r: any) => ({
          category: r.category,
          cases: parseInt(r.cases || 0),
          prevCases: parseInt(r.prev_cases || 0),
          delta: parseInt(r.delta || 0),
          deltaPct: r.delta_pct == null ? null : Number(r.delta_pct),
        })),
        topRootCauses: topRootCauses.map((r: any) => ({
          rootCause: r.root_cause,
          cases: parseInt(r.cases || 0),
          impactMrr: Number(r.impact_mrr || 0),
        })),
        recurring: recurring.map((r: any) => ({
          category: r.category,
          cases: parseInt(r.cases || 0),
          channelsCount: parseInt(r.channels_count || 0),
        })),
        hotChannels: hotChannels.map((r: any) => ({
          channelId: r.channel_id,
          channelName: r.channel_name || 'Без названия',
          totalCases: parseInt(r.total_cases || 0),
          openCases: parseInt(r.open_cases || 0),
          avgAgeHours: Number(r.avg_age_hours || 0),
        })),
        stuckCases: stuckCases.map((r: any) => ({
          id: r.id,
          ticketNumber: r.ticket_number,
          title: r.title,
          status: r.status,
          priority: r.priority,
          channelName: r.channel_name,
          assigneeName: r.assignee_name,
          hoursInStatus: Math.round(Number(r.hours_in_status || 0) * 10) / 10,
        })),
        stats: {
          totalCreated: parseInt(stats.total_created || 0),
          totalResolved: parseInt(stats.total_resolved || 0),
          avgResolutionHours: stats.avg_resolution_hours == null ? null : Number(stats.avg_resolution_hours),
          openNow: parseInt(stats.open_now || 0),
          unassignedNow: parseInt(stats.unassigned_now || 0),
          prevTotalCreated: parseInt(prevStats.total_created || 0),
          createdDelta: parseInt(stats.total_created || 0) - parseInt(prevStats.total_created || 0),
        },
      },
      200,
      60,
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[support-health]', msg)
    return json({ error: msg }, 500)
  }
}
