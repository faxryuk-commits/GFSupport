export interface Channel {
  id: string
  telegramChatId: number
  name: string
  type: 'client' | 'partner' | 'internal'
  companyName: string
  isActive: boolean
  messagesCount: number
  unreadCount: number
  lastMessageAt: string | null
  lastMessageText: string | null
  lastSenderName: string | null
  awaitingReply: boolean
  lastClientMessageAt: string | null
  photoUrl?: string
  isForum?: boolean
}

export interface ChannelFilters {
  search: string
  type: 'all' | 'client' | 'partner' | 'internal'
  status: 'all' | 'active' | 'awaiting'
  sortBy: 'lastMessage' | 'unread' | 'name'
}
