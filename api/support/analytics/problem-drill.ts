/**
 * Drill-down по конкретной подкатегории — какие именно темы (ai_theme)
 * встречаются чаще всего и реальные сообщения внутри.
 *
 * GET /api/support/analytics/problem-drill?domain=X&subcategory=Y&period=30d[&source=]
 *
 * Возвращает:
 *   - top_themes: топ ai_theme строк по частоте (LLM формулирует свободно)
 *   - top_intents: топ ai_intent (отдельный, более структурированный сигнал)
 *   - by_status:   распределение resolved/in_progress/stuck/ignored
 *   - by_sentiment: positive/neutral/negative/frustrated
 *   - by_channel: топ каналов с этой проблемой (= какие покупатели Delever
 *     чаще жалуются на это)
 *   - recent_messages: 30 свежих сообщений с цитатой и ссылкой на чат
 *
 * Использует ту же выборку, что category-flow (is_problem или нужный intent),
 * чтобы числа сходились с верхним уровнем.
 */

import { getRequestOrgId } from '../lib/org.js'
import { json, getSQL } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

interface ThemeRow {
  theme: string | null
  count: string | number
  sample_text: string | null
}

interface IntentRow {
  intent: string | null
  count: string | number
}

interface StatusRow {
  case_status: string | null
  count: string | number
}

interface SentimentRow {
  sentiment: string | null
  count: string | number
}

interface ChannelRow {
  channel_id: string
  channel_name: string | null
  source: string | null
  count: string | number
}

