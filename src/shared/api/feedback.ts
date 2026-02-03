import { apiGet, apiPost } from '../services/api.service'

export interface Feedback {
  id: string
  channelId: string
  channelName?: string
  caseId?: string
  agentId?: string
  agentName?: string
  rating: number  // 1-5
  comment?: string
  tags?: string[]  // quick feedback tags
  respondedAt?: string
  createdAt: string
}

export interface FeedbackStats {
  averageRating: number
  totalFeedback: number
  ratingDistribution: Record<number, number>  // { 1: 5, 2: 3, 3: 10, ... }
  commonTags: Array<{ tag: string; count: number }>
  byAgent: Array<{
    agentId: string
    agentName: string
    averageRating: number
    feedbackCount: number
  }>
  trend: Array<{
    date: string
    averageRating: number
    count: number
  }>
}

export interface FeedbackResponse {
  feedback: Feedback[]
  total: number
  stats: FeedbackStats
}

/**
 * Получить список отзывов
 */
export async function fetchFeedback(options?: {
  channelId?: string
  caseId?: string
  agentId?: string
  minRating?: number
  maxRating?: number
  from?: string
  to?: string
  limit?: number
  offset?: number
}): Promise<FeedbackResponse> {
  const params = new URLSearchParams()
  if (options?.channelId) params.append('channelId', options.channelId)
  if (options?.caseId) params.append('caseId', options.caseId)
  if (options?.agentId) params.append('agentId', options.agentId)
  if (options?.minRating) params.append('minRating', String(options.minRating))
  if (options?.maxRating) params.append('maxRating', String(options.maxRating))
  if (options?.from) params.append('from', options.from)
  if (options?.to) params.append('to', options.to)
  if (options?.limit) params.append('limit', String(options.limit))
  if (options?.offset) params.append('offset', String(options.offset))
  
  return apiGet(`/feedback?${params}`)
}

/**
 * Получить статистику отзывов
 */
export async function fetchFeedbackStats(options?: {
  agentId?: string
  from?: string
  to?: string
}): Promise<FeedbackStats> {
  const params = new URLSearchParams()
  params.append('stats', 'true')
  if (options?.agentId) params.append('agentId', options.agentId)
  if (options?.from) params.append('from', options.from)
  if (options?.to) params.append('to', options.to)
  
  return apiGet<{ stats: FeedbackStats }>(`/feedback?${params}`).then(r => r.stats)
}

/**
 * Отправить отзыв (обычно от клиента)
 */
export async function submitFeedback(data: {
  channelId: string
  caseId?: string
  agentId?: string
  rating: number
  comment?: string
  tags?: string[]
}): Promise<{ success: boolean; feedback: Feedback }> {
  return apiPost('/feedback', data)
}

/**
 * Запросить отзыв у клиента (отправить сообщение в Telegram)
 */
export async function requestFeedback(
  channelId: string,
  caseId?: string
): Promise<{ success: boolean; messageId?: string }> {
  return apiPost('/feedback', { action: 'request', channelId, caseId })
}
