import { apiGet } from '../services/api.service'

export type ReplySentiment = 'positive' | 'neutral' | 'negative' | 'frustrated' | null

export interface BroadcastResponseRecipient {
  channelId: string
  channelName: string | null
  status: string
  deliveredAt: string | null
  replied: boolean
  firstReplyAt: string | null
  firstReplyText: string | null
  firstReplySentiment: ReplySentiment
  replyCount: number
  /** Минут от delivered_at до первого ответа клиента. */
  replyMinutesAfter: number | null
}

export interface BroadcastResponsesSummary {
  total: number
  delivered: number
  responded: number
  responseRate: number
  sentimentBreakdown: {
    positive: number
    neutral: number
    negative: number
    frustrated: number
    unscored: number
  }
  windowHours: number
}

export interface BroadcastResponsesResponse {
  campaign: {
    id: string
    messageText: string
    scheduledAt: string
    status: string
  }
  summary: BroadcastResponsesSummary
  recipients: BroadcastResponseRecipient[]
}

export const fetchBroadcastResponses = (
  broadcastId: string,
  windowHours = 168,
): Promise<BroadcastResponsesResponse> =>
  apiGet<BroadcastResponsesResponse>(
    `/broadcast/responses?id=${encodeURIComponent(broadcastId)}&window_hours=${windowHours}`,
    false,
  )
