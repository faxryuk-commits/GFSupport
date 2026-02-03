import { apiGet, apiPost, apiPut, apiDelete } from '../services/api.service'

/**
 * Telegram Topics API для форумов
 * Позволяет управлять топиками внутри групп-форумов
 */

export interface Topic {
  id: string
  channelId: string
  telegramTopicId: number
  name: string
  iconColor?: string
  iconCustomEmojiId?: string
  isClosed: boolean
  isGeneral: boolean
  isPinned: boolean
  messagesCount: number
  lastMessageAt?: string
  createdAt: string
}

export interface TopicsResponse {
  topics: Topic[]
  total: number
  channelId: string
  isForumEnabled: boolean
}

/**
 * Получить список топиков канала
 */
export async function fetchTopics(channelId: string): Promise<TopicsResponse> {
  return apiGet(`/topics?channelId=${channelId}`)
}

/**
 * Создать топик в форуме
 */
export async function createTopic(data: {
  channelId: string
  name: string
  iconColor?: string
  iconCustomEmojiId?: string
}): Promise<{ success: boolean; topic: Topic }> {
  return apiPost('/topics', data)
}

/**
 * Обновить топик
 */
export async function updateTopic(
  topicId: string,
  data: Partial<{
    name: string
    iconCustomEmojiId: string
  }>
): Promise<{ success: boolean; topic: Topic }> {
  return apiPut(`/topics?id=${topicId}`, data)
}

/**
 * Закрыть/открыть топик
 */
export async function toggleTopicClosed(
  topicId: string,
  isClosed: boolean
): Promise<{ success: boolean }> {
  return apiPut(`/topics?id=${topicId}`, { isClosed })
}

/**
 * Закрепить/открепить топик
 */
export async function toggleTopicPinned(
  topicId: string,
  isPinned: boolean
): Promise<{ success: boolean }> {
  return apiPut(`/topics?id=${topicId}`, { isPinned })
}

/**
 * Удалить топик
 */
export async function deleteTopic(topicId: string): Promise<{ success: boolean }> {
  return apiDelete(`/topics?id=${topicId}`)
}

/**
 * Отправить сообщение в конкретный топик
 */
export async function sendMessageToTopic(
  channelId: string,
  topicId: number,
  text: string
): Promise<{ success: boolean; messageId: string }> {
  return apiPost('/messages/send', { 
    channelId, 
    text,
    messageThreadId: topicId 
  })
}

/**
 * Проверить, является ли канал форумом
 */
export async function checkForumEnabled(channelId: string): Promise<{ 
  isForumEnabled: boolean 
  topicsCount?: number 
}> {
  return apiGet(`/topics?channelId=${channelId}&check=true`)
}
