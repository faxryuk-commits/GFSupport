import { apiGet } from '../services/api.service'

export type MetricStatus = 'gold' | 'silver' | 'bronze' | 'below_bronze' | 'unknown'
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
  /** Доп. контекст для FRT (опционально — есть только у frt_avg_minutes). */
  medianValue?: number | null
  p90Value?: number | null
  totalSessions?: number
  answeredRate?: number | null
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
  roles?: string[] | null
}

export const fetchMetric = (params: FetchMetricParams): Promise<MetricResponse> => {
  const qs = new URLSearchParams()
  qs.set('key', params.key)
  if (params.period) qs.set('period', params.period)
  if (params.agentId) qs.set('agentId', params.agentId)
  if (params.market) qs.set('market', params.market)
  if (params.source) qs.set('source', params.source)
  if (params.role) qs.set('role', params.role)
  if (params.roles && params.roles.length > 0) qs.set('roles', params.roles.join(','))
  return apiGet<MetricResponse>(`/analytics/metric?${qs.toString()}`)
}

export interface MetricPerAgentRow {
  agentId: string
  agentName: string | null
  value: number
  sampleSize: number
  status: MetricStatus
}

export interface MetricPerAgentResponse {
  descriptor: MetricDescriptor
  period: MetricResult['period']
  benchmarks: MetricResult['benchmarks']
  rows: MetricPerAgentRow[]
}

export interface FetchMetricPerAgentParams {
  key: string
  period?: FetchMetricParams['period']
  market?: string | null
  source?: string | null
  /** Список ролей (lower-case или как в support_agents.role) — фильтр кого считать. */
  roles?: string[] | null
}

export const fetchMetricPerAgent = (
  params: FetchMetricPerAgentParams,
): Promise<MetricPerAgentResponse> => {
  const qs = new URLSearchParams()
  qs.set('key', params.key)
  if (params.period) qs.set('period', params.period)
  if (params.market) qs.set('market', params.market)
  if (params.source) qs.set('source', params.source)
  if (params.roles && params.roles.length > 0) qs.set('roles', params.roles.join(','))
  return apiGet<MetricPerAgentResponse>(`/analytics/metric-per-agent?${qs.toString()}`)
}