interface MessageRow {
  id: string
  channel_id: string
  channel_name: string | null
  source: string | null
  text_content: string | null
  ai_theme: string | null
  ai_intent: string | null
  ai_sentiment: string | null
  is_problem: boolean | null
  created_at: string
  case_status: string | null
}

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  const p = parseInt(String(v))
  return Number.isFinite(p) ? p : 0
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

  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'Unauthorized' }, 401)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)
  const domain = url.searchParams.get('domain')
  const subcategory = url.searchParams.get('subcategory') // может быть '_unknown' или null
  const period = url.searchParams.get('period') || '30d'
  const source = (url.searchParams.get('source') || 'all').toLowerCase()
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30

  if (!domain) return json({ error: 'Missing domain' }, 400)

  const fromISO = new Date(Date.now() - days * 86400000).toISOString()
  const subFilter = subcategory === '_unknown' ? null : subcategory
  const sourceFilter = source === 'all' ? 'all' : source

  try {
    // Базовая выборка: сообщения клиента в этой подкатегории за период,
    // помеченные как проблема или с одним из проблемных intent'ов.
    const [themeRows, intentRows, statusRows, sentimentRows, channelRows, messageRows] = await Promise.all([
      // 1. Топ ai_theme
      sql`
        SELECT
          m.ai_theme AS theme,
          COUNT(*)::int AS count,
          (ARRAY_AGG(m.text_content ORDER BY m.created_at DESC))[1] AS sample_text
        FROM support_messages m
        LEFT JOIN support_channels c ON c.id = m.channel_id
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = true
          AND m.created_at >= ${fromISO}::timestamptz
          AND m.ai_domain = ${domain}
          AND (${subFilter}::text IS NULL OR m.ai_subcategory = ${subFilter})
          AND (${sourceFilter}::text = 'all' OR COALESCE(c.source, 'telegram') = ${sourceFilter})
          AND (m.is_problem = true OR m.ai_intent IN ('report_problem','complaint','ask_question','request_feature'))
          AND m.ai_theme IS NOT NULL AND m.ai_theme <> ''
        GROUP BY m.ai_theme
        ORDER BY count DESC
        LIMIT 15
      `.catch(() => []),

      // 2. Топ ai_intent в этой подкатегории
      sql`
        SELECT
          m.ai_intent AS intent,
          COUNT(*)::int AS count
        FROM support_messages m
        LEFT JOIN support_channels c ON c.id = m.channel_id
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = true
          AND m.created_at >= ${fromISO}::timestamptz
          AND m.ai_domain = ${domain}
          AND (${subFilter}::text IS NULL OR m.ai_subcategory = ${subFilter})
          AND (${sourceFilter}::text = 'all' OR COALESCE(c.source, 'telegram') = ${sourceFilter})
          AND m.ai_intent IS NOT NULL
        GROUP BY m.ai_intent
        ORDER BY count DESC
        LIMIT 10
      `.catch(() => []),

      // 3. Распределение по статусу кейса (если есть case)
      sql`
        SELECT
          COALESCE(LOWER(c.status), 'no_case') AS case_status,
          COUNT(*)::int AS count
        FROM support_messages m
        LEFT JOIN support_channels ch ON ch.id = m.channel_id
        LEFT JOIN support_cases c ON c.id = m.case_id
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = true
          AND m.created_at >= ${fromISO}::timestamptz
          AND m.ai_domain = ${domain}
          AND (${subFilter}::text IS NULL OR m.ai_subcategory = ${subFilter})
          AND (${sourceFilter}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${sourceFilter})
          AND (m.is_problem = true OR m.ai_intent IN ('report_problem','complaint','ask_question','request_feature'))
        GROUP BY 1
        ORDER BY count DESC
      `.catch(() => []),

      // 4. Sentiment-распределение
      sql`
        SELECT
          COALESCE(LOWER(m.ai_sentiment), 'unknown') AS sentiment,
          COUNT(*)::int AS count
        FROM support_messages m
        LEFT JOIN support_channels c ON c.id = m.channel_id
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = true
          AND m.created_at >= ${fromISO}::timestamptz
          AND m.ai_domain = ${domain}
          AND (${subFilter}::text IS NULL OR m.ai_subcategory = ${subFilter})
          AND (${sourceFilter}::text = 'all' OR COALESCE(c.source, 'telegram') = ${sourceFilter})
          AND (m.is_problem = true OR m.ai_intent IN ('report_problem','complaint','ask_question','request_feature'))
        GROUP BY 1
        ORDER BY count DESC
      `.catch(() => []),

      // 5. Топ каналов (покупателей Delever) с этой проблемой
      sql`
        SELECT
          m.channel_id,
          c.name AS channel_name,
          COALESCE(c.source, 'telegram') AS source,
          COUNT(*)::int AS count
        FROM support_messages m
        LEFT JOIN support_channels c ON c.id = m.channel_id
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = true
          AND m.created_at >= ${fromISO}::timestamptz
          AND m.ai_domain = ${domain}
          AND (${subFilter}::text IS NULL OR m.ai_subcategory = ${subFilter})
          AND (${sourceFilter}::text = 'all' OR COALESCE(c.source, 'telegram') = ${sourceFilter})
          AND (m.is_problem = true OR m.ai_intent IN ('report_problem','complaint','ask_question','request_feature'))
        GROUP BY m.channel_id, c.name, c.source
        ORDER BY count DESC
        LIMIT 15
      `.catch(() => []),

      // 6. Последние 30 сообщений с этой темой
      sql`
        SELECT
          m.id, m.channel_id, c.name AS channel_name,
          COALESCE(c.source, 'telegram') AS source,
          m.text_content, m.ai_theme, m.ai_intent, m.ai_sentiment, m.is_problem,
          m.created_at,
          LOWER(cs.status) AS case_status
        FROM support_messages m
        LEFT JOIN support_channels c ON c.id = m.channel_id
        LEFT JOIN support_cases cs ON cs.id = m.case_id
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = true
          AND m.created_at >= ${fromISO}::timestamptz
          AND m.ai_domain = ${domain}
          AND (${subFilter}::text IS NULL OR m.ai_subcategory = ${subFilter})
          AND (${sourceFilter}::text = 'all' OR COALESCE(c.source, 'telegram') = ${sourceFilter})
          AND (m.is_problem = true OR m.ai_intent IN ('report_problem','complaint','ask_question','request_feature'))
        ORDER BY m.created_at DESC
        LIMIT 30
      `.catch(() => []),
    ])

    return json(
      {
        domain,
        subcategory,
        period: { days, from: fromISO },
        source: sourceFilter,
        topThemes: (themeRows as ThemeRow[]).map((r) => ({
          theme: r.theme,
          count: num(r.count),
          sampleText: r.sample_text ? r.sample_text.slice(0, 200) : null,
        })),
        topIntents: (intentRows as IntentRow[]).map((r) => ({
          intent: r.intent,
          count: num(r.count),
        })),
        byStatus: (statusRows as StatusRow[]).map((r) => ({
          status: r.case_status,
          count: num(r.count),
        })),
        bySentiment: (sentimentRows as SentimentRow[]).map((r) => ({
          sentiment: r.sentiment,
          count: num(r.count),
        })),
        topChannels: (channelRows as ChannelRow[]).map((r) => ({
          channelId: r.channel_id,
          channelName: r.channel_name,
          source: r.source,
          count: num(r.count),
        })),
        recentMessages: (messageRows as MessageRow[]).map((r) => ({
          messageId: r.id,
          channelId: r.channel_id,
          channelName: r.channel_name,
          source: r.source,
          text: r.text_content ? r.text_content.slice(0, 500) : '',
          theme: r.ai_theme,
          intent: r.ai_intent,
          sentiment: r.ai_sentiment,
          isProblem: r.is_problem,
          caseStatus: r.case_status,
          createdAt: r.created_at,
        })),
      },
      200,
      30,
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[problem-drill]', msg, e instanceof Error ? e.stack : undefined)
    return json({ error: msg, where: 'problem-drill' }, 500)
  }
}
