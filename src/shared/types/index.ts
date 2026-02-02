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
}

export interface AgentMetrics {
  messagesHandled: number
  resolvedConversations: number
  avgFirstResponseMin: number
  avgResolutionMin: number
  satisfactionScore: number
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
