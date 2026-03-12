import { apiGet, apiPost, apiPut } from '../services/api.service'

export interface AgentDecisionItem {
  id: string
  channelId: string
  channelName: string
  source: string
  incomingMessage: string
  senderName: string
  action: string
  replyText?: string
  tagAgentId?: string
  tagAgentName?: string
  escalateToRole?: string
  casePriority?: string
  caseTitle?: string
  reasoning: string
  confidence: number
  contextMessagesCount: number
  similarHistoryCount: number
  feedback?: 'correct' | 'wrong' | null
  feedbackNote?: string
  executedActions?: string[]
  createdAt: string
}

export interface AgentStats {
  total: number
  replies: number
  tags: number
  escalations: number
  cases_created: number
  waits: number
  correct: number
  wrong: number
  avg_confidence: number
}

export interface AgentSettings {
  enabled: boolean
  mode: 'autonomous' | 'assist' | 'night_only'
  autoReply: boolean
  minConfidence: number
  workStart: number
  workEnd: number
  timezone: string
  excludeChannels: string[]
  model: string
  hasApiKey: boolean
}

export function fetchAgentDecisions(limit = 30, channelId?: string) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (channelId) params.set('channelId', channelId)
  return apiGet<{ decisions: AgentDecisionItem[]; stats: AgentStats }>(`/api/support/ai/agent?${params}`)
}

export function submitAgentFeedback(decisionId: string, feedback: 'correct' | 'wrong', note?: string) {
  return apiPost('/api/support/ai/agent', { action: 'feedback', decisionId, feedback, note })
}

export function testAgentDecision(channelId: string, message: string, channelName?: string) {
  return apiPost('/api/support/ai/agent', {
    action: 'test', channelId, channelName, message, senderName: 'Тестовый клиент',
  })
}

export function fetchAgentSettings() {
  return apiGet<AgentSettings>('/api/support/ai/agent-settings')
}

export function updateAgentSettings(settings: Partial<AgentSettings> & { togetherApiKey?: string }) {
  return apiPut('/api/support/ai/agent-settings', settings)
}
