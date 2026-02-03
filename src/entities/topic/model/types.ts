/**
 * Telegram Forum Topic
 * Топики в группах-форумах Telegram
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

// Цвета иконок топиков в Telegram
export const TOPIC_ICON_COLORS = [
  '#6FB9F0', // Light Blue
  '#FFD67E', // Yellow
  '#CB86DB', // Purple
  '#8EEE98', // Green
  '#FF93B2', // Pink
  '#FB6F5F', // Red
] as const

export type TopicIconColor = typeof TOPIC_ICON_COLORS[number]

/**
 * Конфигурация для отображения топика
 */
export function getTopicDisplayConfig(topic: Topic): { 
  icon: string
  color: string
  status: 'open' | 'closed' | 'pinned'
} {
  const status = topic.isClosed ? 'closed' : topic.isPinned ? 'pinned' : 'open'
  
  return {
    icon: topic.isGeneral ? '💬' : topic.isClosed ? '🔒' : topic.isPinned ? '📌' : '💭',
    color: topic.iconColor || TOPIC_ICON_COLORS[0],
    status,
  }
}
