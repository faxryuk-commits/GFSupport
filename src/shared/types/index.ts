// ============ ENTITY TYPES (shared layer — used by api, hooks, entities) ============

export type AgentRole = 'admin' | 'manager' | 'agent'
export type AgentStatus = 'online' | 'away' | 'offline'

export interface Agent {
  id: string
  name: string
  email?: string
  username?: string
  telegramId?: number
  role: AgentRole
  status?: AgentStatus
  avatarUrl?: string
  isActive?: boolean
  lastActiveAt?: string
  lastSeenAt?: string
  createdAt?: string
  assignedChannels?: number
  activeChats?: number
  metrics?: AgentMetrics
  points?: number
  phone?: string
  position?: string
  department?: string
}

export interface AgentMetrics {
  messagesHandled: number
  resolvedConversations: number
  avgFirstResponseMin: number
  avgResolutionMin: number
  satisfactionScore: number
}

export type CaseStatus = 'detected' | 'in_progress' | 'waiting' | 'blocked' | 'resolved' | 'closed' | 'cancelled' | 'recurring'
export type CasePriority = 'low' | 'medium' | 'high' | 'urgent' | 'critical'

export interface Case {
  id: string
  ticketNumber?: number
  channelId: string
  channelName?: string
  telegramChatId?: number
  companyId?: string
  companyName: string
  leadId?: string
  title: string
  description: string
  status: CaseStatus
  category: string
  subcategory?: string
  rootCause?: string
  priority: CasePriority
  severity?: string
  assignedTo?: string
  assigneeName?: string
  reporterName?: string
  firstResponseAt?: string
  resolvedAt?: string | null
  resolutionTimeMinutes?: number
  resolutionNotes?: string
  impactMrr?: number
  churnRiskScore?: number
  isRecurring?: boolean
  relatedCaseId?: string
  tags?: string[]
  messagesCount: number
  messageId?: string
  createdAt: string
  updatedAt?: string
  updatedBy?: string
  updatedByName?: string
  sourceMessageId?: string
}

export interface Channel {
  id: string
  telegramChatId: number
  name: string
  type: 'client' | 'partner' | 'internal'
  source?: 'telegram' | 'whatsapp'
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
  mediaType?: 'photo' | 'video' | 'document' | 'voice' | 'sticker' | 'video_note' | 'audio' | 'animation'
  thumbnailUrl?: string
  fileName?: string
  fileSize?: number
  mimeType?: string
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
  forwardedFrom?: string
  createdAt: string
}

export interface MessageGroup {
  date: string
  messages: Message[]
}

// ============ CORE ENTITIES ============

export interface SupportCase {
  id: string
  ticketNumber?: number
  channelId: string
  channelName: string
  companyId: string
  companyName: string
  title: string
  description: string
  status: 'detected' | 'in_progress' | 'waiting' | 'blocked' | 'resolved'
  category: string
  priority: 'low' | 'medium' | 'high' | 'critical'
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

export interface SupportChannel {
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

export interface SupportMessage {
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
  mediaType?: string
  mediaUrl?: string
  reactions?: Record<string, string[]>
  topicId?: number
  topicName?: string
}

export interface SupportAgent {
  id: string
  name: string
  email: string
  username?: string
  role: 'admin' | 'manager' | 'agent'
  isActive: boolean
  lastActiveAt?: string
  metrics?: AgentMetrics
  points?: number
  phone?: string
  position?: string
  department?: string
  orgId?: string
}

export interface SupportUser {
  id: string
  telegramId: number
  name: string
  username?: string
  role: 'employee' | 'partner' | 'client'
  channelIds: string[]
  channelNames: string[]
  department?: string
  position?: string
  messagesCount: number
  lastMessageAt: string | null
  notes?: string
}

export interface Conversation {
  id: string
  channelId: string
  channelName: string
  status: 'open' | 'resolved'
  messagesCount: number
  lastMessageAt: string
}

export interface Reminder {
  id: string
  channelId: string
  channelName: string
  messageId: string
  messageText: string
  assignedTo: string | null
  assignedToName: string | null
  dueAt: string
  status: 'active' | 'completed' | 'escalated'
  isOverdue: boolean
  isVague: boolean
  createdAt: string
}

// ============ ANALYTICS ============

export interface AnalyticsData {
  cases: {
    total: number
    open: number
    resolved: number
    avgResolutionTime: number
    urgent: number
    recurring: number
  }
  messages: {
    total: number
    problems: number
    voice: number
  }
  channels: {
    total: number
    active: number
    avgFirstResponse: number
  }
  patterns?: {
    byCategory: Record<string, number>
    bySentiment: Record<string, number>
    byIntent: Record<string, number>
    recurringProblems: Array<{ issue: string; count: number }>
  }
  team?: {
    byManager: Array<{ name: string; resolved: number; avgTime: number }>
    dailyTrend: Array<{ date: string; cases: number; messages: number }>
  }
}

// ============ SETTINGS ============

export interface SupportSettings {
  botToken: string
  autoCreateCases: boolean
  aiModel: string
  notifyOnNewMessage: boolean
}

export interface Automation {
  id: string
  name: string
  trigger: string
  action: string
  isActive: boolean
  priority: number
  createdAt: string
}

// ============ UI STATE ============

export interface ConfirmDialog {
  show: boolean
  title: string
  message: string
  danger: boolean
  onConfirm: () => void
}

export interface Notification {
  id: string
  type: 'message' | 'case' | 'reminder'
  title: string
  body: string
  urgency: 'low' | 'medium' | 'high' | 'critical'
  channelId?: string
  createdAt: Date
}

// ============ AI ============

export interface AIContext {
  summary: string
  currentStatus: string
  mainIssues: string[]
  pendingActions: string[]
  suggestedResponse: string
  sentiment: string
  urgencyLevel: string
  commitments: string[]
  keyTopics: string[]
  clientWaitingTime: string
  recentSuggestions: string[]
  similarSolutions: Array<{ issue: string; solution: string }>
}

export interface AIPatterns {
  uzbekKeywords: string[]
  categories: string[]
  intents: string[]
}
