import { apiGet } from '../services/api.service'

export type ChurnSeverity = 'high' | 'medium' | 'low'
export type ChurnCategory = 'leaving' | 'competitor' | 'disappointed' | 'refund'

export interface ChurnSignalMatch {
  phrase: string
  severity: ChurnSeverity
  category: ChurnCategory
}

export interface ChurnSignalRow {
  messageId: string
  channelId: string
  createdAt: string
  senderName: string | null
  text: string
  matches: ChurnSignalMatch[]
  maxSeverity: ChurnSeverity
}

export interface ChurnSignalsResponse {
  channelId: string
  period: { from: string; to: string; label: string }
  total: number
  rows: ChurnSignalRow[]
}

export interface FetchChurnSignalsParams {
  channelId: string
  period?: '7d' | '30d' | '90d' | 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month'
  limit?: number
}

export const fetchChurnSignals = (
  params: FetchChurnSignalsParams,
): Promise<ChurnSignalsResponse> => {
  const qs = new URLSearchParams()
  qs.set('channelId', params.channelId)
  if (params.period) qs.set('period', params.period)
  if (params.limit) qs.set('limit', String(params.limit))
  return apiGet<ChurnSignalsResponse>(`/analytics/churn-signals?${qs.toString()}`)
}
