import { apiGet } from '../services/api.service'

// SLA категории каналов
export type SlaCategory = 'client' | 'client_integration' | 'partner' | 'internal'

export const SLA_CATEGORY_CONFIG: Record<SlaCategory, { label: string; priority: number; color: string }> = {
  client: { label: 'Delever + Клиенты', priority: 1, color: 'blue' },
  client_integration: { label: 'Delever + Клиенты + Интеграция', priority: 1, color: 'purple' },
  partner: { label: 'Delever + Партнёры', priority: 2, color: 'green' },
  internal: { label: 'Внутренняя команда', priority: 3, color: 'slate' },
}

// Метрики по SLA категории
export interface SlaCategoryMetrics {
  label: string
  channels: {
    total: number
    waitingReply: number
    withUnread: number
    totalUnread: number
  }
  cases: {
    total: number
    open: number
    resolved: number
    urgent: number
    avgResolutionMinutes: number
  }
  response: {
    avgMinutes: number
    respondedCount: number
    totalMessages: number
  }
  slaPercent: number
}

// Интерфейсы для данных с API
interface ApiAnalyticsResponse {
  period: string
  periodDays: number
  generatedAt: string
  overview: {
    totalCases: number
    openCases: number
    resolvedCases: number
    newCasesPeriod: number
    avgResolutionMinutes: number
    avgResolutionHours: number
    urgentCases: number
    urgentOpenCases?: number // ОТКРЫТЫХ срочных кейсов - для AI рекомендаций
    recurringCases: number
    casesByPriority?: {
      low: number
      medium: number
      high: number
      urgent: number
    }
    totalMessages: number
    problemMessages: number
    voiceMessages: number
    videoMessages: number
    transcribedMessages: number
    totalChannels: number
    activeChannels: number
    avgFirstResponseMinutes: number | null
  }
  patterns: {
    byCategory: Array<{ category: string; count: number; openCount: number; avgResolutionMinutes: number }>
    bySentiment: Array<{ sentiment: string; count: number }>
    byIntent: Array<{ intent: string; count: number }>
    recurringProblems: Array<{ problem: string; occurrences: number; affectedCompanies: number }>
  }
  teamMetrics: {
    byManager: Array<{
      managerId: string | null
      managerName: string
      totalMessages: number
      channelsServed: number
      activeDays: number
      totalCases: number
      resolvedCases: number
      resolutionRate: number
      avgResolutionMinutes: number
      lastActiveAt?: string
    }>
    dailyTrend: Array<{ date: string; casesCreated: number; casesResolved: number }>
    responseTimeDistribution?: Array<{ bucket: string; count: number; avgMinutes: number }>
  }
  churnSignals: {
    negativeCompanies: Array<{
      companyId: string
      companyName: string
      negativeMessages: number
      totalMessages: number
      lastNegativeAt: string
    }>
    stuckCases: Array<{
      companyId: string
      companyName: string
      stuckCases: number
      oldestCaseAt: string
      oldestHours: number
    }>
    recurringByCompany: Array<{
      companyId: string
      companyName: string
      recurringCases: number
      categories: string[]
    }>
    highRiskCompanies: Array<{
      companyId: string
      companyName: string
      mrr: number
      riskScore: number
      openCases: number
      recurringCases: number
    }>
  }
  byCategory?: Record<SlaCategory, SlaCategoryMetrics>
  topDemandingChannels?: Array<{
    id: string
    name: string
    slaCategory: string
    awaitingReply: boolean
    unreadCount: number
    messagesCount: number
    problemCount: number
    negativeCount: number
    urgentCount: number
    openCases: number
    recurringCases: number
    avgResponseMinutes: number | null
    attentionScore: number
    lastMessageAt: string | null
  }>
  slowestClients?: Array<{
    id: string
    name: string
    slaCategory: string
    clientAvgMs: number
    clientAvgFormatted: string
    clientResponseCount: number
    agentAvgMs: number
    agentAvgFormatted: string
    agentResponseCount: number
    differenceMs: number
    differenceFormatted: string
    slowerParty: 'client' | 'agent'
    lastMessageAt: string | null
  }>
}

