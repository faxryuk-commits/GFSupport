import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'
import { ensureChannelSourceColumn, ensureTaxonomyColumns } from '../lib/ensure-taxonomy.js'

export const config = {
  runtime: 'edge',
}

/**
 * GET /api/support/analytics/agent-360
 *   ?name=Имя+Сотрудника  (или ?agentId=agent_xxx)
 *   &from=YYYY-MM-DD&to=YYYY-MM-DD
 *   &source=all|telegram|whatsapp
 *
 * Полный 360°-профиль одного сотрудника за период:
 * каналы, типы контента, языки, AI-категории, воронка статусов,
 * тренд по дням, отклонение от медианы команды, sentiment, последние кейсы.
 *
 * Все запросы идут параллельно (Promise.all), фильтр по агенту делаем
 * через `LOWER(sender_name) = LOWER(name)` + alias из support_agents,
 * это совпадает с тем, как считает sla-report.ts.
 */

const TZ_OFFSET = '+05:00'

interface BySourceRow {
  source: string
  messages: number
  avgFRT: number | null
  channels: number
}

interface ByContentTypeRow {
  type: string
  count: number
  share: number
}

interface ByDomainRow {
  domain: string
  subcategory: string | null
  count: number
}

interface DailyTrendRow {
  date: string
  messages: number
  avgFRT: number | null
  resolved: number
}

