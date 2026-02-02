import { apiGet, apiPost } from '../services/api.service'
import type { Message } from '@/entities/message'

interface MessagesResponse {
  messages: Message[]
  hasMore: boolean
  total: number
}

export async function fetchMessages(
  channelId: string, 
  options?: { limit?: number; before?: string }
): Promise<MessagesResponse> {
  const params = new URLSearchParams()
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.before) params.set('before', options.before)
  
  const query = params.toString() ? `?${params}` : ''
  return apiGet<MessagesResponse>(`/messages?channelId=${channelId}${query}`)
}

export async function sendMessage(
  channelId: string, 
  text: string,
  replyToMessageId?: number
): Promise<Message> {
  return apiPost<{ message: Message }>('/messages/send', {
    channelId,
    text,
    replyToMessageId
  }).then(r => r.message)
}

export async function sendMediaMessage(
  channelId: string,
  formData: FormData
): Promise<Message> {
  const token = localStorage.getItem('support_agent_token') || ''
  const res = await fetch('/api/support/messages/send-media', {
    method: 'POST',
    headers: {
      Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
    },
    body: formData
  })
  
  if (!res.ok) {
    throw new Error('Failed to send media')
  }
  
  return res.json().then(r => r.message)
}

export async function markMessageRead(messageId: string): Promise<void> {
  await apiPost('/messages/read', { messageId })
}

export async function reactToMessage(
  messageId: string, 
  emoji: string
): Promise<void> {
  await apiPost('/messages/react', { messageId, emoji })
}