// Экспортируемые интерфейсы для фронтенда
export interface AnalyticsData {
  period: string
  periodDays: number
  generatedAt: string
  
  cases: {
    total: number
    open: number
    resolved: number
    avgResolutionTime: number
    avgResolutionHours: number
    urgent: number
    urgentOpen: number // ОТКРЫТЫХ срочных - для AI рекомендаций
    recurring: number
    newPeriod: number
    byPriority: {
      low: number
      medium: number
      high: number
      urgent: number
    }
  }
  messages: {
    total: number
    problems: number
    voice: number
    video: number
    transcribed: number
  }
  channels: {
    total: number
    active: number
    avgFirstResponse: number
  }
  patterns: {
    byCategory: Array<{ name: string; count: number; openCount: number; avgResolution: number }>
    bySentiment: Array<{ sentiment: string; count: number }>
    byIntent: Array<{ intent: string; count: number }>
    recurringProblems: Array<{ issue: string; category?: string; count: number; affected: number }>
  }
  team: {
    byManager: Array<{
      id: string | null
      name: string
      totalMessages: number
      channelsServed: number
      activeDays: number
      totalCases: number
      resolved: number
      resolutionRate: number
      avgTime: number
      lastActiveAt?: string
    }>
    dailyTrend: Array<{ date: string; cases: number; resolved: number; messages: number }>
    responseTimeDistribution: Array<{ bucket: string; count: number; avgMinutes: number }>
  }
  churnSignals: {
    negativeCompanies: Array<{
      companyId: string
      companyName: string
      negativeMessages: number
      totalMessages: number
      lastNegativeAt: string
    }>
    stuckCases: Array<{
      companyId: string
      companyName: string
      stuckCases: number
      oldestHours: number
    }>
    recurringByCompany: Array<{
      companyId: string
      companyName: string
      recurringCases: number
      categories: string[]
    }>
    highRiskCompanies: Array<{
      companyId: string
      companyName: string
      riskScore: number
      openCases: number
      recurringCases: number
    }>
  }
  // Метрики по SLA категориям
  byCategory: Record<SlaCategory, SlaCategoryMetrics>
  // Топ каналов требующих внимания
  topDemandingChannels: Array<{
    id: string
    name: string
    slaCategory: string
    awaitingReply: boolean
    unreadCount: number
    messagesCount: number
    problemCount: number
    negativeCount: number
    urgentCount: number
    openCases: number
    recurringCases: number
    avgResponseMinutes: number | null
    attentionScore: number
    lastMessageAt: string | null
  }>
  // Топ медленно отвечающих клиентов
  slowestClients: Array<{
    id: string
    name: string
    slaCategory: string
    clientAvgMs: number
    clientAvgFormatted: string
    clientResponseCount: number
    agentAvgMs: number
    agentAvgFormatted: string
    agentResponseCount: number
    differenceMs: number
    differenceFormatted: string
    slowerParty: 'client' | 'agent'
    lastMessageAt: string | null
  }>
}

