import { apiGet, apiPost, apiPut, apiDelete } from '../services/api.service'

export interface BenchmarkMetric {
  key: string
  labelRu: string
  unit: 'minutes' | 'hours' | 'seconds' | 'percent' | 'ratio' | 'count' | 'currency'
  direction: 'higher_better' | 'lower_better'
  level: 'outcome' | 'driver' | 'indicator' | 'activity'
  formulaRu: string
  perAgent: boolean
}

export interface BenchmarkRow {
  id: string
  metricKey: string
  scope: {
    role: string | null
    market: string | null
    source: string | null
  }
  periodType: 'daily' | 'weekly' | 'monthly'
  tier: 'bronze' | 'silver' | 'gold'
  value: number
  sourceType: 'percentile_internal' | 'manual' | 'industry_default'
  sampleSize: number | null
  computedAt: string | null
  setBy: string | null
  setAt: string | null
  notes: string | null
}

export interface BenchmarksListResponse {
  metrics: BenchmarkMetric[]
  benchmarks: BenchmarkRow[]
}

export interface RecomputeSummaryItem {
  metric: string
  scope: string
  observations: number
  reason: string
  bronze?: number
  silver?: number
  gold?: number
}

export interface RecomputeResponse {
  period: { from: string; to: string; days: number; type: string }
  summary: RecomputeSummaryItem[]
}

export interface UpsertBenchmarkInput {
  metric_key: string
  tier: 'bronze' | 'silver' | 'gold'
  target_value: number
  scope_role?: string | null
  scope_market?: string | null
  scope_source?: string | null
  period_type?: 'daily' | 'weekly' | 'monthly'
  notes?: string | null
}

export const fetchBenchmarks = () =>
  apiGet<BenchmarksListResponse>('/analytics/benchmarks', false)

export const recomputeBenchmarks = (metric: string = 'all', days: number = 60) =>
  apiPost<RecomputeResponse>(
    `/analytics/benchmarks-recompute?metric=${encodeURIComponent(metric)}&days=${days}`,
    {},
  )

export const upsertBenchmark = (input: UpsertBenchmarkInput) =>
  apiPut<{ ok: boolean; id: string }>('/analytics/benchmarks', input)

export const deleteBenchmark = (id: string) =>
  apiDelete<{ ok: boolean; deleted: string }>(
    `/analytics/benchmarks?id=${encodeURIComponent(id)}`,
  )