interface CaseRow {
  caseId: string
  ticket: string | null
  title: string
  resolvedAt?: string | null
  resolutionHours?: number | null
  status?: string
  createdAt?: string
  daysOpen?: number
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

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)

  const name = (url.searchParams.get('name') || '').trim()
  const agentId = (url.searchParams.get('agentId') || '').trim()
  if (!name && !agentId) {
    return json({ error: 'name or agentId is required' }, 400)
  }

  const fromDate = url.searchParams.get('from') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const toDate = url.searchParams.get('to') || new Date().toISOString().slice(0, 10)
  const rawSource = (url.searchParams.get('source') || 'all').toLowerCase()
  const source: 'all' | 'telegram' | 'whatsapp' =
    rawSource === 'telegram' ? 'telegram' : rawSource === 'whatsapp' ? 'whatsapp' : 'all'

  const fromTs = `${fromDate}T00:00:00${TZ_OFFSET}`
  const toTs = `${toDate}T23:59:59${TZ_OFFSET}`

  await Promise.all([ensureTaxonomyColumns(), ensureChannelSourceColumn()])

  try {
    // Резолвим агента: предпочитаем agentId, иначе LOWER(name)
    const [agentRow] = await sql`
      SELECT id, name, role, status, telegram_id, email, phone, position, last_active_at
      FROM support_agents
      WHERE org_id = ${orgId}
        AND (
          (${agentId}::text <> '' AND id = ${agentId})
          OR (${agentId}::text = '' AND ${name}::text <> '' AND LOWER(name) = LOWER(${name}))
        )
      LIMIT 1
    `

    const resolvedName: string = agentRow?.name || name
    if (!resolvedName) return json({ error: 'agent not found' }, 404)

    // Запускаем все агрегации параллельно
    const [
      kpiRes,
      bySourceRes,
      byContentTypeRes,
      byLanguageRes,
      byDomainRes,
      statusFunnelRes,
      dailyTrendRes,
      teamMedianRes,
      sentimentRes,
      recentResolvedRes,
      stuckRes,
      topChannelsRes,
      frtRes,
    ] = await Promise.all([
      // 1. KPI: totalMessages, totalChars, активные дни, каналов
      sql`
        SELECT
          COUNT(*)::int AS total_messages,
          COALESCE(SUM(LENGTH(COALESCE(m.text_content, ''))), 0)::int AS total_chars,
          COUNT(DISTINCT m.channel_id)::int AS channels_served,
          COUNT(DISTINCT (m.created_at AT TIME ZONE 'Asia/Tashkent')::date)::int AS active_days
        FROM support_messages m
        LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = false
          AND m.sender_role IN ('support', 'team', 'agent')
          AND LOWER(m.sender_name) = LOWER(${resolvedName})
          AND m.created_at >= ${fromTs}::timestamptz
          AND m.created_at <= ${toTs}::timestamptz
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
      `,

      // 2. Разбивка по источнику (Telegram/WhatsApp)
      sql`
        SELECT
          COALESCE(ch.source, 'telegram') AS source,
          COUNT(*)::int AS messages,
          COUNT(DISTINCT m.channel_id)::int AS channels
        FROM support_messages m
        LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = false
          AND m.sender_role IN ('support', 'team', 'agent')
          AND LOWER(m.sender_name) = LOWER(${resolvedName})
          AND m.created_at >= ${fromTs}::timestamptz
          AND m.created_at <= ${toTs}::timestamptz
        GROUP BY 1
        ORDER BY messages DESC
      `,

      // 3. Разбивка по типу контента (text/voice/photo/video/document)
      sql`
        SELECT
          COALESCE(NULLIF(m.content_type, ''), 'text') AS type,
          COUNT(*)::int AS count
        FROM support_messages m
        LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = false
          AND m.sender_role IN ('support', 'team', 'agent')
          AND LOWER(m.sender_name) = LOWER(${resolvedName})
          AND m.created_at >= ${fromTs}::timestamptz
          AND m.created_at <= ${toTs}::timestamptz
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        GROUP BY 1
        ORDER BY count DESC
        LIMIT 8
      `,

      // 4. Языки переписки клиентов в каналах, где работает агент
      sql`
        WITH agent_channels AS (
          SELECT DISTINCT m.channel_id
          FROM support_messages m
          WHERE m.org_id = ${orgId}
            AND LOWER(m.sender_name) = LOWER(${resolvedName})
            AND m.is_from_client = false
            AND m.created_at >= ${fromTs}::timestamptz
            AND m.created_at <= ${toTs}::timestamptz
        )
        SELECT
          COALESCE(NULLIF(m.transcript_language, ''), 'unknown') AS lang,
          COUNT(*)::int AS count
        FROM support_messages m
        WHERE m.org_id = ${orgId}
          AND m.channel_id IN (SELECT channel_id FROM agent_channels)
          AND m.is_from_client = true
          AND m.transcript_language IS NOT NULL
          AND m.created_at >= ${fromTs}::timestamptz
          AND m.created_at <= ${toTs}::timestamptz
        GROUP BY 1
        ORDER BY count DESC
        LIMIT 6
      `,

      // 5. Топ AI-категорий по кейсам, назначенным агенту
      sql`
        SELECT
          COALESCE(NULLIF(c.category, ''), 'general') AS domain,
          COALESCE(NULLIF(c.subcategory, ''), NULL) AS subcategory,
          COUNT(*)::int AS count
        FROM support_cases c
        LEFT JOIN support_agents a ON a.id::text = c.assigned_to::text
        LEFT JOIN support_channels ch ON ch.id = c.channel_id AND ch.org_id = c.org_id
        WHERE c.org_id = ${orgId}
          AND (
            (${agentId}::text <> '' AND c.assigned_to = ${agentId})
            OR LOWER(a.name) = LOWER(${resolvedName})
          )
          AND c.created_at >= ${fromTs}::timestamptz
          AND c.created_at <= ${toTs}::timestamptz
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        GROUP BY 1, 2
        ORDER BY count DESC
        LIMIT 10
      `,

      // 6. Воронка статусов кейсов агента
      sql`
        SELECT
          COALESCE(NULLIF(c.status, ''), 'detected') AS status,
          COUNT(*)::int AS count
        FROM support_cases c
        LEFT JOIN support_agents a ON a.id::text = c.assigned_to::text
        LEFT JOIN support_channels ch ON ch.id = c.channel_id AND ch.org_id = c.org_id
        WHERE c.org_id = ${orgId}
          AND (
            (${agentId}::text <> '' AND c.assigned_to = ${agentId})
            OR LOWER(a.name) = LOWER(${resolvedName})
          )
          AND c.created_at >= ${fromTs}::timestamptz
          AND c.created_at <= ${toTs}::timestamptz
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        GROUP BY 1
      `,

      // 7. Тренд по дням
      sql`
        WITH agent_msgs AS (
          SELECT
            (m.created_at AT TIME ZONE 'Asia/Tashkent')::date AS d,
            COUNT(*)::int AS messages
          FROM support_messages m
          LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
          WHERE m.org_id = ${orgId}
            AND m.is_from_client = false
            AND m.sender_role IN ('support', 'team', 'agent')
            AND LOWER(m.sender_name) = LOWER(${resolvedName})
            AND m.created_at >= ${fromTs}::timestamptz
            AND m.created_at <= ${toTs}::timestamptz
            AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
          GROUP BY (m.created_at AT TIME ZONE 'Asia/Tashkent')::date
        ),
        agent_resolved AS (
          SELECT
            (c.resolved_at AT TIME ZONE 'Asia/Tashkent')::date AS d,
            COUNT(*)::int AS resolved
          FROM support_cases c
          LEFT JOIN support_agents a ON a.id::text = c.assigned_to::text
          LEFT JOIN support_channels ch ON ch.id = c.channel_id AND ch.org_id = c.org_id
          WHERE c.org_id = ${orgId}
            AND c.resolved_at IS NOT NULL
            AND (
              (${agentId}::text <> '' AND c.assigned_to = ${agentId})
              OR LOWER(a.name) = LOWER(${resolvedName})
            )
            AND c.resolved_at >= ${fromTs}::timestamptz
            AND c.resolved_at <= ${toTs}::timestamptz
            AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
          GROUP BY (c.resolved_at AT TIME ZONE 'Asia/Tashkent')::date
        )
        SELECT
          TO_CHAR(d, 'YYYY-MM-DD') AS date,
          COALESCE(am.messages, 0)::int AS messages,
          COALESCE(ar.resolved, 0)::int AS resolved
        FROM (
          SELECT d FROM agent_msgs
          UNION
          SELECT d FROM agent_resolved
        ) days
        LEFT JOIN agent_msgs am USING (d)
        LEFT JOIN agent_resolved ar USING (d)
        ORDER BY d
      `,

      // 8. Медианы команды для сравнения (только активные агенты в этом периоде)
      sql`
        WITH per_agent AS (
          SELECT
            LOWER(m.sender_name) AS agent_key,
            COUNT(*) FILTER (WHERE m.is_from_client = false AND m.sender_role IN ('support','team','agent'))::int AS responses
          FROM support_messages m
          LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
          WHERE m.org_id = ${orgId}
            AND m.created_at >= ${fromTs}::timestamptz
            AND m.created_at <= ${toTs}::timestamptz
            AND m.sender_name IS NOT NULL
            AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
          GROUP BY LOWER(m.sender_name)
          HAVING COUNT(*) FILTER (WHERE m.is_from_client = false AND m.sender_role IN ('support','team','agent')) > 0
        ),
        per_agent_resolved AS (
          SELECT a.id::text AS agent_id, COUNT(*)::int AS resolved
          FROM support_cases c
          JOIN support_agents a ON a.id::text = c.assigned_to::text
          LEFT JOIN support_channels ch ON ch.id = c.channel_id AND ch.org_id = c.org_id
          WHERE c.org_id = ${orgId}
            AND c.resolved_at IS NOT NULL
            AND c.resolved_at >= ${fromTs}::timestamptz
            AND c.resolved_at <= ${toTs}::timestamptz
            AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
          GROUP BY a.id
        )
        SELECT
          (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY responses) FROM per_agent)::numeric AS median_responses,
          (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY resolved) FROM per_agent_resolved)::numeric AS median_resolved
      `,

      // 9. Sentiment клиентов в каналах агента (по сообщениям клиентов)
      sql`
        WITH agent_channels AS (
          SELECT DISTINCT m.channel_id
          FROM support_messages m
          WHERE m.org_id = ${orgId}
            AND LOWER(m.sender_name) = LOWER(${resolvedName})
            AND m.is_from_client = false
            AND m.created_at >= ${fromTs}::timestamptz
            AND m.created_at <= ${toTs}::timestamptz
        )
        SELECT
          COALESCE(NULLIF(m.ai_sentiment, ''), 'neutral') AS sentiment,
          COUNT(*)::int AS count
        FROM support_messages m
        WHERE m.org_id = ${orgId}
          AND m.channel_id IN (SELECT channel_id FROM agent_channels)
          AND m.is_from_client = true
          AND m.ai_sentiment IS NOT NULL
          AND m.created_at >= ${fromTs}::timestamptz
          AND m.created_at <= ${toTs}::timestamptz
        GROUP BY 1
      `,

      // 10. Последние решённые кейсы
      sql`
        SELECT
          c.id AS case_id,
          c.ticket_number AS ticket,
          c.title,
          c.resolved_at,
          c.resolution_time_minutes
        FROM support_cases c
        LEFT JOIN support_agents a ON a.id::text = c.assigned_to::text
        LEFT JOIN support_channels ch ON ch.id = c.channel_id AND ch.org_id = c.org_id
        WHERE c.org_id = ${orgId}
          AND c.resolved_at IS NOT NULL
          AND (
            (${agentId}::text <> '' AND c.assigned_to = ${agentId})
            OR LOWER(a.name) = LOWER(${resolvedName})
          )
          AND c.resolved_at >= ${fromTs}::timestamptz
          AND c.resolved_at <= ${toTs}::timestamptz
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        ORDER BY c.resolved_at DESC
        LIMIT 8
      `,

      // 11. Зависшие кейсы (открытые, более 24 часов)
      sql`
        SELECT
          c.id AS case_id,
          c.ticket_number AS ticket,
          c.title,
          c.status,
          c.priority,
          c.created_at,
          EXTRACT(EPOCH FROM (NOW() - c.created_at))/86400.0 AS days_open
        FROM support_cases c
        LEFT JOIN support_agents a ON a.id::text = c.assigned_to::text
        LEFT JOIN support_channels ch ON ch.id = c.channel_id AND ch.org_id = c.org_id
        WHERE c.org_id = ${orgId}
          AND c.status NOT IN ('resolved', 'closed', 'cancelled')
          AND (
            (${agentId}::text <> '' AND c.assigned_to = ${agentId})
            OR LOWER(a.name) = LOWER(${resolvedName})
          )
          AND c.created_at <= ${toTs}::timestamptz
          AND EXTRACT(EPOCH FROM (NOW() - c.created_at)) > 86400
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        ORDER BY c.created_at ASC
        LIMIT 8
      `,

      // 12. Топ каналов (групп) агента
      sql`
        SELECT
          ch.id AS channel_id,
          ch.name,
          COALESCE(ch.source, 'telegram') AS source,
          COUNT(*)::int AS messages
        FROM support_messages m
        JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = false
          AND m.sender_role IN ('support', 'team', 'agent')
          AND LOWER(m.sender_name) = LOWER(${resolvedName})
          AND m.created_at >= ${fromTs}::timestamptz
          AND m.created_at <= ${toTs}::timestamptz
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        GROUP BY ch.id, ch.name, ch.source
        ORDER BY messages DESC
        LIMIT 6
      `,

      // 13. FRT агента + распределение per-source (avg отдельно)
      sql`
        WITH client_msgs AS (
          SELECT
            m.id, m.channel_id, m.created_at,
            COALESCE(ch.source, 'telegram') AS source
          FROM support_messages m
          JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
          WHERE m.org_id = ${orgId}
            AND m.is_from_client = true
            AND m.sender_role = 'client'
            AND m.created_at >= ${fromTs}::timestamptz
            AND m.created_at <= ${toTs}::timestamptz
            AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        ),
        responses AS (
          SELECT
            cm.id AS client_id,
            cm.source,
            cm.created_at AS client_at,
            (
              SELECT m2.created_at
              FROM support_messages m2
              WHERE m2.org_id = ${orgId}
                AND m2.channel_id = cm.channel_id
                AND m2.is_from_client = false
                AND m2.sender_role IN ('support','team','agent')
                AND LOWER(m2.sender_name) = LOWER(${resolvedName})
                AND m2.created_at > cm.created_at
                AND m2.created_at <= cm.created_at + INTERVAL '4 hours'
              ORDER BY m2.created_at ASC
              LIMIT 1
            ) AS response_at
          FROM client_msgs cm
        )
        SELECT
          source,
          COUNT(*) FILTER (WHERE response_at IS NOT NULL)::int AS responses,
          AVG(EXTRACT(EPOCH FROM (response_at - client_at))/60.0) FILTER (WHERE response_at IS NOT NULL) AS avg_minutes,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (response_at - client_at))/60.0) FILTER (WHERE response_at IS NOT NULL) AS median_minutes
        FROM responses
        GROUP BY 1
      `,
    ])

    const kpiRow = kpiRes[0] || {}
    const teamMedians = teamMedianRes[0] || {}

    // Считаем общий avgFRT и medianFRT (взвешенно по всем источникам)
    let totalResponsesFrt = 0
    let totalMinutes = 0
    const frtBySource = new Map<string, { responses: number; avg: number | null; median: number | null }>()
    for (const r of frtRes as any[]) {
      const responses = Number(r.responses || 0)
      const avg = r.avg_minutes != null ? Number(r.avg_minutes) : null
      const median = r.median_minutes != null ? Number(r.median_minutes) : null
      frtBySource.set(r.source, { responses, avg, median })
      if (responses && avg != null) {
        totalResponsesFrt += responses
        totalMinutes += avg * responses
      }
    }
    const overallAvgFrt = totalResponsesFrt > 0 ? Math.round((totalMinutes / totalResponsesFrt) * 10) / 10 : null

    // bySource
    const bySource: BySourceRow[] = (bySourceRes as any[]).map((r) => {
      const f = frtBySource.get(r.source)
      return {
        source: r.source,
        messages: Number(r.messages || 0),
        avgFRT: f?.avg != null ? Math.round(f.avg * 10) / 10 : null,
        channels: Number(r.channels || 0),
      }
    })

    // byContentType с share
    const ctTotal = (byContentTypeRes as any[]).reduce((s, r) => s + Number(r.count || 0), 0)
    const byContentType: ByContentTypeRow[] = (byContentTypeRes as any[]).map((r) => ({
      type: r.type,
      count: Number(r.count || 0),
      share: ctTotal > 0 ? Math.round((Number(r.count || 0) / ctTotal) * 100) : 0,
    }))

    // byLanguage с share
    const langTotal = (byLanguageRes as any[]).reduce((s, r) => s + Number(r.count || 0), 0)
    const byLanguage = (byLanguageRes as any[]).map((r) => ({
      lang: r.lang,
      count: Number(r.count || 0),
      share: langTotal > 0 ? Math.round((Number(r.count || 0) / langTotal) * 100) : 0,
    }))

    // byDomain
    const byDomain: ByDomainRow[] = (byDomainRes as any[]).map((r) => ({
      domain: r.domain,
      subcategory: r.subcategory,
      count: Number(r.count || 0),
    }))

    // statusFunnel
    const statusFunnel = (statusFunnelRes as any[]).map((r) => ({
      status: r.status,
      count: Number(r.count || 0),
    }))

    // dailyTrend (FRT по дням опускаем - дорого; будут только messages + resolved)
    const dailyTrend: DailyTrendRow[] = (dailyTrendRes as any[]).map((r) => ({
      date: r.date,
      messages: Number(r.messages || 0),
      avgFRT: null,
      resolved: Number(r.resolved || 0),
    }))

    // sentiment в %
    const sentTotal = (sentimentRes as any[]).reduce((s, r) => s + Number(r.count || 0), 0)
    const sentMap: Record<string, number> = { positive: 0, neutral: 0, negative: 0 }
    for (const r of sentimentRes as any[]) {
      const k = String(r.sentiment).toLowerCase()
      const cnt = Number(r.count || 0)
      if (k === 'positive' || k === 'happy') sentMap.positive += cnt
      else if (k === 'negative' || k === 'unhappy' || k === 'angry') sentMap.negative += cnt
      else sentMap.neutral += cnt
    }
    const sentiment = sentTotal > 0
      ? {
          positive: Math.round((sentMap.positive / sentTotal) * 100),
          neutral: Math.round((sentMap.neutral / sentTotal) * 100),
          negative: Math.round((sentMap.negative / sentTotal) * 100),
          total: sentTotal,
        }
      : { positive: 0, neutral: 0, negative: 0, total: 0 }

    // Recent resolved
    const recentResolved: CaseRow[] = (recentResolvedRes as any[]).map((r) => ({
      caseId: r.case_id,
      ticket: r.ticket || null,
      title: r.title,
      resolvedAt: r.resolved_at,
      resolutionHours: r.resolution_time_minutes != null ? Math.round((r.resolution_time_minutes / 60) * 10) / 10 : null,
    }))

    // Stuck
    const stuck: CaseRow[] = (stuckRes as any[]).map((r) => ({
      caseId: r.case_id,
      ticket: r.ticket || null,
      title: r.title,
      status: r.status,
      createdAt: r.created_at,
      daysOpen: r.days_open != null ? Math.round(Number(r.days_open) * 10) / 10 : 0,
    }))

    const totalMessages = Number(kpiRow.total_messages || 0)
    const totalCharsAgent = Number(kpiRow.total_chars || 0)
    const channelsServed = Number(kpiRow.channels_served || 0)
    const activeDays = Number(kpiRow.active_days || 0)

    // Воронка → удобные агрегаты
    const statusMap = new Map(statusFunnel.map((s) => [s.status, s.count]))
    const totalCases = statusFunnel.reduce((s, r) => s + r.count, 0)
    const resolvedCases = (statusMap.get('resolved') || 0) + (statusMap.get('closed') || 0)
    const stuckCases = stuck.length
    const openCases = totalCases - resolvedCases - (statusMap.get('cancelled') || 0)

    // vs Team — отклонения в %
    const medianResponses = teamMedians.median_responses != null ? Number(teamMedians.median_responses) : 0
    const medianResolved = teamMedians.median_resolved != null ? Number(teamMedians.median_resolved) : 0
    const totalResponses = bySource.reduce((s, r) => s + r.messages, 0)
    const vsTeam = {
      responses: medianResponses > 0 ? Math.round(((totalResponses - medianResponses) / medianResponses) * 100) : null,
      resolved: medianResolved > 0 ? Math.round(((resolvedCases - medianResolved) / medianResolved) * 100) : null,
      medianResponses: Math.round(medianResponses),
      medianResolved: Math.round(medianResolved),
    }

    return json({
      profile: {
        id: agentRow?.id || null,
        name: resolvedName,
        role: agentRow?.role || 'agent',
        status: agentRow?.status || null,
        telegramId: agentRow?.telegram_id || null,
        email: agentRow?.email || null,
        phone: agentRow?.phone || null,
        position: agentRow?.position || null,
        lastActiveAt: agentRow?.last_active_at || null,
      },
      period: { from: fromDate, to: toDate, source },
      kpi: {
        totalResponses,
        totalMessages,
        totalChars: totalCharsAgent,
        channelsServed,
        activeDays,
        avgFRT: overallAvgFrt,
        resolvedCases,
        openCases: Math.max(0, openCases),
        stuckCases,
        totalCases,
      },
      bySource,
      byContentType,
      byLanguage,
      byDomain,
      statusFunnel,
      dailyTrend,
      sentiment,
      vsTeam,
      recentResolved,
      stuck,
      topChannels: (topChannelsRes as any[]).map((r) => ({
        channelId: r.channel_id,
        name: r.name,
        source: r.source,
        messages: Number(r.messages || 0),
      })),
    })
  } catch (e: any) {
    console.error('[agent-360]', e?.message, e?.stack?.slice(0, 500))
    return json({ error: 'Internal server error', detail: e?.message }, 500)
  }
}
