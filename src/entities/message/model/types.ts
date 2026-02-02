export interface Message {
  id: string
  channelId: string
  telegramMessageId: number
  text: string
  senderName: string
  senderRole: 'client' | 'support' | 'team'
  isFromTeam: boolean
  createdAt: string
  isRead: boolean
  replyToMessageId?: number
  mediaType?: 'photo' | 'video' | 'document' | 'voice' | 'sticker'
  mediaUrl?: string
  reactions?: Record<string, string[]>
  topicId?: number
  topicName?: string
}

export interface MessageGroup {
  date: string
  messages: Message[]
}
