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
  replyToMessageId?: number,
  senderName?: string
): Promise<Message> {
  // Получаем имя агента из localStorage если не передано
  const agentData = localStorage.getItem('support_agent_data')
  const agent = agentData ? JSON.parse(agentData) : null
  const name = senderName || agent?.name || 'Support'
  
  const response = await apiPost<SendMessageResponse>('/messages/send', {
    channelId,
    text,
    replyToMessageId,
    senderName: name
  })
  
  // Преобразуем ответ API в формат Message
  return {
    id: response.messageId,
    channelId,
    telegramMessageId: response.telegramMessageId,
    senderName: name,
    senderRole: 'support',
    isFromTeam: true,
    text,
    isRead: true,
    createdAt: response.sentAt,
  }
}

interface SendMediaResponse {
  success: boolean
  messageId: string
  telegramMessageId: number
  mediaUrl: string | null
}

export async function sendMediaMessage(
  channelId: string,
  file: File,
  caption?: string,
  senderName?: string
): Promise<Message> {
  const token = localStorage.getItem('support_agent_token') || ''
  const agentData = localStorage.getItem('support_agent_data')
  const agent = agentData ? JSON.parse(agentData) : null
  const name = senderName || agent?.name || 'Support'
  
  const formData = new FormData()
  formData.append('file', file)
  formData.append('channelId', channelId)
  formData.append('caption', caption || '')
  formData.append('senderName', name)
  
  const res = await fetch('/api/support/messages/send-media', {
    method: 'POST',
    headers: {
      Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
    },
    body: formData
  })
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to send media' }))
    throw new Error(error.error || 'Failed to send media')
  }
  
  const response: SendMediaResponse = await res.json()
  
  // Определяем тип контента
  const contentType = file.type.startsWith('image/') ? 'photo' 
    : file.type.startsWith('video/') ? 'video'
    : file.type.startsWith('audio/') ? 'voice'
    : 'document'
  
  return {
    id: response.messageId,
    channelId,
    telegramMessageId: response.telegramMessageId,
    senderName: name,
    senderRole: 'support',
    isFromTeam: true,
    text: caption || '',
    contentType,
    mediaUrl: response.mediaUrl || undefined,
    isRead: true,
    createdAt: new Date().toISOString(),
  }
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
