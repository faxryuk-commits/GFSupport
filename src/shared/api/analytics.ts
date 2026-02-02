import { apiGet } from '../services/api.service'

export interface AnalyticsData {
  cases: {
    total: number
    open: number
    resolved: number
    avgResolutionTime: number
    urgent: number
    recurring: number
  }
  messages: {
    total: number
    problems: number
    voice: number
  }
  channels: {
    total: number
    active: number
    avgFirstResponse: number
  }
  patterns?: {
    byCategory: Record<string, number>
    bySentiment: Record<string, number>
    byIntent: Record<string, number>
    recurringProblems: Array<{ issue: string; count: number }>
  }
  team?: {
    byManager: Array<{ name: string; resolved: number; avgTime: number }>
    dailyTrend: Array<{ date: string; cases: number; messages: number }>
  }
}

export async function fetchAnalytics(period?: string): Promise<AnalyticsData> {
  const query = period ? `?period=${period}` : ''
  return apiGet<AnalyticsData>(`/analytics${query}`)
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

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  // Aggregate from multiple endpoints
  try {
    const [analytics, channelsData] = await Promise.all([
      fetchAnalytics(),
      apiGet<{ channels: any[] }>('/channels').catch(() => ({ channels: [] }))
    ])

    const channels = channelsData?.channels || []
    const awaitingChannels = channels.filter((c: any) => c?.awaitingReply).length

    return {
      waiting: awaitingChannels,
      avgResponseTime: `${Math.round(analytics?.channels?.avgFirstResponse || 0)}м`,
      slaPercent: 95,
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
