import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'
import { ensureChannelSourceColumn } from '../lib/ensure-taxonomy.js'

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

  await ensureChannelSourceColumn()

  const period = url.searchParams.get('period') || '7d'
  const market = url.searchParams.get('market') || null
  const rawSource = (url.searchParams.get('source') || 'all').toLowerCase()
  const source: 'all' | 'telegram' | 'whatsapp' =
    rawSource === 'telegram' ? 'telegram' : rawSource === 'whatsapp' ? 'whatsapp' : 'all'
  const days = period === '30d' ? 30 : period === '90d' ? 90 : 7

  const now = new Date()
  const toDate = now.toISOString()
  const fromDate = new Date(now.getTime() - days * 86400000).toISOString()
  const prevFromDate = new Date(now.getTime() - 2 * days * 86400000).toISOString()

  try {
    // 1. Топ категорий + WoW дельта
    const topCategories = await sql`
      WITH curr AS (
        SELECT COALESCE(NULLIF(sc.category, ''), 'general') as cat, COUNT(*)::int as cnt
        FROM support_cases sc
        LEFT JOIN support_channels ch ON ch.id = sc.channel_id AND ch.org_id = sc.org_id
        WHERE sc.org_id = ${orgId}
          AND sc.created_at >= ${fromDate}::timestamptz AND sc.created_at < ${toDate}::timestamptz
          AND (${market}::text IS NULL OR sc.market_id = ${market})
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        GROUP BY cat
      ),
      prev AS (
        SELECT COALESCE(NULLIF(sc.category, ''), 'general') as cat, COUNT(*)::int as cnt
        FROM support_cases sc
        LEFT JOIN support_channels ch ON ch.id = sc.channel_id AND ch.org_id = sc.org_id
        WHERE sc.org_id = ${orgId}
          AND sc.created_at >= ${prevFromDate}::timestamptz AND sc.created_at < ${fromDate}::timestamptz
          AND (${market}::text IS NULL OR sc.market_id = ${market})
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
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
        COALESCE(NULLIF(sc.root_cause, ''), 'Не указано') as root_cause,
        COUNT(*)::int as cases,
        ROUND(COALESCE(SUM(sc.impact_mrr), 0)::numeric, 2)::float as impact_mrr
      FROM support_cases sc
      LEFT JOIN support_channels ch ON ch.id = sc.channel_id AND ch.org_id = sc.org_id
      WHERE sc.org_id = ${orgId}
        AND sc.created_at >= ${fromDate}::timestamptz AND sc.created_at < ${toDate}::timestamptz
        AND (${market}::text IS NULL OR sc.market_id = ${market})
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        AND sc.root_cause IS NOT NULL AND sc.root_cause <> ''
      GROUP BY sc.root_cause
      ORDER BY cases DESC
      LIMIT 5
    `

    // 3. Повторяющиеся проблемы (is_recurring=true) по категориям
    const recurring = await sql`
      SELECT
        COALESCE(NULLIF(sc.category, ''), 'general') as category,
        COUNT(*)::int as cases,
        COUNT(DISTINCT sc.channel_id)::int as channels_count
      FROM support_cases sc
      LEFT JOIN support_channels ch ON ch.id = sc.channel_id AND ch.org_id = sc.org_id
      WHERE sc.org_id = ${orgId}
        AND sc.created_at >= ${fromDate}::timestamptz AND sc.created_at < ${toDate}::timestamptz
        AND (${market}::text IS NULL OR sc.market_id = ${market})
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        AND sc.is_recurring = true
      GROUP BY sc.category
      ORDER BY cases DESC
      LIMIT 5
    `

    // 4. Hot-каналы: кто грузит поддержку больше всех (всего кейсов + открытых + средний возраст)
    const hotChannels = await sql`
      SELECT
        c.channel_id,
        ch.name as channel_name,
        COALESCE(ch.source, 'telegram') as channel_source,
        COUNT(*)::int as total_cases,
        SUM(CASE WHEN c.status NOT IN ('resolved','closed','cancelled') THEN 1 ELSE 0 END)::int as open_cases,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 3600)::numeric, 1)::float as avg_age_hours
      FROM support_cases c
      LEFT JOIN support_channels ch ON ch.id = c.channel_id AND ch.org_id = ${orgId}
      WHERE c.org_id = ${orgId}
        AND c.created_at >= ${fromDate}::timestamptz AND c.created_at < ${toDate}::timestamptz
        AND (${market}::text IS NULL OR c.market_id = ${market})
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        AND c.channel_id IS NOT NULL
      GROUP BY c.channel_id, ch.name, ch.source
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
        c.channel_id,
        ch.name as channel_name,
        COALESCE(ch.source, 'telegram') as channel_source,
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
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        AND COALESCE(lsc.changed_at, c.created_at) < NOW() - INTERVAL '24 hours'
      ORDER BY hours_in_status DESC
      LIMIT 10
    `

    // 6. Общая статистика периода
    const statsRow = await sql`
      SELECT
        COUNT(*) FILTER (WHERE sc.created_at >= ${fromDate}::timestamptz AND sc.created_at < ${toDate}::timestamptz)::int as total_created,
        COUNT(*) FILTER (WHERE sc.resolved_at >= ${fromDate}::timestamptz AND sc.resolved_at < ${toDate}::timestamptz)::int as total_resolved,
        ROUND(AVG(sc.resolution_time_minutes) FILTER (
          WHERE sc.resolved_at >= ${fromDate}::timestamptz AND sc.resolved_at < ${toDate}::timestamptz
            AND sc.resolution_time_minutes IS NOT NULL
        )::numeric / 60.0, 1)::float as avg_resolution_hours,
        COUNT(*) FILTER (WHERE sc.status NOT IN ('resolved','closed','cancelled'))::int as open_now,
        COUNT(*) FILTER (
          WHERE sc.status NOT IN ('resolved','closed','cancelled') AND (sc.assigned_to IS NULL OR sc.assigned_to = '')
        )::int as unassigned_now
      FROM support_cases sc
      LEFT JOIN support_channels ch ON ch.id = sc.channel_id AND ch.org_id = sc.org_id
      WHERE sc.org_id = ${orgId}
        AND (${market}::text IS NULL OR sc.market_id = ${market})
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
    `

    // 7. Предыдущий период — для дельт на общих метриках
    const prevStatsRow = await sql`
      SELECT
        COUNT(*)::int as total_created
      FROM support_cases sc
      LEFT JOIN support_channels ch ON ch.id = sc.channel_id AND ch.org_id = sc.org_id
      WHERE sc.org_id = ${orgId}
        AND sc.created_at >= ${prevFromDate}::timestamptz AND sc.created_at < ${fromDate}::timestamptz
        AND (${market}::text IS NULL OR sc.market_id = ${market})
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
    `

    // 7a. Разбивка bySource: ключевые метрики отдельно для Telegram и WhatsApp
    //     Всегда считаем по обоим, игнорируя текущий фильтр source — для split-бейджей в UI
    const bySourceRaw = await sql`
      SELECT
        COALESCE(ch.source, 'telegram') as src,
        COUNT(*) FILTER (WHERE sc.created_at >= ${fromDate}::timestamptz AND sc.created_at < ${toDate}::timestamptz)::int as created,
        COUNT(*) FILTER (WHERE sc.resolved_at >= ${fromDate}::timestamptz AND sc.resolved_at < ${toDate}::timestamptz)::int as resolved,
        COUNT(*) FILTER (WHERE sc.status NOT IN ('resolved','closed','cancelled'))::int as open_now
      FROM support_cases sc
      LEFT JOIN support_channels ch ON ch.id = sc.channel_id AND ch.org_id = sc.org_id
      WHERE sc.org_id = ${orgId}
        AND (${market}::text IS NULL OR sc.market_id = ${market})
      GROUP BY COALESCE(ch.source, 'telegram')
    `

    // Мусорные значения AI-классификации, которые не несут сигнала для "где болит"
    const noiseCategories = ['unknown', 'other', 'general', 'noise', 'small_talk', 'greeting', 'closing', 'information', 'none', '']
    const noiseIntents = ['unknown', 'other', 'greeting', 'closing', 'small_talk', 'information', 'none', 'report_problem', '']

    // 8. О чём реально пишут клиенты (AI-темы из сообщений)
    //    Берём только клиентские сообщения, где AI успел определить категорию
    //    Исключаем мусорные значения и порог min 3 сообщения
    const topAiTopics = await sql`
      WITH curr AS (
        SELECT LOWER(m.ai_category) as topic, COUNT(*)::int as cnt
        FROM support_messages m
        LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = true
          AND m.ai_category IS NOT NULL AND m.ai_category <> ''
          AND LOWER(m.ai_category) <> ALL(${noiseCategories}::text[])
          AND m.created_at >= ${fromDate}::timestamptz AND m.created_at < ${toDate}::timestamptz
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        GROUP BY LOWER(m.ai_category)
        HAVING COUNT(*) >= 3
      ),
      prev AS (
        SELECT LOWER(m.ai_category) as topic, COUNT(*)::int as cnt
        FROM support_messages m
        LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = true
          AND m.ai_category IS NOT NULL AND m.ai_category <> ''
          AND LOWER(m.ai_category) <> ALL(${noiseCategories}::text[])
          AND m.created_at >= ${prevFromDate}::timestamptz AND m.created_at < ${fromDate}::timestamptz
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        GROUP BY LOWER(m.ai_category)
      )
      SELECT
        c.topic,
        c.cnt as messages,
        COALESCE(p.cnt, 0)::int as prev_messages,
        (c.cnt - COALESCE(p.cnt, 0))::int as delta,
        ROUND(
          CASE WHEN COALESCE(p.cnt, 0) = 0 THEN NULL
               ELSE ((c.cnt - p.cnt)::numeric / p.cnt) * 100 END,
          0
        ) as delta_pct
      FROM curr c
      LEFT JOIN prev p ON p.topic = c.topic
      ORDER BY c.cnt DESC
      LIMIT 8
    `

    // 9. Что хотят клиенты (AI intents) — фильтруем мусор и порог 3
    const topIntents = await sql`
      SELECT
        LOWER(m.ai_intent) as intent,
        COUNT(*)::int as messages,
        COUNT(DISTINCT m.channel_id)::int as channels,
        COUNT(*) FILTER (WHERE m.ai_sentiment IN ('negative','frustrated'))::int as negative,
        COUNT(*) FILTER (WHERE COALESCE(m.ai_urgency, 0) >= 3)::int as urgent
      FROM support_messages m
      LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
      WHERE m.org_id = ${orgId}
        AND m.is_from_client = true
        AND m.ai_intent IS NOT NULL AND m.ai_intent <> ''
        AND LOWER(m.ai_intent) <> ALL(${noiseIntents}::text[])
        AND m.created_at >= ${fromDate}::timestamptz AND m.created_at < ${toDate}::timestamptz
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
      GROUP BY LOWER(m.ai_intent)
      HAVING COUNT(*) >= 3
      ORDER BY messages DESC
      LIMIT 6
    `

    // 10. Типы контента: текст/голос/видео/фото/документ
    const contentMix = await sql`
      SELECT
        COALESCE(NULLIF(LOWER(m.content_type), ''), 'text') as content_type,
        COUNT(*)::int as messages
      FROM support_messages m
      LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
      WHERE m.org_id = ${orgId}
        AND m.is_from_client = true
        AND m.created_at >= ${fromDate}::timestamptz AND m.created_at < ${toDate}::timestamptz
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
      GROUP BY COALESCE(NULLIF(LOWER(m.content_type), ''), 'text')
      ORDER BY messages DESC
    `

    // 11. Распределение по языкам (из транскрипций voice/video)
    const byLanguage = await sql`
      SELECT
        LOWER(m.transcript_language) as language,
        COUNT(*)::int as messages
      FROM support_messages m
      LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
      WHERE m.org_id = ${orgId}
        AND m.is_from_client = true
        AND m.transcript_language IS NOT NULL AND m.transcript_language <> ''
        AND m.created_at >= ${fromDate}::timestamptz AND m.created_at < ${toDate}::timestamptz
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
      GROUP BY LOWER(m.transcript_language)
      ORDER BY messages DESC
      LIMIT 8
    `

    // 12. Настроение клиентов — % negative/neutral/positive
    const sentimentRow = await sql`
      SELECT
        COUNT(*) FILTER (WHERE m.ai_sentiment = 'negative' OR m.ai_sentiment = 'frustrated')::int as negative,
        COUNT(*) FILTER (WHERE m.ai_sentiment = 'neutral')::int as neutral,
        COUNT(*) FILTER (WHERE m.ai_sentiment = 'positive')::int as positive,
        COUNT(*) FILTER (WHERE m.ai_sentiment IS NOT NULL AND m.ai_sentiment <> '')::int as total
      FROM support_messages m
      LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
      WHERE m.org_id = ${orgId}
        AND m.is_from_client = true
        AND m.created_at >= ${fromDate}::timestamptz AND m.created_at < ${toDate}::timestamptz
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
    `

    // 13. Кто из сотрудников слабее: для агентов с ≥3 назначенными кейсами за период
    //     считаем resolved/assigned, ср. время закрытия, открытые и зависшие кейсы
    const bottomAgents = await sql`
      WITH last_status_change AS (
        SELECT DISTINCT ON (case_id) case_id, created_at as changed_at
        FROM support_case_activities
        WHERE type = 'status_change'
        ORDER BY case_id, created_at DESC
      ),
      agent_cases AS (
        SELECT
          c.assigned_to as agent_id,
          c.id as case_id,
          c.status,
          c.created_at,
          c.resolved_at,
          c.resolution_time_minutes,
          c.first_response_at,
          COALESCE(lsc.changed_at, c.created_at) as in_status_since
        FROM support_cases c
        LEFT JOIN support_channels ch ON ch.id = c.channel_id AND ch.org_id = c.org_id
        LEFT JOIN last_status_change lsc ON lsc.case_id = c.id
        WHERE c.org_id = ${orgId}
          AND c.assigned_to IS NOT NULL AND c.assigned_to <> ''
          AND c.created_at >= ${fromDate}::timestamptz AND c.created_at < ${toDate}::timestamptz
          AND (${market}::text IS NULL OR c.market_id = ${market})
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
      )
      SELECT
        a.id as agent_id,
        a.name as agent_name,
        a.avatar_url,
        COUNT(*)::int as assigned,
        COUNT(*) FILTER (WHERE ac.status IN ('resolved','closed'))::int as resolved,
        COUNT(*) FILTER (WHERE ac.status NOT IN ('resolved','closed','cancelled'))::int as open_now,
        COUNT(*) FILTER (
          WHERE ac.status NOT IN ('resolved','closed','cancelled')
            AND ac.in_status_since < NOW() - INTERVAL '24 hours'
        )::int as stuck,
        ROUND(AVG(ac.resolution_time_minutes) FILTER (
          WHERE ac.resolved_at IS NOT NULL AND ac.resolution_time_minutes IS NOT NULL
        )::numeric / 60.0, 1)::float as avg_resolution_hours,
        ROUND(AVG(EXTRACT(EPOCH FROM (ac.first_response_at - ac.created_at)) / 60) FILTER (
          WHERE ac.first_response_at IS NOT NULL
        )::numeric, 0)::int as avg_first_response_min
      FROM agent_cases ac
      JOIN support_agents a ON a.id = ac.agent_id AND a.org_id = ${orgId}
      GROUP BY a.id, a.name, a.avatar_url
      HAVING COUNT(*) >= 3
      ORDER BY
        COUNT(*) FILTER (
          WHERE ac.status NOT IN ('resolved','closed','cancelled')
            AND ac.in_status_since < NOW() - INTERVAL '24 hours'
        ) DESC,
        (COUNT(*) FILTER (WHERE ac.status IN ('resolved','closed'))::numeric / COUNT(*)) ASC,
        AVG(ac.resolution_time_minutes) DESC NULLS LAST
      LIMIT 8
    `

    const stats = statsRow[0] || {}
    const prevStats = prevStatsRow[0] || {}
    const sentiment = sentimentRow[0] || { negative: 0, neutral: 0, positive: 0, total: 0 }
    const totalContent = contentMix.reduce((s: number, r: any) => s + parseInt(r.messages || 0), 0) || 0
    const totalLang = byLanguage.reduce((s: number, r: any) => s + parseInt(r.messages || 0), 0) || 0

    // Разбивка по source для split-бейджей (TG/WA)
    const bySourceMap: Record<string, { created: number; resolved: number; openNow: number }> = {
      telegram: { created: 0, resolved: 0, openNow: 0 },
      whatsapp: { created: 0, resolved: 0, openNow: 0 },
    }
    for (const r of bySourceRaw as any[]) {
      const src = (r.src as string) === 'whatsapp' ? 'whatsapp' : 'telegram'
      bySourceMap[src] = {
        created: parseInt(r.created || 0),
        resolved: parseInt(r.resolved || 0),
        openNow: parseInt(r.open_now || 0),
      }
    }

    return json(
      {
        period: { from: fromDate, to: toDate, days, prevFrom: prevFromDate },
        source,
        bySource: bySourceMap,
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
          source: (r.channel_source as string) === 'whatsapp' ? 'whatsapp' : 'telegram',
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
          channelId: r.channel_id || null,
          channelName: r.channel_name,
          source: (r.channel_source as string) === 'whatsapp' ? 'whatsapp' : 'telegram',
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
        topAiTopics: topAiTopics.map((r: any) => ({
          topic: r.topic,
          messages: parseInt(r.messages || 0),
          prevMessages: parseInt(r.prev_messages || 0),
          delta: parseInt(r.delta || 0),
          deltaPct: r.delta_pct == null ? null : Number(r.delta_pct),
        })),
        topIntents: topIntents.map((r: any) => ({
          intent: r.intent,
          messages: parseInt(r.messages || 0),
          channels: parseInt(r.channels || 0),
          negative: parseInt(r.negative || 0),
          urgent: parseInt(r.urgent || 0),
        })),
        contentMix: contentMix.map((r: any) => {
          const m = parseInt(r.messages || 0)
          return {
            contentType: r.content_type,
            messages: m,
            share: totalContent > 0 ? Math.round((m / totalContent) * 1000) / 10 : 0,
          }
        }),
        byLanguage: byLanguage.map((r: any) => {
          const m = parseInt(r.messages || 0)
          return {
            language: r.language,
            messages: m,
            share: totalLang > 0 ? Math.round((m / totalLang) * 1000) / 10 : 0,
          }
        }),
        sentiment: {
          negative: parseInt(sentiment.negative || 0),
          neutral: parseInt(sentiment.neutral || 0),
          positive: parseInt(sentiment.positive || 0),
          total: parseInt(sentiment.total || 0),
        },
        bottomAgents: bottomAgents.map((r: any) => {
          const assigned = parseInt(r.assigned || 0)
          const resolved = parseInt(r.resolved || 0)
          const resolvedPct = assigned > 0 ? Math.round((resolved / assigned) * 100) : 0
          return {
            agentId: r.agent_id,
            agentName: r.agent_name,
            avatarUrl: r.avatar_url || null,
            assigned,
            resolved,
            openNow: parseInt(r.open_now || 0),
            stuck: parseInt(r.stuck || 0),
            resolvedPct,
            avgResolutionHours: r.avg_resolution_hours == null ? null : Number(r.avg_resolution_hours),
            avgFirstResponseMin: r.avg_first_response_min == null ? null : parseInt(r.avg_first_response_min),
          }
        }),
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
