import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'
import { ensureChannelSourceColumn } from '../lib/ensure-taxonomy.js'

export const config = {
  runtime: 'edge',
}

/**
 * SLA Report API - Детальный отчёт по времени ответа и решению тикетов
 * 
 * GET /api/support/analytics/sla-report?from=2026-02-01&to=2026-02-10&sla_minutes=10
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

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)
  
  const fromDate = url.searchParams.get('from') || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const toDate = url.searchParams.get('to') || new Date().toISOString().split('T')[0]
  const slaMinutes = parseInt(url.searchParams.get('sla_minutes') || '10')
  const market = url.searchParams.get('market') || null
  const source = url.searchParams.get('source') || 'all'
  
  const fromDateTime = `${fromDate}T00:00:00+05:00` // Tashkent timezone
  const toDateTime = `${toDate}T23:59:59+05:00`

  await ensureChannelSourceColumn()

  try {
    // =============================================
    // 1. ВРЕМЯ ПЕРВОГО ОТВЕТА - детальный список
    // =============================================
    const firstResponseData = await sql`
      WITH all_msgs AS (
        SELECT 
          m.id,
          m.channel_id,
          m.sender_name,
          m.text_content,
          m.created_at,
          m.sender_role,
          m.is_from_client,
          c.name as channel_name,
          LAG(m.sender_role) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_sender_role,
          LAG(m.is_from_client) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_is_from_client
        FROM support_messages m
        JOIN support_channels c ON c.id = m.channel_id
        WHERE m.org_id = ${orgId}
          AND m.created_at >= ${fromDateTime}::timestamptz - INTERVAL '24 hours'
          AND m.created_at <= ${toDateTime}::timestamptz
          AND (${market}::text IS NULL OR c.market_id = ${market})
          AND (${source}::text = 'all' OR COALESCE(c.source, 'telegram') = ${source})
      ),
      client_messages AS (
        SELECT id, channel_id, sender_name as client_name, text_content, created_at as message_at, channel_name
        FROM all_msgs
        WHERE sender_role = 'client' AND is_from_client = true
          AND created_at >= ${fromDateTime}::timestamptz
          AND (
            prev_sender_role IS NULL
            OR prev_sender_role IN ('support', 'team', 'agent')
            OR prev_is_from_client = false
          )
          AND NOT (
            COALESCE(LENGTH(text_content), 0) <= 50
            AND LOWER(COALESCE(text_content, '')) ~ '(^|\\s)(хоп|ок|окей|рахмат|спасибо|тушунарли|хорошо|понял|ладно|rahmat|ok|okay|tushunarli|hop|хоп рахмат|ок рахмат|рахмат катта|катта рахмат|болди|хо[пр]|да|нет|йук|ха|хн|понятно|good|thanks|thank you|aни|hozir|тушундим)(\\s|$)'
          )
      ),
      first_responses AS (
        SELECT 
          cm.id as client_msg_id,
          cm.channel_id,
          cm.channel_name,
          cm.client_name,
          cm.text_content,
          cm.message_at,
          (
            SELECT m2.created_at 
            FROM support_messages m2 
            WHERE m2.channel_id = cm.channel_id
              AND m2.org_id = ${orgId}
              AND m2.is_from_client = false
              AND m2.sender_role IN ('support', 'team', 'agent')
              AND m2.created_at > cm.message_at
              AND m2.created_at <= cm.message_at + INTERVAL '4 hours'
            ORDER BY m2.created_at ASC
            LIMIT 1
          ) as response_at,
          (
            SELECT COALESCE(ra.name, m2.sender_name) 
            FROM support_messages m2 
            LEFT JOIN support_agents ra ON (
              ra.telegram_id::text = m2.sender_id::text
              OR ra.id::text = m2.sender_id::text
              OR LOWER(ra.username) = LOWER(m2.sender_username)
              OR LOWER(ra.name) = LOWER(m2.sender_name)
            )
            WHERE m2.channel_id = cm.channel_id
              AND m2.org_id = ${orgId}
              AND m2.is_from_client = false
              AND m2.sender_role IN ('support', 'team', 'agent')
              AND m2.created_at > cm.message_at
              AND m2.created_at <= cm.message_at + INTERVAL '4 hours'
            ORDER BY m2.created_at ASC
            LIMIT 1
          ) as responder_name
        FROM client_messages cm
      )
      SELECT 
        client_msg_id,
        channel_id,
        channel_name,
        client_name,
        text_content,
        message_at,
        response_at,
        responder_name,
        CASE 
          WHEN response_at IS NOT NULL 
          THEN ROUND(EXTRACT(EPOCH FROM (response_at - message_at)) / 60.0, 1)
          ELSE NULL 
        END as response_minutes
      FROM first_responses
      ORDER BY message_at DESC
      LIMIT 500
    `
    
    // =============================================
    // 2. ВРЕМЯ РЕШЕНИЯ ТИКЕТОВ - детальный список
    // =============================================
    const caseResolutionData = await sql`
      SELECT 
        c.id,
        c.ticket_number,
        c.title,
        c.status,
        c.priority,
        c.category,
        c.assigned_to,
        c.created_at,
        c.first_response_at,
        c.resolved_at,
        ch.name as channel_name,
        a.name as agent_name,
        CASE 
          WHEN c.first_response_at IS NOT NULL 
          THEN ROUND(EXTRACT(EPOCH FROM (c.first_response_at - c.created_at)) / 60.0, 1)
          ELSE NULL 
        END as first_response_minutes,
        CASE 
          WHEN c.resolved_at IS NOT NULL 
          THEN ROUND(EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)) / 60.0, 1)
          ELSE NULL 
        END as resolution_minutes,
        CASE 
          WHEN c.resolved_at IS NOT NULL 
          THEN ROUND(EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)) / 3600.0, 1)
          ELSE NULL 
        END as resolution_hours
      FROM support_cases c
      LEFT JOIN support_channels ch ON ch.id = c.channel_id
      LEFT JOIN support_agents a ON a.id::text = c.assigned_to::text
      WHERE c.org_id = ${orgId}
        AND c.created_at >= ${fromDateTime}::timestamptz
        AND c.created_at <= ${toDateTime}::timestamptz
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
      ORDER BY c.created_at DESC
      LIMIT 200
    `
    
    // =============================================
    // 3. СТАТИСТИКА ПО СОТРУДНИКАМ (сообщения + символы + роль)
    // =============================================
    const agentStatsData = await sql`
      SELECT 
        COALESCE(a.name, m.sender_name) as agent_name,
        COALESCE(a.role, 'agent') as agent_role,
        COUNT(*) as total_messages,
        SUM(COALESCE(LENGTH(m.text_content), 0)) as total_chars,
        ROUND(AVG(COALESCE(LENGTH(m.text_content), 0))) as avg_chars_per_message,
        COUNT(DISTINCT m.channel_id) as channels_served,
        COUNT(DISTINCT DATE(m.created_at)) as active_days
      FROM support_messages m
      JOIN support_channels sc ON sc.id = m.channel_id
      LEFT JOIN support_agents a ON (
        a.telegram_id::text = m.sender_id::text
        OR a.id::text = m.sender_id::text
        OR LOWER(a.username) = LOWER(m.sender_username)
        OR LOWER(a.name) = LOWER(m.sender_name)
      )
      WHERE m.org_id = ${orgId}
        AND m.is_from_client = false
        AND m.sender_role IN ('support', 'team', 'agent')
        AND m.created_at >= ${fromDateTime}::timestamptz
        AND m.created_at <= ${toDateTime}::timestamptz
        AND (${source}::text = 'all' OR COALESCE(sc.source, 'telegram') = ${source})
      GROUP BY COALESCE(a.name, m.sender_name), COALESCE(a.role, 'agent')
      ORDER BY total_messages DESC
    `

    // 3b. Кейсы per agent
    const agentCasesData = await sql`
      SELECT 
        a.name as agent_name,
        COUNT(*) as total_assigned,
        COUNT(*) FILTER (WHERE c.status IN ('resolved', 'closed')) as resolved_cases
      FROM support_cases c
      JOIN support_agents a ON a.id::text = c.assigned_to::text
      LEFT JOIN support_channels ch ON ch.id = c.channel_id
      WHERE c.org_id = ${orgId}
        AND c.created_at >= ${fromDateTime}::timestamptz
        AND c.created_at <= ${toDateTime}::timestamptz
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
      GROUP BY a.name
    `

    // 3c. Обязательства per agent
    let commitmentsData: any[] = []
    try {
      commitmentsData = await sql`
        SELECT 
          promised_by,
          COUNT(*) as total_commitments,
          COUNT(*) FILTER (WHERE status = 'fulfilled') as fulfilled
        FROM support_commitments
        WHERE org_id = ${orgId}
          AND created_at >= ${fromDateTime}::timestamptz
          AND created_at <= ${toDateTime}::timestamptz
        GROUP BY promised_by
      `
    } catch (e) { /* promised_by column may not exist yet */ }

    // 3d. Сессии per agent (часы онлайн)
    const sessionsData = await sql`
      SELECT 
        a.name as agent_name,
        SUM(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at))) / 3600.0 as online_hours
      FROM support_agent_sessions s
      JOIN support_agents a ON a.id::text = s.agent_id::text AND a.org_id = ${orgId}
      WHERE s.started_at >= ${fromDateTime}::timestamptz
        AND s.started_at <= ${toDateTime}::timestamptz
      GROUP BY a.name
    `

    // Индексы для быстрого объединения
    const statsMap: Record<string, any> = {}
    for (const s of agentStatsData) {
      statsMap[s.agent_name] = s
    }
    const casesMap: Record<string, any> = {}
    for (const c of agentCasesData) {
      casesMap[c.agent_name] = c
    }
    const commitmentsMap: Record<string, any> = {}
    for (const c of commitmentsData) {
      commitmentsMap[c.promised_by] = c
    }
    const sessionsMap: Record<string, any> = {}
    for (const s of sessionsData) {
      sessionsMap[s.agent_name] = s
    }
    
    // Детальная статистика по каждому сотруднику - время ответов
    const agentResponseTimes: Record<string, number[]> = {}
    
    for (const r of firstResponseData) {
      if (r.responder_name && r.response_minutes !== null) {
        if (!agentResponseTimes[r.responder_name]) {
          agentResponseTimes[r.responder_name] = []
        }
        agentResponseTimes[r.responder_name].push(parseFloat(r.response_minutes))
      }
    }

    // Кол-во дней в выбранном периоде
    const periodDays = Math.max(1, Math.ceil(
      (new Date(toDateTime).getTime() - new Date(fromDateTime).getTime()) / (1000 * 60 * 60 * 24)
    ))

    // Все сотрудники из БД (включая тех, кто не писал в выбранный период)
    const allDbAgents = await sql`
      SELECT name, role FROM support_agents WHERE org_id = ${orgId} AND name IS NOT NULL ORDER BY name
    `
    const agentRoleMap: Record<string, string> = {}
    for (const a of allDbAgents) agentRoleMap[a.name] = a.role || 'agent'

    // Whitelist: только сотрудники нашей организации из support_agents.
    // Иначе в таблицу попадают админы клиентских групп (Telegram отдаёт им роль
    // 'support'/'team'/'agent' и is_from_client=false), хотя в нашу команду они
    // не входят. Используем нормализованные имена (lowercase) для сравнения.
    const teamNamesLower = new Set(allDbAgents.map((a: any) => String(a.name || '').toLowerCase()))

    const allAgentNames = new Set([
      ...Object.keys(agentResponseTimes),
      ...agentStatsData.map((s: any) => s.agent_name),
      ...allDbAgents.map((a: any) => a.name),
    ])

    const agentDetails = Array.from(allAgentNames)
      .filter((name) => name && teamNamesLower.has(String(name).toLowerCase()))
      .map(name => {
      const times = agentResponseTimes[name] || []
      const sorted = [...times].sort((a, b) => a - b)
      const withinSLACount = times.filter(t => t <= slaMinutes).length
      const stats = statsMap[name]
      const cases = casesMap[name]
      const commitments = commitmentsMap[name]
      const sessions = sessionsMap[name]

      const totalChars = parseInt(stats?.total_chars || '0')
      const totalMessages = parseInt(stats?.total_messages || '0')
      const resolvedCasesCount = parseInt(cases?.resolved_cases || '0')
      const totalAssigned = parseInt(cases?.total_assigned || '0')
      const channelsServed = parseInt(stats?.channels_served || '0')
      const activeDays = parseInt(stats?.active_days || '0')
      const avgCharsMsg = parseInt(stats?.avg_chars_per_message || '0')
      const totalCommitments = parseInt(commitments?.total_commitments || '0')
      const fulfilledCommitments = parseInt(commitments?.fulfilled || '0')
      const onlineHours = parseFloat(sessions?.online_hours || '0')
      const role: string = stats?.agent_role || agentRoleMap[name] || 'agent'

      const isInactive = totalMessages === 0 && times.length === 0

      // --- Engagement Score (4 категории, каждая 0-25) ---
      // 1. Активность (0-25): присутствие + объём
      const presenceRatio = Math.min(activeDays / periodDays, 1)
      const messagesPerDay = activeDays > 0 ? totalMessages / activeDays : 0
      const activityScore = Math.round(presenceRatio * 12 + Math.min(messagesPerDay / 15, 1) * 13)

      // 2. Скорость (0-25): SLA compliance + средняя скорость
      const slaRate = times.length > 0 ? withinSLACount / times.length : 0
      const avgMin = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0
      const speedFromAvg = avgMin > 0 ? Math.min(slaMinutes / avgMin, 1) : 0
      const speedScore = Math.round(slaRate * 15 + speedFromAvg * 10)

      // 3. Качество (0-25): resolution rate + детальность ответов
      const resolutionRate = totalAssigned > 0 ? resolvedCasesCount / totalAssigned : 0
      const charsQuality = Math.min(avgCharsMsg / 200, 1)
      const qualityScore = Math.round(resolutionRate * 15 + charsQuality * 10)

      // 4. Ответственность (0-25): обязательства + покрытие каналов + часы онлайн
      const commitRate = totalCommitments > 0 ? fulfilledCommitments / totalCommitments : 0
      const coverageRatio = Math.min(channelsServed / 5, 1)
      const hoursRatio = Math.min(onlineHours / (periodDays * 8), 1)
      const responsibilityScore = Math.round(commitRate * 10 + coverageRatio * 8 + hoursRatio * 7)

      // Ролевые веса: менеджер/админ — больше качество, меньше скорость
      const isLeader = role === 'admin' || role === 'manager'
      const wActivity = 1.0
      const wSpeed = isLeader ? 0.7 : 1.0
      const wQuality = isLeader ? 1.5 : 1.0
      const wResponsibility = isLeader ? 1.3 : 1.0
      const totalWeight = wActivity + wSpeed + wQuality + wResponsibility

      const rawScore = (activityScore * wActivity + speedScore * wSpeed + qualityScore * wQuality + responsibilityScore * wResponsibility) / totalWeight
      const engagementScore = isInactive ? 0 : Math.round(Math.min(rawScore, 100))
      const engagementLevel = engagementScore >= 70 ? 'high' : engagementScore >= 40 ? 'medium' : 'low'

      return {
        name,
        role,
        totalResponses: times.length,
        withinSLA: withinSLACount,
        violatedSLA: times.length - withinSLACount,
        slaCompliance: times.length > 0 ? Math.round((withinSLACount / times.length) * 100) : null,
        avgMinutes: times.length > 0 ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10 : 0,
        minMinutes: sorted[0] || 0,
        maxMinutes: sorted[sorted.length - 1] || 0,
        medianMinutes: sorted[Math.floor(sorted.length / 2)] || 0,
        totalMessages,
        totalChars,
        avgCharsPerMessage: avgCharsMsg,
        channelsServed,
        activeDays,
        resolvedCases: resolvedCasesCount,
        totalAssignedCases: totalAssigned,
        efficiencyRatio: resolvedCasesCount > 0 ? Math.round(totalChars / resolvedCasesCount) : 0,
        onlineHours: Math.round(onlineHours * 10) / 10,
        engagementScore,
        engagementLevel,
        engagementBreakdown: {
          activity: activityScore,
          speed: speedScore,
          quality: qualityScore,
          responsibility: responsibilityScore,
        },
        isInactive,
      }
    }).sort((a, b) => {
      if (a.isInactive !== b.isInactive) return a.isInactive ? 1 : -1
      return b.totalResponses - a.totalResponses
    })
    
    // =============================================
    // 4. РАСЧЁТ МЕТРИК
    // =============================================
    const totalClientMessages = firstResponseData.length
    const respondedMessages = firstResponseData.filter((r: any) => r.response_at !== null)
    const withinSLA = respondedMessages.filter((r: any) => parseFloat(r.response_minutes) <= slaMinutes)
    const violatedSLA = respondedMessages.filter((r: any) => parseFloat(r.response_minutes) > slaMinutes)
    const noResponse = firstResponseData.filter((r: any) => r.response_at === null)
    
    const allResponseMinutes = respondedMessages.map((r: any) => parseFloat(r.response_minutes))
    const avgResponseMinutes = allResponseMinutes.length > 0
      ? Math.round((allResponseMinutes.reduce((a: number, b: number) => a + b, 0) / allResponseMinutes.length) * 10) / 10
      : 0
    
    const sortedTimes = [...allResponseMinutes].sort((a, b) => a - b)
    const medianResponseMinutes = sortedTimes.length > 0 
      ? sortedTimes[Math.floor(sortedTimes.length / 2)] 
      : 0
    
    // Метрики по кейсам
    const totalCases = caseResolutionData.length
    const resolvedCases = caseResolutionData.filter((c: any) => c.status === 'resolved' || c.status === 'closed')
    const openCases = caseResolutionData.filter((c: any) => c.status !== 'resolved' && c.status !== 'closed')
    
    const resolutionTimes = resolvedCases
      .filter((c: any) => c.resolution_minutes !== null)
      .map((c: any) => parseFloat(c.resolution_minutes))
    
    const avgResolutionMinutes = resolutionTimes.length > 0
      ? Math.round((resolutionTimes.reduce((a: number, b: number) => a + b, 0) / resolutionTimes.length) * 10) / 10
      : 0
    
    const avgResolutionHours = Math.round((avgResolutionMinutes / 60) * 10) / 10
    
    // =============================================
    // 5. ПОСЛЕДНИЕ СООБЩЕНИЯ БЕЗ ОТВЕТА
    // =============================================
    const unansweredMessages = noResponse.slice(0, 30).map((r: any) => ({
      channelId: r.channel_id,
      channelName: r.channel_name,
      clientName: r.client_name,
      messagePreview: (r.text_content || '').slice(0, 100),
      messageAt: r.message_at,
      waitingMinutes: Math.round((Date.now() - new Date(r.message_at).getTime()) / 60000),
    }))
    
    // =============================================
    // 6. НАРУШЕНИЯ SLA - детальный список
    // =============================================
    const slaViolations = violatedSLA.slice(0, 50).map((r: any) => ({
      channelId: r.channel_id,
      channelName: r.channel_name,
      clientName: r.client_name,
      messagePreview: (r.text_content || '').slice(0, 80),
      messageAt: r.message_at,
      responseAt: r.response_at,
      responseMinutes: parseFloat(r.response_minutes),
      responder: r.responder_name,
      exceededBy: Math.round((parseFloat(r.response_minutes) - slaMinutes) * 10) / 10,
    }))
    
    // =============================================
    // 7. ОТКРЫТЫЕ КЕЙСЫ - ожидающие решения
    // =============================================
    const pendingCases = openCases.slice(0, 30).map((c: any) => ({
      caseId: c.id,
      ticketNumber: c.ticket_number ? `CASE-${c.ticket_number}` : c.id,
      title: c.title,
      status: c.status,
      priority: c.priority,
      channelName: c.channel_name,
      agentName: c.agent_name,
      createdAt: c.created_at,
      waitingHours: Math.round((Date.now() - new Date(c.created_at).getTime()) / 3600000 * 10) / 10,
    }))
    
    // =============================================
    // 8. РАСПРЕДЕЛЕНИЕ ВРЕМЕНИ ОТВЕТА
    // =============================================
    const distribution = {
      within1min: respondedMessages.filter((r: any) => parseFloat(r.response_minutes) <= 1).length,
      within5min: respondedMessages.filter((r: any) => parseFloat(r.response_minutes) > 1 && parseFloat(r.response_minutes) <= 5).length,
      within10min: respondedMessages.filter((r: any) => parseFloat(r.response_minutes) > 5 && parseFloat(r.response_minutes) <= 10).length,
      within30min: respondedMessages.filter((r: any) => parseFloat(r.response_minutes) > 10 && parseFloat(r.response_minutes) <= 30).length,
      within60min: respondedMessages.filter((r: any) => parseFloat(r.response_minutes) > 30 && parseFloat(r.response_minutes) <= 60).length,
      over60min: respondedMessages.filter((r: any) => parseFloat(r.response_minutes) > 60).length,
      noResponse: noResponse.length,
    }

    // =============================================
    // 8.5. АВТОКЛАССИФИКАЦИЯ: один запрос CASE WHEN вместо 80+ отдельных
    // =============================================
    try {
      await sql`
        UPDATE support_messages SET ai_category = CASE
          WHEN LOWER(text_content) LIKE '%оплат%' OR LOWER(text_content) LIKE '%тариф%' OR LOWER(text_content) LIKE '%баланс%' OR LOWER(text_content) LIKE '%tolov%' OR LOWER(text_content) LIKE '%счёт%' OR LOWER(text_content) LIKE '%счет%' OR LOWER(text_content) LIKE '%подписк%' THEN 'billing'
          WHEN LOWER(text_content) LIKE '%ошибк%' OR LOWER(text_content) LIKE '%не работа%' OR LOWER(text_content) LIKE '%сломал%' OR LOWER(text_content) LIKE '%xato%' OR LOWER(text_content) LIKE '%ishlamay%' OR LOWER(text_content) LIKE '%баг%' OR LOWER(text_content) LIKE '%глюч%' OR LOWER(text_content) LIKE '%завис%' OR LOWER(text_content) LIKE '%не загруж%' OR LOWER(text_content) LIKE '%не открыва%' THEN 'technical'
          WHEN LOWER(text_content) LIKE '%iiko%' OR LOWER(text_content) LIKE '%интеграц%' OR LOWER(text_content) LIKE '%webhook%' OR LOWER(text_content) LIKE '%api%' THEN 'integration'
          WHEN LOWER(text_content) LIKE '%заказ%' OR LOWER(text_content) LIKE '%buyurtma%' OR LOWER(text_content) LIKE '%чек%' OR LOWER(text_content) LIKE '%корзин%' OR LOWER(text_content) LIKE '%оформлен%' THEN 'order'
          WHEN LOWER(text_content) LIKE '%доставк%' OR LOWER(text_content) LIKE '%курьер%' OR LOWER(text_content) LIKE '%yetkazib%' OR LOWER(text_content) LIKE '%адрес%' THEN 'delivery'
          WHEN LOWER(text_content) LIKE '%меню%' OR LOWER(text_content) LIKE '%товар%' OR LOWER(text_content) LIKE '%mahsulot%' OR LOWER(text_content) LIKE '%продукт%' OR LOWER(text_content) LIKE '%блюд%' OR LOWER(text_content) LIKE '%позици%' OR LOWER(text_content) LIKE '%каталог%' THEN 'menu'
          WHEN LOWER(text_content) LIKE '%приложен%' OR LOWER(text_content) LIKE '%android%' OR LOWER(text_content) LIKE '%ios%' OR LOWER(text_content) LIKE '%мобильн%' OR LOWER(text_content) LIKE '%ilova%' THEN 'app'
          WHEN LOWER(text_content) LIKE '%пароль%' OR LOWER(text_content) LIKE '%логин%' OR LOWER(text_content) LIKE '%аккаунт%' OR LOWER(text_content) LIKE '%авториз%' OR LOWER(text_content) LIKE '%войти%' OR LOWER(text_content) LIKE '%вход%' OR LOWER(text_content) LIKE '%parol%' OR LOWER(text_content) LIKE '%kirish%' THEN 'account'
          WHEN LOWER(text_content) LIKE '%отчёт%' OR LOWER(text_content) LIKE '%отчет%' OR LOWER(text_content) LIKE '%статистик%' OR LOWER(text_content) LIKE '%аналитик%' OR LOWER(text_content) LIKE '%hisobot%' OR LOWER(text_content) LIKE '%выгрузк%' THEN 'reports'
          WHEN LOWER(text_content) LIKE '%акци%' OR LOWER(text_content) LIKE '%скидк%' OR LOWER(text_content) LIKE '%промокод%' OR LOWER(text_content) LIKE '%купон%' OR LOWER(text_content) LIKE '%бонус%' OR LOWER(text_content) LIKE '%chegirma%' THEN 'promo'
          WHEN LOWER(text_content) LIKE '%клиент%' OR LOWER(text_content) LIKE '%ресторан%' OR LOWER(text_content) LIKE '%заведен%' OR LOWER(text_content) LIKE '%филиал%' OR LOWER(text_content) LIKE '%точк%' THEN 'clients'
          WHEN LOWER(text_content) LIKE '%график%' OR LOWER(text_content) LIKE '%расписан%' OR LOWER(text_content) LIKE '%смен%' THEN 'schedule'
          WHEN LOWER(text_content) LIKE '%принтер%' OR LOWER(text_content) LIKE '%печат%' OR LOWER(text_content) LIKE '%терминал%' OR LOWER(text_content) LIKE '%сканер%' OR LOWER(text_content) LIKE '%оборудован%' THEN 'hardware'
          WHEN LOWER(text_content) LIKE '%уведомлен%' OR LOWER(text_content) LIKE '%оповещен%' OR LOWER(text_content) LIKE '%sms%' OR LOWER(text_content) LIKE '%push%' OR LOWER(text_content) LIKE '%рассылк%' THEN 'notification'
          WHEN LOWER(text_content) LIKE '%обучен%' OR LOWER(text_content) LIKE '%инструкц%' OR LOWER(text_content) LIKE '%документац%' OR LOWER(text_content) LIKE '%как пользова%' THEN 'training'
          WHEN LOWER(text_content) LIKE '%регистрац%' OR LOWER(text_content) LIKE '%подключен%' OR LOWER(text_content) LIKE '%настрой%' OR LOWER(text_content) LIKE '%начать%' THEN 'onboarding'
          WHEN LOWER(text_content) LIKE '%подскажите%' OR LOWER(text_content) LIKE '%как сделать%' OR LOWER(text_content) LIKE '%помогите%' OR LOWER(text_content) LIKE '%вопрос%' OR LOWER(text_content) LIKE '%объясни%' OR LOWER(text_content) LIKE '%savol%' THEN 'question'
          WHEN LOWER(text_content) LIKE '%спасибо%' OR LOWER(text_content) LIKE '%rahmat%' OR LOWER(text_content) LIKE '%отлично%' OR LOWER(text_content) LIKE '%класс%' OR LOWER(text_content) LIKE '%молодц%' THEN 'feedback'
          WHEN LOWER(text_content) LIKE '%жалоб%' OR LOWER(text_content) LIKE '%недовол%' OR LOWER(text_content) LIKE '%плохо%' OR LOWER(text_content) LIKE '%ужасн%' OR LOWER(text_content) LIKE '%возврат%' THEN 'complaint'
          WHEN LOWER(text_content) LIKE '%предложен%' OR LOWER(text_content) LIKE '%хотел бы%' OR LOWER(text_content) LIKE '%добавьте%' OR LOWER(text_content) LIKE '%было бы%' THEN 'feature_request'
          ELSE 'general'
        END
        WHERE org_id = ${orgId}
          AND (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown' OR ai_category = 'general')
          AND text_content IS NOT NULL AND LENGTH(text_content) > 2
          AND created_at >= ${fromDateTime}::timestamptz
          AND created_at <= ${toDateTime}::timestamptz
      `
    } catch (e) { /* classification failed, continue */ }

    // =============================================
    // 8.6. АВТОСИНХРОНИЗАЦИЯ СОТРУДНИКОВ
    // Создаём записи в support_agents из support_users (role='employee')
    // =============================================
    try {
      await sql`
        INSERT INTO support_agents (id, name, username, telegram_id, role, org_id)
        SELECT
          'agent_' || u.telegram_id::text,
          u.name,
          REPLACE(COALESCE(u.telegram_username, ''), '@', ''),
          u.telegram_id::text,
          'agent',
          u.org_id
        FROM support_users u
        WHERE u.org_id = ${orgId}
          AND u.role = 'employee'
          AND u.is_active = true
          AND u.telegram_id IS NOT NULL
          AND u.name IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM support_agents sa
            WHERE sa.telegram_id = u.telegram_id::text AND sa.org_id = ${orgId}
          )
        ON CONFLICT (id) DO NOTHING
      `
    } catch (e) { /* user sync failed */ }

    // =============================================
    // 8.7. ПЕРЕКЛАССИФИКАЦИЯ СООБЩЕНИЙ СОТРУДНИКОВ
    // Сообщения от известных агентов, помеченные как 'client', обновляем на 'support'
    // =============================================
    try {
      await sql`
        UPDATE support_messages m
        SET sender_role = 'support', is_from_client = false
        FROM support_agents a
        WHERE m.org_id = ${orgId}
          AND m.sender_role = 'client'
          AND m.created_at >= ${fromDateTime}::timestamptz
          AND m.created_at <= ${toDateTime}::timestamptz
          AND (
            (m.sender_id IS NOT NULL AND a.telegram_id IS NOT NULL AND a.telegram_id = m.sender_id)
            OR (m.sender_username IS NOT NULL AND a.username IS NOT NULL AND a.username != '' AND LOWER(a.username) = LOWER(m.sender_username))
            OR (m.sender_name IS NOT NULL AND a.name IS NOT NULL AND LOWER(a.name) = LOWER(m.sender_name))
          )
      `
    } catch (e) { /* reclassify failed */ }

    try {
      await sql`
        UPDATE support_messages m
        SET sender_role = 'support', is_from_client = false
        FROM support_users u
        WHERE m.org_id = ${orgId}
          AND u.org_id = ${orgId}
          AND u.role = 'employee' AND u.is_active = true
          AND m.sender_role = 'client'
          AND m.created_at >= ${fromDateTime}::timestamptz
          AND m.created_at <= ${toDateTime}::timestamptz
          AND (
            (m.sender_id IS NOT NULL AND u.telegram_id IS NOT NULL AND m.sender_id = u.telegram_id::text)
            OR (m.sender_username IS NOT NULL AND u.telegram_username IS NOT NULL AND LOWER(REPLACE(u.telegram_username, '@', '')) = LOWER(m.sender_username))
            OR (m.sender_name IS NOT NULL AND u.name IS NOT NULL AND LOWER(u.name) = LOWER(m.sender_name))
          )
      `
    } catch (e) { /* direct user reclassify failed */ }

    // =============================================
    // 8.8. БЭКФИЛ: заполнить sender_id/sender_username для сообщений из UI
    // =============================================
    try {
      await sql`
        UPDATE support_messages m
        SET sender_id = a.telegram_id, sender_username = a.username
        FROM support_agents a
        WHERE m.org_id = ${orgId}
          AND m.sender_id IS NULL
          AND m.sender_role = 'support'
          AND m.sender_name IS NOT NULL
          AND a.org_id = ${orgId}
          AND a.telegram_id IS NOT NULL
          AND LOWER(m.sender_name) = LOWER(a.name)
      `
    } catch (e) { /* backfill failed, non-critical */ }

    // =============================================
    // 9. ЭКСПЕРТИЗА ПО КАТЕГОРИЯМ: на какие темы каждый агент отвечает
    // =============================================
    const agentCategoriesData = await sql`
      SELECT
        COALESCE(a.name, m.sender_name) as agent_name,
        CASE COALESCE(NULLIF(m.ai_category, ''), 'other')
          WHEN 'technical' THEN 'Техническая'
          WHEN 'billing' THEN 'Оплата'
          WHEN 'order' THEN 'Заказы'
          WHEN 'delivery' THEN 'Доставка'
          WHEN 'integration' THEN 'Интеграции'
          WHEN 'menu' THEN 'Меню/Товары'
          WHEN 'app' THEN 'Приложение'
          WHEN 'account' THEN 'Аккаунт/Вход'
          WHEN 'reports' THEN 'Отчёты'
          WHEN 'promo' THEN 'Акции/Скидки'
          WHEN 'clients' THEN 'Клиенты/Заведения'
          WHEN 'schedule' THEN 'График работы'
          WHEN 'hardware' THEN 'Оборудование'
          WHEN 'notification' THEN 'Уведомления'
          WHEN 'training' THEN 'Обучение'
          WHEN 'question' THEN 'Вопросы'
          WHEN 'complaint' THEN 'Жалобы'
          WHEN 'feedback' THEN 'Благодарности'
          WHEN 'onboarding' THEN 'Подключения'
          WHEN 'feature_request' THEN 'Предложения'
          WHEN 'general' THEN 'Общие'
          ELSE 'Прочее'
        END as category,
        COUNT(*) as msg_count
      FROM support_messages m
      JOIN support_channels sc ON sc.id = m.channel_id
      LEFT JOIN support_agents a ON (
        a.telegram_id::text = m.sender_id::text
        OR a.id::text = m.sender_id::text
        OR LOWER(a.username) = LOWER(m.sender_username)
        OR LOWER(a.name) = LOWER(m.sender_name)
      )
      WHERE m.org_id = ${orgId}
        AND m.is_from_client = false
        AND m.sender_role IN ('support', 'team', 'agent')
        AND m.created_at >= ${fromDateTime}::timestamptz
        AND m.created_at <= ${toDateTime}::timestamptz
        AND (${source}::text = 'all' OR COALESCE(sc.source, 'telegram') = ${source})
      GROUP BY COALESCE(a.name, m.sender_name), category
      ORDER BY msg_count DESC
    `

    const agentCaseCategoriesData = await sql`
      SELECT
        a.name as agent_name,
        CASE COALESCE(NULLIF(c.category, ''), 'other')
          WHEN 'technical' THEN 'Техническая'
          WHEN 'billing' THEN 'Оплата'
          WHEN 'order' THEN 'Заказы'
          WHEN 'delivery' THEN 'Доставка'
          WHEN 'integration' THEN 'Интеграции'
          WHEN 'menu' THEN 'Меню/Товары'
          WHEN 'app' THEN 'Приложение'
          WHEN 'account' THEN 'Аккаунт/Вход'
          WHEN 'reports' THEN 'Отчёты'
          WHEN 'promo' THEN 'Акции/Скидки'
          WHEN 'clients' THEN 'Клиенты/Заведения'
          WHEN 'schedule' THEN 'График работы'
          WHEN 'hardware' THEN 'Оборудование'
          WHEN 'notification' THEN 'Уведомления'
          WHEN 'training' THEN 'Обучение'
          WHEN 'question' THEN 'Вопросы'
          WHEN 'complaint' THEN 'Жалобы'
          WHEN 'feedback' THEN 'Благодарности'
          WHEN 'onboarding' THEN 'Подключения'
          WHEN 'feature_request' THEN 'Предложения'
          WHEN 'general' THEN 'Общие'
          ELSE 'Прочее'
        END as category,
        COUNT(*) as case_count,
        COUNT(*) FILTER (WHERE c.status IN ('resolved', 'closed')) as resolved_count
      FROM support_cases c
      JOIN support_agents a ON a.id::text = c.assigned_to::text
      WHERE c.org_id = ${orgId}
        AND c.created_at >= ${fromDateTime}::timestamptz
        AND c.created_at <= ${toDateTime}::timestamptz
      GROUP BY a.name, category
      ORDER BY case_count DESC
    `

    // Объединяем экспертизу
    const expertiseMap: Record<string, Record<string, { messages: number; cases: number; resolved: number }>> = {}
    for (const r of agentCategoriesData) {
      if (!expertiseMap[r.agent_name]) expertiseMap[r.agent_name] = {}
      if (!expertiseMap[r.agent_name][r.category]) expertiseMap[r.agent_name][r.category] = { messages: 0, cases: 0, resolved: 0 }
      expertiseMap[r.agent_name][r.category].messages = parseInt(r.msg_count)
    }
    for (const r of agentCaseCategoriesData) {
      if (!expertiseMap[r.agent_name]) expertiseMap[r.agent_name] = {}
      if (!expertiseMap[r.agent_name][r.category]) expertiseMap[r.agent_name][r.category] = { messages: 0, cases: 0, resolved: 0 }
      expertiseMap[r.agent_name][r.category].cases = parseInt(r.case_count)
      expertiseMap[r.agent_name][r.category].resolved = parseInt(r.resolved_count)
    }

    for (const a of allDbAgents) {
      if (!expertiseMap[a.name]) expertiseMap[a.name] = {}
    }

    const agentExpertise = Object.entries(expertiseMap).map(([name, cats]) => ({
      name,
      categories: Object.entries(cats)
        .map(([category, data]) => ({ category, ...data }))
        .sort((a, b) => b.messages - a.messages)
        .slice(0, 10),
    }))

    // =============================================
    // 10. КОГОРТА ПО ДНЯМ НЕДЕЛИ
    // =============================================
    const weeklyData = await sql`
      SELECT
        COALESCE(a.name, m.sender_name) as agent_name,
        EXTRACT(DOW FROM m.created_at AT TIME ZONE 'Asia/Tashkent') as dow,
        COUNT(*) as msg_count
      FROM support_messages m
      JOIN support_channels sc ON sc.id = m.channel_id
      LEFT JOIN support_agents a ON (
        a.telegram_id::text = m.sender_id::text
        OR a.id::text = m.sender_id::text
        OR LOWER(a.username) = LOWER(m.sender_username)
        OR LOWER(a.name) = LOWER(m.sender_name)
      )
      WHERE m.org_id = ${orgId}
        AND m.is_from_client = false
        AND m.sender_role IN ('support', 'team', 'agent')
        AND m.created_at >= ${fromDateTime}::timestamptz
        AND m.created_at <= ${toDateTime}::timestamptz
        AND (${source}::text = 'all' OR COALESCE(sc.source, 'telegram') = ${source})
      GROUP BY COALESCE(a.name, m.sender_name), EXTRACT(DOW FROM m.created_at AT TIME ZONE 'Asia/Tashkent')
      ORDER BY agent_name, dow
    `

    const weeklyMap: Record<string, number[]> = {}
    for (const r of weeklyData) {
      if (!weeklyMap[r.agent_name]) weeklyMap[r.agent_name] = [0, 0, 0, 0, 0, 0, 0]
      weeklyMap[r.agent_name][parseInt(r.dow)] = parseInt(r.msg_count)
    }

    for (const a of allDbAgents) {
      if (!weeklyMap[a.name]) weeklyMap[a.name] = [0, 0, 0, 0, 0, 0, 0]
    }

    const weeklyWorkload = Object.entries(weeklyMap).map(([name, days]) => ({
      name,
      days,
      total: days.reduce((a, b) => a + b, 0),
      peakDay: days.indexOf(Math.max(...days)),
    })).sort((a, b) => b.total - a.total)

    // Суммарная нагрузка команды по дням
    const teamWeekly = [0, 0, 0, 0, 0, 0, 0]
    for (const w of weeklyWorkload) {
      for (let i = 0; i < 7; i++) teamWeekly[i] += w.days[i]
    }

    // =============================================
    // 11. КОЛЛАБОРАЦИЯ: сколько агентов участвует в решении
    // =============================================
    const collaborationData = await sql`
      SELECT
        m.channel_id,
        c.name as channel_name,
        COUNT(DISTINCT COALESCE(a.name, m.sender_name)) as agent_count,
        ARRAY_AGG(DISTINCT COALESCE(a.name, m.sender_name)) as agents
      FROM support_messages m
      JOIN support_channels c ON c.id = m.channel_id
      LEFT JOIN support_agents a ON (
        a.telegram_id::text = m.sender_id::text
        OR a.id::text = m.sender_id::text
        OR LOWER(a.username) = LOWER(m.sender_username)
        OR LOWER(a.name) = LOWER(m.sender_name)
      )
      WHERE m.org_id = ${orgId}
        AND m.is_from_client = false
        AND m.sender_role IN ('support', 'team', 'agent')
        AND m.created_at >= ${fromDateTime}::timestamptz
        AND m.created_at <= ${toDateTime}::timestamptz
        AND (${source}::text = 'all' OR COALESCE(c.source, 'telegram') = ${source})
      GROUP BY m.channel_id, c.name
      HAVING COUNT(DISTINCT COALESCE(a.name, m.sender_name)) >= 1
      ORDER BY agent_count DESC
    `

    const totalCollabChannels = collaborationData.length
    const multiAgentChannels = collaborationData.filter((c: any) => parseInt(c.agent_count) > 1)
    const avgAgentsPerChannel = totalCollabChannels > 0
      ? Math.round((collaborationData.reduce((sum: number, c: any) => sum + parseInt(c.agent_count), 0) / totalCollabChannels) * 10) / 10
      : 0

    const collaboration = {
      totalChannels: totalCollabChannels,
      multiAgentChannels: multiAgentChannels.length,
      soloChannels: totalCollabChannels - multiAgentChannels.length,
      avgAgentsPerChannel,
      multiAgentPercent: totalCollabChannels > 0
        ? Math.round((multiAgentChannels.length / totalCollabChannels) * 100) : 0,
      details: multiAgentChannels.slice(0, 20).map((c: any) => ({
        channelName: c.channel_name,
        agentCount: parseInt(c.agent_count),
        agents: c.agents,
      })),
    }

    // =============================================
    // 12. РАЗБИВКА ПО ИСТОЧНИКУ (Telegram / WhatsApp)
    // =============================================
    let sourceBreakdown: any[] = []
    try {
      sourceBreakdown = await sql`
        WITH src AS (
          SELECT
            COALESCE(c.source, 'telegram') as src,
            COUNT(*) as total_messages,
            COUNT(*) FILTER (WHERE m.is_from_client = true) as client_messages,
            COUNT(*) FILTER (WHERE m.is_from_client = false) as agent_messages,
            ROUND(AVG(m.response_time_ms) FILTER (
              WHERE m.response_time_ms IS NOT NULL AND m.response_time_ms > 0 AND m.response_time_ms < 86400000
            ))::int as avg_response_ms,
            COUNT(DISTINCT m.channel_id) as channels
          FROM support_messages m
          JOIN support_channels c ON c.id = m.channel_id
          WHERE m.org_id = ${orgId}
            AND m.created_at >= ${fromDateTime}::timestamptz
            AND m.created_at <= ${toDateTime}::timestamptz
            AND (${market}::text IS NULL OR c.market_id = ${market})
          GROUP BY COALESCE(c.source, 'telegram')
        )
        SELECT * FROM src ORDER BY total_messages DESC
      `
    } catch {}

    return json({
      period: {
        from: fromDate,
        to: toDate,
        slaMinutes,
        source,
        timezone: 'Asia/Tashkent (UTC+5)',
      },
      
      // Сводка по времени ответа
      responseTimeSummary: {
        totalClientMessages,
        responded: respondedMessages.length,
        withinSLA: withinSLA.length,
        violatedSLA: violatedSLA.length,
        noResponse: noResponse.length,
        slaCompliancePercent: respondedMessages.length > 0
          ? Math.round((withinSLA.length / respondedMessages.length) * 1000) / 10
          : 100,
        responseRatePercent: totalClientMessages > 0
          ? Math.round((respondedMessages.length / totalClientMessages) * 1000) / 10
          : 100,
        avgResponseMinutes,
        medianResponseMinutes: Math.round(medianResponseMinutes * 10) / 10,
        minResponseMinutes: sortedTimes[0] ? Math.round(sortedTimes[0] * 10) / 10 : 0,
        maxResponseMinutes: sortedTimes[sortedTimes.length - 1] ? Math.round(sortedTimes[sortedTimes.length - 1] * 10) / 10 : 0,
      },
      
      // Сводка по решению кейсов
      caseResolutionSummary: {
        totalCases,
        resolved: resolvedCases.length,
        open: openCases.length,
        resolutionRatePercent: totalCases > 0 
          ? Math.round((resolvedCases.length / totalCases) * 1000) / 10
          : 100,
        avgResolutionMinutes,
        avgResolutionHours,
      },
      
      // Распределение времени ответа
      responseDistribution: distribution,
      
      // Детализация по сотрудникам
      agentPerformance: agentDetails,
      
      // Нарушения SLA
      slaViolations,
      
      // Сообщения без ответа
      unansweredMessages,
      
      // Открытые кейсы
      pendingCases,
      
      // Решённые кейсы с временем
      resolvedCasesDetails: resolvedCases.slice(0, 30).map((c: any) => ({
        caseId: c.id,
        ticketNumber: c.ticket_number ? `CASE-${c.ticket_number}` : c.id,
        title: c.title,
        priority: c.priority,
        channelName: c.channel_name,
        agentName: c.agent_name,
        createdAt: c.created_at,
        resolvedAt: c.resolved_at,
        resolutionMinutes: c.resolution_minutes,
        resolutionHours: c.resolution_hours,
      })),

      // Экспертиза по категориям
      agentExpertise,

      // Когорта по дням недели
      weeklyWorkload,
      teamWeekly,

      // Коллаборация
      collaboration,

      // Разбивка по источнику
      sourceBreakdown: sourceBreakdown.map((s: any) => ({
        source: s.src,
        totalMessages: parseInt(s.total_messages || '0'),
        clientMessages: parseInt(s.client_messages || '0'),
        agentMessages: parseInt(s.agent_messages || '0'),
        avgResponseMin: s.avg_response_ms ? Math.round(s.avg_response_ms / 60000 * 10) / 10 : null,
        channels: parseInt(s.channels || '0'),
      })),
    }, 200, 60)
    
  } catch (e: any) {
    console.error('[SLA Report] Error:', e)
    return json({ error: "Internal server error" }, 500)
  }
}
