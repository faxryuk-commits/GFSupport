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

// Перевод категорий/проблем на русский
const problemLabels: Record<string, string> = {
  technical: 'Технические проблемы',
  integration: 'Проблемы интеграции',
  billing: 'Вопросы оплаты',
  complaint: 'Жалобы клиентов',
  feature_request: 'Запросы функций',
  order: 'Проблемы с заказами',
  delivery: 'Проблемы доставки',
  menu: 'Вопросы по меню',
  app: 'Проблемы приложения',
  onboarding: 'Вопросы подключения',
  question: 'Общие вопросы',
  general: 'Прочие обращения',
  feedback: 'Обратная связь',
  'Множественные обращения': 'Повторные обращения',
}

function translateProblem(problem: string): string {
  if (!problem) return 'Прочее'
  return problemLabels[problem.toLowerCase()] || problemLabels[problem] || problem
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

    // Топ повторяющихся проблем - улучшенная логика
    // Группируем по категории + подкатегории или типу проблемы
    const recurringProblems = await sql`
      WITH problem_patterns AS (
        -- Группировка кейсов по категории
        SELECT 
          category as problem_type,
          'category' as source,
          COUNT(*) as occurrences,
          COUNT(DISTINCT channel_id) as affected_companies
        FROM support_cases
        WHERE created_at >= ${startDate.toISOString()}
          AND category IS NOT NULL
        GROUP BY category
        HAVING COUNT(*) >= 2
        
        UNION ALL
        
        -- Группировка сообщений с проблемами по категории AI
        SELECT 
          ai_category as problem_type,
          'ai_category' as source,
          COUNT(*) as occurrences,
          COUNT(DISTINCT channel_id) as affected_companies
        FROM support_messages
        WHERE created_at >= ${startDate.toISOString()}
          AND is_problem = true
          AND ai_category IS NOT NULL
        GROUP BY ai_category
        HAVING COUNT(*) >= 3
        
        UNION ALL
        
        -- Каналы с множеством проблем
        SELECT 
          'Множественные обращения' as problem_type,
          'multi_contact' as source,
          COUNT(*) as occurrences,
          COUNT(DISTINCT channel_id) as affected_companies
        FROM support_messages
        WHERE created_at >= ${startDate.toISOString()}
          AND is_problem = true
        GROUP BY channel_id
        HAVING COUNT(*) >= 3
      )
      SELECT 
        problem_type as problem,
        SUM(occurrences) as occurrences,
        SUM(affected_companies) as affected_companies
      FROM problem_patterns
      WHERE problem_type IS NOT NULL AND problem_type != ''
      GROUP BY problem_type
      ORDER BY occurrences DESC
      LIMIT 10
    `

    // ============================================
    // 3. TEAM METRICS
    // ============================================
    
    // Метрики команды по сообщениям (кто сколько ответил)
    // Исключаем ботов и системные аккаунты
    const teamPerformance = await sql`
      SELECT 
        COALESCE(m.sender_name, m.sender_username, m.sender_id::text, 'Неизвестный') as manager_name,
        m.sender_id as manager_id,
        COUNT(*) as total_messages,
        COUNT(DISTINCT m.channel_id) as channels_served,
        COUNT(DISTINCT DATE(m.created_at)) as active_days,
        MIN(m.created_at) as first_message_at,
        MAX(m.created_at) as last_message_at
      FROM support_messages m
      WHERE (m.sender_role IN ('support', 'team', 'agent') OR m.is_from_client = false)
        AND m.sender_id IS NOT NULL
        AND LOWER(COALESCE(m.sender_name, '')) NOT LIKE '%bot%'
        AND LOWER(COALESCE(m.sender_name, '')) NOT LIKE '%delever support%'
        AND LOWER(COALESCE(m.sender_username, '')) NOT LIKE '%bot%'
      GROUP BY m.sender_id, m.sender_name, m.sender_username
      HAVING COUNT(*) >= 1
      ORDER BY total_messages DESC
      LIMIT 20
    `

    // Дополнительно: метрики по кейсам если есть assigned_to
    const caseMetrics = await sql`
      SELECT 
        c.assigned_to as manager_id,
        COUNT(*) as total_cases,
        COUNT(*) FILTER (WHERE c.status IN ('resolved', 'closed')) as resolved_cases,
        AVG(c.resolution_time_minutes) FILTER (WHERE c.resolution_time_minutes > 0) as avg_resolution_minutes
      FROM support_cases c
      WHERE c.assigned_to IS NOT NULL
      GROUP BY c.assigned_to
    `
    
    // Объединяем данные
    const caseMetricsMap = new Map(caseMetrics.map((c: any) => [c.manager_id?.toString(), c]))

    // Время первого ответа - вычисляем из сообщений
    // Находим разницу между первым сообщением клиента и первым ответом от поддержки для каждого канала
    let avgFirstResponse: number | null = null
    let responseTimeDistribution: any[] = []
    
    try {
      // Вычисляем время ответа для КАЖДОГО сообщения клиента
      // Находим следующий ответ поддержки после каждого сообщения клиента
      const responseTimesResult = await sql`
        WITH client_messages AS (
          SELECT 
            id,
            channel_id,
            created_at as client_msg_at
          FROM support_messages
          WHERE sender_role = 'client' OR is_from_client = true
        ),
        response_times AS (
          SELECT 
            cm.id as client_msg_id,
            cm.channel_id,
            cm.client_msg_at,
            (
              SELECT MIN(created_at)
              FROM support_messages sm
              WHERE sm.channel_id = cm.channel_id
                AND sm.created_at > cm.client_msg_at
                AND (sm.sender_role IN ('support', 'team', 'agent') OR sm.is_from_client = false)
            ) as response_at
          FROM client_messages cm
        )
        SELECT 
          EXTRACT(EPOCH FROM (response_at - client_msg_at)) / 60 as response_minutes
        FROM response_times
        WHERE response_at IS NOT NULL
          AND EXTRACT(EPOCH FROM (response_at - client_msg_at)) >= 0
      `
      
      if (responseTimesResult.length > 0) {
        // Среднее время
        const totalMinutes = responseTimesResult.reduce((sum: number, r: any) => sum + parseFloat(r.response_minutes || 0), 0)
        avgFirstResponse = Math.round(totalMinutes / responseTimesResult.length)
        
        // Распределение по интервалам
        const buckets = {
          '5min': { count: 0, total: 0 },
          '10min': { count: 0, total: 0 },
          '30min': { count: 0, total: 0 },
          '60min': { count: 0, total: 0 },
          '60plus': { count: 0, total: 0 },
        }
        
        for (const r of responseTimesResult) {
          const mins = parseFloat(r.response_minutes || 0)
          let bucket: keyof typeof buckets
          if (mins <= 5) bucket = '5min'
          else if (mins <= 10) bucket = '10min'
          else if (mins <= 30) bucket = '30min'
          else if (mins <= 60) bucket = '60min'
          else bucket = '60plus'
          
          buckets[bucket].count++
          buckets[bucket].total += mins
        }
        
        responseTimeDistribution = Object.entries(buckets)
          .filter(([_, v]) => v.count > 0)
          .map(([key, v]) => ({
            bucket: key,
            count: v.count,
            avg_minutes: v.count > 0 ? v.total / v.count : 0,
          }))
      }
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
          problem: translateProblem(p.problem),
          occurrences: parseInt(p.occurrences),
          affectedCompanies: parseInt(p.affected_companies),
        })),
      },

      teamMetrics: {
        byManager: teamPerformance.map((t: any) => {
          const caseData = caseMetricsMap.get(t.manager_id?.toString()) || {}
          const totalCases = parseInt(caseData.total_cases || 0)
          const resolvedCases = parseInt(caseData.resolved_cases || 0)
          return {
            managerId: t.manager_id,
            managerName: t.manager_name,
            totalMessages: parseInt(t.total_messages || 0),
            channelsServed: parseInt(t.channels_served || 0),
            activeDays: parseInt(t.active_days || 0),
            totalCases,
            resolvedCases,
            resolutionRate: totalCases > 0 
              ? Math.round(resolvedCases / totalCases * 100) 
              : 0,
            avgResolutionMinutes: Math.round(parseFloat(caseData.avg_resolution_minutes || 0)),
            lastActiveAt: t.last_message_at,
          }
        }),
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
