import { apiGet } from '../services/api.service'

export interface ProblemTheme {
  theme: string | null
  count: number
  sampleText: string | null
}
export interface ProblemIntent {
  intent: string | null
  count: number
}
export interface ProblemStatusItem {
  status: string | null
  count: number
}
export interface ProblemSentimentItem {
  sentiment: string | null
  count: number
}
export interface ProblemChannel {
  channelId: string
  channelName: string | null
  source: string | null
  count: number
}
export interface ProblemMessage {
  messageId: string
  channelId: string
  channelName: string | null
  source: string | null
  text: string
  theme: string | null
  intent: string | null
  sentiment: string | null
  isProblem: boolean | null
  caseStatus: string | null
  createdAt: string
}

export interface ProblemDrillResponse {
  domain: string
  subcategory: string | null
  period: { days: number; from: string }
  source: string
  topThemes: ProblemTheme[]
  topIntents: ProblemIntent[]
  byStatus: ProblemStatusItem[]
  bySentiment: ProblemSentimentItem[]
  topChannels: ProblemChannel[]
  recentMessages: ProblemMessage[]
}

export interface FetchProblemDrillParams {
  domain: string
  subcategory?: string | null
  period?: '7d' | '30d' | '90d'
  source?: string | null
}

export const fetchProblemDrill = (
  params: FetchProblemDrillParams,
): Promise<ProblemDrillResponse> => {
  const qs = new URLSearchParams()
  qs.set('domain', params.domain)
  if (params.subcategory) qs.set('subcategory', params.subcategory)
  if (params.period) qs.set('period', params.period)
  if (params.source) qs.set('source', params.source)
  return apiGet<ProblemDrillResponse>(`/analytics/problem-drill?${qs.toString()}`)
}
