import { apiGet } from '../services/api.service'

export type HealthPeriod = '7d' | '30d' | '90d'

export interface HealthTopCategory {
  category: string
  cases: number
  prevCases: number
  delta: number
  deltaPct: number | null
}

export interface HealthRootCause {
  rootCause: string
  cases: number
  impactMrr: number
}

export interface HealthRecurring {
  category: string
  cases: number
  channelsCount: number
}

export interface HealthHotChannel {
  channelId: string
  channelName: string
  totalCases: number
  openCases: number
  avgAgeHours: number
}

export interface HealthStuckCase {
  id: string
  ticketNumber?: number
  title: string
  status: string
  priority: string
  channelId?: string
  channelName?: string
  assigneeName?: string
  hoursInStatus: number
}

export interface HealthStats {
  totalCreated: number
  totalResolved: number
  avgResolutionHours: number | null
  openNow: number
  unassignedNow: number
  prevTotalCreated: number
  createdDelta: number
}

export interface HealthAiTopic {
  topic: string
  messages: number
  prevMessages: number
  delta: number
  deltaPct: number | null
}

export interface HealthIntent {
  intent: string
  messages: number
  channels: number
  negative: number
  urgent: number
}

export interface HealthContentType {
  contentType: string
  messages: number
  share: number
}

export interface HealthLanguage {
  language: string
  messages: number
  share: number
}

export interface HealthSentiment {
  negative: number
  neutral: number
  positive: number
  total: number
}

export interface HealthBottomAgent {
  agentId: string
  agentName: string
  avatarUrl: string | null
  assigned: number
  resolved: number
  openNow: number
  stuck: number
  resolvedPct: number
  avgResolutionHours: number | null
  avgFirstResponseMin: number | null
}

export interface SupportHealthPayload {
  period: { from: string; to: string; days: number; prevFrom: string }
  topCategories: HealthTopCategory[]
  topRootCauses: HealthRootCause[]
  recurring: HealthRecurring[]
  hotChannels: HealthHotChannel[]
  stuckCases: HealthStuckCase[]
  stats: HealthStats
  topAiTopics: HealthAiTopic[]
  topIntents: HealthIntent[]
  contentMix: HealthContentType[]
  byLanguage: HealthLanguage[]
  sentiment: HealthSentiment
  bottomAgents: HealthBottomAgent[]
}

export async function fetchSupportHealth(params?: {
  period?: HealthPeriod
  market?: string
}): Promise<SupportHealthPayload> {
  const q = new URLSearchParams()
  q.set('period', params?.period || '7d')
  if (params?.market) q.set('market', params.market)
  return apiGet<SupportHealthPayload>(`/analytics/support-health?${q.toString()}`)
}

export type HealthDrillKind = 'topic' | 'intent' | 'content_type' | 'language'

export interface HealthDrillItem {
  id: string
  channelId: string
  channelName: string
  senderName: string
  contentType: string
  text: string
  transcript: string
  transcriptLanguage: string | null
  aiSummary: string | null
  aiCategory: string | null
  aiIntent: string | null
  aiSentiment: string | null
  aiUrgency: number
  createdAt: string
}

export interface HealthDrillChannel {
  id: string
  name: string
  count: number
}

export interface HealthDrillPayload {
  kind: HealthDrillKind
  value: string
  period: HealthPeriod
  items: HealthDrillItem[]
  channels: HealthDrillChannel[]
  total: number
}

export async function fetchHealthDrilldown(params: {
  kind: HealthDrillKind
  value: string
  period?: HealthPeriod
  market?: string
  limit?: number
}): Promise<HealthDrillPayload> {
  const q = new URLSearchParams()
  q.set('kind', params.kind)
  q.set('value', params.value)
  q.set('period', params.period || '7d')
  if (params.market) q.set('market', params.market)
  if (params.limit) q.set('limit', String(params.limit))
  return apiGet<HealthDrillPayload>(`/analytics/health-drilldown?${q.toString()}`)
}
