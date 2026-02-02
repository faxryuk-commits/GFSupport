// Shared types for Support Dashboard Tabs

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

export interface SupportUser {
  id: string
  telegramId: number
  telegramUsername: string | null
  name: string
  photoUrl: string | null
  role: 'employee' | 'partner' | 'client'
  department: string | null
  position: string | null
  notes: string | null
  channels: Array<{ id: string; name: string; addedAt: string }>
  firstSeenAt: string
  lastSeenAt: string
  calculatedMetrics?: {
    totalMessages: number
    channelsActive: number
    avgResponseMinutes: number
  } | null
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

export interface Reminder {
  id: string
  channelId: string
  channelName: string
  messageId?: string
  telegramMessageId?: number
  commitmentText: string
  commitmentType: string
  messageContext?: string
  messageSender?: string
  messageCreatedAt?: string
  isVague: boolean
  deadline: string
  isAutoDeadline: boolean
  escalationLevel: number
  assignedTo: string | null
  assignedName: string | null
  createdBy?: string
  status: string
  urgencyLevel: 'low' | 'medium' | 'high' | 'critical' | 'overdue'
  hoursLeft: number
  minutesLeft: number
  timeLeftFormatted: string
  isOverdue: boolean
  createdAt: string
}

export interface Automation {
  id: string
  name: string
  description: string
  triggerType: string
  actionType: string
  triggerConfig: Record<string, unknown>
  actionConfig: Record<string, unknown>
  isActive: boolean
  priority: number
  executionsCount: number
  createdAt: string
}

export interface TeamMetrics {
  avgFirstResponseMin: number
  avgResolutionMin: number
  totalConversations: number
  resolvedToday: number
  activeNow: number
  satisfactionAvg: number
}

export interface AnalyticsData {
  overview: {
    totalCases: number
    openCases: number
    resolvedCases: number
    avgResolutionHours: number
  }
  patterns: {
    byCategory: Array<{ category: string; count: number }>
    bySentiment: Array<{ sentiment: string; count: number }>
  }
  churnSignals: {
    highRiskCompanies: Array<{
      companyId: string
      companyName: string
      riskScore: number
      mrr: number
      openCases?: number
      recurringCases?: number
    }>
  }
  teamMetrics: {
    byManager: Array<{
      managerName: string
      totalCases: number
      resolvedCases: number
      resolutionRate: number
      avgResolutionMinutes: number
    }>
  }
}

export interface MessagesStats {
  total: number
  unread: number
  problems: number
  channelsWithMessages: number
}

export interface UsersStats {
  total: number
  byRole?: {
    employee?: number
    partner?: number
    client?: number
  }
}

export interface Settings {
  telegram_bot_token: string
  notify_chat_id: string
  ai_model: string
  auto_create_cases: boolean
  auto_transcribe_voice: boolean
  notify_on_problem: boolean
  min_urgency_for_case: number
}

export interface AIPatterns {
  uzbek_keywords?: Record<string, string[]>
  russian_problem_words?: string[]
  categories?: Array<{ id: string; name: string; keywords?: string[] }>
  urgency_rules?: Array<{
    description: string
    mrr_threshold?: number
    hours?: number
    score: number
  }>
  commitment_patterns?: {
    vague?: string[]
    callback?: string[]
    action?: string[]
  }
}

export interface UserMetrics {
  responseTime?: {
    avgMinutes: number
    totalResponses: number
  }
  resolutions?: {
    resolutionRate: number
  }
  messageStats?: {
    channels_active: number
  }
  clientSentiment?: Record<string, number>
}

// KPI Constants
export const KPI = {
  FIRST_RESPONSE_MIN: 5,
  RESOLUTION_L1_MIN: 60,
  RESOLUTION_L2_MIN: 480,
  RESOLUTION_L2_MAX: 2400,
  SLA_TARGET_PERCENT: 99,
  CORE_CATEGORIES: ['orders', 'core', 'critical', 'payment'],
}

// Sentiment colors
export const sentimentColors: Record<string, string> = {
  positive: 'bg-green-100 text-green-700',
  neutral: 'bg-slate-100 text-slate-600',
  negative: 'bg-red-100 text-red-700',
  frustrated: 'bg-orange-100 text-orange-700',
}

// Confirm dialog state
export interface ConfirmDialogState {
  show: boolean
  title: string
  message: string
  danger?: boolean
  onConfirm: () => void
}
