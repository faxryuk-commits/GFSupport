export interface Channel {
  id: string
  telegramChatId: number
  name: string
  type: 'client' | 'partner' | 'internal'
  companyId?: string
  companyName: string
  leadId?: string
  isActive: boolean
  membersCount?: number
  settings?: Record<string, unknown>
  messagesCount: number
  openCasesCount?: number
  unreadCount: number
  lastMessageAt: string | null
  lastMessageText: string | null
  lastMessagePreview?: string | null
  lastSenderName: string | null
  awaitingReply: boolean
  lastClientMessageAt: string | null
  lastTeamMessageAt?: string | null
  photoUrl?: string
  isForum?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface ChannelFilters {
  search: string
  type: 'all' | 'client' | 'partner' | 'internal'
  status: 'all' | 'active' | 'awaiting'
  sortBy: 'lastMessage' | 'unread' | 'name'
}
