import { apiGet, apiPost, apiPut } from '../services/api.service'

export interface Conversation {
  id: string
  channelId: string
  channelName?: string
  startedAt: string
  endedAt?: string
  status: 'active' | 'waiting' | 'resolved' | 'archived'
  topic?: string
  summary?: string
  messagesCount: number
  participantsCount: number
  participants: Array<{
    id: string
    name: string
    role: 'client' | 'support' | 'bot'
  }>
  firstResponseTime?: number  // в секундах
  resolutionTime?: number     // в секундах
  satisfactionRating?: number
  tags?: string[]
  caseId?: string
  createdAt: string
  updatedAt: string
}

export interface ConversationsResponse {
  conversations: Conversation[]
  total: number
  stats: {
    active: number
    waiting: number
    resolved: number
    avgFirstResponseTime: number
    avgResolutionTime: number
  }
}

/**
 * Получить список разговоров
 */
export async function fetchConversations(options?: {
  channelId?: string
  status?: 'active' | 'waiting' | 'resolved' | 'archived' | 'all'
  agentId?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}): Promise<ConversationsResponse> {
  const params = new URLSearchParams()
  if (options?.channelId) params.append('channelId', options.channelId)
  if (options?.status) params.append('status', options.status)
  if (options?.agentId) params.append('agentId', options.agentId)
  if (options?.from) params.append('from', options.from)
  if (options?.to) params.append('to', options.to)
  if (options?.limit) params.append('limit', String(options.limit))
  if (options?.offset) params.append('offset', String(options.offset))
  
  return apiGet(`/conversations?${params}`)
}

/**
 * Получить конкретный разговор
 */
export async function fetchConversation(id: string): Promise<{ conversation: Conversation }> {
  return apiGet(`/conversations?id=${id}`)
}

/**
 * Начать новый разговор
 */
export async function startConversation(data: {
  channelId: string
  topic?: string
  messageId?: string
}): Promise<{ success: boolean; conversation: Conversation }> {
  return apiPost('/conversations', data)
}

/**
 * Обновить разговор
 */
export async function updateConversation(
  id: string,
  data: Partial<{
    status: 'active' | 'waiting' | 'resolved' | 'archived'
    topic: string
    summary: string
    tags: string[]
    caseId: string
  }>
): Promise<{ success: boolean; conversation: Conversation }> {
  return apiPut(`/conversations?id=${id}`, data)
}

/**
 * Завершить разговор
 */
export async function endConversation(
  id: string,
  summary?: string
): Promise<{ success: boolean }> {
  return apiPut(`/conversations?id=${id}`, { status: 'resolved', summary })
}

/**
 * Объединить разговоры
 */
export async function mergeConversations(
  targetId: string,
  sourceIds: string[]
): Promise<{ success: boolean; conversation: Conversation }> {
  return apiPost('/conversations', { action: 'merge', targetId, sourceIds })
}
