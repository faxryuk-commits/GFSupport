import { apiGet } from '../services/api.service'

export type MetricStatus = 'good' | 'borderline' | 'bad' | 'unknown'
export type MetricUnit = 'minutes' | 'hours' | 'seconds' | 'percent' | 'ratio' | 'count' | 'currency'
export type MetricDirection = 'higher_better' | 'lower_better'

export interface MetricDescriptor {
  key: string
  level: 'outcome' | 'driver' | 'indicator' | 'activity'
  unit: MetricUnit
  direction: MetricDirection
  labelRu: string
  formulaRu: string
  perAgent: boolean
}

export interface BenchmarkTarget {
  tier: 'bronze' | 'silver' | 'gold'
  value: number
  source: 'percentile_internal' | 'manual' | 'industry_default'
  sampleSize: number | null
  computedAt: string | null
}

export interface MetricResult {
  key: string
  value: number | null
  sampleSize: number
  benchmarks: {
    bronze: BenchmarkTarget | null
    silver: BenchmarkTarget | null
    gold: BenchmarkTarget | null
  }
  status: MetricStatus
  period: {
    from: string
    to: string
    granularity: 'daily' | 'weekly' | 'monthly'
    label: string
  }
}

export interface MetricResponse {
  descriptor: MetricDescriptor
  result: MetricResult
}

export interface FetchMetricParams {
  key: string
  period?: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | '7d' | '30d' | '90d'
  agentId?: string | null
  market?: string | null
  source?: string | null
  role?: string | null
}

export const fetchMetric = (params: FetchMetricParams): Promise<MetricResponse> => {
  const qs = new URLSearchParams()
  qs.set('key', params.key)
  if (params.period) qs.set('period', params.period)
  if (params.agentId) qs.set('agentId', params.agentId)
  if (params.market) qs.set('market', params.market)
  if (params.source) qs.set('source', params.source)
  if (params.role) qs.set('role', params.role)
  return apiGet<MetricResponse>(`/analytics/metric?${qs.toString()}`)
}
