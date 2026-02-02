// Shared types for Mobile Support App

export interface SupportChannel {
  id: string
  telegramChatId: number
  name: string
  type: string
  companyName: string
  isActive: boolean
  messagesCount: number
  openCasesCount: number
  unreadCount: number
  awaitingReply: boolean
  lastSenderName: string | null
  lastMessagePreview: string | null
  lastClientMessageAt: string | null
  lastTeamMessageAt: string | null
  lastMessageAt: string
  isForum: boolean
  createdAt: string
  updatedAt: string
  photoUrl?: string | null
}

export interface SupportMessage {
  id: string
  channelId: string
  channelName: string
  caseId: string | null
  senderName: string
  senderUsername: string | null
  senderRole: 'client' | 'support' | 'team'
  isFromClient: boolean
  contentType: string
  textContent: string | null
  transcript: string | null
  mediaUrl?: string | null
  aiSummary: string | null
  aiCategory: string | null
  aiSentiment: string | null
  aiIntent: string | null
  aiUrgency: number
  aiImageAnalysis?: string | null
  aiSuggestion?: string | null
  isProblem: boolean
  isRead: boolean
  createdAt: string
}

export interface SupportCase {
  id: string
  ticketNumber?: number
  channelId: string
  channelName: string
  companyId: string
  companyName: string
  title: string
  description: string
  status: string
  category: string
  priority: string
  severity: string
  assignedTo: string
  assigneeName: string
  messagesCount: number
  createdAt: string
  updatedAt?: string
  updatedBy?: string
  updatedByName?: string
  resolvedAt: string | null
  sourceMessageId?: string
}

export interface SupportAgent {
  id: string
  name: string
  username: string | null
  email: string | null
  telegramId: string | null
  role: 'agent' | 'senior' | 'lead' | 'manager'
  status: 'online' | 'away' | 'offline'
  avatarUrl?: string | null
  assignedChannels: number
  activeChats: number
  metrics: AgentMetrics
  lastSeenAt?: string
  phone?: string
  position?: string
  department?: string
}

export interface AgentMetrics {
  totalConversations: number
  resolvedConversations: number
  avgFirstResponseMin: number
  avgResolutionMin: number
  satisfactionScore: number
  messagesHandled: number
  escalations: number
}

export interface AnalyticsData {
  totalChannels: number
  activeChannels: number
  totalMessages: number
  todayMessages: number
  openCases: number
  resolvedCases: number
  avgResponseTime: number
  slaCompliance: number
}

export interface Reminder {
  id: string
  channelId: string
  channelName: string
  messageId?: string
  telegramMessageId?: number
  commitmentText: string
  commitmentType: string
  deadline: string
  status: string
  urgencyLevel: 'low' | 'medium' | 'high' | 'critical' | 'overdue'
  isOverdue: boolean
  createdAt: string
}

// Tab types
export type MobileTab = 'messages' | 'cases' | 'analytics'

// Navigation state
export interface NavigationState {
  tab: MobileTab
  channelId?: string
  caseId?: string
  messageId?: string
}
