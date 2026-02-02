import { apiGet, apiPost } from '../services/api.service'
import type { Message } from '@/entities/message'

interface MessagesResponse {
  messages: Message[]
  hasMore: boolean
  total: number
}

export async function fetchMessages(
  channelId: string, 
  offset = 0,
  limit = 100
): Promise<MessagesResponse> {
  const params = new URLSearchParams({
    channelId,
    offset: String(offset),
    limit: String(limit),
  })
  
  return apiGet<MessagesResponse>(`/messages?${params}`)
}

interface SendMessageResponse {
  success: boolean
  messageId: string
  telegramMessageId: number
  sentAt: string
}

export async function sendMessage(
  channelId: string, 
  text: string,
  replyToMessageId?: number
): Promise<Message> {
  const response = await apiPost<SendMessageResponse>('/messages/send', {
    channelId,
    text,
    replyToMessageId
  })
  
  // Преобразуем ответ API в формат Message
  return {
    id: response.messageId,
    channelId,
    telegramMessageId: response.telegramMessageId,
    senderName: 'Вы',
    senderRole: 'support',
    isFromTeam: true,
    text,
    isRead: true,
    createdAt: response.sentAt,
  }
}

export async function sendMediaMessage(
  _channelId: string,
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
