import { apiGet } from '../services/api.service'

export type HealthBand = 'healthy' | 'at_risk' | 'critical' | 'unknown'

export interface CustomerHealthRow {
  channelId: string
  channelName: string | null
  source: string
  marketId: string | null
  lastMessageAt: string | null
  daysSinceLastMessage: number | null
  totalMessages: number
  clientMessages: number
  scoredMessages: number
  positiveMessages: number
  negativeMessages: number
  totalCases: number
  resolvedCases: number
  openCases: number
  churnMatches: number
  activityScore: number | null
  sentimentScore: number | null
  resolutionScore: number | null
  churnScore: number
  healthScore: number | null
  band: HealthBand
}

export interface CustomerHealthResponse {
  period: {
    from: string
    to: string
    granularity: 'daily' | 'weekly' | 'monthly'
    label: string
  }
  summary: {
    healthy: number
    atRisk: number
    critical: number
    unknown: number
    total: number
  }
  /**
   * Сколько КРИТИЧЕСКИХ И В ЗОНЕ РИСКА каналов получили низкий score по компоненту.
   * Помогает понять, какой именно фактор тянет совокупный Health Score вниз.
   * (Каналы могут попадать в несколько компонентов одновременно.)
   */
  breakdown?: {
    lowActivity: number
    lowSentiment: number
    poorResolution: number
    churnSignals: number
    openCases: number
  }
  rows: CustomerHealthRow[]
}

export interface FetchCustomerHealthParams {
  period?: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | '7d' | '30d' | '90d'
  market?: string | null
  source?: string | null
  limit?: number
}

export const fetchCustomerHealth = (
  params: FetchCustomerHealthParams = {},
): Promise<CustomerHealthResponse> => {
  const qs = new URLSearchParams()
  if (params.period) qs.set('period', params.period)
  if (params.market) qs.set('market', params.market)
  if (params.source) qs.set('source', params.source)
  if (params.limit) qs.set('limit', String(params.limit))
  const q = qs.toString()
  return apiGet<CustomerHealthResponse>(`/analytics/customer-health${q ? `?${q}` : ''}`)
}
