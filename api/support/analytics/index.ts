import { neon } from '@neondatabase/serverless'

// API Version: 2.2 - SLA Categories with real data
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

// Format milliseconds to human-readable duration
function formatDurationMs(ms: number): string {
  if (!ms || ms <= 0) return '—'
  
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}с`
  
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}м`
  
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}ч ${remainingMinutes}м` : `${hours}ч`
  }
  
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}д ${remainingHours}ч` : `${days}д`
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
  const period = url.searchParams.get('period') || '30d'
  const customFrom = url.searchParams.get('from')
  const customTo = url.searchParams.get('to')
  
  // Вычисляем дату начала периода
  // Поддерживаем: today, yesterday, week, month, 7d, 30d, 90d, или custom from/to
  let periodDays: number
  let startDate: Date
  let endDate: Date = new Date()
  
  if (customFrom && customTo) {
    // Custom date range
    startDate = new Date(customFrom)
    endDate = new Date(customTo)
    endDate.setHours(23, 59, 59, 999) // Include full day
    periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
  } else {
    switch (period) {
      case 'today': periodDays = 1; break
      case 'yesterday': periodDays = 2; break
      case 'week': 
      case '7d': periodDays = 7; break
      case 'month':
      case '30d': periodDays = 30; break
      case '90d': periodDays = 90; break
      default: periodDays = 30
    }
    
    startDate = new Date()
    startDate.setDate(startDate.getDate() - periodDays)
  }

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
        -- Всего срочных кейсов (для истории)
        COUNT(*) FILTER (WHERE priority = 'urgent') as urgent_cases,
        -- ОТКРЫТЫХ срочных кейсов (для AI рекомендаций)
        COUNT(*) FILTER (WHERE priority = 'urgent' AND status NOT IN ('resolved', 'closed')) as urgent_open_cases,
        COUNT(*) FILTER (WHERE is_recurring = true) as recurring_cases,
        -- Cases by priority for the period
        COUNT(*) FILTER (WHERE priority = 'low' AND created_at >= ${startDate.toISOString()}) as low_priority_cases,
        COUNT(*) FILTER (WHERE priority = 'medium' AND created_at >= ${startDate.toISOString()}) as medium_priority_cases,
        COUNT(*) FILTER (WHERE priority = 'high' AND created_at >= ${startDate.toISOString()}) as high_priority_cases,
        COUNT(*) FILTER (WHERE priority = 'urgent' AND created_at >= ${startDate.toISOString()}) as urgent_priority_cases
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
    // Связываем с таблицей agents по telegram_id для правильных имён
    // Исключаем ботов и системные аккаунты
    const teamPerformance = await sql`
      SELECT 
        COALESCE(a.name, m.sender_name, m.sender_username, 'Неизвестный') as manager_name,
        COALESCE(a.id, m.sender_id::text) as manager_id,
        a.username as agent_username,
        a.role as agent_role,
        COUNT(*) as total_messages,
        COUNT(DISTINCT m.channel_id) as channels_served,
        COUNT(DISTINCT DATE(m.created_at)) as active_days,
        MIN(m.created_at) as first_message_at,
        MAX(m.created_at) as last_message_at
      FROM support_messages m
      LEFT JOIN support_agents a ON (
        a.telegram_id = m.sender_id::text 
        OR LOWER(a.username) = LOWER(m.sender_username)
        OR LOWER(a.name) = LOWER(m.sender_name)
      )
      WHERE (m.sender_role IN ('support', 'team', 'agent') OR m.is_from_client = false)
        AND m.sender_id IS NOT NULL
        AND LOWER(COALESCE(m.sender_name, '')) NOT LIKE '%bot%'
        AND LOWER(COALESCE(m.sender_name, '')) NOT LIKE '%delever support%'
        AND LOWER(COALESCE(m.sender_username, '')) NOT LIKE '%bot%'
      GROUP BY a.id, a.name, a.username, a.role, m.sender_id, m.sender_name, m.sender_username
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
      // Вычисляем время ответа для КАЖДОГО сообщения клиента ЗА ПЕРИОД
      // Находим следующий ответ поддержки после каждого сообщения клиента
      const responseTimesResult = await sql`
        WITH client_messages AS (
          SELECT 
            id,
            channel_id,
            sender_id,
            created_at as client_msg_at
          FROM support_messages
          WHERE sender_role = 'client'
            AND is_from_client = true
            AND created_at >= ${startDate.toISOString()}
            AND created_at <= ${endDate.toISOString()}
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
                AND sm.sender_role IN ('support', 'team', 'agent')
                AND sm.is_from_client = false
                AND sm.sender_id != cm.sender_id
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

    // Кейсы по дням (тренд) - получаем данные и заполняем пропуски в JS
    const dailyCasesRaw = await sql`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as cases_created,
        COUNT(*) FILTER (WHERE status IN ('resolved', 'closed')) as cases_resolved
      FROM support_cases
      WHERE created_at >= ${startDate.toISOString()}
      GROUP BY DATE(created_at)
      ORDER BY date
    `
    
    // Создаём массив всех дней периода и заполняем данными
    const dailyTrend: Array<{date: Date, cases_created: number, cases_resolved: number}> = []
    const casesMap = new Map(dailyCasesRaw.map((d: any) => [
      new Date(d.date).toISOString().split('T')[0], 
      { created: parseInt(d.cases_created), resolved: parseInt(d.cases_resolved) }
    ]))
    
    const currentDate = new Date()
    const iterDate = new Date(startDate)
    while (iterDate <= currentDate) {
      const dateStr = iterDate.toISOString().split('T')[0]
      const data = casesMap.get(dateStr) || { created: 0, resolved: 0 }
      dailyTrend.push({
        date: new Date(iterDate),
        cases_created: data.created,
        cases_resolved: data.resolved
      })
      iterDate.setDate(iterDate.getDate() + 1)
    }

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
    // 5. SLA METRICS BY CATEGORY
    // ============================================
    
    // Собираем данные по категориям
    const slaCategories = ['client', 'client_integration', 'partner', 'internal']
    const slaCategoryLabels: Record<string, string> = {
      client: 'Delever + Клиенты',
      client_integration: 'Delever + Клиенты + Интеграция',
      partner: 'Delever + Партнёры',
      internal: 'Внутренняя команда',
    }
    
    let byCategory: Record<string, any> = {}
    
    try {
      // Метрики по SLA категориям каналов
      const slaCategoryMetrics = await sql`
        SELECT 
          COALESCE(ch.sla_category, 'client') as sla_category,
          COUNT(DISTINCT ch.id) as total_channels,
          COUNT(DISTINCT ch.id) FILTER (WHERE ch.awaiting_reply = true) as waiting_reply,
          COUNT(DISTINCT ch.id) FILTER (WHERE ch.unread_count > 0) as with_unread,
          SUM(COALESCE(ch.unread_count, 0)) as total_unread
        FROM support_channels ch
        WHERE ch.is_active = true
        GROUP BY ch.sla_category
      `
      
      // Кейсы по SLA категориям
      const slaCasesMetrics = await sql`
        SELECT 
          COALESCE(ch.sla_category, 'client') as sla_category,
          COUNT(*) as total_cases,
          COUNT(*) FILTER (WHERE c.status NOT IN ('resolved', 'closed')) as open_cases,
          COUNT(*) FILTER (WHERE c.priority = 'urgent') as urgent_cases,
          AVG(c.resolution_time_minutes) FILTER (WHERE c.resolution_time_minutes > 0) as avg_resolution_minutes
        FROM support_cases c
        JOIN support_channels ch ON c.channel_id = ch.id
        WHERE c.created_at >= ${startDate.toISOString()}
        GROUP BY ch.sla_category
      `
      
      // Время ответа по SLA категориям
      const slaResponseMetrics = await sql`
        WITH response_times AS (
          SELECT 
            ch.sla_category,
            cm.id as client_msg_id,
            cm.created_at as client_msg_at,
            (
              SELECT MIN(sm.created_at)
              FROM support_messages sm
              WHERE sm.channel_id = cm.channel_id
                AND sm.created_at > cm.created_at
                AND (sm.sender_role IN ('support', 'team', 'agent') OR sm.is_from_client = false)
            ) as response_at
          FROM support_messages cm
          JOIN support_channels ch ON cm.channel_id = ch.id
          WHERE (cm.sender_role = 'client' OR cm.is_from_client = true)
            AND cm.created_at >= ${startDate.toISOString()}
        )
        SELECT 
          COALESCE(sla_category, 'client') as sla_category,
          AVG(EXTRACT(EPOCH FROM (response_at - client_msg_at)) / 60) as avg_response_minutes,
          COUNT(*) FILTER (WHERE response_at IS NOT NULL) as responded_count,
          COUNT(*) as total_messages
        FROM response_times
        WHERE response_at IS NOT NULL
          AND EXTRACT(EPOCH FROM (response_at - client_msg_at)) >= 0
        GROUP BY sla_category
      `
      
      const channelsByCat = new Map(slaCategoryMetrics.map((m: any) => [m.sla_category, m]))
      const casesByCat = new Map(slaCasesMetrics.map((m: any) => [m.sla_category, m]))
      const responseByCat = new Map(slaResponseMetrics.map((m: any) => [m.sla_category, m]))
      
      for (const cat of slaCategories) {
        const channelData = channelsByCat.get(cat) || {}
        const caseData = casesByCat.get(cat) || {}
        const responseData = responseByCat.get(cat) || {}
        
        const totalCases = parseInt(caseData.total_cases || 0)
        const openCases = parseInt(caseData.open_cases || 0)
        const resolvedCases = totalCases - openCases
        
        byCategory[cat] = {
          label: slaCategoryLabels[cat],
          channels: {
            total: parseInt(channelData.total_channels || 0),
            waitingReply: parseInt(channelData.waiting_reply || 0),
            withUnread: parseInt(channelData.with_unread || 0),
            totalUnread: parseInt(channelData.total_unread || 0),
          },
          cases: {
            total: totalCases,
            open: openCases,
            resolved: resolvedCases,
            urgent: parseInt(caseData.urgent_cases || 0),
            avgResolutionMinutes: Math.round(parseFloat(caseData.avg_resolution_minutes || 0)),
          },
          response: {
            avgMinutes: Math.round(parseFloat(responseData.avg_response_minutes || 0)),
            respondedCount: parseInt(responseData.responded_count || 0),
            totalMessages: parseInt(responseData.total_messages || 0),
          },
          slaPercent: totalCases > 0 ? Math.round(resolvedCases / totalCases * 100) : 100,
        }
      }
    } catch (e) {
      // Если колонка sla_category не существует - создаём пустые данные
      console.error('SLA category metrics error (column may not exist yet):', e)
      for (const cat of slaCategories) {
        byCategory[cat] = {
          label: slaCategoryLabels[cat],
          channels: { total: 0, waitingReply: 0, withUnread: 0, totalUnread: 0 },
          cases: { total: 0, open: 0, resolved: 0, urgent: 0, avgResolutionMinutes: 0 },
          response: { avgMinutes: 0, respondedCount: 0, totalMessages: 0 },
          slaPercent: 100,
        }
      }
    }

    // ============================================
    // 6. TOP DEMANDING CHANNELS
    // ============================================
    
    // Топ каналов требующих внимания (по нагрузке, проблемам, срочности)
    const topDemandingChannels = await sql`
      WITH channel_metrics AS (
        SELECT 
          c.id,
          c.name,
          c.sla_category,
          c.awaiting_reply,
          c.unread_count,
          c.last_message_at,
          -- Количество сообщений за период
          COUNT(DISTINCT m.id) FILTER (WHERE m.created_at >= ${startDate.toISOString()}) as messages_count,
          -- Количество проблемных сообщений
          COUNT(DISTINCT m.id) FILTER (WHERE m.is_problem = true AND m.created_at >= ${startDate.toISOString()}) as problem_count,
          -- Количество негативных сообщений
          COUNT(DISTINCT m.id) FILTER (WHERE m.ai_sentiment IN ('negative', 'frustrated') AND m.created_at >= ${startDate.toISOString()}) as negative_count,
          -- Количество срочных запросов
          COUNT(DISTINCT m.id) FILTER (WHERE m.ai_urgency >= 4 AND m.created_at >= ${startDate.toISOString()}) as urgent_count,
          -- Открытые кейсы
          COUNT(DISTINCT cs.id) FILTER (WHERE cs.status NOT IN ('resolved', 'closed')) as open_cases,
          -- Повторяющиеся кейсы
          COUNT(DISTINCT cs.id) FILTER (WHERE cs.is_recurring = true) as recurring_cases,
          -- Среднее время ответа
          AVG(EXTRACT(EPOCH FROM (
            (SELECT MIN(sm.created_at) FROM support_messages sm 
             WHERE sm.channel_id = c.id AND sm.created_at > m.created_at 
             AND (sm.sender_role IN ('support', 'team', 'agent') OR sm.is_from_client = false))
            - m.created_at
          )) / 60) FILTER (WHERE m.is_from_client = true OR m.sender_role = 'client') as avg_response_minutes
        FROM support_channels c
        LEFT JOIN support_messages m ON m.channel_id = c.id
        LEFT JOIN support_cases cs ON cs.channel_id = c.id
        WHERE c.is_active = true
        GROUP BY c.id, c.name, c.sla_category, c.awaiting_reply, c.unread_count, c.last_message_at
      )
      SELECT 
        *,
        -- Расчёт "индекса внимания" (attention score)
        (
          COALESCE(messages_count, 0) * 0.1 +
          COALESCE(problem_count, 0) * 3 +
          COALESCE(negative_count, 0) * 4 +
          COALESCE(urgent_count, 0) * 5 +
          COALESCE(open_cases, 0) * 2 +
          COALESCE(recurring_cases, 0) * 3 +
          CASE WHEN awaiting_reply THEN 10 ELSE 0 END +
          COALESCE(unread_count, 0) * 0.5
        ) as attention_score
      FROM channel_metrics
      WHERE messages_count > 0 OR open_cases > 0 OR unread_count > 0
      ORDER BY attention_score DESC
      LIMIT 10
    `

    // ============================================
    // 7. SLOWEST RESPONDING CLIENTS
    // ============================================
    
    // Calculate response times by looking at time gaps between messages
    const slowestClients = await sql`
      WITH message_pairs AS (
        SELECT 
          m.channel_id,
          m.is_from_client,
          m.created_at,
          LAG(m.created_at) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_created_at,
          LAG(m.is_from_client) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_is_from_client
        FROM support_messages m
        WHERE m.created_at >= ${startDate.toISOString()}
      ),
      response_times AS (
        SELECT
          channel_id,
          -- Agent response time: when agent replies after client message
          CASE 
            WHEN NOT is_from_client AND prev_is_from_client 
            THEN EXTRACT(EPOCH FROM (created_at - prev_created_at)) * 1000 
          END as agent_response_ms,
          -- Client response time: when client replies after agent message
          CASE 
            WHEN is_from_client AND NOT prev_is_from_client 
            THEN EXTRACT(EPOCH FROM (created_at - prev_created_at)) * 1000 
          END as client_response_ms
        FROM message_pairs
        WHERE prev_created_at IS NOT NULL
      )
      SELECT 
        c.id,
        c.name,
        c.sla_category,
        COALESCE(c.client_avg_response_ms, AVG(rt.client_response_ms)) as client_avg_response_ms,
        COALESCE(c.client_response_count, COUNT(rt.client_response_ms)) as client_response_count,
        AVG(rt.agent_response_ms) as agent_avg_response_ms,
        COUNT(rt.agent_response_ms) as agent_response_count,
        c.last_message_at
      FROM support_channels c
      LEFT JOIN response_times rt ON rt.channel_id = c.id
      WHERE c.is_active = true
      GROUP BY c.id, c.name, c.sla_category, c.client_avg_response_ms, c.client_response_count, c.last_message_at
      HAVING COALESCE(c.client_avg_response_ms, AVG(rt.client_response_ms)) > 0
      ORDER BY COALESCE(c.client_avg_response_ms, AVG(rt.client_response_ms)) DESC
      LIMIT 10
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
        // ВАЖНО: Открытые срочные кейсы - для AI рекомендаций
        urgentOpenCases: parseInt(overview.urgent_open_cases || 0),
        recurringCases: parseInt(overview.recurring_cases || 0),
        casesByPriority: {
          low: parseInt(overview.low_priority_cases || 0),
          medium: parseInt(overview.medium_priority_cases || 0),
          high: parseInt(overview.high_priority_cases || 0),
          urgent: parseInt(overview.urgent_priority_cases || 0),
        },
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
          issue: translateProblem(p.problem),
          category: p.problem, // Original category for API queries
          count: parseInt(p.occurrences),
          affected: parseInt(p.affected_companies),
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
            managerUsername: t.agent_username || null,
            managerRole: t.agent_role || 'agent',
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
          date: d.date instanceof Date ? d.date.toISOString() : d.date,
          casesCreated: d.cases_created || 0,
          casesResolved: d.cases_resolved || 0,
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

      // Метрики по SLA категориям
      byCategory,

      // Топ каналов требующих внимания
      topDemandingChannels: topDemandingChannels.map((ch: any) => ({
        id: ch.id,
        name: ch.name,
        slaCategory: ch.sla_category || 'client',
        awaitingReply: ch.awaiting_reply || false,
        unreadCount: parseInt(ch.unread_count || 0),
        messagesCount: parseInt(ch.messages_count || 0),
        problemCount: parseInt(ch.problem_count || 0),
        negativeCount: parseInt(ch.negative_count || 0),
        urgentCount: parseInt(ch.urgent_count || 0),
        openCases: parseInt(ch.open_cases || 0),
        recurringCases: parseInt(ch.recurring_cases || 0),
        avgResponseMinutes: ch.avg_response_minutes ? Math.round(parseFloat(ch.avg_response_minutes)) : null,
        attentionScore: Math.round(parseFloat(ch.attention_score || 0)),
        lastMessageAt: ch.last_message_at,
      })),

      // Топ медленно отвечающих клиентов
      slowestClients: slowestClients.map((ch: any) => {
        const clientAvgMs = parseInt(ch.client_avg_response_ms || 0)
        const agentAvgMs = Math.round(parseFloat(ch.agent_avg_response_ms || 0))
        return {
          id: ch.id,
          name: ch.name,
          slaCategory: ch.sla_category || 'client',
          clientAvgMs,
          clientAvgFormatted: formatDurationMs(clientAvgMs),
          clientResponseCount: parseInt(ch.client_response_count || 0),
          agentAvgMs,
          agentAvgFormatted: formatDurationMs(agentAvgMs),
          agentResponseCount: parseInt(ch.agent_response_count || 0),
          // How much slower client is compared to agent (positive = client slower)
          differenceMs: clientAvgMs - agentAvgMs,
          differenceFormatted: formatDurationMs(Math.abs(clientAvgMs - agentAvgMs)),
          slowerParty: clientAvgMs > agentAvgMs ? 'client' : 'agent',
          lastMessageAt: ch.last_message_at,
        }
      }),
    })

  } catch (e: any) {
    return json({ error: 'Failed to fetch analytics', details: e.message }, 500)
  }
}
