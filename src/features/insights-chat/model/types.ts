export type InsightsRole = 'user' | 'assistant' | 'tool' | 'system'

export interface InsightsToolCall {
  id: string
  name: string
  args: unknown
  result: unknown
  durationMs: number
}

export interface InsightsMessage {
  id: string
  role: InsightsRole
  content: string
  toolName?: string
  toolArgs?: unknown
  toolResult?: unknown
  toolCalls?: InsightsToolCall[]
  createdAt?: string
  pending?: boolean
  error?: boolean
}

export interface InsightsSession {
  id: string
  title: string
  periodDefault?: string
  sourceDefault?: string
  archived?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface SendChatRequest {
  sessionId?: string
  message: string
  period?: string
  source?: 'all' | 'telegram' | 'whatsapp'
  includePII?: boolean
}

export interface SendChatResponse {
  sessionId: string
  isNewSession: boolean
  assistantMessage: InsightsMessage
}
