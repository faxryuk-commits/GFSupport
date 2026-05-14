import { apiGet } from '../services/api.service'
import type { MetricDescriptor, MetricStatus } from './metric'

export type TrendGranularity = 'weekly' | 'monthly'
export type TrendDirection = 'improving' | 'stable' | 'declining' | 'insufficient_data'

export interface TrendPoint {
  periodStart: string
  periodEnd: string
  label: string
  value: number | null
  sampleSize: number
  status: MetricStatus
}

export interface AgentTrendResponse {
  agentId: string
  descriptor: MetricDescriptor
  granularity: TrendGranularity
  benchmarks: {
    bronze: { value: number } | null
    silver: { value: number } | null
    gold: { value: number } | null
  } | null
  points: TrendPoint[]
  trend: TrendDirection
  changePct: number | null
}

export interface FetchAgentTrendParams {
  agentId: string
  key: string
  granularity?: TrendGranularity
  periods?: number
  source?: string | null
}

export const fetchAgentTrend = (
  params: FetchAgentTrendParams,
): Promise<AgentTrendResponse> => {
  const qs = new URLSearchParams()
  qs.set('agentId', params.agentId)
  qs.set('key', params.key)
  if (params.granularity) qs.set('granularity', params.granularity)
  if (params.periods) qs.set('periods', String(params.periods))
  if (params.source) qs.set('source', params.source)
  return apiGet<AgentTrendResponse>(`/analytics/agent-trend?${qs.toString()}`)
}