export async function fetchAnalytics(period?: string): Promise<AnalyticsData> {
  // Support custom date range: "custom:2024-01-01:2024-01-31"
  let query = ''
  if (period?.startsWith('custom:')) {
    const [, from, to] = period.split(':')
    query = `?from=${from}&to=${to}`
  } else if (period) {
    query = `?period=${period}`
  }
  
  try {
    const raw = await apiGet<ApiAnalyticsResponse>(`/analytics${query}`)
    
    // Маппинг данных из API в формат фронтенда
    return {
      period: raw.period || '30d',
      periodDays: raw.periodDays || 30,
      generatedAt: raw.generatedAt || new Date().toISOString(),
      
      cases: {
        total: raw.overview?.totalCases || 0,
        open: raw.overview?.openCases || 0,
        resolved: raw.overview?.resolvedCases || 0,
        avgResolutionTime: raw.overview?.avgResolutionMinutes || 0,
        avgResolutionHours: raw.overview?.avgResolutionHours || 0,
        urgent: raw.overview?.urgentCases || 0,
        urgentOpen: raw.overview?.urgentOpenCases || 0, // ОТКРЫТЫХ срочных
        recurring: raw.overview?.recurringCases || 0,
        newPeriod: raw.overview?.newCasesPeriod || 0,
        byPriority: {
          low: raw.overview?.casesByPriority?.low || 0,
          medium: raw.overview?.casesByPriority?.medium || 0,
          high: raw.overview?.casesByPriority?.high || 0,
          urgent: raw.overview?.casesByPriority?.urgent || 0,
        },
      },
      messages: {
        total: raw.overview?.totalMessages || 0,
        problems: raw.overview?.problemMessages || 0,
        voice: raw.overview?.voiceMessages || 0,
        video: raw.overview?.videoMessages || 0,
        transcribed: raw.overview?.transcribedMessages || 0,
      },
      channels: {
        total: raw.overview?.totalChannels || 0,
        active: raw.overview?.activeChannels || 0,
        avgFirstResponse: raw.overview?.avgFirstResponseMinutes || 0,
      },
      patterns: {
        byCategory: (raw.patterns?.byCategory || []).map(c => ({
          name: c.category,
          count: c.count,
          openCount: c.openCount,
          avgResolution: c.avgResolutionMinutes,
        })),
        bySentiment: raw.patterns?.bySentiment || [],
        byIntent: raw.patterns?.byIntent || [],
        recurringProblems: (raw.patterns?.recurringProblems || []).map((p: any) => ({
          issue: p.issue || p.problem || 'Неизвестная проблема',
          category: p.category || p.problem,
          count: p.count || p.occurrences || 0,
          affected: p.affected || p.affectedCompanies || 0,
        })),
      },
      team: {
        byManager: (raw.teamMetrics?.byManager || []).map(m => ({
          id: m.managerId,
          name: m.managerName,
          totalMessages: m.totalMessages || 0,
          channelsServed: m.channelsServed || 0,
          activeDays: m.activeDays || 0,
          totalCases: m.totalCases || 0,
          resolved: m.resolvedCases || 0,
          resolutionRate: m.resolutionRate || 0,
          avgTime: m.avgResolutionMinutes || 0,
          lastActiveAt: m.lastActiveAt,
        })),
        dailyTrend: (raw.teamMetrics?.dailyTrend || []).map(d => ({
          date: d.date,
          cases: d.casesCreated,
          resolved: d.casesResolved,
          messages: 0, // API не возвращает сообщения по дням
        })),
        responseTimeDistribution: (raw.teamMetrics?.responseTimeDistribution || []).map(r => ({
          bucket: r.bucket,
          count: r.count,
          avgMinutes: r.avgMinutes,
        })),
      },
      churnSignals: {
        negativeCompanies: raw.churnSignals?.negativeCompanies || [],
        stuckCases: (raw.churnSignals?.stuckCases || []).map(c => ({
          companyId: c.companyId,
          companyName: c.companyName,
          stuckCases: c.stuckCases,
          oldestHours: c.oldestHours,
        })),
        recurringByCompany: raw.churnSignals?.recurringByCompany || [],
        highRiskCompanies: (raw.churnSignals?.highRiskCompanies || []).map(c => ({
          companyId: c.companyId,
          companyName: c.companyName,
          riskScore: c.riskScore,
          openCases: c.openCases,
          recurringCases: c.recurringCases,
        })),
      },
      byCategory: raw.byCategory || {
        client: { label: 'Delever + Клиенты', channels: { total: 0, waitingReply: 0, withUnread: 0, totalUnread: 0 }, cases: { total: 0, open: 0, resolved: 0, urgent: 0, avgResolutionMinutes: 0 }, response: { avgMinutes: 0, respondedCount: 0, totalMessages: 0 }, slaPercent: 100 },
        client_integration: { label: 'Delever + Клиенты + Интеграция', channels: { total: 0, waitingReply: 0, withUnread: 0, totalUnread: 0 }, cases: { total: 0, open: 0, resolved: 0, urgent: 0, avgResolutionMinutes: 0 }, response: { avgMinutes: 0, respondedCount: 0, totalMessages: 0 }, slaPercent: 100 },
        partner: { label: 'Delever + Партнёры', channels: { total: 0, waitingReply: 0, withUnread: 0, totalUnread: 0 }, cases: { total: 0, open: 0, resolved: 0, urgent: 0, avgResolutionMinutes: 0 }, response: { avgMinutes: 0, respondedCount: 0, totalMessages: 0 }, slaPercent: 100 },
        internal: { label: 'Внутренняя команда', channels: { total: 0, waitingReply: 0, withUnread: 0, totalUnread: 0 }, cases: { total: 0, open: 0, resolved: 0, urgent: 0, avgResolutionMinutes: 0 }, response: { avgMinutes: 0, respondedCount: 0, totalMessages: 0 }, slaPercent: 100 },
      },
      topDemandingChannels: raw.topDemandingChannels || [],
      slowestClients: raw.slowestClients || [],
    }
  } catch (error) {
    console.error('Failed to fetch analytics:', error)
    const emptyCategory: SlaCategoryMetrics = { label: '', channels: { total: 0, waitingReply: 0, withUnread: 0, totalUnread: 0 }, cases: { total: 0, open: 0, resolved: 0, urgent: 0, avgResolutionMinutes: 0 }, response: { avgMinutes: 0, respondedCount: 0, totalMessages: 0 }, slaPercent: 100 }
    // Возвращаем пустые данные при ошибке
    return {
      period: '30d',
      periodDays: 30,
      generatedAt: new Date().toISOString(),
      cases: { total: 0, open: 0, resolved: 0, avgResolutionTime: 0, avgResolutionHours: 0, urgent: 0, urgentOpen: 0, recurring: 0, newPeriod: 0, byPriority: { low: 0, medium: 0, high: 0, urgent: 0 } },
      messages: { total: 0, problems: 0, voice: 0, video: 0, transcribed: 0 },
      channels: { total: 0, active: 0, avgFirstResponse: 0 },
      patterns: { byCategory: [], bySentiment: [], byIntent: [], recurringProblems: [] },
      team: { byManager: [], dailyTrend: [], responseTimeDistribution: [] },
      churnSignals: { negativeCompanies: [], stuckCases: [], recurringByCompany: [], highRiskCompanies: [] },
      byCategory: {
        client: { ...emptyCategory, label: 'Delever + Клиенты' },
        client_integration: { ...emptyCategory, label: 'Delever + Клиенты + Интеграция' },
        partner: { ...emptyCategory, label: 'Delever + Партнёры' },
        internal: { ...emptyCategory, label: 'Внутренняя команда' },
      },
      topDemandingChannels: [],
      slowestClients: [],
    }
  }
}

