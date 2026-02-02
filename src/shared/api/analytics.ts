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
  const [analytics, channels] = await Promise.all([
    fetchAnalytics(),
    apiGet<{ channels: any[] }>('/channels')
  ])

  const awaitingChannels = channels.channels.filter(c => c.awaitingReply).length

  return {
    waiting: awaitingChannels,
    avgResponseTime: `${Math.round(analytics.channels.avgFirstResponse)}м`,
    slaPercent: 95, // TODO: calculate from data
    urgentCases: analytics.cases.urgent,
    resolvedToday: analytics.cases.resolved,
    totalChannels: analytics.channels.total,
    activeAgents: 0 // TODO: from agents endpoint
  }
}
