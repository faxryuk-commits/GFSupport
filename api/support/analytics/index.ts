import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const sql = getSQL()
  const url = new URL(req.url)
  const period = url.searchParams.get('period') || '30d' // 7d, 30d, 90d
  
  // Вычисляем дату начала периода
  const periodDays = period === '7d' ? 7 : period === '90d' ? 90 : 30
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - periodDays)

  try {
    // ============================================
    // 1. OVERVIEW METRICS
    // ============================================
    
    const overviewResult = await sql`
      SELECT
        COUNT(*) as total_cases,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed')) as open_cases,
        COUNT(*) FILTER (WHERE status IN ('resolved', 'closed')) as resolved_cases,
        COUNT(*) FILTER (WHERE created_at >= ${startDate.toISOString()}) as new_cases_period,
        AVG(resolution_time_minutes) FILTER (WHERE resolution_time_minutes > 0) as avg_resolution_minutes,
        COUNT(*) FILTER (WHERE priority = 'urgent') as urgent_cases,
        COUNT(*) FILTER (WHERE is_recurring = true) as recurring_cases
      FROM support_cases
    `
    const overview = overviewResult[0] || {}

    const messagesResult = await sql`
      SELECT
        COUNT(*) as total_messages,
        COUNT(*) FILTER (WHERE is_problem = true) as problem_messages,
        COUNT(*) FILTER (WHERE content_type = 'voice') as voice_messages,
        COUNT(*) FILTER (WHERE content_type IN ('video', 'video_note')) as video_messages,
        COUNT(*) FILTER (WHERE transcript IS NOT NULL) as transcribed_messages
      FROM support_messages
      WHERE created_at >= ${startDate.toISOString()}
    `
    const messages = messagesResult[0] || {}

    const channelsResult = await sql`
      SELECT COUNT(*) as total_channels, COUNT(*) FILTER (WHERE is_active = true) as active_channels
      FROM support_channels
    `
    const channels = channelsResult[0] || {}

    // ============================================
    // 2. PROBLEM PATTERNS (топ категорий и проблем)
    // ============================================
    
    const categoryPatterns = await sql`
      SELECT 
        COALESCE(category, 'uncategorized') as category,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed')) as open_count,
        AVG(resolution_time_minutes) FILTER (WHERE resolution_time_minutes > 0) as avg_resolution
      FROM support_cases
      WHERE created_at >= ${startDate.toISOString()}
      GROUP BY category
      ORDER BY count DESC
      LIMIT 10
    `

    const sentimentDistribution = await sql`
      SELECT 
        COALESCE(ai_sentiment, 'unknown') as sentiment,
        COUNT(*) as count
      FROM support_messages
      WHERE created_at >= ${startDate.toISOString()} AND ai_sentiment IS NOT NULL
      GROUP BY ai_sentiment
      ORDER BY count DESC
    `

    const intentDistribution = await sql`
      SELECT 
        COALESCE(ai_intent, 'unknown') as intent,
        COUNT(*) as count
      FROM support_messages
      WHERE created_at >= ${startDate.toISOString()} AND ai_intent IS NOT NULL
      GROUP BY ai_intent
      ORDER BY count DESC
      LIMIT 10
    `

    // Топ повторяющихся проблем (по root_cause)
    const recurringProblems = await sql`
      SELECT 
        COALESCE(root_cause, category, title) as problem,
        COUNT(*) as occurrences,
        COUNT(DISTINCT channel_id) as affected_companies
      FROM support_cases
      WHERE created_at >= ${startDate.toISOString()}
        AND (is_recurring = true OR root_cause IS NOT NULL)
      GROUP BY COALESCE(root_cause, category, title)
      HAVING COUNT(*) > 1
      ORDER BY occurrences DESC
      LIMIT 10
    `

    // ============================================
    // 3. TEAM METRICS
    // ============================================
    
    const teamPerformance = await sql`
      SELECT 
        COALESCE(a.name, c.assigned_to::text, 'Не назначен') as manager_name,
        c.assigned_to as manager_id,
        COUNT(*) as total_cases,
        COUNT(*) FILTER (WHERE c.status IN ('resolved', 'closed')) as resolved_cases,
        AVG(c.resolution_time_minutes) FILTER (WHERE c.resolution_time_minutes > 0) as avg_resolution_minutes,
        COUNT(*) FILTER (WHERE c.priority IN ('urgent', 'high')) as high_priority_cases
      FROM support_cases c
      LEFT JOIN support_agents a ON c.assigned_to::text = a.id::text
      WHERE c.created_at >= ${startDate.toISOString()}
      GROUP BY c.assigned_to, a.name
      ORDER BY total_cases DESC
    `

    // Среднее время первого ответа
    const responseTimeResult = await sql`
      SELECT 
        AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60) as avg_first_response_minutes
      FROM support_cases
      WHERE first_response_at IS NOT NULL
        AND created_at >= ${startDate.toISOString()}
    `
    const avgFirstResponse = responseTimeResult[0]?.avg_first_response_minutes || null

    // Распределение времени первого ответа по интервалам
    let responseTimeDistribution: any[] = []
    try {
      responseTimeDistribution = await sql`
        SELECT 
          CASE 
            WHEN EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60 <= 5 THEN '5min'
            WHEN EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60 <= 10 THEN '10min'
            WHEN EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60 <= 30 THEN '30min'
            WHEN EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60 <= 60 THEN '60min'
            ELSE '60plus'
          END as bucket,
          COUNT(*) as count,
          AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60) as avg_minutes
        FROM support_cases
        WHERE first_response_at IS NOT NULL
          AND created_at >= ${startDate.toISOString()}
        GROUP BY 1
        ORDER BY 
          CASE 
            WHEN EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60 <= 5 THEN 1
            WHEN EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60 <= 10 THEN 2
            WHEN EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60 <= 30 THEN 3
            WHEN EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60 <= 60 THEN 4
            ELSE 5
          END
        LIMIT 5
      `
    } catch (e) {
      console.error('responseTimeDistribution error:', e)
    }

    // Кейсы по дням (тренд)
    const dailyTrend = await sql`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as cases_created,
        COUNT(*) FILTER (WHERE status IN ('resolved', 'closed')) as cases_resolved
      FROM support_cases
      WHERE created_at >= ${startDate.toISOString()}
      GROUP BY DATE(created_at)
      ORDER BY date
    `

    // ============================================
    // 4. CHURN SIGNALS
    // ============================================
    
    // Каналы с негативным sentiment
    const negativeCompanies = await sql`
      SELECT 
        c.id as company_id,
        c.name as company_name,
        COUNT(*) as negative_messages,
        COUNT(DISTINCT m.id) as total_messages,
        MAX(m.created_at) as last_negative_at
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.ai_sentiment IN ('negative', 'frustrated')
        AND m.created_at >= ${startDate.toISOString()}
      GROUP BY c.id, c.name
      HAVING COUNT(*) >= 3
      ORDER BY negative_messages DESC
      LIMIT 10
    `

    // Каналы с нерешёнными кейсами > 48 часов
    const stuckCases = await sql`
      SELECT 
        ch.id as company_id,
        ch.name as company_name,
        COUNT(*) as stuck_cases,
        MIN(c.created_at) as oldest_case_at,
        EXTRACT(EPOCH FROM (NOW() - MIN(c.created_at))) / 3600 as oldest_hours
      FROM support_cases c
      JOIN support_channels ch ON c.channel_id = ch.id
      WHERE c.status NOT IN ('resolved', 'closed')
        AND c.created_at < NOW() - INTERVAL '48 hours'
      GROUP BY ch.id, ch.name
      ORDER BY oldest_hours DESC
      LIMIT 10
    `

    // Каналы с повторяющимися проблемами
    const recurringByCompany = await sql`
      SELECT 
        ch.id as company_id,
        ch.name as company_name,
        COUNT(*) as recurring_cases,
        array_agg(DISTINCT c.category) as categories
      FROM support_cases c
      JOIN support_channels ch ON c.channel_id = ch.id
      WHERE c.is_recurring = true
        AND c.created_at >= ${startDate.toISOString()}
      GROUP BY ch.id, ch.name
      HAVING COUNT(*) >= 2
      ORDER BY recurring_cases DESC
      LIMIT 10
    `

    // Churn risk score calculation
    const churnRiskCompanies = await sql`
      SELECT 
        c.id as company_id,
        c.name as company_name,
        0 as mrr,
        COALESCE(SUM(
          CASE 
            WHEN m.ai_sentiment IN ('negative', 'frustrated') THEN 3
            WHEN m.ai_urgency >= 4 THEN 2
            WHEN m.is_problem = true THEN 1
            ELSE 0
          END
        ), 0) as risk_score,
        COUNT(DISTINCT CASE WHEN cs.status NOT IN ('resolved', 'closed') THEN cs.id END) as open_cases,
        COUNT(DISTINCT CASE WHEN cs.is_recurring THEN cs.id END) as recurring_cases
      FROM support_channels c
      LEFT JOIN support_messages m ON m.channel_id = c.id AND m.created_at >= ${startDate.toISOString()}
      LEFT JOIN support_cases cs ON cs.channel_id = c.id
      GROUP BY c.id, c.name
      HAVING COALESCE(SUM(
        CASE 
          WHEN m.ai_sentiment IN ('negative', 'frustrated') THEN 3
          WHEN m.ai_urgency >= 4 THEN 2
          WHEN m.is_problem = true THEN 1
          ELSE 0
        END
      ), 0) >= 5
      ORDER BY risk_score DESC
      LIMIT 15
    `

    // ============================================
    // RESPONSE
    // ============================================

    return json({
      period,
      periodDays,
      generatedAt: new Date().toISOString(),
      
      overview: {
        totalCases: parseInt(overview.total_cases || 0),
        openCases: parseInt(overview.open_cases || 0),
        resolvedCases: parseInt(overview.resolved_cases || 0),
        newCasesPeriod: parseInt(overview.new_cases_period || 0),
        avgResolutionMinutes: Math.round(parseFloat(overview.avg_resolution_minutes || 0)),
        avgResolutionHours: Math.round(parseFloat(overview.avg_resolution_minutes || 0) / 60 * 10) / 10,
        urgentCases: parseInt(overview.urgent_cases || 0),
        recurringCases: parseInt(overview.recurring_cases || 0),
        totalMessages: parseInt(messages.total_messages || 0),
        problemMessages: parseInt(messages.problem_messages || 0),
        voiceMessages: parseInt(messages.voice_messages || 0),
        videoMessages: parseInt(messages.video_messages || 0),
        transcribedMessages: parseInt(messages.transcribed_messages || 0),
        totalChannels: parseInt(channels.total_channels || 0),
        activeChannels: parseInt(channels.active_channels || 0),
        avgFirstResponseMinutes: avgFirstResponse ? Math.round(avgFirstResponse) : null,
      },

      patterns: {
        byCategory: categoryPatterns.map((p: any) => ({
          category: p.category,
          count: parseInt(p.count),
          openCount: parseInt(p.open_count || 0),
          avgResolutionMinutes: Math.round(parseFloat(p.avg_resolution || 0)),
        })),
        bySentiment: sentimentDistribution.map((s: any) => ({
          sentiment: s.sentiment,
          count: parseInt(s.count),
        })),
        byIntent: intentDistribution.map((i: any) => ({
          intent: i.intent,
          count: parseInt(i.count),
        })),
        recurringProblems: recurringProblems.map((p: any) => ({
          problem: p.problem,
          occurrences: parseInt(p.occurrences),
          affectedCompanies: parseInt(p.affected_companies),
        })),
      },

      teamMetrics: {
        byManager: teamPerformance.map((t: any) => ({
          managerId: t.manager_id,
          managerName: t.manager_name,
          totalCases: parseInt(t.total_cases),
          resolvedCases: parseInt(t.resolved_cases),
          resolutionRate: t.total_cases > 0 
            ? Math.round(parseInt(t.resolved_cases) / parseInt(t.total_cases) * 100) 
            : 0,
          avgResolutionMinutes: Math.round(parseFloat(t.avg_resolution_minutes || 0)),
          highPriorityCases: parseInt(t.high_priority_cases),
        })),
        dailyTrend: dailyTrend.map((d: any) => ({
          date: d.date,
          casesCreated: parseInt(d.cases_created),
          casesResolved: parseInt(d.cases_resolved),
        })),
        responseTimeDistribution: responseTimeDistribution.map((r: any) => {
          const bucketLabels: Record<string, string> = {
            '5min': 'до 5 мин',
            '10min': 'до 10 мин',
            '30min': 'до 30 мин',
            '60min': 'до 1 часа',
            '60plus': 'более 1 часа',
          }
          return {
            bucket: bucketLabels[r.bucket] || r.bucket,
            count: parseInt(r.count || 0),
            avgMinutes: Math.round(parseFloat(r.avg_minutes || 0) * 10) / 10,
          }
        }),
      },

      churnSignals: {
        negativeCompanies: negativeCompanies.map((c: any) => ({
          companyId: c.company_id,
          companyName: c.company_name,
          negativeMessages: parseInt(c.negative_messages),
          totalMessages: parseInt(c.total_messages),
          lastNegativeAt: c.last_negative_at,
        })),
        stuckCases: stuckCases.map((c: any) => ({
          companyId: c.company_id,
          companyName: c.company_name,
          stuckCases: parseInt(c.stuck_cases),
          oldestCaseAt: c.oldest_case_at,
          oldestHours: Math.round(parseFloat(c.oldest_hours || 0)),
        })),
        recurringByCompany: recurringByCompany.map((c: any) => ({
          companyId: c.company_id,
          companyName: c.company_name,
          recurringCases: parseInt(c.recurring_cases),
          categories: c.categories,
        })),
        highRiskCompanies: churnRiskCompanies.map((c: any) => ({
          companyId: c.company_id,
          companyName: c.company_name,
          mrr: parseFloat(c.mrr || 0),
          riskScore: parseInt(c.risk_score),
          openCases: parseInt(c.open_cases),
          recurringCases: parseInt(c.recurring_cases),
        })),
      },
    })

  } catch (e: any) {
    return json({ error: 'Failed to fetch analytics', details: e.message }, 500)
  }
}
