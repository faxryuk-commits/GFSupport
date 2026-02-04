export interface Message {
  id: string
  channelId: string
  channelName?: string
  caseId?: string
  telegramMessageId: number
  senderId?: number
  senderName: string
  senderUsername?: string
  senderPhotoUrl?: string | null
  senderRole: 'client' | 'support' | 'team'
  isFromClient?: boolean
  isFromTeam: boolean
  contentType?: string
  text: string
  textContent?: string
  mediaUrl?: string
  mediaType?: 'photo' | 'video' | 'document' | 'voice' | 'sticker' | 'video_note' | 'audio'
  transcript?: string
  aiSummary?: string
  aiCategory?: string
  aiSentiment?: string
  aiIntent?: string
  aiUrgency?: number
  aiEntities?: Record<string, unknown>
  isProblem?: boolean
  isRead: boolean
  readAt?: string
  replyToMessageId?: number
  replyToText?: string
  replyToSender?: string
  threadId?: number
  threadName?: string
  topicId?: number
  topicName?: string
  reactions?: Record<string, string[]>
  createdAt: string
}

export interface MessageGroup {
  date: string
  messages: Message[]
}
