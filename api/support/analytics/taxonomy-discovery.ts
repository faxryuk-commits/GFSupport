import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

/**
 * GET /api/support/analytics/taxonomy-discovery?period=30d
 *
 * Read-only. Показывает реальное распределение AI-полей в сообщениях
 * и каналов, чтобы можно было собрать/поправить таксономию до бекфилла.
 *
 * Возвращает:
 *   - aiCategory:      distinct значения + count
 *   - aiIntent:        distinct значения + count
 *   - aiSentiment:     distinct значения + count
 *   - contentType:     распределение по типу сообщения
 *   - language:        transcript_language
 *   - entities:        частые product/error/integration из ai_extracted_entities
 *   - channels:        distinct type/sla_category
 *   - sla:             текущие настройки SLA из support_settings
 *   - totals:          общие счётчики для контекста
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
  const period = url.searchParams.get('period') || '30d'
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30

  const now = new Date()
  const fromDate = new Date(now.getTime() - days * 86400000).toISOString()

  try {
    // 1. ai_category — реальное распределение (любой sender_role, чтобы видеть всю картину)
    const aiCategory = await sql`
      SELECT
        COALESCE(NULLIF(LOWER(ai_category), ''), '(empty)') as value,
        COUNT(*)::int as count,
        COUNT(*) FILTER (WHERE is_from_client = true)::int as from_client,
        COUNT(*) FILTER (WHERE is_problem = true)::int as is_problem
      FROM support_messages
      WHERE org_id = ${orgId}
        AND created_at >= ${fromDate}::timestamptz
      GROUP BY COALESCE(NULLIF(LOWER(ai_category), ''), '(empty)')
      ORDER BY count DESC
      LIMIT 40
    `

    // 2. ai_intent
    const aiIntent = await sql`
      SELECT
        COALESCE(NULLIF(LOWER(ai_intent), ''), '(empty)') as value,
        COUNT(*)::int as count,
        COUNT(*) FILTER (WHERE is_from_client = true)::int as from_client
      FROM support_messages
      WHERE org_id = ${orgId}
        AND created_at >= ${fromDate}::timestamptz
      GROUP BY COALESCE(NULLIF(LOWER(ai_intent), ''), '(empty)')
      ORDER BY count DESC
      LIMIT 40
    `

    // 3. ai_sentiment
    const aiSentiment = await sql`
      SELECT
        COALESCE(NULLIF(LOWER(ai_sentiment), ''), '(empty)') as value,
        COUNT(*)::int as count,
        COUNT(*) FILTER (WHERE is_from_client = true)::int as from_client
      FROM support_messages
      WHERE org_id = ${orgId}
        AND created_at >= ${fromDate}::timestamptz
      GROUP BY COALESCE(NULLIF(LOWER(ai_sentiment), ''), '(empty)')
      ORDER BY count DESC
    `

    // 4. content_type (text/voice/video/photo/document)
    const contentType = await sql`
      SELECT
        COALESCE(NULLIF(LOWER(content_type), ''), 'text') as value,
        COUNT(*)::int as count
      FROM support_messages
      WHERE org_id = ${orgId}
        AND created_at >= ${fromDate}::timestamptz
      GROUP BY COALESCE(NULLIF(LOWER(content_type), ''), 'text')
      ORDER BY count DESC
    `

    // 5. transcript_language
    const language = await sql`
      SELECT
        LOWER(transcript_language) as value,
        COUNT(*)::int as count
      FROM support_messages
      WHERE org_id = ${orgId}
        AND transcript_language IS NOT NULL AND transcript_language <> ''
        AND created_at >= ${fromDate}::timestamptz
      GROUP BY LOWER(transcript_language)
      ORDER BY count DESC
      LIMIT 10
    `

    // 6. urgency distribution
    const urgency = await sql`
      SELECT
        COALESCE(ai_urgency, 0) as value,
        COUNT(*)::int as count
      FROM support_messages
      WHERE org_id = ${orgId}
        AND is_from_client = true
        AND created_at >= ${fromDate}::timestamptz
      GROUP BY COALESCE(ai_urgency, 0)
      ORDER BY value ASC
    `

    // 7. Частые значения из ai_extracted_entities — отдельно product/error/integration
    const entityIntegration = await sql`
      SELECT
        LOWER(TRIM(ai_extracted_entities->>'integration')) as value,
        COUNT(*)::int as count
      FROM support_messages
      WHERE org_id = ${orgId}
        AND created_at >= ${fromDate}::timestamptz
        AND ai_extracted_entities IS NOT NULL
        AND ai_extracted_entities->>'integration' IS NOT NULL
        AND LENGTH(TRIM(ai_extracted_entities->>'integration')) > 0
      GROUP BY LOWER(TRIM(ai_extracted_entities->>'integration'))
      ORDER BY count DESC
      LIMIT 20
    `
    const entityProduct = await sql`
      SELECT
        LOWER(TRIM(ai_extracted_entities->>'product')) as value,
        COUNT(*)::int as count
      FROM support_messages
      WHERE org_id = ${orgId}
        AND created_at >= ${fromDate}::timestamptz
        AND ai_extracted_entities IS NOT NULL
        AND ai_extracted_entities->>'product' IS NOT NULL
        AND LENGTH(TRIM(ai_extracted_entities->>'product')) > 0
      GROUP BY LOWER(TRIM(ai_extracted_entities->>'product'))
      ORDER BY count DESC
      LIMIT 20
    `
    const entityError = await sql`
      SELECT
        LOWER(TRIM(ai_extracted_entities->>'error')) as value,
        COUNT(*)::int as count
      FROM support_messages
      WHERE org_id = ${orgId}
        AND created_at >= ${fromDate}::timestamptz
        AND ai_extracted_entities IS NOT NULL
        AND ai_extracted_entities->>'error' IS NOT NULL
        AND LENGTH(TRIM(ai_extracted_entities->>'error')) > 0
      GROUP BY LOWER(TRIM(ai_extracted_entities->>'error'))
      ORDER BY count DESC
      LIMIT 20
    `

    // 8. Каналы — тип и sla_category
    const channelTypes = await sql`
      SELECT
        COALESCE(NULLIF(type, ''), '(empty)') as value,
        COUNT(*)::int as count
      FROM support_channels
      WHERE org_id = ${orgId}
        AND is_active = true
      GROUP BY COALESCE(NULLIF(type, ''), '(empty)')
      ORDER BY count DESC
    `
    const channelSlaCategories = await sql`
      SELECT
        COALESCE(NULLIF(sla_category, ''), '(empty)') as value,
        COUNT(*)::int as count
      FROM support_channels
      WHERE org_id = ${orgId}
        AND is_active = true
      GROUP BY COALESCE(NULLIF(sla_category, ''), '(empty)')
      ORDER BY count DESC
    `

    // 9. Кейсы: категории и статусы
    const caseStatus = await sql`
      SELECT
        COALESCE(NULLIF(LOWER(status), ''), '(empty)') as value,
        COUNT(*)::int as count
      FROM support_cases
      WHERE org_id = ${orgId}
        AND created_at >= ${fromDate}::timestamptz
      GROUP BY COALESCE(NULLIF(LOWER(status), ''), '(empty)')
      ORDER BY count DESC
    `
    const caseCategory = await sql`
      SELECT
        COALESCE(NULLIF(LOWER(category), ''), '(empty)') as value,
        COUNT(*)::int as count,
        COUNT(*) FILTER (WHERE subcategory IS NOT NULL AND subcategory <> '')::int as has_subcategory,
        COUNT(*) FILTER (WHERE root_cause IS NOT NULL AND root_cause <> '')::int as has_root_cause
      FROM support_cases
      WHERE org_id = ${orgId}
        AND created_at >= ${fromDate}::timestamptz
      GROUP BY COALESCE(NULLIF(LOWER(category), ''), '(empty)')
      ORDER BY count DESC
      LIMIT 20
    `

    // 10. Текущий SLA из настроек
    const slaRows = await sql`
      SELECT key, value FROM support_settings
      WHERE org_id = ${orgId}
        AND key IN ('targetResponseTime', 'targetResolutionTime', 'slaTarget', 'workingHoursStart', 'workingHoursEnd', 'workingDays')
    `
    const slaSettings: Record<string, string | null> = {
      targetResponseTime: null,
      targetResolutionTime: null,
      slaTarget: null,
      workingHoursStart: null,
      workingHoursEnd: null,
      workingDays: null,
    }
    for (const r of slaRows as any[]) {
      if (r.key in slaSettings) slaSettings[r.key] = r.value
    }

    // 11. Totals для контекста
    const totalsRow = await sql`
      SELECT
        COUNT(*)::int as messages_total,
        COUNT(*) FILTER (WHERE is_from_client = true)::int as messages_from_client,
        COUNT(*) FILTER (WHERE is_problem = true AND is_from_client = true)::int as problems,
        COUNT(*) FILTER (WHERE case_id IS NOT NULL)::int as linked_to_case,
        COUNT(DISTINCT channel_id)::int as channels_active,
        COUNT(*) FILTER (WHERE ai_category IS NOT NULL AND ai_category <> '')::int as analyzed
      FROM support_messages
      WHERE org_id = ${orgId}
        AND created_at >= ${fromDate}::timestamptz
    `
    const casesTotalsRow = await sql`
      SELECT
        COUNT(*)::int as cases_total,
        COUNT(*) FILTER (WHERE status IN ('resolved', 'closed'))::int as resolved,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed', 'cancelled'))::int as open_now
      FROM support_cases
      WHERE org_id = ${orgId}
        AND created_at >= ${fromDate}::timestamptz
    `

    const totals = (totalsRow[0] as any) || {}
    const cases = (casesTotalsRow[0] as any) || {}

    return json(
      {
        period: { from: fromDate, to: now.toISOString(), days },
        totals: {
          messagesTotal: parseInt(totals.messages_total || 0),
          messagesFromClient: parseInt(totals.messages_from_client || 0),
          problems: parseInt(totals.problems || 0),
          linkedToCase: parseInt(totals.linked_to_case || 0),
          channelsActive: parseInt(totals.channels_active || 0),
          analyzed: parseInt(totals.analyzed || 0),
          casesTotal: parseInt(cases.cases_total || 0),
          casesResolved: parseInt(cases.resolved || 0),
          casesOpenNow: parseInt(cases.open_now || 0),
        },
        sla: {
          targetResponseTime: slaSettings.targetResponseTime ? Number(slaSettings.targetResponseTime) : null,
          targetResolutionTime: slaSettings.targetResolutionTime ? Number(slaSettings.targetResolutionTime) : null,
          slaTarget: slaSettings.slaTarget ? Number(slaSettings.slaTarget) : null,
          workingHoursStart: slaSettings.workingHoursStart,
          workingHoursEnd: slaSettings.workingHoursEnd,
          workingDays: slaSettings.workingDays,
        },
        aiCategory: (aiCategory as any[]).map((r) => ({
          value: r.value,
          count: parseInt(r.count || 0),
          fromClient: parseInt(r.from_client || 0),
          isProblem: parseInt(r.is_problem || 0),
        })),
        aiIntent: (aiIntent as any[]).map((r) => ({
          value: r.value,
          count: parseInt(r.count || 0),
          fromClient: parseInt(r.from_client || 0),
        })),
        aiSentiment: (aiSentiment as any[]).map((r) => ({
          value: r.value,
          count: parseInt(r.count || 0),
          fromClient: parseInt(r.from_client || 0),
        })),
        contentType: (contentType as any[]).map((r) => ({
          value: r.value,
          count: parseInt(r.count || 0),
        })),
        language: (language as any[]).map((r) => ({
          value: r.value,
          count: parseInt(r.count || 0),
        })),
        urgency: (urgency as any[]).map((r) => ({
          value: parseInt(r.value || 0),
          count: parseInt(r.count || 0),
        })),
        entities: {
          integration: (entityIntegration as any[]).map((r) => ({
            value: r.value,
            count: parseInt(r.count || 0),
          })),
          product: (entityProduct as any[]).map((r) => ({
            value: r.value,
            count: parseInt(r.count || 0),
          })),
          error: (entityError as any[]).map((r) => ({
            value: r.value,
            count: parseInt(r.count || 0),
          })),
        },
        channels: {
          byType: (channelTypes as any[]).map((r) => ({
            value: r.value,
            count: parseInt(r.count || 0),
          })),
          bySlaCategory: (channelSlaCategories as any[]).map((r) => ({
            value: r.value,
            count: parseInt(r.count || 0),
          })),
        },
        cases: {
          byStatus: (caseStatus as any[]).map((r) => ({
            value: r.value,
            count: parseInt(r.count || 0),
          })),
          byCategory: (caseCategory as any[]).map((r) => ({
            value: r.value,
            count: parseInt(r.count || 0),
            hasSubcategory: parseInt(r.has_subcategory || 0),
            hasRootCause: parseInt(r.has_root_cause || 0),
          })),
        },
      },
      200,
      60,
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[taxonomy-discovery]', msg)
    return json({ error: msg }, 500)
  }
}