export interface DashboardMetrics {
  waiting: number
  avgResponseTime: string
  slaPercent: number
  urgentCases: number
  resolvedToday: number
  totalChannels: number
  activeAgents: number
}

export async function fetchDashboardMetrics(period?: string): Promise<DashboardMetrics> {
  try {
    const [analytics, channelsData] = await Promise.all([
      fetchAnalytics(period).catch(() => null),
      apiGet<{ channels: any[] }>('/channels').catch(() => ({ channels: [] }))
    ])

    const channels = channelsData?.channels || []
    const awaitingChannels = channels.filter((c: any) => c?.awaitingReply).length

    const rtd = analytics?.team?.responseTimeDistribution || []
    const slaPercent = rtd.length > 0
      ? Math.round(
          ((rtd.find((d) => d.bucket === '5min')?.count || 0) +
           (rtd.find((d) => d.bucket === '10min')?.count || 0)) /
          Math.max(rtd.reduce((sum, d) => sum + d.count, 0), 1) * 100
        )
      : (analytics?.channels?.avgFirstResponse != null ? 95 : 100)

    return {
      waiting: awaitingChannels,
      avgResponseTime: analytics?.channels?.avgFirstResponse 
        ? `${Math.round(analytics.channels.avgFirstResponse)}м` 
        : '—',
      slaPercent,
      urgentCases: analytics?.cases?.urgent || 0,
      resolvedToday: analytics?.cases?.resolved || 0,
      totalChannels: analytics?.channels?.total || 0,
      activeAgents: 0
    }
  } catch (error) {
    console.error('Failed to fetch dashboard metrics:', error)
    return {
      waiting: 0,
      avgResponseTime: '—',
      slaPercent: 0,
      urgentCases: 0,
      resolvedToday: 0,
      totalChannels: 0,
      activeAgents: 0
    }
  }
}
