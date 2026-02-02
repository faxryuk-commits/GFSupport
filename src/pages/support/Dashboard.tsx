import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom'
import { 
  MessageSquare, Users, AlertCircle, CheckCircle, Clock, 
  Search, RefreshCw, Plus, ChevronRight, ChevronLeft, Headphones,
  TrendingUp, AlertTriangle, Zap, Activity, BarChart3, Home,
  Settings, Save, TestTube, Bot, Key, Bell, Shield, X, Building,
  Edit2, Trash2, LogOut, UserCheck, Award, Timer, Briefcase, Filter, UserCog,
  Volume2, VolumeX, Camera, BookOpen, FileText, ExternalLink, Megaphone, Calendar, Radio, Send, User,
  Sparkles, Copy, Brain, Eye, MailWarning, Pin, History, Hash, Book, Link2
} from 'lucide-react'
import { Logo } from '@/components/Logo'
import { UsersTab, SettingsTab } from './tabs'
import { ProfileModal } from './modals'

// KPI нормативы для Support
const KPI = {
  FIRST_RESPONSE_MIN: 5,        // Время первого ответа: 5 минут
  RESOLUTION_L1_MIN: 60,        // L1 решение: 1 час
  RESOLUTION_L2_MIN: 480,       // L2 решение минимум: 8 часов
  RESOLUTION_L2_MAX: 2400,      // L2 решение максимум: 40 часов
  SLA_TARGET_PERCENT: 99,       // Целевой SLA: 99%
  // Приоритеты по категориям
  CORE_CATEGORIES: ['orders', 'core', 'critical', 'payment'], // Проблемы с приёмом заказов - макс приоритет
}

// Геймификация - система очков
const GAMIFICATION = {
  POINTS: {
    MESSAGE_SENT: 1,           // Отправка сообщения
    FAST_RESPONSE: 5,          // Быстрый ответ (< 5 мин)
    CASE_RESOLVED: 10,         // Решённый кейс
    SLA_MET: 5,                // Решено в рамках SLA
    CLIENT_THANKS: 20,         // Благодарность от клиента
    FIRST_OF_DAY: 3,           // Первый ответ дня
  },
  LEVELS: [
    { name: 'Новичок', icon: '🌱', minPoints: 0 },
    { name: 'Стажёр', icon: '📚', minPoints: 100 },
    { name: 'Агент', icon: '🎯', minPoints: 500 },
    { name: 'Старший', icon: '⭐', minPoints: 2000 },
    { name: 'Эксперт', icon: '🏆', minPoints: 5000 },
    { name: 'Мастер', icon: '👑', minPoints: 10000 },
  ],
  ACHIEVEMENTS: [
    { id: 'speedster', name: 'Скорострел', icon: '⚡', desc: '10 ответов за час', condition: 'fast_responses >= 10' },
    { id: 'solver', name: 'Решала', icon: '🔧', desc: '5 кейсов за день', condition: 'daily_cases >= 5' },
    { id: 'streak', name: 'Серия', icon: '🔥', desc: '7 дней без пропусков', condition: 'streak >= 7' },
    { id: 'sla_master', name: 'Мастер SLA', icon: '✅', desc: '100% SLA за неделю', condition: 'weekly_sla == 100' },
    { id: 'night_owl', name: 'Сова', icon: '🦉', desc: 'Ответ после 22:00', condition: 'night_response' },
    { id: 'early_bird', name: 'Ранняя пташка', icon: '🐦', desc: 'Ответ до 8:00', condition: 'early_response' },
  ]
}

// Функция расчёта уровня по очкам
function getAgentLevel(points: number) {
  const levels = GAMIFICATION.LEVELS
  for (let i = levels.length - 1; i >= 0; i--) {
    if (points >= levels[i].minPoints) {
      const nextLevel = levels[i + 1]
      const progress = nextLevel 
        ? Math.round(((points - levels[i].minPoints) / (nextLevel.minPoints - levels[i].minPoints)) * 100)
        : 100
      return { ...levels[i], index: i, progress, nextLevel }
    }
  }
  return { ...levels[0], index: 0, progress: 0, nextLevel: levels[1] }
}

// Расчёт эффективности на основе реального объёма работы
interface EfficiencyData {
  score: number           // Итоговый score 0-150+
  positivePoints: number  // Баллы за работу
  negativePoints: number  // Штрафы
  details: {
    messagesHandled: number
    casesResolved: number
    fastResponses: number
    overdueReminders: number
    openOverdueCases: number
  }
  label: string
  color: string
}

function calculateEfficiencyScore(
  agent: { id: string; metrics?: { messagesHandled?: number; resolvedConversations?: number; avgFirstResponseMin?: number } },
  cases: Array<{ assignedTo: string; status: string; createdAt: string; priority?: string }>,
  reminders: Array<{ assignedTo: string | null; status: string; isOverdue: boolean }>
): EfficiencyData {
  const WEIGHTS = {
    MESSAGE: 1,           // +1 за сообщение
    CASE_RESOLVED: 10,    // +10 за закрытый кейс
    FAST_RESPONSE: 3,     // +3 за быстрый ответ (<5 мин)
    OVERDUE_REMINDER: -10,// -10 за просроченное обещание
    OVERDUE_CASE: -5,     // -5 за просроченный кейс
  }
  
  // Норма за смену (8 часов)
  const DAILY_NORM = 80 // ~50 сообщений + 3 кейса × 10 = 80 баллов
  
  const messagesHandled = agent.metrics?.messagesHandled || 0
  const casesResolved = agent.metrics?.resolvedConversations || 0
  const avgResponse = agent.metrics?.avgFirstResponseMin || 999
  const fastResponses = avgResponse <= 5 ? Math.floor(messagesHandled * 0.5) : 0 // Примерно 50% быстрых ответов если средняя < 5мин
  
  // Просроченные обещания этого агента
  const overdueReminders = reminders.filter(r => 
    r.assignedTo === agent.id && r.status !== 'completed' && r.isOverdue
  ).length
  
  // Открытые просроченные кейсы (более 24 часов)
  const now = Date.now()
  const openOverdueCases = cases.filter(c => 
    c.assignedTo === agent.id && 
    c.status === 'open' && 
    (now - new Date(c.createdAt).getTime()) > 24 * 60 * 60 * 1000
  ).length
  
  // Подсчёт баллов
  const positivePoints = 
    messagesHandled * WEIGHTS.MESSAGE +
    casesResolved * WEIGHTS.CASE_RESOLVED +
    fastResponses * WEIGHTS.FAST_RESPONSE
  
  const negativePoints = 
    overdueReminders * Math.abs(WEIGHTS.OVERDUE_REMINDER) +
    openOverdueCases * Math.abs(WEIGHTS.OVERDUE_CASE)
  
  // Итоговый score
  const rawScore = positivePoints - negativePoints
  const score = Math.max(0, Math.round((rawScore / DAILY_NORM) * 100))
  
  // Определение метки и цвета
  let label: string
  let color: string
  if (score >= 100) {
    label = 'Отлично'
    color = 'text-green-600'
  } else if (score >= 70) {
    label = 'В норме'
    color = 'text-blue-600'
  } else if (score >= 40) {
    label = 'Ниже'
    color = 'text-yellow-600'
  } else if (score > 0) {
    label = 'Низкая'
    color = 'text-red-600'
  } else {
    label = '-'
    color = 'text-slate-400'
  }
  
  return {
    score,
    positivePoints,
    negativePoints,
    details: {
      messagesHandled,
      casesResolved,
      fastResponses,
      overdueReminders,
      openOverdueCases,
    },
    label,
    color,
  }
}

interface SupportCase {
  id: string
  ticketNumber?: number // #001, #002, etc.
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
  updatedAt?: string // Время последнего изменения
  updatedBy?: string // ID изменившего
  updatedByName?: string // Имя изменившего
  resolvedAt: string | null
  sourceMessageId?: string // Link to original message
}

interface SupportChannel {
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
  photoUrl?: string | null // Telegram group photo
}

interface SupportMessage {
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

// Support agent/employee profile
interface SupportAgent {
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
  lastSeenAt?: string // Последний раз онлайн
  phone?: string
  position?: string
  department?: string
}

// Agent performance metrics
interface AgentMetrics {
  totalConversations: number
  resolvedConversations: number
  avgFirstResponseMin: number
  avgResolutionMin: number
  satisfactionScore: number
  messagesHandled: number
  escalations: number
}

// Support user (from telegram chats)
interface SupportUser {
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

// Chat participant/user
interface SupportUser {
  id: string
  telegramId: number
  telegramUsername: string | null
  name: string
  photoUrl: string | null
  role: 'employee' | 'partner' | 'client'
  department: string | null
  position: string | null
  channels: Array<{ id: string; name: string; addedAt: string }>
  lastSeenAt: string
  firstSeenAt: string
}

// Conversation tracking
interface Conversation {
  id: string
  channelId: string
  channelName: string
  startedAt: string
  endedAt: string | null
  status: 'active' | 'waiting' | 'resolved' | 'abandoned'
  firstResponseAt: string | null
  firstResponseTimeMin: number | null
  resolutionTimeMin: number | null
  messageCount: number
  agentId: string | null
  agentName: string | null
  clientSatisfaction: number | null
}

interface Reminder {
  id: string
  channelId: string
  channelName: string
  messageId?: string // ID сообщения для перехода
  telegramMessageId?: number // Telegram ID сообщения
  commitmentText: string
  commitmentType: string
  messageContext?: string // Полный контекст сообщения
  messageSender?: string // Кто написал сообщение
  messageCreatedAt?: string // Время сообщения
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

interface ChannelContext {
  channel: { id: string; name: string; type: string }
  company: {
    name: string
    mrr: number
    plan: string
    segment: string
    isVIP: boolean
    healthScore: number
  } | null
  caseStats: {
    total: number
    open: number
    resolved: number
    avgResolutionFormatted: string
  }
  messageStats: {
    total: number
    fromClient: number
    problems: number
    unread: number
  }
  recentCases: Array<{ id: string; title: string; category: string; resolution: string }>
  topCategories: Array<{ category: string; count: number }>
  recommendations: Array<{ 
    id: string
    category: string
    solutionText: string
    confidence: number
    usedCount: number
    avgResolutionMinutes: number
  }>
  risk: {
    level: string
    churnScore: number
    reasons: string[]
  }
  context: {
    summary: string
    quickActions: Array<{ action: string; label: string; priority: string }>
  }
  messages: Array<{
    id: string
    channelId: string
    senderName: string
    senderRole: 'client' | 'support' | 'team'
    isFromClient: boolean
    contentType: string
    textContent: string | null
    createdAt: string
    isRead: boolean
    isProblem: boolean
    aiUrgency: number
    aiSuggestion?: string | null
  }>
}

interface ChannelTopic {
  id: string
  threadId: number
  name: string
  messagesCount: number
  unreadCount: number
  awaitingReply: boolean
  lastMessageAt: string
  lastSenderName: string
  recentMessages: Array<{
    id: string
    senderName: string
    senderRole: string
    text: string
    isFromClient: boolean
    createdAt: string
  }>
}

interface AnalyticsData {
  overview: {
    totalCases: number
    openCases: number
    resolvedCases: number
    newCasesPeriod: number
    avgResolutionHours: number
    urgentCases: number
    recurringCases: number
    totalMessages: number
    problemMessages: number
    voiceMessages: number
    totalChannels: number
    activeChannels: number
    avgFirstResponseMinutes: number | null
  }
  patterns: {
    byCategory: Array<{ category: string; count: number; openCount: number }>
    bySentiment: Array<{ sentiment: string; count: number }>
    byIntent: Array<{ intent: string; count: number }>
    recurringProblems: Array<{ problem: string; occurrences: number; affectedCompanies: number }>
  }
  teamMetrics: {
    byManager: Array<{
      managerId: string
      managerName: string
      totalCases: number
      resolvedCases: number
      resolutionRate: number
      avgResolutionMinutes: number
    }>
    dailyTrend: Array<{ date: string; casesCreated: number; casesResolved: number }>
  }
  churnSignals: {
    negativeCompanies: Array<{ companyId: string; companyName: string; negativeMessages: number }>
    stuckCases: Array<{ companyId: string; companyName: string; stuckCases: number; oldestHours: number }>
    highRiskCompanies: Array<{ companyId: string; companyName: string; riskScore: number; mrr: number; openCases: number; recurringCases: number }>
  }
}

interface SupportSettings {
  telegram_bot_token: string
  telegram_bot_username: string
  auto_create_cases: boolean
  min_urgency_for_case: number
  auto_transcribe_voice: boolean
  notify_on_problem: boolean
  notify_chat_id: string
  ai_model: string
}

const statusColors: Record<string, string> = {
  detected: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  waiting: 'bg-purple-100 text-purple-700',
  blocked: 'bg-red-100 text-red-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-slate-100 text-slate-600',
  recurring: 'bg-orange-100 text-orange-700',
}

const statusLabels: Record<string, string> = {
  detected: 'Обнаружено',
  in_progress: 'В работе',
  waiting: 'Ожидание',
  blocked: 'Блокер',
  resolved: 'Решено',
  closed: 'Закрыто',
  recurring: 'Повторяется',
}

const priorityColors: Record<string, string> = {
  low: 'text-slate-500',
  medium: 'text-blue-500',
  high: 'text-orange-500',
  urgent: 'text-red-500',
  critical: 'text-red-600',
}

const priorityLabels: Record<string, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  urgent: 'Срочный',
  critical: 'Критичный',
}

const priorityBgColors: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
  critical: 'bg-red-200 text-red-800',
}

const kanbanStatuses = ['detected', 'in_progress', 'waiting', 'blocked', 'resolved'] as const

const sentimentColors: Record<string, string> = {
  positive: 'bg-green-100 text-green-700',
  neutral: 'bg-slate-100 text-slate-600',
  negative: 'bg-red-100 text-red-700',
  frustrated: 'bg-orange-100 text-orange-700',
}

interface DashboardProps {
  defaultTab?: 'cases' | 'channels' | 'messages' | 'automations' | 'analytics' | 'agents' | 'users' | 'settings'
}

export function SupportDashboard({ defaultTab = 'channels' }: DashboardProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams<{ channelId?: string; caseId?: string; messageId?: string }>()
  
  // Проверка авторизации - синхронно при первом рендере
  const token = typeof window !== 'undefined' ? localStorage.getItem('support_agent_token') : null
  const [isAuthorized, setIsAuthorized] = useState<boolean>(!!token)
  
  // Редирект если нет токена
  useEffect(() => {
    if (!token) {
      navigate('/support/login', { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  
  const [activeTab, setActiveTab] = useState<'cases' | 'channels' | 'messages' | 'automations' | 'analytics' | 'agents' | 'users' | 'settings'>(defaultTab)
  
  // Состояние для хлебных крошек
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ label: string; path?: string }>>([])
  
  // Обновляем URL при смене вкладки
  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab)
    const tabToPath: Record<string, string> = {
      channels: '/support/channels',
      messages: '/support/messages',
      cases: '/support/cases',
      analytics: '/support/analytics',
      agents: '/support/agents',
      users: '/support/users',
      settings: '/support/settings',
      automations: '/support'
    }
    navigate(tabToPath[tab] || '/support', { replace: true })
  }
  const [cases, setCases] = useState<SupportCase[]>([])
  const lastCaseUpdateRef = useRef<number>(0) // Timestamp of last manual case update (drag & drop)
  const [channels, setChannels] = useState<SupportChannel[]>([])
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [messagesStats, setMessagesStats] = useState<any>({})
  const [groupedMessages, setGroupedMessages] = useState<any[]>([])
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(new Set())
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set())
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [remindersStats, setRemindersStats] = useState<{ active: number; vague: number; overdue: number; completed: number; escalated: number }>({ active: 0, vague: 0, overdue: 0, completed: 0, escalated: 0 })
  const [aiContext, setAiContext] = useState<{
    summary: string
    currentStatus: string
    mainIssues: string[]
    pendingActions: string[]
    suggestedResponse: string | null
    sentiment: string
    urgencyLevel: number
    commitments: Array<{ text: string; deadline: string | null; status: string }>
    keyTopics: string[]
    clientWaitingTime: number | null
    recentSuggestions: Array<{ messageId: string; senderName: string; suggestion: string; urgency: number }>
    similarSolutions: Array<{ id: string; category: string; text: string; steps: string[]; successScore: number; isVerified: boolean }>
  } | null>(null)
  const [loadingAiContext, setLoadingAiContext] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState<ChannelContext | null>(null)
  const [loadingContext, setLoadingContext] = useState(false)
  const [channelTopics, setChannelTopics] = useState<ChannelTopic[]>([])
  const [replyText, setReplyText] = useState('')
  const [selectedTopic, setSelectedTopic] = useState<number | null>(null)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [replyToMessage, setReplyToMessage] = useState<{ id: string; telegramMessageId?: number; senderName: string; text: string } | null>(null)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [previewFile, setPreviewFile] = useState<{ file: File; url: string } | null>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  // Channel context menu state
  const [channelContextMenu, setChannelContextMenu] = useState<{
    x: number
    y: number
    channelId: string
    channelName: string
  } | null>(null)
  
  // Preview mode - open channel without marking as read
  const [previewChannelId, setPreviewChannelId] = useState<string | null>(null)
  
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; messageId: string; telegramMessageId?: number; text: string; senderName: string; isFromTeam?: boolean } | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionResults, setMentionResults] = useState<Array<{ name: string; username: string }>>([])
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null) // messageId
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  const quickEmojis = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏']
  const allEmojis = ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '👍', '👎', '👏', '🙌', '🤝', '🙏', '❤️', '🔥', '⭐', '✅', '❌']
  const [editingChannel, setEditingChannel] = useState<{id: string, type: string, name: string} | null>(null)
  const [editingChannelType, setEditingChannelType] = useState<string | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [settings, setSettings] = useState<SupportSettings | null>(null)
  const [envStatus, setEnvStatus] = useState<Record<string, boolean>>({})
  const [aiPatterns, setAiPatterns] = useState<any>(null)
  const [settingsTab, setSettingsTab] = useState<'general' | 'patterns' | 'scoring' | 'team' | 'roles'>('general')
  
  // Automations
  const [automations, setAutomations] = useState<any[]>([])
  const [showNewAutomationModal, setShowNewAutomationModal] = useState(false)
  const [newAutomation, setNewAutomation] = useState({
    name: '',
    description: '',
    triggerType: 'message_problem_detected',
    actionType: 'create_case',
    triggerConfig: {} as any,
    actionConfig: {} as any,
    priority: 0
  })
  const [agents, setAgents] = useState<SupportAgent[]>([])
  
  // Broadcast (массовая рассылка)
  const [showBroadcastModal, setShowBroadcastModal] = useState(false)
  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [broadcastType, setBroadcastType] = useState<'announcement' | 'update' | 'warning'>('announcement')
  const [broadcastFilter, setBroadcastFilter] = useState<'all' | 'active' | 'selected'>('all')
  const [broadcastPreview, setBroadcastPreview] = useState<{ count: number; channels: Array<{ id: string; name: string }> } | null>(null)
  const [selectedBroadcastChannels, setSelectedBroadcastChannels] = useState<Set<string>>(new Set())
  const [broadcastChannelSearch, setBroadcastChannelSearch] = useState('')
  
  // Кастомный confirm диалог
  const [confirmDialog, setConfirmDialog] = useState<{ 
    show: boolean; 
    title: string; 
    message: string; 
    onConfirm: () => void;
    danger?: boolean;
  }>({ show: false, title: '', message: '', onConfirm: () => {} })
  const [sendingBroadcast, setSendingBroadcast] = useState(false)
  const [broadcastProgress, setBroadcastProgress] = useState<{ sent: number; total: number; current?: string } | null>(null)
  const [broadcastResult, setBroadcastResult] = useState<{ successful: number; failed: number; broadcastId?: string } | null>(null)
  const [deletingBroadcast, setDeletingBroadcast] = useState<string | null>(null)
  const [broadcastScheduleMode, setBroadcastScheduleMode] = useState(false)
  const [broadcastScheduleDate, setBroadcastScheduleDate] = useState('')
  const [scheduledBroadcasts, setScheduledBroadcasts] = useState<Array<{
    id: string
    messageText: string
    messageType: string
    filterType: string
    scheduledAt: string
    status: string
    createdBy: string
  }>>([])
  const [broadcastHistory, setBroadcastHistory] = useState<Array<{
    id: string
    type: string
    message: string
    filter: string
    sent: number
    successful: number
    failed: number
    clicks?: number
    uniqueClicks?: number
    forwards?: number
    sender: string
    createdAt: string
  }>>([])
  const [showBroadcastHistory, setShowBroadcastHistory] = useState(false)
  
  // Модалки хедера
  const [showUnansweredModal, setShowUnansweredModal] = useState(false)
  const [showCalendarModal, setShowCalendarModal] = useState(false)
  const [showSlaModal, setShowSlaModal] = useState<'response' | 'resolution' | 'percent' | null>(null)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  
  // Documentation search
  const [docsSearchQuery, setDocsSearchQuery] = useState('')
  const [docsSearchResults, setDocsSearchResults] = useState<Array<{
    id: number
    title: string
    excerpt: string
    url: string
    category: string
    relevance?: number
  }>>([])
  const [searchingDocs, setSearchingDocs] = useState(false)
  const [autoDocsResults, setAutoDocsResults] = useState<Array<{
    id: number
    title: string
    url: string
    category: string
  }>>([])
  
  // Similar dialogs from learning database
  const [similarDialogs, setSimilarDialogs] = useState<Array<{
    id: string
    question: string
    answer: string
    answeredBy: string
    confidence: number
    usedCount: number
    wasHelpful: boolean | null
  }>>([])
  
  // Learning stats
  const [learningStats, setLearningStats] = useState<{
    totalDialogs: number
    successRate: number
    avgConfidence: number
  } | null>(null)
  
  const [editingAgent, setEditingAgent] = useState<SupportAgent | null>(null)
  
  // Users (chat participants)
  const [chatUsers, setChatUsers] = useState<SupportUser[]>([])
  const [usersStats, setUsersStats] = useState<{ total: number; byRole: Record<string, number> }>({ total: 0, byRole: {} })
  const [usersFilter, setUsersFilter] = useState<'all' | 'employee' | 'partner' | 'client'>('all')
  const [selectedUser, setSelectedUser] = useState<SupportUser | null>(null)
  const [userMetrics, setUserMetrics] = useState<any>(null)
  const [loadingUserMetrics, setLoadingUserMetrics] = useState(false)
  const [newAgentForm, setNewAgentForm] = useState({ name: '', username: '', email: '', role: 'agent', password: '', showPassword: false })
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [agentActivity, setAgentActivity] = useState<any[]>([])
  const [activityPeriod, setActivityPeriod] = useState<'day' | 'week' | 'month'>('day')
  const [teamMetrics, setTeamMetrics] = useState<{
    avgFirstResponseMin: number
    avgResolutionMin: number
    totalConversations: number
    resolvedToday: number
    activeNow: number
    satisfactionAvg: number
  } | null>(null)
  const [metricsByType, setMetricsByType] = useState<{
    all: { avgFirstResponseMin: number; avgResolutionMin: number; totalConversations: number; resolvedTotal: number; activeNow: number }
    clients: { avgFirstResponseMin: number; avgResolutionMin: number; totalConversations: number; resolvedTotal: number; activeNow: number }
    partners: { avgFirstResponseMin: number; avgResolutionMin: number; totalConversations: number; resolvedTotal: number; activeNow: number }
    internal: { avgFirstResponseMin: number; avgResolutionMin: number; totalConversations: number; resolvedTotal: number; activeNow: number }
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // Weather, Clock, News states
  const [currentTime, setCurrentTime] = useState(new Date())
  const [weather, setWeather] = useState<{ temp: number; icon: string; description: string } | null>(null)
  const [newsItems, setNewsItems] = useState<Array<{ title: string; link: string }>>([])
  const [currentNewsIndex, setCurrentNewsIndex] = useState(0)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [stats, setStats] = useState<Record<string, number>>({})
  const [selectedCase, setSelectedCase] = useState<SupportCase | null>(null)
  const [caseActivities, setCaseActivities] = useState<Array<{
    id: string
    type: string
    title: string
    description?: string
    fromStatus?: string
    toStatus?: string
    managerName?: string
    createdAt: string
  }>>([])
  const [draggingCase, setDraggingCase] = useState<string | null>(null)
  const [botTestResult, setBotTestResult] = useState<any>(null)
  const [analyticsPeriod, setAnalyticsPeriod] = useState('30d')
  
  // Modal states
  const [showNewCaseModal, setShowNewCaseModal] = useState(false)
  const [showNewChannelModal, setShowNewChannelModal] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showConversationsModal, setShowConversationsModal] = useState<{ type: 'all' | 'open' | 'resolved'; title: string; channelId?: string } | null>(null)
  const [inviteUrl, setInviteUrl] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  
  // Notifications state
  const [notifications, setNotifications] = useState<Array<{
    id: string
    type: 'message' | 'reminder' | 'alert' | 'case'
    title: string
    body: string
    channelId?: string
    urgency: 'low' | 'medium' | 'high' | 'critical'
    timestamp: Date
    read: boolean
  }>>([])
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [lastSeenMessages, setLastSeenMessages] = useState<Set<string>>(new Set())
  const [initialLoadComplete, setInitialLoadComplete] = useState(false) // Флаг первой загрузки
  const notificationAudioRef = useRef<HTMLAudioElement | null>(null)
  
  // Role permissions
  const [agentPermissions, setAgentPermissions] = useState<{
    canAccessCases: boolean
    canAccessChannels: boolean
    canAccessMessages: boolean
    canAccessAutomations: boolean
    canAccessAnalytics: boolean
    canAccessAgents: boolean
    canAccessUsers: boolean
    canAccessSettings: boolean
    canCreateCases: boolean
    canAssignCases: boolean
    canDeleteMessages: boolean
    canManageAgents: boolean
  }>({
    canAccessCases: true,
    canAccessChannels: true,
    canAccessMessages: true,
    canAccessAutomations: false,
    canAccessAnalytics: true,
    canAccessAgents: false,
    canAccessUsers: false,
    canAccessSettings: false,
    canCreateCases: true,
    canAssignCases: false,
    canDeleteMessages: false,
    canManageAgents: false
  })
  const [profileForm, setProfileForm] = useState({ name: '', email: '', phone: '', telegram: '', position: '', department: '' })
  const [newCase, setNewCase] = useState({ title: '', description: '', category: 'general', priority: 'medium' })
  const [newChannel, setNewChannel] = useState({ telegramChatId: '', name: '', type: 'client' })
  const [actionLoading, setActionLoading] = useState(false)

  // Cache helpers - отключен для сообщений для real-time
  const CACHE_TTL = 5000 // 5 seconds (reduced from 30s)
  const cacheRef = useRef<Record<string, { data: any; timestamp: number }>>({})
  
  function getCached(key: string) {
    const cached = cacheRef.current[key]
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data
    }
    // Also try sessionStorage for persistence
    try {
      const stored = sessionStorage.getItem(`support_${key}`)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Date.now() - parsed.timestamp < CACHE_TTL * 2) {
          return parsed.data
        }
      }
    } catch {}
    return null
  }
  
  function setCache(key: string, data: any) {
    cacheRef.current[key] = { data, timestamp: Date.now() }
    try {
      sessionStorage.setItem(`support_${key}`, JSON.stringify({ data, timestamp: Date.now() }))
    } catch {}
  }

  // Apply cached data to state
  function applyCachedData(cached: any) {
    if (!cached) return
    switch (cached.type) {
      case 'cases':
        setCases(cached.cases || [])
        setStats(cached.stats || {})
        break
      case 'channels':
        setChannels(cached.channels || [])
        break
      case 'analytics':
        setAnalytics(cached.analytics || {})
        break
      case 'messages':
        setGroupedMessages(cached.groupedMessages || [])
        setMessagesStats(cached.messagesStats || {})
        setMessages(cached.messages || [])
        break
    }
    setLoading(false) // Hide loading if we have cache
  }

  // Load data with caching - show cache immediately, refresh in background
  useEffect(() => {
    loadData(false) // Initial load shows loading
  }, [activeTab, statusFilter, analyticsPeriod, activityPeriod])
  
  // Автостарт работы - определяем по активности в системе
  const autoStartWork = () => {
    try {
      const agentData = localStorage.getItem('support_agent_data')
      if (!agentData) return
      
      const agent = JSON.parse(agentData)
      if (!agent) return
      
      const currentAgentId = localStorage.getItem('support_agent_id')
      
      // Если агент уже активен - ничего не делаем
      if (currentAgentId === agent.id) return
      
      // Автоматически начинаем смену при первой активности
      localStorage.setItem('support_agent_id', agent.id)
      const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
      const authHeader = token.startsWith('Bearer') ? token : `Bearer ${token}`
      
      fetch('/api/support/agents/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ agentId: agent.id, action: 'login' })
      }).catch(() => {})
    } catch (e) {
      console.error('autoStartWork error:', e)
    }
  }
  
  // Global Escape key handler - close expanded chat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close any open channel
        if (expandedChannels.size > 0) {
          setExpandedChannels(new Set())
          setSelectedTopic(null)
          setReplyToMessage(null)
          setReplyText('')
        }
        // Close any open modal
        if (selectedCase) setSelectedCase(null)
        if (selectedChannel) setSelectedChannel(null)
        if (contextMenu) setContextMenu(null)
        if (showNewCaseModal) setShowNewCaseModal(false)
        if (showNewChannelModal) setShowNewChannelModal(false)
        if (showProfileModal) setShowProfileModal(false)
        if (showInviteModal) setShowInviteModal(false)
        if (showConversationsModal) setShowConversationsModal(null)
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [expandedChannels, selectedCase, selectedChannel, contextMenu, showNewCaseModal, showNewChannelModal, showProfileModal, showInviteModal, showConversationsModal])
  
  // Initialize notification audio
  useEffect(() => {
    notificationAudioRef.current = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleKxUyHMJL4PB8OeVAQqC0uaBTwQFjtm8d0QEBJfapGtIBASV3aVvTAUIkNaoekwGDIrMrIFQBhGFx6+FVgcXgcCxilsHHn66tY5gByR7tLeTZQkqd6+6mGoKLnWsuJxsDjVxqLqhcQ87bqW4pnMSQWqitrqndhdGZ5+zuqt3G0tmm7C8r3sgT2OWrbyzfyVSYJKptrmDKlVdj6S3uocrV1uLobS4jCxZWYiesrevjy9bVoWhsravkjBdU4GerrKvlTJfUn6bqrGtkzRgUXuYp66pkzZhUHiVpKynkDhiT3aSpKqljzpjTXOQoqejjTxkTHCOoKahjT5kS26Mn6OfjkBlSmuLnaGdj0FmSWmJm5+bjUNnSGaHmZyZjEVoR2SFlpeXi0dqR2GDk5SVikhrRl+BkZOTiUpuRV1/j5GRiE1wRVp9jY+PiE9yRFd6i42NiFB0RFV4iYuLiFF1Q1J2h4mJh1J3Q1B0hYeHhlR5Qk5ygYWEhVV7Qktwf4GDg1Z9QkhufoCCglh/QUZMK7d/gVqBQEO7R3t+gFx/Pj+8SXl9flx9PTy6S3d7fFp7PDm2TXV6e1l4OzWyT3N5elh1OjGsUXF3eFZzOS2mUnBzeVRxOCmiU29yeVJvNyacVG1xeFBtNiKXVWxweU5rNR6RVmtweExnNBuMV2pveEpkMxiIWGlud0hhMhWDWmhsdkZeMhJ+W2dsc0NbMQ95XGZrcUBYLwt0XWVqcD1VLQhvXmRpbjpSLAVpX2NoblF')
    notificationAudioRef.current.volume = 0.5
  }, [])
  
  // Clock - update every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  
  // Weather - load on mount and every 30 minutes
  useEffect(() => {
    async function loadWeather() {
      try {
        // Using wttr.in API for Tashkent (free, no API key)
        const res = await fetch('https://wttr.in/Tashkent?format=j1')
        if (res.ok) {
          const data = await res.json()
          const current = data.current_condition?.[0]
          if (current) {
            setWeather({
              temp: parseInt(current.temp_C),
              icon: getWeatherEmoji(current.weatherCode),
              description: current.lang_ru?.[0]?.value || current.weatherDesc?.[0]?.value || ''
            })
          }
        }
      } catch (e) {
        console.log('Weather fetch error:', e)
      }
    }
    
    function getWeatherEmoji(code: string): string {
      const c = parseInt(code)
      if (c === 113) return '☀️'
      if (c === 116) return '⛅'
      if (c === 119 || c === 122) return '☁️'
      if (c >= 176 && c <= 263) return '🌧️'
      if (c >= 266 && c <= 299) return '🌧️'
      if (c >= 302 && c <= 356) return '🌧️'
      if (c >= 359 && c <= 395) return '🌨️'
      if (c >= 200 && c <= 232) return '⛈️'
      return '🌤️'
    }
    
    loadWeather()
    const interval = setInterval(loadWeather, 30 * 60 * 1000) // Every 30 min
    return () => clearInterval(interval)
  }, [])
  
  // News RSS - load on mount and rotate every 10 seconds
  useEffect(() => {
    async function loadNews() {
      try {
        // Using a CORS proxy for RSS feed
        const rssUrl = 'https://api.rss2json.com/v1/api.json?rss_url=https://kun.uz/news/rss'
        const res = await fetch(rssUrl)
        if (res.ok) {
          const data = await res.json()
          if (data.items) {
            setNewsItems(data.items.slice(0, 10).map((item: any) => ({
              title: item.title,
              link: item.link
            })))
          }
        }
      } catch (e) {
        console.log('News fetch error:', e)
      }
    }
    
    loadNews()
    const loadInterval = setInterval(loadNews, 15 * 60 * 1000) // Reload every 15 min
    return () => clearInterval(loadInterval)
  }, [])
  
  // Rotate news every 8 seconds
  useEffect(() => {
    if (newsItems.length > 1) {
      const timer = setInterval(() => {
        setCurrentNewsIndex(prev => (prev + 1) % newsItems.length)
      }, 8000)
      return () => clearInterval(timer)
    }
  }, [newsItems.length])
  
  // Auto-scroll to last message when chat opens or new messages arrive
  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: smooth ? 'smooth' : 'auto',
        block: 'end' 
      })
    }
  }, [])
  
  // Navigate to specific message in channel
  const navigateToMessage = useCallback((channelId: string, messageId?: string) => {
    setActiveTab('messages')
    setExpandedChannels(new Set([channelId]))
    setExpandedTopics(new Set())
    setSelectedTopic(null)
    loadAiContext(channelId)
    
    // Scroll to message after channel loads
    if (messageId) {
      setTimeout(() => {
        const msgEl = document.querySelector(`[data-message="${messageId}"]`)
        if (msgEl) {
          msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
          // Highlight message briefly
          msgEl.classList.add('ring-2', 'ring-yellow-400', 'ring-offset-2')
          setTimeout(() => {
            msgEl.classList.remove('ring-2', 'ring-yellow-400', 'ring-offset-2')
          }, 3000)
        }
      }, 500)
    }
  }, [loadAiContext])
  
  // Scroll to bottom when channel is opened
  useEffect(() => {
    if (expandedChannels.size > 0) {
      // Small delay to let messages render
      setTimeout(() => scrollToBottom(false), 100)
    }
  }, [expandedChannels, scrollToBottom])
  
  // Load case activities when case is selected
  useEffect(() => {
    if (selectedCase) {
      const loadCaseActivities = async () => {
        try {
          const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
          const res = await fetch(`/api/support/cases/${selectedCase.id}`, {
            headers: { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` }
          })
          if (res.ok) {
            const data = await res.json()
            setCaseActivities(data.activities || [])
          }
        } catch (e) {
          console.error('Failed to load case activities:', e)
        }
      }
      loadCaseActivities()
    } else {
      setCaseActivities([])
    }
  }, [selectedCase?.id])
  
  // Track previous message count to detect real new messages
  const prevMessageCountRef = useRef<number>(0)
  const prevChannelIdRef = useRef<string | null>(null)
  
  // Scroll to bottom when new messages arrive in the open chat
  useEffect(() => {
    if (expandedChannels.size > 0 && groupedMessages.length > 0) {
      const openChannelId = Array.from(expandedChannels)[0]
      const channel = groupedMessages.find((ch: any) => ch.id === openChannelId)
      const currentMessageCount = channel?.recentMessages?.length || 0
      
      // Check if channel changed or new message arrived
      const channelChanged = prevChannelIdRef.current !== openChannelId
      const newMessageArrived = currentMessageCount > prevMessageCountRef.current && prevMessageCountRef.current > 0
      
      if (channel?.recentMessages?.length > 0) {
        const container = messagesContainerRef.current
        if (container) {
          // On channel change - scroll to bottom immediately
          if (channelChanged) {
            setTimeout(() => scrollToBottom(false), 50)
          }
          // On new message - scroll only if user is near bottom
          else if (newMessageArrived) {
            const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200
            if (isNearBottom) {
              scrollToBottom(true)
            }
          }
        }
      }
      
      prevMessageCountRef.current = currentMessageCount
      prevChannelIdRef.current = openChannelId
    }
  }, [groupedMessages, expandedChannels, scrollToBottom])
  
  // Load agent permissions based on role
  useEffect(() => {
    const agentData = localStorage.getItem('support_agent_data')
    if (agentData) {
      try {
        const agent = JSON.parse(agentData)
        const role = agent.role || 'agent'
        
        // Set permissions based on role
        if (role === 'manager' || role === 'admin') {
          setAgentPermissions({
            canAccessCases: true,
            canAccessChannels: true,
            canAccessMessages: true,
            canAccessAutomations: true,
            canAccessAnalytics: true,
            canAccessAgents: true,
            canAccessUsers: true,
            canAccessSettings: true,
            canCreateCases: true,
            canAssignCases: true,
            canDeleteMessages: true,
            canManageAgents: true
          })
        } else if (role === 'lead') {
          setAgentPermissions({
            canAccessCases: true,
            canAccessChannels: true,
            canAccessMessages: true,
            canAccessAutomations: true,
            canAccessAnalytics: true,
            canAccessAgents: true,
            canAccessUsers: true,
            canAccessSettings: false,
            canCreateCases: true,
            canAssignCases: true,
            canDeleteMessages: true,
            canManageAgents: false
          })
        } else if (role === 'senior') {
          setAgentPermissions({
            canAccessCases: true,
            canAccessChannels: true,
            canAccessMessages: true,
            canAccessAutomations: false,
            canAccessAnalytics: true,
            canAccessAgents: false,
            canAccessUsers: true,
            canAccessSettings: false,
            canCreateCases: true,
            canAssignCases: true,
            canDeleteMessages: false,
            canManageAgents: false
          })
        } else {
          // Default agent permissions
          setAgentPermissions({
            canAccessCases: true,
            canAccessChannels: true,
            canAccessMessages: true,
            canAccessAutomations: false,
            canAccessAnalytics: false,
            canAccessAgents: false,
            canAccessUsers: false,
            canAccessSettings: false,
            canCreateCases: true,
            canAssignCases: false,
            canDeleteMessages: false,
            canManageAgents: false
          })
        }
      } catch (e) {
        console.error('Failed to parse agent data:', e)
      }
    }
  }, [])
  
  // Play notification sound
  const playNotificationSound = () => {
    if (soundEnabled && notificationAudioRef.current) {
      notificationAudioRef.current.currentTime = 0
      notificationAudioRef.current.play().catch(() => {})
    }
  }
  
  // Play alert beeps (extended 4-5 seconds) for unanswered messages > 3 min
  const playAlertBeeps = useCallback(() => {
    if (!soundEnabled) return
    
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      
      const playBeep = (startTime: number, frequency: number, duration: number) => {
        const oscillator = audioContext.createOscillator()
        const gainNode = audioContext.createGain()
        
        oscillator.connect(gainNode)
        gainNode.connect(audioContext.destination)
        
        oscillator.frequency.value = frequency
        oscillator.type = 'sine'
        
        gainNode.gain.setValueAtTime(0.25, startTime)
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration)
        
        oscillator.start(startTime)
        oscillator.stop(startTime + duration)
      }
      
      // Паттерн: 10 гудков за ~5 секунд с чередованием тона
      const now = audioContext.currentTime
      const beepPattern = [
        { time: 0, freq: 800, dur: 0.2 },
        { time: 0.4, freq: 1000, dur: 0.2 },
        { time: 0.8, freq: 800, dur: 0.2 },
        { time: 1.2, freq: 1000, dur: 0.2 },
        { time: 1.6, freq: 800, dur: 0.3 },
        { time: 2.2, freq: 1000, dur: 0.2 },
        { time: 2.6, freq: 800, dur: 0.2 },
        { time: 3.0, freq: 1000, dur: 0.2 },
        { time: 3.4, freq: 800, dur: 0.3 },
        { time: 4.0, freq: 1200, dur: 0.5 }, // Финальный длинный
      ]
      
      beepPattern.forEach(({ time, freq, dur }) => {
        playBeep(now + time, freq, dur)
      })
      
      // Закрыть контекст после воспроизведения
      setTimeout(() => audioContext.close(), 6000)
    } catch (e) {
      // Web Audio API не поддерживается
      console.warn('Web Audio API not supported')
    }
  }, [soundEnabled])
  
  // Check for unanswered messages > 3 min and play alert
  const lastAlertTimeRef = useRef<number>(0)
  useEffect(() => {
    if (!soundEnabled) return
    
    const checkInterval = setInterval(() => {
      const now = Date.now()
      
      // Проверяем есть ли неотвеченные > 3 мин
      const unansweredOver3Min = groupedMessages.filter((ch: any) => {
        if (!ch.awaitingReply || !ch.lastClientMessageAt) return false
        const waitingMs = now - new Date(ch.lastClientMessageAt).getTime()
        return waitingMs >= 3 * 60 * 1000 // 3 минуты
      })
      
      if (unansweredOver3Min.length > 0) {
        // Играем звук не чаще чем раз в 30 сек
        if (now - lastAlertTimeRef.current >= 30000) {
          playAlertBeeps()
          lastAlertTimeRef.current = now
        }
      }
    }, 10000) // Проверяем каждые 10 сек
    
    return () => clearInterval(checkInterval)
  }, [soundEnabled, groupedMessages, playAlertBeeps])
  
  // Show toast notification
  const showNotification = (title: string, body: string, urgency: 'low' | 'medium' | 'high' | 'critical', channelId?: string, type: 'message' | 'case' | 'reminder' = 'message') => {
    const id = `notif_${Date.now()}`
    setNotifications(prev => [{
      id,
      type,
      title,
      body,
      channelId,
      urgency,
      timestamp: new Date(),
      read: false
    }, ...prev.slice(0, 19)]) // Keep last 20
    
    playNotificationSound()
    
    // Auto-hide: 3 сек для сообщений, 4 сек для тикетов/кейсов, 5 сек для напоминаний
    const timeout = type === 'message' ? 3000 : type === 'case' ? 4000 : 5000
    setTimeout(() => {
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    }, timeout)
    
    // Browser notification if permitted
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/logo/logo-compact.svg' })
    }
  }
  
  // Check for new messages and show notifications
  // ВАЖНО: при первой загрузке только запоминаем все сообщения, без уведомлений
  useEffect(() => {
    if (groupedMessages.length > 0) {
      const allMessageIds = new Set<string>()
      
      groupedMessages.forEach(channel => {
        if (channel.recentMessages) {
          channel.recentMessages.forEach((msg: any) => {
            allMessageIds.add(msg.id)
            
            // Показываем уведомления ТОЛЬКО после первой загрузки
            if (initialLoadComplete && !lastSeenMessages.has(msg.id) && msg.senderRole === 'client') {
              // Проверяем что сообщение свежее (не старше 2 минут)
              const msgAge = Date.now() - new Date(msg.createdAt).getTime()
              if (msgAge < 120000) { // 2 минуты
                const urgency = msg.aiUrgency >= 4 ? 'critical' : msg.aiUrgency >= 3 ? 'high' : msg.aiUrgency >= 2 ? 'medium' : 'low'
                showNotification(
                  `📩 ${channel.name}`,
                  `${msg.senderName}: ${msg.text?.slice(0, 100) || '[медиа]'}`,
                  urgency,
                  channel.id
                )
              }
            }
          })
        }
      })
      
      // При первой загрузке - запоминаем все ID и помечаем загрузку завершённой
      if (!initialLoadComplete) {
        setLastSeenMessages(allMessageIds)
        setInitialLoadComplete(true)
      } else {
        // При последующих - только добавляем новые
        setLastSeenMessages(prev => new Set([...prev, ...allMessageIds]))
      }
    }
  }, [groupedMessages, initialLoadComplete])
  
  // Request notification permission
  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])
  
  // Reminder for unanswered messages (check every 2 min)
  useEffect(() => {
    const checkUnanswered = () => {
      groupedMessages.forEach(channel => {
        if (channel.awaitingReply && channel.lastMessageAt) {
          const lastMsgTime = new Date(channel.lastMessageAt).getTime()
          const waitingMinutes = Math.floor((Date.now() - lastMsgTime) / 60000)
          
          if (waitingMinutes >= 5 && waitingMinutes % 5 === 0) {
            // Remind every 5 minutes
            showNotification(
              `⏰ Требуется ответ!`,
              `${channel.name} ожидает ответа ${waitingMinutes} мин.`,
              waitingMinutes >= 15 ? 'critical' : waitingMinutes >= 10 ? 'high' : 'medium',
              channel.id,
              'reminder'
            )
          }
        }
      })
    }
    
    const interval = setInterval(checkUnanswered, 120000) // Every 2 min
    return () => clearInterval(interval)
  }, [groupedMessages])
  
  // Track agent session (auto-login on first activity, heartbeat every 5 min, logout on unmount)
  useEffect(() => {
    // Автостарт при загрузке страницы (это уже активность)
    autoStartWork()
    
    const agentId = localStorage.getItem('support_agent_id')
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    const authHeader = token.startsWith('Bearer') ? token : `Bearer ${token}`
    
    if (agentId) {
      // Record login/activity
      fetch('/api/support/agents/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ agentId, action: 'login' })
      }).catch(() => {})
      
      // Heartbeat every 5 minutes
      const heartbeatInterval = setInterval(() => {
        fetch('/api/support/agents/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({ agentId, action: 'heartbeat' })
        }).catch(() => {})
      }, 5 * 60 * 1000)
      
      // Logout on unmount or page close
      const handleLogout = () => {
        navigator.sendBeacon('/api/support/agents/activity', JSON.stringify({ agentId, action: 'logout' }))
      }
      window.addEventListener('beforeunload', handleLogout)
      
      return () => {
        clearInterval(heartbeatInterval)
        window.removeEventListener('beforeunload', handleLogout)
        fetch('/api/support/agents/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({ agentId, action: 'logout' })
        }).catch(() => {})
      }
    }
  }, [])

  // Background refresh - real-time для сообщений (1.5s), другие модули (8s)
  useEffect(() => {
    // Ещё быстрее если чат открыт
    const hasChatOpen = expandedChannels.size > 0
    const refreshInterval = activeTab === 'messages' 
      ? (hasChatOpen ? 1500 : 2500) // 1.5s с открытым чатом, 2.5s без
      : 8000 // 8s для других модулей
    
    const interval = setInterval(() => {
      loadData(true) // Silent background refresh
    }, refreshInterval)
    return () => clearInterval(interval)
  }, [activeTab, statusFilter, analyticsPeriod, expandedChannels.size])

  // Синхронизация activeTab с URL (deep links)
  useEffect(() => {
    const path = location.pathname
    if (path.includes('/cases')) setActiveTab('cases')
    else if (path.includes('/messages')) setActiveTab('messages')
    else if (path.includes('/channels')) setActiveTab('channels')
    else if (path.includes('/analytics')) setActiveTab('analytics')
    else if (path.includes('/agents')) setActiveTab('agents')
    else if (path.includes('/users')) setActiveTab('users')
    else if (path.includes('/settings')) setActiveTab('settings')
  }, [location.pathname])

  // Обработка URL параметров (deep links) и хлебные крошки
  useEffect(() => {
    const { channelId, caseId, messageId } = params
    const path = location.pathname
    
    const crumbs: Array<{ label: string; path?: string }> = [
      { label: 'Поддержка', path: '/support' }
    ]
    
    if (path.includes('/messages')) {
      crumbs.push({ label: 'Сообщения', path: '/support/messages' })
      if (channelId) {
        const channel = groupedMessages.find((ch: any) => ch.id === channelId) || channels.find(ch => ch.id === channelId)
        if (channel) {
          crumbs.push({ label: channel.name })
          if (!expandedChannels.has(channelId)) {
            setExpandedChannels(new Set([channelId]))
            loadAiContext(channelId)
          }
          if (messageId) {
            setTimeout(() => {
              const msgEl = document.querySelector(`[data-message="${messageId}"]`)
              if (msgEl) {
                msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
                msgEl.classList.add('ring-2', 'ring-yellow-400', 'ring-offset-2')
                setTimeout(() => msgEl.classList.remove('ring-2', 'ring-yellow-400', 'ring-offset-2'), 3000)
              }
            }, 800)
          }
        }
      }
    } else if (path.includes('/cases')) {
      crumbs.push({ label: 'Кейсы', path: '/support/cases' })
      if (caseId) {
        const caseItem = cases.find(c => c.id === caseId)
        if (caseItem) {
          const ticketNum = caseItem.ticketNumber ? `#${String(caseItem.ticketNumber).padStart(3, '0')}` : caseId
          crumbs.push({ label: `Тикет ${ticketNum}` })
          setSelectedCase(caseItem)
        }
      }
    } else if (path.includes('/channels')) {
      crumbs.push({ label: 'Каналы', path: '/support/channels' })
      if (channelId) {
        const channel = channels.find(ch => ch.id === channelId)
        if (channel) crumbs.push({ label: channel.name })
      }
    } else if (path.includes('/analytics')) crumbs.push({ label: 'Аналитика' })
    else if (path.includes('/users')) crumbs.push({ label: 'Пользователи' })
    else if (path.includes('/settings')) crumbs.push({ label: 'Настройки' })
    
    setBreadcrumbs(crumbs)
  }, [params, location.pathname, groupedMessages, channels, cases, expandedChannels])

  // Функция копирования ссылки
  const copyLink = useCallback((type: 'channel' | 'case' | 'message', id: string, subId?: string) => {
    let url = `${window.location.origin}/support`
    if (type === 'channel') {
      url += `/channels/${id}`
    } else if (type === 'case') {
      url += `/cases/${id}`
    } else if (type === 'message') {
      url += `/messages/${id}${subId ? `/${subId}` : ''}`
    }
    
    navigator.clipboard.writeText(url).then(() => {
      // Показать toast или уведомление
      const toast = document.createElement('div')
      toast.className = 'fixed bottom-4 right-4 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm z-[300] animate-fade-in'
      toast.textContent = 'Ссылка скопирована!'
      document.body.appendChild(toast)
      setTimeout(() => toast.remove(), 2000)
    }).catch(() => {
      console.error('Failed to copy link')
    })
  }, [])

  // Удаление агента
  async function deleteAgent(agentId: string) {
    try {
      const res = await fetch(`/api/support/agents?id=${agentId}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer admin' }
      })
      if (res.ok) {
        setAgents(prev => prev.filter(a => a.id !== agentId))
      } else {
        const error = await res.json()
        alert('Ошибка: ' + error.error)
      }
    } catch (e) {
      alert('Ошибка при удалении')
    }
  }

  // Загрузка метрик пользователя
  async function loadUserMetrics(telegramId: number) {
    setLoadingUserMetrics(true)
    try {
      const token = localStorage.getItem('support_agent_token') || 'admin'
      const res = await fetch(`/api/support/users/metrics?telegramId=${telegramId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setUserMetrics(data)
      }
    } catch (e) {
      console.error('Failed to load user metrics:', e)
    } finally {
      setLoadingUserMetrics(false)
    }
  }

  // Обновление роли пользователя
  async function updateUserRole(userId: string, newRole: 'employee' | 'partner' | 'client') {
    try {
      const token = localStorage.getItem('support_agent_token') || 'admin'
      const res = await fetch('/api/support/users', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ id: userId, role: newRole })
      })
      if (res.ok) {
        // Обновляем локально
        setChatUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
        // Обновляем статистику
        setUsersStats(prev => {
          const byRole = { ...prev.byRole }
          // Находим старую роль
          const user = chatUsers.find(u => u.id === userId)
          if (user) {
            byRole[user.role] = (byRole[user.role] || 1) - 1
          }
          byRole[newRole] = (byRole[newRole] || 0) + 1
          return { ...prev, byRole }
        })
      }
    } catch (e) {
      console.error('Failed to update user role:', e)
    }
  }

  // Обновление деталей пользователя
  async function updateUserDetails(userId: string, updates: { department?: string; position?: string; notes?: string }) {
    try {
      const token = localStorage.getItem('support_agent_token') || 'admin'
      await fetch('/api/support/users', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ id: userId, ...updates })
      })
      // Обновляем локально
      setChatUsers(prev => prev.map(u => u.id === userId ? { ...u, ...updates } : u))
      if (selectedUser?.id === userId) {
        setSelectedUser(prev => prev ? { ...prev, ...updates } : null)
      }
    } catch (e) {
      console.error('Failed to update user details:', e)
    }
  }

  async function loadData(silent = false) {
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    const authHeader = token.startsWith('Bearer') ? token : `Bearer ${token}`
    
    // Пропускаем кэш если открыт чат (для real-time)
    const hasChatOpen = expandedChannels.size > 0
    const skipCache = hasChatOpen && activeTab === 'messages'
    
    // Show cached data immediately (если не пропускаем кэш)
    const cacheKey = `${activeTab}_${statusFilter}_${analyticsPeriod}`
    const cached = skipCache ? null : getCached(cacheKey)
    if (cached && !silent) {
      applyCachedData(cached)
    }
    
    // Only show loading spinner on first load (no cache)
    if (!cached && !silent) {
      setLoading(true)
    }
    
    try {
      if (activeTab === 'cases') {
        // Пропускаем обновление если было недавнее ручное изменение (drag & drop)
        const timeSinceLastUpdate = Date.now() - lastCaseUpdateRef.current
        const skipCasesRefresh = silent && timeSinceLastUpdate < 5000
        
        if (skipCasesRefresh) {
          console.log('[loadData] Skipping cases refresh - recent manual update')
        } else {
          const res = await fetch(`/api/support/cases?status=${statusFilter}&limit=100`, {
            headers: { Authorization: authHeader }
          })
          if (res.ok) {
            const data = await res.json()
            setCases(data.cases || [])
            setStats(data.stats || {})
            setCache(cacheKey, { type: 'cases', cases: data.cases, stats: data.stats })
          }
        }
      } else if (activeTab === 'channels') {
        const res = await fetch('/api/support/channels?limit=200', {
          headers: { Authorization: authHeader }
        })
        if (res.ok) {
          const data = await res.json()
          setChannels(data.channels || [])
          setCache(cacheKey, { type: 'channels', channels: data.channels })
        }
      } else if (activeTab === 'analytics') {
        const res = await fetch(`/api/support/analytics?period=${analyticsPeriod}`, {
          headers: { Authorization: authHeader }
        })
        if (res.ok) {
          const data = await res.json()
          setAnalytics(data)
          setCache(cacheKey, { type: 'analytics', analytics: data })
        }
      } else if (activeTab === 'messages') {
        // Load grouped messages in parallel
        const [groupedRes, flatRes] = await Promise.all([
          fetch('/api/support/messages/grouped', { headers: { Authorization: authHeader } }),
          fetch('/api/support/messages?limit=100', { headers: { Authorization: authHeader } })
        ])
        
        if (groupedRes.ok) {
          const data = await groupedRes.json()
          setGroupedMessages(data.channels || [])
          setMessagesStats(data.stats || {})
        }
        if (flatRes.ok) {
          const data = await flatRes.json()
          setMessages(data.messages || [])
        }
        
        if (groupedRes.ok && flatRes.ok) {
          const gData = await groupedRes.clone().json().catch(() => ({}))
          const fData = await flatRes.clone().json().catch(() => ({}))
          setCache(cacheKey, { 
            type: 'messages', 
            groupedMessages: gData.channels, 
            messagesStats: gData.stats,
            messages: fData.messages 
          })
        }
      } else if (activeTab === 'agents') {
        // Load agents
        const agentsRes = await fetch('/api/support/agents', {
          headers: { Authorization: authHeader }
        })
        if (agentsRes.ok) {
          const data = await agentsRes.json()
          setAgents(data.agents || [])
        }
        // Load activity
        const actRes = await fetch(`/api/support/agents/activity?period=${activityPeriod}`, {
          headers: { Authorization: authHeader }
        })
        if (actRes.ok) {
          const actData = await actRes.json()
          setAgentActivity(actData.activity || [])
        }
      } else if (activeTab === 'users') {
        // Load chat users
        const usersRes = await fetch('/api/support/users', {
          headers: { Authorization: authHeader }
        })
        if (usersRes.ok) {
          const data = await usersRes.json()
          setChatUsers(data.users || [])
          setUsersStats(data.stats || { total: 0, byRole: {} })
        }
      } else if (activeTab === 'settings') {
        // Load settings
        const res = await fetch('/api/support/settings', {
          headers: { Authorization: 'admin' }
        })
        if (res.ok) {
          const data = await res.json()
          setSettings(data.settings)
          setEnvStatus(data.envStatus || {})
        }
        // Load AI patterns
        const patternsRes = await fetch('/api/support/patterns', {
          headers: { Authorization: authHeader }
        })
        if (patternsRes.ok) {
          const data = await patternsRes.json()
          setAiPatterns(data.patterns)
        }
        // Load team data (agents + conversations + activity)
        const [agentsRes, convsRes, activityRes] = await Promise.all([
          fetch('/api/support/agents', { headers: { Authorization: authHeader } }),
          fetch('/api/support/conversations', { headers: { Authorization: authHeader } }),
          fetch(`/api/support/agents/activity?period=${activityPeriod}`, { headers: { Authorization: authHeader } })
        ])
        if (agentsRes.ok) {
          const data = await agentsRes.json()
          setAgents(data.agents || [])
        }
        if (convsRes.ok) {
          const data = await convsRes.json()
          setConversations(data.conversations || [])
          setTeamMetrics(data.metrics)
          if (data.metricsByType) {
            setMetricsByType(data.metricsByType)
          }
        }
        if (activityRes.ok) {
          const data = await activityRes.json()
          setAgentActivity(data.agents || [])
        }
      }

      // Always load reminders, messages stats, conversations, patterns, automations, and learning stats
      const [remindersRes, msgStatsRes, convsHeaderRes, patternsRes, automationsRes, learningRes] = await Promise.all([
        fetch('/api/support/reminders?status=active', {
          headers: { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` }
        }),
        fetch('/api/support/messages/grouped', {
          headers: { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` }
        }),
        fetch('/api/support/conversations', { headers: { Authorization: authHeader } }),
        fetch('/api/support/patterns', { headers: { Authorization: authHeader } }),
        fetch('/api/support/automations', { headers: { Authorization: authHeader } }),
        fetch('/api/support/learning/stats', { headers: { Authorization: authHeader } }).catch(() => null)
      ])
      if (remindersRes.ok) {
        const data = await remindersRes.json()
        setReminders(data.reminders || [])
        setRemindersStats(data.stats || { active: 0, vague: 0, overdue: 0, completed: 0, escalated: 0 })
      }
      if (msgStatsRes.ok) {
        const data = await msgStatsRes.json()
        // Always update stats for badge, only update channels if on messages tab
        setMessagesStats(data.stats || {})
        if (activeTab === 'messages') {
          setGroupedMessages(data.channels || [])
        }
      }
      if (convsHeaderRes.ok) {
        const data = await convsHeaderRes.json()
        setTeamMetrics(data.metrics)
        if (data.metricsByType) {
          setMetricsByType(data.metricsByType)
        }
      }
      if (patternsRes.ok) {
        const data = await patternsRes.json()
        setAiPatterns(data.patterns)
      }
      if (automationsRes.ok) {
        const data = await automationsRes.json()
        setAutomations(data.automations || [])
      }
      // Load AI learning stats
      if (learningRes && learningRes.ok) {
        const data = await learningRes.json()
        if (data.summary) {
          setLearningStats({
            totalDialogs: data.summary.totalDialogs || 0,
            successRate: data.summary.successRate || 0,
            avgConfidence: data.summary.avgConfidence || 0
          })
        }
      }
    } catch (e) {
      console.error('Failed to load data:', e)
    } finally {
      setLoading(false)
    }
  }

  async function createCase() {
    if (!newCase.title.trim()) return
    setActionLoading(true)
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    
    try {
      const res = await fetch('/api/support/cases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
        },
        body: JSON.stringify(newCase)
      })
      
      if (res.ok) {
        setShowNewCaseModal(false)
        setNewCase({ title: '', description: '', category: 'general', priority: 'medium' })
        loadData()
      } else {
        const data = await res.json()
        alert(data.error || 'Ошибка создания кейса')
      }
    } catch (e) {
      alert('Ошибка создания кейса')
    } finally {
      setActionLoading(false)
    }
  }

  // Update case status (for kanban drag & drop)
  async function updateCaseStatus(caseId: string, newStatus: string) {
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    
    console.log('[Kanban] Updating case status:', { caseId, newStatus })
    
    // Block background refresh for 5 seconds
    lastCaseUpdateRef.current = Date.now()
    
    // Optimistic update
    setCases(prev => {
      const updated = prev.map(c => c.id === caseId ? { ...c, status: newStatus } : c)
      console.log('[Kanban] Optimistic update applied')
      return updated
    })
    
    try {
      const res = await fetch(`/api/support/cases/${caseId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      })
      
      const data = await res.json()
      console.log('[Kanban] API response:', { ok: res.ok, status: res.status, data })
      
      if (!res.ok) {
        // Revert on error - but only after blocking period ends
        console.error('[Kanban] Failed to update case status, reverting...')
        lastCaseUpdateRef.current = 0 // Allow refresh
        loadData()
      } else {
        console.log('[Kanban] Case status updated successfully!')
        // Keep blocking for a bit longer to let server sync
        setTimeout(() => {
          lastCaseUpdateRef.current = 0 // Allow refresh after successful update
        }, 3000)
      }
    } catch (e) {
      console.error('[Kanban] Error updating case status:', e)
      lastCaseUpdateRef.current = 0
      loadData()
    }
  }

  async function createChannel() {
    if (!newChannel.telegramChatId || !newChannel.name.trim()) return
    setActionLoading(true)
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    
    try {
      const res = await fetch('/api/support/channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
        },
        body: JSON.stringify({
          telegramChatId: parseInt(newChannel.telegramChatId),
          name: newChannel.name,
          type: newChannel.type
        })
      })
      
      if (res.ok) {
        setShowNewChannelModal(false)
        setNewChannel({ telegramChatId: '', name: '', type: 'client' })
        loadData()
      } else {
        const data = await res.json()
        alert(data.error || 'Ошибка добавления канала')
      }
    } catch (e) {
      alert('Ошибка добавления канала')
    } finally {
      setActionLoading(false)
    }
  }

  async function saveSettings() {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch('/api/support/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'admin'
        },
        body: JSON.stringify({ settings })
      })
      if (res.ok) {
        alert('Настройки сохранены')
      }
    } catch (e) {
      console.error('Failed to save settings:', e)
    } finally {
      setSaving(false)
    }
  }

  async function testBot() {
    setBotTestResult(null)
    try {
      const res = await fetch('/api/support/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'admin'
        },
        body: JSON.stringify({ action: 'test_bot' })
      })
      const data = await res.json()
      setBotTestResult(data)
    } catch (e) {
      setBotTestResult({ error: 'Connection failed' })
    }
  }

  function formatRelativeTime(dateStr: string) {
    if (!dateStr) return '—'
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    
    if (days > 0) return `${days}д назад`
    if (hours > 0) return `${hours}ч назад`
    if (minutes > 0) return `${minutes}м`
    return 'только что'
  }

  function formatWaitTime(dateStr: string) {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    
    if (days > 0) return `⏱ ${days}д ${hours % 24}ч`
    if (hours > 0) return `⏱ ${hours}ч ${minutes % 60}м`
    return `⏱ ${minutes}м`
  }

  // Загрузка контекста канала
  async function loadChannelContext(channelId: string) {
    setLoadingContext(true)
    setReplyText('')
    setSelectedTopic(null)
    setAiContext(null)
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    const authHeader = token.startsWith('Bearer') ? token : `Bearer ${token}`
    
    try {
      const res = await fetch(`/api/support/channels/${channelId}`, {
        headers: { Authorization: authHeader }
      })
      if (res.ok) {
        const data = await res.json()
        setSelectedChannel(data)
        
        // Load topics if forum
        loadChannelTopics(channelId)
        
        // Load AI context in background
        loadAiContext(channelId)
      }
    } catch (e) {
      console.error('Failed to load channel context:', e)
    } finally {
      setLoadingContext(false)
    }
  }
  
  // Загрузка AI контекста для канала
  async function loadAiContext(channelId: string) {
    setLoadingAiContext(true)
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    const authHeader = token.startsWith('Bearer') ? token : `Bearer ${token}`
    
    try {
      const res = await fetch(`/api/support/ai/context?channelId=${channelId}`, {
        headers: { Authorization: authHeader }
      })
      if (res.ok) {
        const data = await res.json()
        setAiContext({
          ...data.context,
          recentSuggestions: data.recentSuggestions || [],
          similarSolutions: data.similarSolutions || []
        })
        
        // Set similar dialogs from learning database
        if (data.similarDialogs && data.similarDialogs.length > 0) {
          setSimilarDialogs(data.similarDialogs)
        } else {
          setSimilarDialogs([])
        }
        
        // Set similar dialogs from learning database
        if (data.similarDialogs && data.similarDialogs.length > 0) {
          setSimilarDialogs(data.similarDialogs)
        } else {
          setSimilarDialogs([])
        }
        
        // Используем статьи из базы знаний напрямую из API (AI уже нашёл релевантные)
        if (data.knowledgeBaseArticles && data.knowledgeBaseArticles.length > 0) {
          setAutoDocsResults(data.knowledgeBaseArticles.map((a: any) => ({
            id: a.id,
            title: a.title,
            url: a.url,
            category: a.category
          })))
        } else {
          // Fallback: поиск на клиенте если API не вернул статьи
          const searchTerms: string[] = []
          
          // Добавляем keyTopics
          if (data.context?.keyTopics?.length > 0) {
            searchTerms.push(...data.context.keyTopics)
          }
          
          // Добавляем слова из mainIssues
          if (data.context?.mainIssues?.length > 0) {
            data.context.mainIssues.forEach((issue: string) => {
              const words = issue.split(/\s+/).filter((w: string) => w.length > 3)
              searchTerms.push(...words.slice(0, 3))
            })
          }
          
          // Добавляем слова из summary
          if (data.context?.summary) {
            const words = data.context.summary.split(/\s+/).filter((w: string) => w.length > 4)
            searchTerms.push(...words.slice(0, 5))
          }
          
          // Ищем если есть термины
          if (searchTerms.length > 0) {
            searchDocsAuto([...new Set(searchTerms)])
          } else {
            // Очищаем если нет терминов
            setAutoDocsResults([])
          }
        }
      }
    } catch (e) {
      console.error('Failed to load AI context:', e)
    } finally {
      setLoadingAiContext(false)
    }
  }

  // Поиск по документации GitBook
  async function searchDocs(query: string) {
    if (!query || query.length < 2) {
      setDocsSearchResults([])
      return
    }
    
    setSearchingDocs(true)
    try {
      const res = await fetch(`/api/support/docs/search?q=${encodeURIComponent(query)}&limit=5`)
      if (res.ok) {
        const data = await res.json()
        setDocsSearchResults(data.results || [])
      }
    } catch (e) {
      console.error('Failed to search docs:', e)
    } finally {
      setSearchingDocs(false)
    }
  }

  // Автоматический поиск документации по контексту разговора
  async function searchDocsAuto(keywords: string[]) {
    if (!keywords || keywords.length === 0) return
    
    try {
      // Делаем несколько поисковых запросов для лучшего покрытия
      const uniqueKeywords = [...new Set(keywords.map(k => k.toLowerCase().trim()).filter(k => k.length > 2))]
      
      // Запрос 1: все ключевые слова вместе
      const fullQuery = uniqueKeywords.slice(0, 5).join(' ')
      
      // Запрос 2: первые 2-3 самых важных слова
      const shortQuery = uniqueKeywords.slice(0, 2).join(' ')
      
      const results: Array<{ id: number; title: string; url: string; category: string; score: number }> = []
      
      // Параллельно выполняем оба запроса
      const [fullRes, shortRes] = await Promise.all([
        fetch(`/api/support/docs/search?q=${encodeURIComponent(fullQuery)}&limit=5`).catch(() => null),
        fullQuery !== shortQuery 
          ? fetch(`/api/support/docs/search?q=${encodeURIComponent(shortQuery)}&limit=3`).catch(() => null)
          : Promise.resolve(null)
      ])
      
      // Собираем результаты
      if (fullRes?.ok) {
        const data = await fullRes.json()
        data.results?.forEach((r: any, i: number) => {
          results.push({ id: r.id, title: r.title, url: r.url, category: r.category, score: 10 - i })
        })
      }
      
      if (shortRes?.ok) {
        const data = await shortRes.json()
        data.results?.forEach((r: any, i: number) => {
          const existing = results.find(x => x.id === r.id)
          if (existing) {
            existing.score += 5 - i // Увеличиваем score если найден в обоих запросах
          } else {
            results.push({ id: r.id, title: r.title, url: r.url, category: r.category, score: 5 - i })
          }
        })
      }
      
      // Сортируем по score и берём топ-5
      const topResults = results
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(({ id, title, url, category }) => ({ id, title, url, category }))
      
      setAutoDocsResults(topResults)
    } catch (e) {
      // Ignore auto-search errors
    }
  }

  // Загрузка preview для массовой рассылки
  async function loadBroadcastPreview(filter: 'all' | 'active') {
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    const authHeader = token.startsWith('Bearer') ? token : `Bearer ${token}`
    
    try {
      // Загружаем preview, статистику и запланированные параллельно
      const [previewRes, statsRes, scheduledRes] = await Promise.all([
        fetch(`/api/support/broadcast/preview?filter=${filter}`),
        fetch('/api/support/broadcast/stats'),
        fetch('/api/support/broadcast/schedule?status=pending', {
          headers: { Authorization: authHeader }
        })
      ])
      
      if (previewRes.ok) {
        const data = await previewRes.json()
        setBroadcastPreview({ count: data.count, channels: data.channels })
      }
      
      if (statsRes.ok) {
        const statsData = await statsRes.json()
        if (statsData.recent) {
          setBroadcastHistory(statsData.recent)
        }
      }
      
      if (scheduledRes.ok) {
        const scheduledData = await scheduledRes.json()
        if (scheduledData.scheduled) {
          setScheduledBroadcasts(scheduledData.scheduled)
        }
      }
    } catch (e) {
      console.error('Failed to load broadcast preview:', e)
    }
  }
  
  // Отправка массовой рассылки
  async function sendBroadcast() {
    if (!broadcastMessage.trim()) return
    
    // Определяем количество получателей
    const totalRecipients = broadcastFilter === 'selected' 
      ? selectedBroadcastChannels.size 
      : (broadcastPreview?.count || 0)
    
    if (totalRecipients === 0) return
    
    setSendingBroadcast(true)
    setBroadcastResult(null)
    setBroadcastProgress({ sent: 0, total: totalRecipients })
    
    try {
      const agentData = localStorage.getItem('support_agent_data')
      const senderName = agentData ? JSON.parse(agentData).name : 'Delever Support'
      const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
      
      // Если выборочно - передаём список каналов, иначе используем исключения
      const excludeChannels = broadcastFilter === 'selected' && broadcastPreview?.channels
        ? broadcastPreview.channels
            .filter(ch => !selectedBroadcastChannels.has(ch.id))
            .map(ch => ch.id)
        : []
      
      const res = await fetch('/api/support/broadcast/send', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
        },
        body: JSON.stringify({
          message: broadcastMessage,
          type: broadcastType,
          filter: broadcastFilter === 'selected' ? 'all' : broadcastFilter,
          excludeChannels,
          senderName
        })
      })
      
      if (res.ok) {
        const data = await res.json()
        setBroadcastProgress({ sent: data.stats.successful + data.stats.failed, total: totalRecipients })
        setBroadcastResult({ 
          successful: data.stats.successful, 
          failed: data.stats.failed,
          broadcastId: data.broadcastId
        })
        
        // Обновляем историю
        loadBroadcastPreview(broadcastFilter === 'selected' ? 'all' : broadcastFilter)
        
        // Clear form after success (don't close modal to allow cancel)
        if (data.stats.failed === 0) {
          setBroadcastMessage('')
          setSelectedBroadcastChannels(new Set())
        }
      } else {
        const error = await res.json()
        alert('Ошибка: ' + error.error)
      }
    } catch (e) {
      console.error('Failed to send broadcast:', e)
      alert('Ошибка отправки рассылки')
    } finally {
      setSendingBroadcast(false)
      setBroadcastProgress(null)
    }
  }

  // Загрузка топиков канала
  async function loadChannelTopics(channelId: string) {
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    try {
      const res = await fetch(`/api/support/topics?channelId=${channelId}`, {
        headers: { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setChannelTopics(data.topics || [])
      }
    } catch (e) {
      console.error('Failed to load topics:', e)
      setChannelTopics([])
    }
  }

  // Отправка сообщения с МГНОВЕННЫМ оптимистичным UI
  async function sendMessage() {
    // Получаем выбранный канал из expandedChannels
    const selectedChannelId = Array.from(expandedChannels)[0]
    if (!selectedChannelId || !replyText.trim()) return
    
    const messageText = replyText.trim()
    const tempId = `temp_${Date.now()}`
    const agentData = localStorage.getItem('support_agent_data')
    const currentAgentName = agentData ? JSON.parse(agentData).name : 'Support'
    
    // Оптимистичное сообщение
    const optimisticMessage = {
      id: tempId,
      senderName: currentAgentName,
      senderRole: 'support',
      text: messageText,
      contentType: 'text',
      createdAt: new Date().toISOString(),
      isRead: true
    }
    
    // МГНОВЕННО добавляем в groupedMessages
    setGroupedMessages(prev => prev.map(ch => 
      ch.id === selectedChannelId 
        ? { 
            ...ch, 
            recentMessages: [...ch.recentMessages, optimisticMessage],
            lastMessagePreview: messageText,
            lastSenderName: 'Support',
            lastMessageAt: new Date().toISOString(),
            awaitingReply: false
          }
        : ch
    ))
    
    // Очищаем поле ввода СРАЗУ
    setReplyText('')
    
    // Отправка в фоне (не блокируем UI)
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    fetch('/api/support/messages/send', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
      },
      body: JSON.stringify({
        channelId: selectedChannelId,
        text: messageText,
        threadId: selectedTopic,
        senderName: currentAgentName
      })
    }).then(res => {
      if (!res.ok) {
        // Откат при ошибке
        setGroupedMessages(prev => prev.map(ch => 
          ch.id === selectedChannelId 
            ? { ...ch, recentMessages: ch.recentMessages.filter((m: any) => m.id !== tempId) }
            : ch
        ))
        setReplyText(messageText)
        res.json().then(error => alert('Ошибка: ' + (error.details || error.error)))
      }
    }).catch(e => {
      // Откат при ошибке
      setGroupedMessages(prev => prev.map(ch => 
        ch.id === selectedChannelId 
          ? { ...ch, recentMessages: ch.recentMessages.filter((m: any) => m.id !== tempId) }
          : ch
      ))
      setReplyText(messageText)
      console.error('Failed to send message:', e)
    })
  }

  // Обновление настроек канала
  async function updateChannel(channelId: string, updates: { type?: string; name?: string }) {
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    try {
      const res = await fetch('/api/support/channels', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
        },
        body: JSON.stringify({ id: channelId, ...updates })
      })
      
      if (res.ok) {
        setEditingChannel(null)
        loadData() // Reload channels
        if (selectedChannel?.channel.id === channelId) {
          loadChannelContext(channelId)
        }
      }
    } catch (e) {
      console.error('Failed to update channel:', e)
    }
  }

  // Mark messages as read
  async function markAsRead(messageId?: string, channelId?: string) {
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    try {
      const res = await fetch('/api/support/messages/read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
        },
        body: JSON.stringify(messageId ? { messageId } : { channelId })
      })
      
      if (res.ok) {
        // Reload messages
        loadData()
      }
    } catch (e) {
      console.error('Failed to mark as read:', e)
    }
  }

  // Mark channel as unread (to return later)
  async function markChannelUnread(channelId: string) {
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    try {
      await fetch('/api/support/channels/mark-unread', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
        },
        body: JSON.stringify({ channelId })
      })
      loadData()
    } catch (e) {
      console.error('Failed to mark channel unread:', e)
    }
  }

  // Preview channel (open without marking as read)
  function previewChannel(channelId: string) {
    setPreviewChannelId(channelId)
    setExpandedChannels(new Set([channelId]))
    setExpandedTopics(new Set())
    setSelectedTopic(null)
    setChannelTopics([])
    loadAiContext(channelId)
    // Don't mark as read - that's the point of preview!
  }

  // Local reactions state for optimistic updates
  const [localReactions, setLocalReactions] = useState<Record<string, Record<string, { count: number; users: string[] }>>>({})

  // Send reaction to message (toggle: add if not exists, remove if exists)
  async function sendReaction(messageId: string, emoji: string, serverReactions?: Record<string, any>) {
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    
    // Check if user already has this reaction
    const currentReactions = localReactions[messageId] || serverReactions || {}
    const existing = currentReactions[emoji]
    const hasMyReaction = existing?.users?.includes('Вы')
    
    // Optimistic update - toggle reaction
    setLocalReactions(prev => {
      const msgReactions = prev[messageId] || serverReactions || {}
      const existingEmoji = msgReactions[emoji] || { count: 0, users: [] }
      
      if (hasMyReaction) {
        // Remove reaction
        const newUsers = existingEmoji.users.filter((u: string) => u !== 'Вы')
        const newCount = Math.max(0, existingEmoji.count - 1)
        if (newCount === 0) {
          const { [emoji]: _, ...rest } = msgReactions
          return { ...prev, [messageId]: rest }
        }
        return {
          ...prev,
          [messageId]: {
            ...msgReactions,
            [emoji]: { count: newCount, users: newUsers }
          }
        }
      } else {
        // Add reaction
        return {
          ...prev,
          [messageId]: {
            ...msgReactions,
            [emoji]: {
              count: existingEmoji.count + 1,
              users: [...existingEmoji.users, 'Вы']
            }
          }
        }
      }
    })
    setShowReactionPicker(null)
    
    try {
      const res = await fetch('/api/support/messages/react', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
        },
        body: JSON.stringify({ messageId, emoji, action: 'toggle' })
      })
      
      if (res.ok) {
        const data = await res.json()
        // Update with server response
        if (data.reactions) {
          setLocalReactions(prev => ({
            ...prev,
            [messageId]: data.reactions
          }))
        }
      }
    } catch (e) {
      console.error('Failed to toggle reaction:', e)
      // Revert on error - reload from server
      loadData()
    }
  }

  // Merge server reactions with local optimistic reactions
  function getMergedReactions(msgId: string, serverReactions: Record<string, any> | undefined) {
    const local = localReactions[msgId] || {}
    const server = serverReactions || {}
    const merged: Record<string, { count: number; users: string[] }> = { ...server }
    
    for (const [emoji, data] of Object.entries(local)) {
      if (merged[emoji]) {
        // Don't double count if server already has it
      } else {
        merged[emoji] = data
      }
    }
    return merged
  }

  // Copy text to clipboard
  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
    setContextMenu(null)
  }

  // Delete message (own messages only)
  async function deleteMessage(messageId: string, telegramMessageId?: number) {
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    
    try {
      const res = await fetch('/api/support/messages/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
        },
        body: JSON.stringify({ messageId, telegramMessageId })
      })
      
      if (res.ok) {
        // Remove from UI
        setGroupedMessages(prev => prev.map(ch => ({
          ...ch,
          recentMessages: ch.recentMessages.filter((m: any) => m.id !== messageId)
        })))
        setContextMenu(null)
      } else {
        const error = await res.json()
        alert(error.error || 'Ошибка удаления')
      }
    } catch (e) {
      console.error('Failed to delete message:', e)
      alert('Ошибка удаления сообщения')
    }
  }

  // Create case/ticket from message
  async function createCaseFromMessage(messageId: string, text: string, channelId?: string) {
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    try {
      const res = await fetch('/api/support/cases/from-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
        },
        body: JSON.stringify({ messageId, description: text, channelId })
      })
      if (res.ok) {
        const data = await res.json()
        // Обновляем локально сообщение чтобы показать ссылку на тикет
        setGroupedMessages(prev => prev.map(ch => ({
          ...ch,
          recentMessages: ch.recentMessages.map((m: any) => 
            m.id === messageId ? { ...m, caseId: data.caseId } : m
          )
        })))
        loadData()
      } else {
        alert('Ошибка создания тикета')
      }
    } catch (e) {
      console.error('Failed to create case:', e)
      alert('Ошибка создания тикета')
    }
  }

  // Escalate message
  async function escalateMessage(messageId: string) {
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    try {
      const res = await fetch('/api/support/messages/escalate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
        },
        body: JSON.stringify({ messageId })
      })
      if (res.ok) {
        alert('Сообщение эскалировано')
        loadData()
      } else {
        alert('Ошибка эскалации')
      }
    } catch (e) {
      console.error('Failed to escalate:', e)
      alert('Ошибка эскалации')
    }
  }

  // Voice recording state
  const [recordingChannelId, setRecordingChannelId] = useState<string | null>(null)

  // Voice recording functions
  async function startRecording(channelId: string) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []
      setRecordingChannelId(channelId)

      mediaRecorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data)
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingTime(0)
      
      // Start timer
      const interval = setInterval(() => {
        setRecordingTime(prev => prev + 1)
      }, 1000)
      ;(mediaRecorderRef.current as any).intervalId = interval
      ;(mediaRecorderRef.current as any).stream = stream
    } catch (err) {
      console.error('Failed to start recording:', err)
      alert('Не удалось получить доступ к микрофону')
    }
  }

  async function stopRecording() {
    if (mediaRecorderRef.current && isRecording && recordingChannelId) {
      const channelId = recordingChannelId
      
      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/ogg' })
        const audioFile = new File([audioBlob], 'voice.ogg', { type: 'audio/ogg' })
        
        // Send voice message
        await sendChatMessage(channelId, '', [audioFile])
        
        // Cleanup
        ;(mediaRecorderRef.current as any)?.stream?.getTracks().forEach((track: any) => track.stop())
        audioChunksRef.current = []
      }
      
      mediaRecorderRef.current.stop()
      clearInterval((mediaRecorderRef.current as any).intervalId)
      setIsRecording(false)
      setRecordingTime(0)
      setRecordingChannelId(null)
    }
  }

  function cancelRecording() {
    if (mediaRecorderRef.current && isRecording) {
      ;(mediaRecorderRef.current as any)?.stream?.getTracks().forEach((track: any) => track.stop())
      clearInterval((mediaRecorderRef.current as any).intervalId)
      setIsRecording(false)
      setRecordingTime(0)
      setRecordingChannelId(null)
      audioChunksRef.current = []
    }
  }

  function formatRecordingTime(seconds: number) {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Close pickers when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('.emoji-picker-container')) {
        setShowEmojiPicker(false)
      }
      if (!target.closest('.attach-menu-container')) {
        setShowAttachMenu(false)
      }
      if (!target.closest('.reaction-picker-container')) {
        setShowReactionPicker(null)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // Send message from chat (text + files) - МГНОВЕННЫЙ оптимистичный UI + real-time
  function sendChatMessage(channelId: string, text: string, files?: File[]) {
    if (!text.trim() && (!files || files.length === 0)) return
    
    const messageText = text.trim()
    const tempId = `temp_${Date.now()}`
    const agentData = localStorage.getItem('support_agent_data')
    const currentAgentName = agentData ? JSON.parse(agentData).name : 'Support'
    
    // Сохраняем данные ответа до очистки
    const replyData = replyToMessage ? { ...replyToMessage } : null
    
    // МГНОВЕННО добавляем сообщение в UI со статусом "отправляется"
    const optimisticMessage: any = {
      id: tempId,
      senderName: currentAgentName,
      senderRole: 'support',
      text: messageText,
      contentType: files && files.length > 0 ? 'document' : 'text',
      createdAt: new Date().toISOString(),
      isRead: true,
      isSending: true, // Статус отправки
      threadId: selectedTopic,
      replyToMessageId: replyData?.telegramMessageId || replyData?.id,
      replyToText: replyData?.text,
      replyToSender: replyData?.senderName
    }
    
    setGroupedMessages(prev => prev.map(ch => 
      ch.id === channelId 
        ? { 
            ...ch, 
            recentMessages: [...ch.recentMessages, optimisticMessage],
            lastMessagePreview: messageText || '📎 Файл',
            lastSenderName: currentAgentName,
            lastMessageAt: new Date().toISOString(),
            awaitingReply: false
          }
        : ch
    ))
    
    // Очищаем поля СРАЗУ
    setReplyText('')
    setAttachedFiles([])
    setReplyToMessage(null)
    
    // Scroll к последнему сообщению
    setTimeout(() => scrollToBottom(true), 50)
    
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    const authHeader = token.startsWith('Bearer') ? token : `Bearer ${token}`
    
    // Отправка в фоне (не блокируем UI!)
    const sendInBackground = async () => {
      try {
        if (files && files.length > 0) {
          for (const file of files) {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('channelId', channelId)
            formData.append('caption', messageText)
            formData.append('senderName', currentAgentName)
            if (selectedTopic) {
              formData.append('threadId', selectedTopic.toString())
            }
            if (replyData?.telegramMessageId) {
              formData.append('replyToMessageId', replyData.telegramMessageId.toString())
            }
            
            await fetch('/api/support/messages/send-media', {
              method: 'POST',
              headers: { Authorization: authHeader },
              body: formData
            })
          }
        } else {
          await fetch('/api/support/messages/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader
            },
            body: JSON.stringify({
              channelId,
              text: messageText,
              threadId: selectedTopic,
              senderName: currentAgentName,
              replyToMessageId: replyData?.telegramMessageId
            })
          })
        }
        
        // Убираем статус "отправляется" после успеха
        setGroupedMessages(prev => prev.map(ch => 
          ch.id === channelId 
            ? { 
                ...ch, 
                recentMessages: ch.recentMessages.map((m: any) => 
                  m.id === tempId ? { ...m, isSending: false } : m
                )
              }
            : ch
        ))
        
        // Принудительное обновление данных через 500мс для синхронизации
        setTimeout(() => loadData(true), 500)
        
        // Track activity (message sent)
        const currentAgentId = localStorage.getItem('support_agent_id')
        if (currentAgentId) {
          fetch('/api/support/agents/activity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: authHeader },
            body: JSON.stringify({ agentId: currentAgentId, action: 'activity', metadata: { type: 'message_sent', channelId } })
          }).catch(() => {})
        }
      } catch (e) {
        // Откат при ошибке
        setGroupedMessages(prev => prev.map(ch => 
          ch.id === channelId 
            ? { ...ch, recentMessages: ch.recentMessages.filter((m: any) => m.id !== tempId) }
            : ch
        ))
        setReplyText(messageText)
        console.error('Failed to send message:', e)
      }
    }
    
    sendInBackground()
  }

  // Format waiting time
  function formatWaitingTime(lastClientMessageAt: string | null): string {
    if (!lastClientMessageAt) return ''
    const diff = Date.now() - new Date(lastClientMessageAt).getTime()
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(mins / 60)
    const days = Math.floor(hours / 24)
    
    if (days > 0) return `${days}д ${hours % 24}ч`
    if (hours > 0) return `${hours}ч ${mins % 60}м`
    return `${mins}м`
  }

  // Handle reminder actions
  async function handleReminderAction(reminderId: string, action: 'complete' | 'extend' | 'dismiss', extendMinutes?: number) {
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    try {
      const res = await fetch('/api/support/reminders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
        },
        body: JSON.stringify({ reminderId, action, extendMinutes })
      })
      
      if (res.ok) {
        // Reload reminders
        const remindersRes = await fetch('/api/support/reminders?status=active', {
          headers: { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` }
        })
        if (remindersRes.ok) {
          const data = await remindersRes.json()
          setReminders(data.reminders || [])
          setRemindersStats(data.stats || { active: 0, vague: 0, overdue: 0, completed: 0, escalated: 0 })
        }
      }
    } catch (e) {
      console.error('Failed to update reminder:', e)
    }
  }

  // Цветовая система эскалации по urgency (0-5)
  function getUrgencyColor(urgency: number) {
    if (urgency >= 5) return { bg: 'bg-red-500', text: 'text-white', border: 'border-red-500', label: 'Критично', pulse: true }
    if (urgency >= 4) return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-500', label: 'Срочно', pulse: false }
    if (urgency >= 3) return { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-500', label: 'Важно', pulse: false }
    if (urgency >= 2) return { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-500', label: 'Внимание', pulse: false }
    return { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-500', label: 'Норма', pulse: false }
  }

  // Расчёт urgency канала на основе времени ожидания
  function getChannelUrgency(ch: SupportChannel): number {
    if (!ch.awaitingReply || !ch.lastClientMessageAt) return 0
    const hours = (Date.now() - new Date(ch.lastClientMessageAt).getTime()) / (1000 * 60 * 60)
    if (hours >= 24) return 5 // критично
    if (hours >= 8) return 4  // срочно
    if (hours >= 4) return 3  // важно
    if (hours >= 1) return 2  // внимание
    return 1 // норма
  }

  const filteredCases = cases.filter(c => 
    !searchQuery || 
    c.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.companyName?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Если нет авторизации - показываем загрузку (редирект в процессе)
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-brand-blue border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-500">Перенаправление...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Notification Toast Container */}
      <div className="fixed top-4 right-4 z-[100] space-y-2 max-w-sm">
        {notifications.filter(n => !n.read).map(notif => {
          const urgencyColors = {
            low: 'bg-slate-100 border-slate-300',
            medium: 'bg-yellow-50 border-yellow-400',
            high: 'bg-orange-50 border-orange-500',
            critical: 'bg-red-50 border-red-500 animate-pulse'
          }
          return (
            <div
              key={notif.id}
              onClick={() => {
                if (notif.channelId) {
                  setExpandedChannels(new Set([notif.channelId]))
                  setActiveTab('messages')
                }
                setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n))
              }}
              className={`${urgencyColors[notif.urgency]} border-l-4 rounded-lg p-4 shadow-lg cursor-pointer hover:shadow-xl transition-all`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 text-sm">{notif.title}</div>
                  <div className="text-xs text-slate-600 truncate mt-1">{notif.body}</div>
                </div>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n))
                  }}
                  className="p-1 hover:bg-slate-200 rounded"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      
      {/* Header - Минималистичный дизайн */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        {/* Top info bar: Weather, Clock, News - скрыт на мобильном */}
        <div className="hidden sm:block bg-slate-800 text-white px-4 py-1.5">
          <div className="flex items-center justify-between text-xs">
            {/* Weather */}
            <div className="flex items-center gap-2" title={weather?.description || 'Загрузка погоды...'}>
              {weather ? (
                <>
                  <span className="text-base">{weather.icon}</span>
                  <span className="font-medium">{weather.temp}°C</span>
                  <span className="text-slate-400 hidden sm:inline">Ташкент</span>
                </>
              ) : (
                <span className="text-slate-400">☁️ ...</span>
              )}
            </div>
            
            {/* News ticker */}
            <div className="flex-1 mx-4 overflow-hidden hidden md:block">
              {newsItems.length > 0 ? (
                <a 
                  href={newsItems[currentNewsIndex]?.link} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 hover:text-blue-300 transition-colors"
                >
                  <span className="text-red-400 font-medium flex-shrink-0">📰 НОВОСТИ</span>
                  <span className="truncate">{newsItems[currentNewsIndex]?.title}</span>
                </a>
              ) : (
                <span className="text-slate-400">Загрузка новостей...</span>
              )}
            </div>
            
            {/* Clock */}
            <div className="flex items-center gap-2 font-mono">
              <span className="text-slate-400">🕐</span>
              <span className="font-medium">{currentTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span className="text-slate-400 hidden sm:inline">
                {currentTime.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })}
              </span>
            </div>
          </div>
        </div>
        
        <div className="max-w-full mx-auto px-2 md:px-4 py-2 md:py-3 flex items-center justify-between">
          {/* Левая часть: Логотип */}
          <div className="flex items-center gap-1 md:gap-3">
            <button
              onClick={() => navigate('/')}
              className="hover:opacity-80 transition-opacity flex-shrink-0"
            >
              <Logo variant="horizontal" height={24} />
            </button>
            <span className="text-slate-300 hidden md:inline">|</span>
            <span className="text-sm font-medium text-slate-600 hidden md:inline">Поддержка</span>
          </div>

          {/* Центр: Ключевые метрики SLA (компактно) */}
          <div className="hidden md:flex items-center gap-2 lg:gap-3">
            {/* Ожидают ответа */}
            {(() => {
              const awaitingCount = groupedMessages.filter((ch: any) => ch.awaitingReply).length
              const awaitingChannels = groupedMessages.filter((ch: any) => ch.awaitingReply && ch.lastClientMessageAt)
              const maxWaitingMs = awaitingChannels.length > 0 
                ? Math.max(...awaitingChannels.map((ch: any) => Date.now() - new Date(ch.lastClientMessageAt).getTime()))
                : 0
              const maxWaitingMins = Math.floor(maxWaitingMs / 60000)
              
              return awaitingCount > 0 ? (
                <button 
                  onClick={() => setShowUnansweredModal(true)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer hover:opacity-80 transition-opacity ${
                    maxWaitingMins > 30 ? 'bg-red-100 text-red-700' : 
                    maxWaitingMins > 10 ? 'bg-orange-100 text-orange-700' : 
                    'bg-yellow-100 text-yellow-700'
                  }`}
                  title={`${awaitingCount} чатов ожидают ответа. Нажмите для просмотра`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span className="font-semibold">{awaitingCount}</span>
                  <span className="opacity-75">ждут</span>
                </button>
              ) : (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-green-100 text-green-700">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>OK</span>
                </div>
              )
            })()}
            
            {/* SLA Метрики (кликабельные) */}
            {teamMetrics && (
              <>
                {/* Среднее время ответа */}
                <button 
                  onClick={() => setShowSlaModal('response')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer hover:opacity-80 transition-opacity ${
                    teamMetrics.avgFirstResponseMin > 15 ? 'bg-red-100 text-red-700' :
                    teamMetrics.avgFirstResponseMin > 5 ? 'bg-orange-100 text-orange-700' :
                    'bg-green-100 text-green-700'
                  }`}
                  title="Нажмите для детальной информации"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span className="font-semibold">{Math.round(teamMetrics.avgFirstResponseMin)}м</span>
                  <span className="opacity-75 hidden lg:inline">ответ</span>
                </button>
                
                {/* Среднее время решения */}
                <button 
                  onClick={() => setShowSlaModal('resolution')}
                  className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer hover:opacity-80 transition-opacity ${
                    teamMetrics.avgResolutionMin > 120 ? 'bg-red-100 text-red-700' :
                    teamMetrics.avgResolutionMin > 60 ? 'bg-orange-100 text-orange-700' :
                    'bg-green-100 text-green-700'
                  }`}
                  title="Нажмите для детальной информации"
                >
                  <Timer className="w-3.5 h-3.5" />
                  <span className="font-semibold">
                    {teamMetrics.avgResolutionMin >= 60 
                      ? `${Math.round(teamMetrics.avgResolutionMin / 60)}ч` 
                      : `${Math.round(teamMetrics.avgResolutionMin)}м`}
                  </span>
                  <span className="opacity-75">решение</span>
                </button>
                
                {/* % SLA */}
                {(() => {
                  const totalConvs = teamMetrics.totalConversations || 1
                  const resolved = teamMetrics.resolvedToday || 0
                  const slaPercent = totalConvs > 0 ? Math.round((resolved / totalConvs) * 100) : 100
                  return (
                    <button 
                      onClick={() => setShowSlaModal('percent')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer hover:opacity-80 transition-opacity ${
                        slaPercent < 70 ? 'bg-red-100 text-red-700' :
                        slaPercent < 90 ? 'bg-orange-100 text-orange-700' :
                        'bg-green-100 text-green-700'
                      }`}
                      title="Нажмите для детальной информации"
                    >
                      <TrendingUp className="w-3.5 h-3.5" />
                      <span className="font-semibold">{slaPercent}%</span>
                      <span className="opacity-75 hidden lg:inline">SLA</span>
                    </button>
                  )
                })()}
                
                {/* Просроченные SLA */}
                {remindersStats.overdue > 0 && (
                  <div 
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-red-100 text-red-700 animate-pulse"
                    title={`${remindersStats.overdue} просроченных обязательств`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span className="font-semibold">{remindersStats.overdue}</span>
                    <span className="opacity-75 hidden lg:inline">просроч.</span>
                  </div>
                )}
              </>
            )}
            
            {/* Геймификация - Лидерборд виджет */}
            {(() => {
              // Вычисляем очки и рейтинг агентов на основе их метрик
              const agentScores = agents.map(a => {
                const points = 
                  (a.metrics?.messagesHandled || 0) * GAMIFICATION.POINTS.MESSAGE_SENT +
                  (a.metrics?.resolvedConversations || 0) * GAMIFICATION.POINTS.CASE_RESOLVED
                return { ...a, points }
              }).sort((a, b) => b.points - a.points)
              
              const currentAgentId = localStorage.getItem('support_agent_id')
              const currentAgent = agentScores.find(a => a.id === currentAgentId)
              const currentRank = currentAgent ? agentScores.findIndex(a => a.id === currentAgentId) + 1 : 0
              const currentLevel = currentAgent ? getAgentLevel(currentAgent.points) : getAgentLevel(0)
              const topAgent = agentScores[0]
              
              return (
                <button
                  onClick={() => setShowLeaderboard(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-100 to-pink-100 hover:from-purple-200 hover:to-pink-200 rounded-full text-xs transition-all cursor-pointer border border-purple-200"
                  title="Открыть рейтинг сотрудников"
                >
                  <span className="text-base">{currentLevel.icon}</span>
                  <div className="flex flex-col items-start leading-tight">
                    <span className="font-bold text-purple-700">#{currentRank || '?'}</span>
                    <span className="text-[10px] text-purple-500 hidden lg:inline">{currentAgent?.points || 0} очк.</span>
                  </div>
                  {topAgent && topAgent.id !== currentAgentId && (
                    <div className="hidden lg:flex items-center gap-1 pl-2 border-l border-purple-200">
                      <span className="text-yellow-500">👑</span>
                      <span className="text-purple-600 font-medium truncate max-w-[60px]">{topAgent.name?.split(' ')[0]}</span>
                    </div>
                  )}
                </button>
              )
            })()}
          </div>
          
          {/* Правая часть: Действия */}
          <div className="flex items-center gap-1 md:gap-2">
            {/* Мобильный badge ожидания */}
            {(() => {
              const awaitingCount = groupedMessages.filter((ch: any) => ch.awaitingReply).length
              return awaitingCount > 0 ? (
                <div className="md:hidden flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-xs">
                  <Clock className="w-3 h-3" />
                  <span className="font-medium">{awaitingCount}</span>
                </div>
              ) : null
            })()}
            
            {/* Звук - скрыт на мобильном */}
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`hidden md:flex p-2 rounded-lg transition-colors ${soundEnabled ? 'text-green-600 hover:bg-green-50' : 'text-slate-400 hover:bg-slate-100'}`}
              title={soundEnabled ? 'Звук вкл' : 'Звук выкл'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
            
            {/* Уведомления */}
            <button
              onClick={() => setNotifications(prev => prev.map(n => ({ ...n, read: true })))}
              className={`p-2 rounded-lg transition-colors relative ${
                notifications.filter(n => !n.read).length > 0 
                  ? 'text-red-600 hover:bg-red-50' 
                  : 'text-slate-400 hover:bg-slate-100'
              }`}
              title="Уведомления"
            >
              <Bell className="w-4 h-4" />
              {notifications.filter(n => !n.read).length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
                  {notifications.filter(n => !n.read).length}
                </span>
              )}
            </button>
            
            {/* Массовая рассылка - скрыт на мобильном */}
            <button
              onClick={() => {
                setShowBroadcastModal(true)
                loadBroadcastPreview(broadcastFilter === 'selected' ? 'all' : broadcastFilter)
              }}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors text-sm"
              title="Массовая рассылка"
            >
              <Megaphone className="w-4 h-4" />
              <span className="hidden lg:inline">Рассылка</span>
            </button>
            
            {/* Календарь событий */}
            <button
              onClick={async () => {
                setShowCalendarModal(true)
                // Загружаем запланированные рассылки
                try {
                  const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
                  const res = await fetch('/api/support/broadcast/schedule?status=pending', {
                    headers: { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` }
                  })
                  if (res.ok) {
                    const data = await res.json()
                    if (data.scheduled) setScheduledBroadcasts(data.scheduled)
                  }
                } catch {}
              }}
              className="hidden md:flex items-center gap-1 p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors relative"
              title="Календарь событий"
            >
              <Calendar className="w-4 h-4" />
              {reminders.filter(r => r.status === 'active').length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-white text-[10px] rounded-full flex items-center justify-center">
                  {reminders.filter(r => r.status === 'active').length}
                </span>
              )}
            </button>
            
            {/* Руководство */}
            <a
              href="/support/guide"
              className="hidden md:flex items-center gap-1 p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
              title="Руководство пользователя"
            >
              <Book className="w-4 h-4" />
            </a>
            
            {/* Обновить - скрыт на мобильном */}
            <button
              onClick={() => loadData()}
              className="hidden md:flex p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
              title="Обновить данные"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            
            {/* Профиль */}
            {(() => {
              const agentData = localStorage.getItem('support_agent_data')
              const agent = agentData ? JSON.parse(agentData) : null
              return agent ? (
                <button 
                  onClick={async () => {
                    // Сначала показываем из localStorage
                    setProfileForm({
                      name: agent.name || '',
                      email: agent.email || '',
                      phone: agent.phone || '',
                      telegram: agent.username || '',
                      position: agent.position || '',
                      department: agent.department || ''
                    })
                    setShowProfileModal(true)
                    
                    // Загружаем свежие данные с сервера
                    try {
                      const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
                      const res = await fetch(`/api/support/agents?id=${agent.id}`, {
                        headers: { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` }
                      })
                      if (res.ok) {
                        const data = await res.json()
                        const freshAgent = data.agents?.[0] || data.agent
                        if (freshAgent) {
                          setProfileForm({
                            name: freshAgent.name || '',
                            email: freshAgent.email || '',
                            phone: freshAgent.phone || '',
                            telegram: freshAgent.username || '',
                            position: freshAgent.position || '',
                            department: freshAgent.department || ''
                          })
                          // Обновляем localStorage
                          localStorage.setItem('support_agent_data', JSON.stringify({
                            ...agent,
                            ...freshAgent
                          }))
                        }
                      }
                    } catch (e) {
                      console.error('Failed to load fresh profile data:', e)
                    }
                  }}
                  className="flex items-center gap-2 pl-2 pr-3 py-1.5 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors"
                  title="Профиль"
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-medium text-xs">
                    {agent.name ? agent.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() : '?'}
                  </div>
                  <span className="text-sm font-medium text-slate-700 hidden sm:block">{agent.name?.split(' ')[0]}</span>
                </button>
              ) : null
            })()}
          </div>
        </div>

        {/* Tabs - скрыты на мобильном (используем нижнюю навигацию) */}
        <div className="hidden md:block max-w-full mx-auto px-2 md:px-4">
          <div className="flex gap-0.5 md:gap-1 overflow-x-auto scrollbar-hide">
            {[
              { id: 'channels', label: 'Каналы', shortLabel: 'Кан', icon: MessageSquare, badge: channels.length, urgentBadge: channels.filter(c => c.awaitingReply).length, tooltip: 'Подключённые Telegram группы и чаты', permission: 'canAccessChannels' },
              { id: 'messages', label: 'Сообщения', shortLabel: 'Сооб', icon: MessageSquare, badge: messagesStats.unread || 0, urgentBadge: messagesStats.urgent || 0, tooltip: 'Все входящие сообщения из групп', permission: 'canAccessMessages' },
              { id: 'cases', label: 'Кейсы', shortLabel: 'Кей', icon: AlertCircle, badge: stats.detected || 0, urgentBadge: remindersStats.overdue, tooltip: 'Проблемы и задачи на решение', permission: 'canAccessCases' },
              { id: 'users', label: 'Пользователи', shortLabel: 'Польз', icon: UserCog, badge: usersStats.byRole?.employee || 0, urgentBadge: 0, tooltip: 'Участники Telegram групп', permission: 'canAccessUsers' },
              { id: 'analytics', label: 'Аналитика', shortLabel: 'Стат', icon: BarChart3, urgentBadge: 0, tooltip: 'Статистика и отчёты по работе', permission: 'canAccessAnalytics' },
              // { id: 'automations' } - Moved to Settings → Automations sub-tab
              { id: 'settings', label: 'Настройки', shortLabel: 'Настр', icon: Settings, urgentBadge: 0, tooltip: 'Настройки, автоматизации, команда', permission: 'canAccessSettings' },
            ].filter(tab => agentPermissions[tab.permission as keyof typeof agentPermissions]).map(tab => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id as any)}
                title={tab.tooltip}
                className={`flex items-center gap-1 md:gap-2 px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                  activeTab === tab.id
                    ? 'border-brand-blue text-brand-blue'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                <span className="hidden md:inline">{tab.label}</span>
                <span className="md:hidden">{tab.shortLabel}</span>
                {tab.urgentBadge > 0 && (
                  <span className="ml-0.5 md:ml-1 px-1 md:px-1.5 py-0.5 text-[10px] md:text-xs rounded-full bg-red-500 text-white animate-pulse" title="Срочное">
                    {tab.urgentBadge}
                  </span>
                )}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 text-xs rounded-full ${tab.urgentBadge > 0 ? 'bg-orange-100 text-orange-600' : 'bg-red-100 text-red-600'}`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Хлебные крошки (Breadcrumbs) — одна строка */}
      {breadcrumbs.length > 1 && (
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-1.5">
          <nav className="flex items-center gap-1 text-sm flex-nowrap overflow-x-auto min-w-0">
            {breadcrumbs.map((crumb, idx) => (
              <span key={idx} className="flex items-center gap-1 flex-shrink-0">
                {idx > 0 && <ChevronRight className="w-3 h-3 text-slate-400 flex-shrink-0" />}
                {crumb.path ? (
                  <Link to={crumb.path} className="text-slate-500 hover:text-slate-700 hover:underline whitespace-nowrap">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-slate-800 font-medium whitespace-nowrap truncate max-w-[200px]">{crumb.label}</span>
                )}
              </span>
            ))}
            {breadcrumbs.length > 2 && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  const t = document.createElement('div');
                  t.className = 'fixed bottom-4 right-4 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm z-[300]';
                  t.textContent = 'Ссылка скопирована!';
                  document.body.appendChild(t);
                  setTimeout(() => t.remove(), 2000);
                }}
                className="ml-auto flex-shrink-0 p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded"
                title="Скопировать ссылку"
              >
                <Link2 className="w-3.5 h-3.5" />
              </button>
            )}
          </nav>
        </div>
      )}

      {/* Content */}
      <main className="mx-auto px-4 py-6 max-w-full overflow-hidden">
        
        {/* ============ CASES TAB ============ */}
        {activeTab === 'cases' && (
          <>
            {/* Active Reminders Section */}
            {reminders.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium text-slate-800 flex items-center gap-2">
                    <Bell className="w-5 h-5 text-orange-500" />
                    Активные обещания
                    {remindersStats.overdue > 0 && (
                      <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full animate-pulse">
                        {remindersStats.overdue} просрочено!
                      </span>
                    )}
                  </h3>
                  <div className="text-sm text-slate-500">
                    Активных: {remindersStats.active} | Размытых: {remindersStats.vague}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {reminders.slice(0, 6).map(reminder => (
                    <div 
                      key={reminder.id}
                      className={`bg-white rounded-xl p-4 shadow-sm border-l-4 ${
                        reminder.urgencyLevel === 'overdue' ? 'border-red-500 bg-red-50' :
                        reminder.urgencyLevel === 'critical' ? 'border-red-400 animate-pulse' :
                        reminder.urgencyLevel === 'high' ? 'border-orange-500' :
                        reminder.urgencyLevel === 'medium' ? 'border-yellow-500' :
                        'border-green-500'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                            reminder.isOverdue ? 'bg-red-100 text-red-700' :
                            reminder.urgencyLevel === 'critical' ? 'bg-red-100 text-red-700' :
                            reminder.urgencyLevel === 'high' ? 'bg-orange-100 text-orange-700' :
                            reminder.urgencyLevel === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-green-100 text-green-700'
                          }`}>
                            {reminder.isOverdue ? '🔴 Просрочено' : `⏱ ${reminder.timeLeftFormatted}`}
                          </span>
                          {reminder.isVague && (
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                              Размытое
                            </span>
                          )}
                        </div>
                        {reminder.escalationLevel > 0 && (
                          <span className="text-xs text-red-500">⚡ Ур. {reminder.escalationLevel}</span>
                        )}
                      </div>
                      
                      <p className="text-sm text-slate-700 mb-2 line-clamp-2">"{reminder.commitmentText}"</p>
                      
                      <div className="text-xs text-slate-500 mb-3">
                        <span className="font-medium">{reminder.channelName}</span>
                        {reminder.assignedName && (
                          <span> • {reminder.assignedName}</span>
                        )}
                      </div>
                      
                      {/* Кнопка перехода к сообщению */}
                      <button
                        onClick={() => navigateToMessage(reminder.channelId, reminder.messageId)}
                        className="w-full mb-2 px-2 py-1.5 bg-indigo-50 text-indigo-600 text-xs rounded-lg hover:bg-indigo-100 font-medium flex items-center justify-center gap-1"
                      >
                        <MessageSquare className="w-3 h-3" />
                        Перейти к сообщению
                      </button>
                      
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleReminderAction(reminder.id, 'complete')}
                          className="flex-1 px-2 py-1.5 bg-green-100 text-green-700 text-xs rounded-lg hover:bg-green-200 font-medium"
                        >
                          ✓ Выполнено
                        </button>
                        <button
                          onClick={() => handleReminderAction(reminder.id, 'extend', 60)}
                          className="flex-1 px-2 py-1.5 bg-blue-100 text-blue-700 text-xs rounded-lg hover:bg-blue-200 font-medium"
                        >
                          +1 час
                        </button>
                        <button
                          onClick={() => handleReminderAction(reminder.id, 'dismiss')}
                          className="px-2 py-1.5 bg-slate-100 text-slate-500 text-xs rounded-lg hover:bg-slate-200"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {reminders.length > 6 && (
                  <div className="text-center mt-3">
                    <button className="text-sm text-brand-blue hover:underline">
                      Показать все {reminders.length} обещаний →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-medium text-slate-800">Кейсы</h2>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Поиск..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                  />
                </div>
              </div>
              <button 
                onClick={() => setShowNewCaseModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue"
              >
                <Plus className="w-4 h-4" />
                Новый кейс
              </button>
            </div>

            {/* Kanban Board */}
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
              </div>
            ) : (
              <div className="flex gap-3 lg:gap-4 overflow-x-auto lg:overflow-visible pb-4 snap-x snap-mandatory lg:snap-none">
                {kanbanStatuses.map(status => {
                  const statusCases = filteredCases.filter(c => c.status === status)
                  const columnColors: Record<string, { bg: string; border: string; header: string }> = {
                    detected: { bg: 'bg-yellow-50', border: 'border-yellow-200', header: 'bg-yellow-100 text-yellow-800' },
                    in_progress: { bg: 'bg-blue-50', border: 'border-blue-200', header: 'bg-blue-100 text-blue-800' },
                    waiting: { bg: 'bg-purple-50', border: 'border-purple-200', header: 'bg-purple-100 text-purple-800' },
                    blocked: { bg: 'bg-red-50', border: 'border-red-200', header: 'bg-red-100 text-red-800' },
                    resolved: { bg: 'bg-green-50', border: 'border-green-200', header: 'bg-green-100 text-green-800' },
                  }
                  const colors = columnColors[status] || columnColors.detected
                  
                  return (
                    <div
                      key={status}
                      className={`flex-shrink-0 w-[85vw] md:w-[45vw] lg:flex-1 lg:w-auto lg:min-w-0 ${colors.bg} rounded-xl border ${colors.border} snap-center lg:snap-align-none`}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        if (draggingCase) {
                          updateCaseStatus(draggingCase, status)
                          setDraggingCase(null)
                        }
                      }}
                    >
                      {/* Column Header */}
                      <div className={`px-4 py-3 ${colors.header} rounded-t-xl font-medium flex items-center justify-between`}>
                        <span>{statusLabels[status]}</span>
                        <span className="px-2 py-0.5 bg-white/50 rounded-full text-sm">{statusCases.length}</span>
                      </div>
                      
                      {/* Cards */}
                      <div className="p-3 space-y-3 min-h-[400px] max-h-[calc(100vh-350px)] overflow-y-auto">
                        {statusCases.length === 0 ? (
                          <div className="text-center text-sm text-slate-400 py-8">
                            Нет кейсов
                          </div>
                        ) : (
                          statusCases.map(c => {
                            // Calculate time metrics
                            const createdAt = new Date(c.createdAt)
                            const now = new Date()
                            const ageMinutes = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60))
                            const ageHours = Math.floor(ageMinutes / 60)
                            const ageDays = Math.floor(ageHours / 24)
                            
                            const ageFormatted = ageDays > 0 
                              ? `${ageDays}д ${ageHours % 24}ч`
                              : ageHours > 0 
                                ? `${ageHours}ч ${ageMinutes % 60}м`
                                : `${ageMinutes}м`
                            
                            return (
                              <div
                                key={c.id}
                                draggable
                                onDragStart={() => setDraggingCase(c.id)}
                                onDragEnd={() => setDraggingCase(null)}
                                onClick={() => setSelectedCase(c)}
                                className={`group bg-white rounded-lg p-3 shadow-sm cursor-pointer hover:shadow-md transition-shadow border-l-4 ${
                                  c.priority === 'urgent' || c.priority === 'critical' ? 'border-l-red-500' :
                                  c.priority === 'high' ? 'border-l-orange-500' :
                                  c.priority === 'medium' ? 'border-l-blue-500' :
                                  'border-l-slate-300'
                                } ${draggingCase === c.id ? 'opacity-50' : ''}`}
                              >
                                {/* Ticket Number + Title + Copy Link */}
                                <div className="flex items-start gap-2 mb-2">
                                  {c.ticketNumber && (
                                    <span className="flex-shrink-0 px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-mono">
                                      #{String(c.ticketNumber).padStart(3, '0')}
                                    </span>
                                  )}
                                  <div className="font-medium text-slate-800 text-sm line-clamp-2 flex-1">
                                    {c.title}
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      copyLink('case', c.id)
                                    }}
                                    className="flex-shrink-0 p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Скопировать ссылку"
                                  >
                                    <Link2 className="w-3 h-3" />
                                  </button>
                                </div>
                                
                                {/* Client */}
                                <div className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                                  <Building className="w-3 h-3" />
                                  {c.channelName}
                                </div>
                                
                                {/* Priority & Category */}
                                <div className="flex items-center gap-2 mb-2">
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${priorityBgColors[c.priority] || 'bg-slate-100'}`}>
                                    {c.priority === 'urgent' && '⚠️ '}
                                    {priorityLabels[c.priority] || c.priority}
                                  </span>
                                  <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">
                                    {c.category}
                                  </span>
                                </div>
                                
                                {/* Bottom row: assignee, time, comments */}
                                <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-100">
                                  {/* Assignee */}
                                  <div className="flex items-center gap-1" title="Ответственный">
                                    <Users className="w-3 h-3" />
                                    <span>{c.assigneeName || '—'}</span>
                                  </div>
                                  
                                  {/* Time */}
                                  <div className="flex items-center gap-1" title="Время в работе">
                                    <Clock className="w-3 h-3" />
                                    <span>{ageFormatted}</span>
                                  </div>
                                  
                                  {/* Comments */}
                                  <div className="flex items-center gap-1" title="Сообщения">
                                    <MessageSquare className="w-3 h-3" />
                                    <span>{c.messagesCount}</span>
                                  </div>
                                </div>
                                
                                {/* Timestamps */}
                                <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-400 space-y-1">
                                  <div className="flex justify-between">
                                    <span>Поступил:</span>
                                    <span>{new Date(c.createdAt).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                  </div>
                                  {c.updatedAt && c.updatedAt !== c.createdAt && (() => {
                                    const updatedDate = new Date(c.updatedAt)
                                    const sinceUpdateMs = now.getTime() - updatedDate.getTime()
                                    const sinceUpdateMins = Math.floor(sinceUpdateMs / (1000 * 60))
                                    const sinceUpdateHours = Math.floor(sinceUpdateMins / 60)
                                    const sinceUpdateDays = Math.floor(sinceUpdateHours / 24)
                                    const sinceUpdateFormatted = sinceUpdateDays > 0 
                                      ? `${sinceUpdateDays}д ${sinceUpdateHours % 24}ч назад`
                                      : sinceUpdateHours > 0 
                                        ? `${sinceUpdateHours}ч ${sinceUpdateMins % 60}м назад`
                                        : `${sinceUpdateMins}м назад`
                                    return (
                                      <>
                                        <div className="flex justify-between">
                                          <span>Изменено:</span>
                                          <span>{updatedDate.toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                        <div className="flex justify-between text-orange-500">
                                          <span>С изменения:</span>
                                          <span>{sinceUpdateFormatted}</span>
                                        </div>
                                        {c.updatedByName && (
                                          <div className="flex justify-between">
                                            <span>Изменил:</span>
                                            <span className="font-medium text-slate-600">{c.updatedByName}</span>
                                          </div>
                                        )}
                                      </>
                                    )
                                  })()}
                                  {c.resolvedAt && (
                                    <div className="flex justify-between text-green-600">
                                      <span>Решён:</span>
                                      <span>{new Date(c.resolvedAt).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ============ CHANNELS TAB ============ */}
        {activeTab === 'channels' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-medium text-slate-800">Подключенные каналы ({channels.length})</h2>
              <div className="flex items-center gap-2">
                <button 
                  onClick={async () => {
                    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
                    try {
                      const res = await fetch('/api/support/channels/update-photos', {
                        method: 'POST',
                        headers: { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` }
                      })
                      const data = await res.json()
                      if (data.success) {
                        alert(`Обновлено ${data.updated} фото групп из ${data.total}`)
                        loadData() // Перезагрузить данные
                      } else {
                        alert('Ошибка: ' + data.error)
                      }
                    } catch (e) {
                      alert('Ошибка обновления фото')
                    }
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200"
                  title="Загрузить фото всех групп из Telegram"
                >
                  <Camera className="w-4 h-4" />
                  Обновить фото
                </button>
                <button 
                  onClick={() => setShowNewChannelModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue"
                >
                  <Plus className="w-4 h-4" />
                  Подключить группу
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
              </div>
            ) : channels.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center shadow-sm">
                <MessageSquare className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-800">Нет подключенных каналов</h3>
                <p className="text-slate-500 mt-1">Добавьте бота в Telegram группы для мониторинга</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Group channels by type */}
                {[
                  { type: 'client', label: '👤 Клиенты', color: 'blue' },
                  { type: 'partner', label: '🤝 Партнёры', color: 'green' },
                  { type: 'internal', label: '🏠 Внутренние', color: 'purple' },
                ].map(group => {
                  const groupChannels = channels.filter(ch => ch.type === group.type || (group.type === 'client' && !['partner', 'internal'].includes(ch.type)))
                  if (groupChannels.length === 0) return null
                  
                  return (
                    <div key={group.type}>
                      <h3 className={`text-sm font-medium mb-3 text-${group.color}-600 flex items-center gap-2`}>
                        {group.label}
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs">{groupChannels.length}</span>
                      </h3>
                      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {groupChannels.map(ch => {
                          const urgency = getChannelUrgency(ch)
                          const urgencyStyle = getUrgencyColor(urgency)
                          
                          return (
                            <div 
                              key={ch.id} 
                              onClick={() => loadChannelContext(ch.id)}
                              className={`bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow border-l-4 cursor-pointer ${urgencyStyle.border} ${urgencyStyle.pulse ? 'animate-pulse' : ''}`}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                  <div className={`relative w-10 h-10 rounded-full flex items-center justify-center bg-${group.color}-100`}>
                                    <Users className={`w-5 h-5 text-${group.color}-600`} />
                                    {ch.unreadCount > 0 && (
                                      <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-medium">
                                        {ch.unreadCount > 9 ? '9+' : ch.unreadCount}
                                      </span>
                                    )}
                                  </div>
                                  <div>
                                    <h3 className="font-medium text-slate-800">{ch.name}</h3>
                                    <p className="text-xs text-slate-500">
                                      {ch.isForum && '📂 Форум'}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {ch.awaitingReply && urgency >= 2 && (
                                    <span className={`px-2 py-0.5 ${urgencyStyle.bg} ${urgencyStyle.text} text-xs rounded-full font-medium`}>
                                      {urgencyStyle.label}
                                    </span>
                                  )}
                                  {ch.awaitingReply && urgency < 2 && (
                                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                                      Ждёт ответа
                                    </span>
                                  )}
                                  <span className={`w-2 h-2 rounded-full ${ch.isActive ? 'bg-green-500' : 'bg-slate-300'}`} />
                                </div>
                              </div>
                              
                              {/* Last message preview */}
                              {ch.lastMessagePreview && (
                                <div className={`mt-3 p-2 rounded-lg ${urgency >= 4 ? 'bg-red-50' : urgency >= 3 ? 'bg-orange-50' : 'bg-slate-50'}`}>
                                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                                    <span className="font-medium">{ch.lastSenderName || 'Неизвестный'}</span>
                                    {ch.lastMessageAt && <span>• {formatRelativeTime(ch.lastMessageAt)}</span>}
                                  </div>
                                  <p className="text-sm text-slate-600 line-clamp-2">{ch.lastMessagePreview}</p>
                                </div>
                              )}
                              
                              <div className="mt-4 flex items-center justify-between text-sm">
                                <div className="flex items-center gap-4 text-slate-500">
                                  <span className="flex items-center gap-1"><MessageSquare className="w-4 h-4" />{ch.messagesCount}</span>
                                  {ch.openCasesCount > 0 && (
                                    <span className="flex items-center gap-1 text-orange-500">
                                      <AlertCircle className="w-4 h-4" />{ch.openCasesCount}
                                    </span>
                                  )}
                                </div>
                                {ch.lastClientMessageAt && ch.awaitingReply ? (
                                  <span className={`text-xs font-medium ${urgency >= 3 ? urgencyStyle.text : 'text-slate-500'}`}>
                                    {formatWaitTime(ch.lastClientMessageAt)}
                                  </span>
                                ) : ch.lastMessageAt ? (
                                  <span className="text-xs text-slate-400">
                                    {formatRelativeTime(ch.lastMessageAt)}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ============ MESSAGES TAB (Telegram Style) ============ */}
        {activeTab === 'messages' && (
          <div className="flex gap-4 h-[calc(100vh-140px)] md:h-[calc(100vh-200px)]">
            {/* Left Sidebar - Groups List (like Telegram) */}
            {/* На мобильном: скрыть если чат открыт */}
            <div className={`${expandedChannels.size > 0 ? 'hidden md:flex' : 'flex'} w-full md:w-80 bg-white rounded-xl shadow-sm overflow-hidden flex-col`}>
              <div className="p-3 border-b bg-slate-50">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="Поиск..." 
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                  />
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center h-32">
                    <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
                  </div>
                ) : groupedMessages.length === 0 ? (
                  <div className="p-4 text-center text-slate-500 text-sm">
                    Нет каналов
                  </div>
                ) : (
                  groupedMessages
                    .filter(channel => {
                      if (!searchQuery.trim()) return true
                      const q = searchQuery.toLowerCase()
                      // Search in channel name
                      if (channel.name?.toLowerCase().includes(q)) return true
                      // Search in messages
                      if (channel.recentMessages?.some((m: any) => 
                        m.text?.toLowerCase().includes(q) ||
                        m.senderName?.toLowerCase().includes(q) ||
                        m.transcript?.toLowerCase().includes(q)
                      )) return true
                      return false
                    })
                    .map(channel => {
                    const isSelected = expandedChannels.has(channel.id)
                    const hasUnread = channel.unreadCount > 0
                    
                    return (
                      <div
                        key={channel.id}
                        onClick={() => {
                          setPreviewChannelId(null) // Exit preview mode
                          setExpandedChannels(new Set([channel.id]))
                          setExpandedTopics(new Set())
                          setSelectedTopic(null) // CRITICAL: Reset topic when switching channels
                          setChannelTopics([])   // Clear topics from previous channel
                          // Load AI context for selected channel
                          loadAiContext(channel.id)
                          // Auto-mark as read when opening chat
                          if (channel.unreadCount > 0) {
                            markAsRead(undefined, channel.id)
                          }
                        }}
                        className={`flex items-center gap-2 px-2 py-2 cursor-pointer border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                          isSelected ? 'bg-brand-blue/5 border-l-2 border-l-brand-blue' : ''
                        } ${previewChannelId === channel.id ? 'ring-2 ring-yellow-400' : ''}`}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setChannelContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            channelId: channel.id,
                            channelName: channel.name
                          })
                        }}
                      >
                        {/* Avatar - компактный */}
                        <div className="relative flex-shrink-0">
                          {channel.photoUrl ? (
                            <img 
                              src={channel.photoUrl} 
                              alt={channel.name}
                              className="w-10 h-10 rounded-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none'
                                ;(e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden')
                              }}
                            />
                          ) : null}
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${channel.photoUrl ? 'hidden' : ''} ${
                            channel.type === 'internal' ? 'bg-purple-100 text-purple-600' :
                            channel.type === 'partner' ? 'bg-green-100 text-green-600' :
                            'bg-blue-100 text-blue-600'
                          }`}>
                            {channel.name.charAt(0).toUpperCase()}
                          </div>
                          {channel.awaitingReply && (
                            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-orange-500 rounded-full flex items-center justify-center">
                              <Clock className="w-2 h-2 text-white" />
                            </span>
                          )}
                        </div>
                        
                        {/* Info - компактный */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className={`font-medium text-xs truncate ${hasUnread ? 'text-slate-900' : 'text-slate-700'}`}>
                              {channel.name}
                            </span>
                            <div className="flex items-center gap-1 ml-1 shrink-0">
                              {hasUnread && (
                                <span className="px-1 py-0.5 bg-brand-blue text-white text-[10px] rounded-full min-w-[16px] text-center">
                                  {channel.unreadCount}
                                </span>
                              )}
                              <span className="text-[10px] text-slate-400">
                                {channel.lastMessageAt ? formatRelativeTime(channel.lastMessageAt) : ''}
                              </span>
                            </div>
                          </div>
                          <p className={`text-[11px] truncate mt-0.5 ${hasUnread ? 'text-slate-600' : 'text-slate-400'}`}>
                            {channel.lastSenderName ? `${channel.lastSenderName}: ` : ''}
                            {channel.lastMessagePreview || '📷 Фото'}
                          </p>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Center - Chat/Topics View */}
            {/* На мобильном: показать только если чат открыт */}
            <div className={`${expandedChannels.size === 0 ? 'hidden md:flex' : 'flex'} flex-1 bg-white rounded-xl shadow-sm overflow-hidden flex-col`}>
              {expandedChannels.size === 0 ? (
                <div className="flex-1 flex items-center justify-center text-slate-400">
                  <div className="text-center">
                    <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Выберите чат слева</p>
                  </div>
                </div>
              ) : (
                (() => {
                  const selectedChannelId = Array.from(expandedChannels)[0]
                  const channel = groupedMessages.find(c => c.id === selectedChannelId)
                  if (!channel) return null
                  
                  return (
                    <>
                      {/* Chat Header */}
                      <div className="p-3 md:p-4 border-b bg-slate-50 flex items-center justify-between">
                        <div className="flex items-center gap-2 md:gap-3">
                          {/* Кнопка назад для мобильной */}
                          <button 
                            onClick={() => setExpandedChannels(new Set())}
                            className="md:hidden p-2 -ml-2 hover:bg-slate-200 rounded-lg"
                          >
                            <ChevronLeft className="w-5 h-5 text-slate-600" />
                          </button>
                          <div className={`w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center ${
                            channel.type === 'internal' ? 'bg-purple-100 text-purple-600' :
                            channel.type === 'partner' ? 'bg-green-100 text-green-600' :
                            'bg-blue-100 text-blue-600'
                          }`}>
                            {channel.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <h3 className="font-medium text-slate-800 text-sm md:text-base">{channel.name}</h3>
                            <p className="text-[10px] md:text-xs text-slate-500">
                              {channel.messagesCount} сообщ.
                              {channel.companyName && ` • ${channel.companyName}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {channel.maxUrgency >= 3 && (
                            <span className={`px-2 py-1 ${getUrgencyColor(channel.maxUrgency).bg} ${getUrgencyColor(channel.maxUrgency).text} text-[10px] md:text-xs rounded-full`}>
                              {getUrgencyColor(channel.maxUrgency).label}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Topics/Threads Bar */}
                      {(channel.isForum && channel.topics.length > 0) && (
                        <div className="p-2 border-b bg-slate-50/50 flex gap-2 overflow-x-auto">
                          <button 
                            onClick={() => {
                              setExpandedTopics(new Set())
                              setSelectedTopic(null)
                            }}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                              expandedTopics.size === 0 ? 'bg-brand-blue text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            Все ({channel.recentMessages?.length || 0})
                          </button>
                          {channel.topics.map((topic: any) => {
                            const topicMsgCount = (channel.recentMessages || []).filter((m: any) => m.threadId === topic.threadId).length
                            return (
                              <button 
                                key={topic.id}
                                onClick={() => {
                                  setExpandedTopics(new Set([topic.threadId]))
                                  setSelectedTopic(topic.threadId) // Sync for sending messages
                                }}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap flex items-center gap-1 ${
                                  expandedTopics.has(topic.threadId) ? 'bg-brand-blue text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                              >
                                # {topic.name}
                                <span className="opacity-70">({topicMsgCount})</span>
                                {topic.unreadCount > 0 && (
                                  <span className="px-1 bg-red-500 text-white rounded-full text-[10px]">{topic.unreadCount}</span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      )}

                      {/* Waiting time indicator */}
                      {channel.awaitingReply && (
                        <div className="px-4 py-2 bg-orange-50 border-b border-orange-100 flex items-center gap-2 text-orange-700">
                          <Clock className="w-4 h-4" />
                          <span className="text-sm">Ожидает ответа: <strong>{formatWaitingTime(channel.lastClientMessageAt)}</strong></span>
                        </div>
                      )}

                      {/* Messages - newest at bottom, filtered by topic */}
                      <div 
                        ref={messagesContainerRef}
                        className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-slate-50/50 to-white"
                      >
                        <div className="space-y-3">
                        {(() => {
                          // Filter messages by selected topic and search query
                          let filteredMessages = expandedTopics.size > 0
                            ? (channel.recentMessages || []).filter((m: any) => expandedTopics.has(m.threadId))
                            : (channel.recentMessages || [])
                          
                          // Apply search filter
                          if (searchQuery.trim()) {
                            const q = searchQuery.toLowerCase()
                            filteredMessages = filteredMessages.filter((m: any) => 
                              m.text?.toLowerCase().includes(q) ||
                              m.senderName?.toLowerCase().includes(q) ||
                              m.transcript?.toLowerCase().includes(q)
                            )
                          }
                          
                          // Sort by date ascending (oldest first, newest at bottom)
                          return [...filteredMessages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                        })().map((msg: any, i: number, arr: any[]) => {
                          const isFromTeam = msg.senderRole !== 'client'
                          const showDate = i === 0 || new Date(msg.createdAt).toDateString() !== new Date(arr[i-1]?.createdAt).toDateString()
                          
                          return (
                            <div key={msg.id} className="group relative">
                              {showDate && (
                                <div className="flex justify-center my-4">
                                  <span className="px-3 py-1 bg-slate-200/50 text-slate-500 text-xs rounded-full">
                                    {new Date(msg.createdAt).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })}
                                  </span>
                                </div>
                              )}
                              <div className={`flex items-end gap-2 ${isFromTeam ? 'justify-end' : 'justify-start'}`}>
                                {/* Avatar for client messages (left side) */}
                                {!isFromTeam && (
                                  <div className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden">
                                    {msg.senderPhoto ? (
                                      <img src={msg.senderPhoto} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                      <div className="w-full h-full bg-gradient-to-br from-slate-400 to-slate-500 flex items-center justify-center text-white text-[10px] font-medium">
                                        {(msg.senderName || 'К').charAt(0).toUpperCase()}
                                      </div>
                                    )}
                                  </div>
                                )}
                                
                                <div 
                                  id={`msg-${msg.id}`}
                                  className={`max-w-[80%] relative transition-all`}
                                >
                                  {/* Sender name for all messages */}
                                  <div className={`flex items-center gap-2 mb-1 ${isFromTeam ? 'mr-1 justify-end' : 'ml-1'}`}>
                                    <span className={`text-xs font-medium ${isFromTeam ? 'text-blue-400' : 'text-blue-600'}`}>
                                      {msg.senderName || (isFromTeam ? 'Поддержка' : 'Клиент')}
                                      {isFromTeam && msg.senderRole === 'support' && (
                                        <span className="ml-1 px-1.5 py-0.5 bg-blue-500/30 rounded text-[10px]">Админ</span>
                                      )}
                                    </span>
                                  </div>
                                  
                                  {/* Message bubble with context menu on right click */}
                                  <div 
                                    className={`relative p-3 rounded-2xl cursor-pointer ${
                                      isFromTeam 
                                        ? 'bg-blue-100 text-slate-800 rounded-br-md border border-blue-200' 
                                        : 'bg-white shadow-sm border rounded-bl-md'
                                    }`}
                                    onContextMenu={(e) => {
                                      e.preventDefault()
                                      // Use senderRole to determine if message is from team (more reliable than isFromClient)
                                      const isTeamMsg = msg.senderRole !== 'client'
                                      setContextMenu({ x: e.clientX, y: e.clientY, messageId: msg.id, telegramMessageId: msg.telegramMessageId, text: msg.text || '', senderName: msg.senderName, isFromTeam: isTeamMsg })
                                    }}
                                    onDoubleClick={() => {
                                      // Quick reply on double click
                                      setReplyToMessage({ 
                                        id: msg.id, 
                                        telegramMessageId: msg.telegramMessageId,
                                        senderName: msg.senderName, 
                                        text: msg.text?.slice(0, 50) || '[медиа]'
                                      })
                                    }}
                                  >
                                    {/* Reply quote - show original message being replied to */}
                                    {(msg.replyToMessageId || msg.replyToText) && (() => {
                                      // Use saved reply text if available, otherwise try to find in array
                                      const replyText = msg.replyToText
                                      const replySender = msg.replyToSender
                                      
                                      // Fallback: find in loaded messages
                                      const replyMsg = !replyText ? arr.find((m: any) => m.telegramMessageId === msg.replyToMessageId || m.id === msg.replyToMessageId) : null
                                      
                                      const displayText = replyText || replyMsg?.text || replyMsg?.transcript || '[медиа]'
                                      const displaySender = replySender || replyMsg?.senderName || 'Сообщение'
                                      
                                      if (displayText || displaySender) {
                                        return (
                                          <div className={`mb-2 p-2 rounded-lg border-l-2 ${isFromTeam ? 'bg-blue-50 border-blue-300' : 'bg-slate-100 border-slate-300'}`}>
                                            <div className={`text-[10px] font-medium mb-0.5 ${isFromTeam ? 'text-blue-600' : 'text-slate-500'}`}>
                                              ↩️ {displaySender}
                                            </div>
                                            <div className={`text-xs line-clamp-2 ${isFromTeam ? 'text-blue-700' : 'text-slate-600'}`}>
                                              {displayText}
                                            </div>
                                          </div>
                                        )
                                      }
                                      return null
                                    })()}
                                    
                                    {/* Media content (photo, video, document) */}
                                    {msg.mediaUrl && (
                                      <div className="mb-2">
                                        {msg.contentType === 'photo' ? (
                                          <div className="relative">
                                            <img 
                                              src={msg.mediaUrl} 
                                              alt="Фото" 
                                              className="max-w-full max-h-64 rounded-lg cursor-pointer hover:opacity-90"
                                              onClick={() => window.open(msg.mediaUrl, '_blank')}
                                              onError={(e) => {
                                                const target = e.target as HTMLImageElement
                                                target.style.display = 'none'
                                                target.nextElementSibling?.classList.remove('hidden')
                                              }}
                                            />
                                            <div className="hidden bg-slate-100 rounded-lg p-4 text-center">
                                              <span className="text-3xl block mb-2">📷</span>
                                              <span className="text-xs text-slate-500">Фото недоступно (истёк срок)</span>
                                            </div>
                                          </div>
                                        ) : msg.contentType === 'video' || msg.contentType === 'video_note' ? (
                                          <div className="relative">
                                            <video 
                                              src={msg.mediaUrl} 
                                              controls 
                                              className="max-w-full max-h-64 rounded-lg"
                                              onError={(e) => {
                                                const target = e.target as HTMLVideoElement
                                                target.style.display = 'none'
                                                target.nextElementSibling?.classList.remove('hidden')
                                              }}
                                            />
                                            <div className="hidden bg-slate-100 rounded-lg p-4 text-center">
                                              <span className="text-3xl block mb-2">🎬</span>
                                              <span className="text-xs text-slate-500">Видео недоступно (истёк срок)</span>
                                            </div>
                                          </div>
                                        ) : msg.contentType === 'voice' || msg.contentType === 'audio' ? (
                                          <div className="bg-slate-100 rounded-xl p-2">
                                            <audio 
                                              src={msg.mediaUrl} 
                                              controls 
                                              className="w-full h-10" 
                                              style={{ minWidth: '200px' }}
                                              onError={(e) => {
                                                const target = e.target as HTMLAudioElement
                                                target.style.display = 'none'
                                                const placeholder = document.createElement('div')
                                                placeholder.className = 'text-center py-2'
                                                placeholder.innerHTML = '<span class="text-xl">🎵</span><span class="text-xs text-slate-500 block">Аудио недоступно</span>'
                                                target.parentElement?.appendChild(placeholder)
                                              }}
                                            />
                                          </div>
                                        ) : msg.contentType === 'document' ? (
                                          <a 
                                            href={msg.mediaUrl} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 p-2 bg-slate-100 rounded-lg hover:bg-slate-200"
                                          >
                                            <span className="text-2xl">📄</span>
                                            <span className="text-sm text-slate-700">Открыть документ</span>
                                          </a>
                                        ) : null}
                                      </div>
                                    )}
                                    
                                    {/* Text content - главный контент */}
                                    {msg.text && (
                                      <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-slate-800">{msg.text}</p>
                                    )}
                                    
                                    {/* Case/Ticket link */}
                                    {msg.caseId && (
                                      <button
                                        onClick={async (e) => {
                                          e.stopPropagation()
                                          // Сначала ищем в локальном массиве
                                          let linkedCase = cases.find(c => c.id === msg.caseId)
                                          
                                          // Если не найден - загружаем с сервера
                                          if (!linkedCase) {
                                            try {
                                              const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
                                              const res = await fetch(`/api/support/cases/${msg.caseId}`, {
                                                headers: { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` }
                                              })
                                              if (res.ok) {
                                                const data = await res.json()
                                                linkedCase = data.case
                                              }
                                            } catch (err) {
                                              console.error('Failed to load case:', err)
                                            }
                                          }
                                          
                                          if (linkedCase) {
                                            setSelectedCase(linkedCase)
                                          } else {
                                            alert('Кейс не найден: ' + msg.caseId)
                                          }
                                        }}
                                        className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 bg-orange-100 text-orange-700 rounded-lg text-xs hover:bg-orange-200 transition-colors"
                                      >
                                        <span>🎫</span>
                                        <span>Тикет #{msg.caseId.slice(-6)}</span>
                                        <ChevronRight className="w-3 h-3" />
                                      </button>
                                    )}
                                    
                                    {/* Transcript for voice/video - основной контент */}
                                    {msg.transcript && (
                                      <div className="mt-1">
                                        <p className="text-[15px] leading-relaxed text-slate-800 italic">{msg.transcript}</p>
                                        <span className="text-[9px] text-purple-400">🎤 транскрипция</span>
                                      </div>
                                    )}
                                    
                                    {/* AI image analysis - второстепенный */}
                                    {msg.aiImageAnalysis && (
                                      <div className="mt-2 p-1.5 bg-slate-50 rounded text-xs text-slate-500 opacity-70">
                                        <span className="text-slate-400">📷</span> {msg.aiImageAnalysis}
                                      </div>
                                    )}
                                    
                                    {/* AI suggestion - второстепенный блок */}
                                    {msg.aiSuggestion && (
                                      <div className="mt-2 p-2 bg-slate-50 rounded border border-slate-200 opacity-70 hover:opacity-100 transition-opacity">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-slate-400 text-xs">💡</span>
                                            <span className="text-[9px] text-slate-400 uppercase">AI</span>
                                          </div>
                                          <button 
                                            onClick={() => setReplyText(msg.aiSuggestion || '')}
                                            className="text-[10px] text-blue-500 hover:text-blue-600"
                                          >
                                            ↩ Использовать
                                          </button>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{msg.aiSuggestion}</p>
                                      </div>
                                    )}
                                    
                                    {/* No content indicator */}
                                    {!msg.text && !msg.mediaUrl && !msg.transcript && (
                                      <p className="text-sm text-slate-400 italic">[медиа без текста]</p>
                                    )}
                                    
                                    {/* AI category badge */}
                                    {!isFromTeam && msg.category && (
                                      <div className="mt-2 pt-2 border-t border-slate-100">
                                        <div className="flex items-center gap-2 text-[10px]">
                                          <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">{msg.category}</span>
                                          {msg.urgency >= 3 && (
                                            <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">Срочно</span>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                    
                                    {/* Time and read/sending status */}
                                    <div className={`flex items-center justify-end gap-1 mt-1 ${isFromTeam ? 'text-white/70' : 'text-slate-400'}`}>
                                      <span className="text-[10px]">
                                        {new Date(msg.createdAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                      {isFromTeam && (
                                        <span className="flex items-center" title={msg.isSending ? 'Отправляется...' : msg.isRead ? 'Прочитано' : 'Доставлено'}>
                                          {msg.isSending ? (
                                            <RefreshCw className="w-3 h-3 animate-spin" />
                                          ) : msg.isRead ? (
                                            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                                              <path d="M12.354 4.354a.5.5 0 0 0-.708-.708L5 10.293 2.354 7.646a.5.5 0 1 0-.708.708l3 3a.5.5 0 0 0 .708 0l7-7z"/>
                                              <path d="M6.354 11.354a.5.5 0 0 1-.708 0l-3-3a.5.5 0 1 1 .708-.708L6 10.293l.146-.147a.5.5 0 0 1 .708.708l-.5.5z" style={{transform: 'translateX(4px)'}}/>
                                            </svg>
                                          ) : (
                                            <CheckCircle className="w-3 h-3" />
                                          )}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Quick reactions on hover */}
                                  <div className={`absolute top-0 ${isFromTeam ? 'left-0 -translate-x-full pr-2' : 'right-0 translate-x-full pl-2'} opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 z-10 pointer-events-auto`}>
                                    {quickEmojis.slice(0, 4).map(emoji => (
                                      <button
                                        key={emoji}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          sendReaction(msg.id, emoji)
                                        }}
                                        className="w-7 h-7 flex items-center justify-center hover:bg-slate-100 bg-white shadow-sm border rounded-full text-sm transition-colors cursor-pointer"
                                      >
                                        {emoji}
                                      </button>
                                    ))}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setShowReactionPicker(showReactionPicker === msg.id ? null : msg.id)
                                      }}
                                      className="reaction-picker-container w-7 h-7 flex items-center justify-center hover:bg-slate-100 bg-white shadow-sm border rounded-full text-slate-400 transition-colors cursor-pointer"
                                    >
                                      <span className="text-lg leading-none">+</span>
                                    </button>
                                  </div>

                                  {/* Full emoji picker for reactions */}
                                  {showReactionPicker === msg.id && (
                                    <div 
                                      className={`reaction-picker-container absolute top-full mt-1 ${isFromTeam ? 'right-0' : 'left-0'} z-50 bg-white rounded-xl shadow-lg border p-2 w-64`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
                                        {allEmojis.map(emoji => (
                                          <button
                                            key={emoji}
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              sendReaction(msg.id, emoji)
                                            }}
                                            className="w-7 h-7 flex items-center justify-center hover:bg-slate-100 rounded text-lg cursor-pointer"
                                          >
                                            {emoji}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Reactions display - merged server + local optimistic */}
                                  {(() => {
                                    const mergedReactions = getMergedReactions(msg.id, msg.reactions)
                                    return Object.keys(mergedReactions).length > 0 && (
                                      <div className={`flex gap-1 mt-1.5 flex-wrap ${isFromTeam ? 'justify-end' : 'justify-start'}`}>
                                        {Object.entries(mergedReactions).map(([emoji, data]: [string, any]) => (
                                          <button 
                                            key={emoji} 
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              sendReaction(msg.id, emoji)
                                            }}
                                            className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-full text-xs shadow-sm flex items-center gap-1 transition-all animate-in fade-in duration-200"
                                            title={data.users?.join(', ')}
                                          >
                                            <span className="text-base">{emoji}</span> 
                                            <span className="text-blue-600 font-medium">{data.count}</span>
                                          </button>
                                        ))}
                                      </div>
                                    )
                                  })()}
                                </div>
                                
                                {/* Avatar for team messages (right side) */}
                                {isFromTeam && (
                                  <div className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden">
                                    {msg.senderPhoto ? (
                                      <img src={msg.senderPhoto} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                      <div className="w-full h-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-[10px] font-medium">
                                        {(msg.senderName || 'П').charAt(0).toUpperCase()}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                        {/* Scroll anchor */}
                        <div ref={messagesEndRef} />
                        </div>
                      </div>

                      {/* Message Input */}
                      <div className="border-t bg-white">
                        {/* Reply preview */}
                        {replyToMessage && (
                          <div className="px-3 pt-2 flex items-center gap-2 text-sm">
                            <div className="flex-1 p-2 bg-blue-50 border-l-2 border-blue-500 rounded">
                              <div className="text-xs text-blue-600 font-medium">{replyToMessage.senderName}</div>
                              <div className="text-xs text-slate-600 truncate">{replyToMessage.text}</div>
                            </div>
                            <button onClick={() => setReplyToMessage(null)} className="p-1 text-slate-400 hover:text-slate-600">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                        
                        {/* Attached files preview - улучшенный с превью изображений */}
                        {attachedFiles.length > 0 && (
                          <div className="px-3 pt-3 pb-1 bg-slate-50 border-t border-slate-100">
                            <div className="flex gap-3 flex-wrap">
                              {attachedFiles.map((file, i) => {
                                const isImage = file.type.startsWith('image/')
                                const isVideo = file.type.startsWith('video/')
                                const isAudio = file.type.startsWith('audio/')
                                const fileSize = file.size < 1024 ? `${file.size} B` 
                                  : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB`
                                  : `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                                
                                return (
                                  <div 
                                    key={i} 
                                    className="relative group bg-white rounded-xl overflow-hidden shadow-sm border border-slate-200 hover:shadow-md transition-shadow"
                                    style={{ width: isImage || isVideo ? '100px' : 'auto', minWidth: '100px' }}
                                  >
                                    {isImage ? (
                                      <div 
                                        className="w-full h-24 relative cursor-pointer"
                                        onClick={() => setPreviewFile({ file, url: URL.createObjectURL(file) })}
                                      >
                                        <img 
                                          src={URL.createObjectURL(file)} 
                                          alt={file.name}
                                          className="w-full h-full object-cover"
                                        />
                                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                          <span className="text-white text-xs font-medium">👁 Просмотр</span>
                                        </div>
                                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1">
                                          <p className="text-[9px] text-white truncate">{file.name}</p>
                                          <p className="text-[8px] text-white/70">{fileSize}</p>
                                        </div>
                                      </div>
                                    ) : isVideo ? (
                                      <div 
                                        className="w-full h-24 relative bg-slate-900 flex items-center justify-center cursor-pointer"
                                        onClick={() => setPreviewFile({ file, url: URL.createObjectURL(file) })}
                                      >
                                        <video 
                                          src={URL.createObjectURL(file)} 
                                          className="w-full h-full object-cover opacity-50"
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                          <span className="text-3xl">▶️</span>
                                        </div>
                                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1">
                                          <p className="text-[9px] text-white truncate">{file.name}</p>
                                          <p className="text-[8px] text-white/70">{fileSize}</p>
                                        </div>
                                      </div>
                                    ) : isAudio ? (
                                      <div className="w-full p-3 flex flex-col items-center gap-1">
                                        <span className="text-2xl">🎵</span>
                                        <div className="text-center">
                                          <p className="text-[10px] text-slate-700 truncate max-w-[90px]">{file.name}</p>
                                          <p className="text-[9px] text-slate-400">{fileSize}</p>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="w-full p-3 flex flex-col items-center gap-1">
                                        <span className="text-2xl">
                                          {file.name.endsWith('.pdf') ? '📄' : 
                                           file.name.endsWith('.doc') || file.name.endsWith('.docx') ? '📝' :
                                           file.name.endsWith('.xls') || file.name.endsWith('.xlsx') ? '📊' :
                                           file.name.endsWith('.zip') || file.name.endsWith('.rar') ? '📦' :
                                           '📎'}
                                        </span>
                                        <div className="text-center">
                                          <p className="text-[10px] text-slate-700 truncate max-w-[90px]">{file.name}</p>
                                          <p className="text-[9px] text-slate-400">{fileSize}</p>
                                        </div>
                                      </div>
                                    )}
                                    
                                    {/* Кнопка удаления */}
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setAttachedFiles(files => files.filter((_, idx) => idx !== i))
                                      }} 
                                      className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                            <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
                              <span>{attachedFiles.length} файл(ов) готово к отправке</span>
                              <button 
                                onClick={() => setAttachedFiles([])}
                                className="text-red-500 hover:text-red-600"
                              >
                                Очистить все
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="p-3 flex items-end gap-2">
                          {/* Recording UI */}
                          {isRecording ? (
                            <div className="flex-1 flex items-center gap-3 bg-red-50 rounded-xl px-4 py-3">
                              <button
                                onClick={cancelRecording}
                                className="p-2 text-red-500 hover:bg-red-100 rounded-full transition-colors"
                                title="Отмена"
                              >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                              <div className="flex-1 flex items-center gap-2">
                                <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
                                <span className="text-red-600 font-medium">{formatRecordingTime(recordingTime)}</span>
                                <span className="text-red-400 text-sm">Запись...</span>
                              </div>
                              <button
                                onClick={stopRecording}
                                className="p-2.5 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                                title="Отправить"
                              >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <>
                              {/* Attach button with menu */}
                              <div className="attach-menu-container relative">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setShowAttachMenu(!showAttachMenu)
                                  }}
                                  className="p-2.5 text-slate-400 hover:text-brand-blue hover:bg-slate-100 rounded-full transition-colors"
                                >
                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                  </svg>
                                </button>
                                
                                {/* Attach menu dropdown */}
                                {showAttachMenu && (
                                  <div 
                                    className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-lg border py-2 min-w-[180px] z-50"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <label className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 cursor-pointer text-sm text-slate-700">
                                      <span className="text-lg">🖼</span> Фото или видео
                                      <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={e => {
                                        if (e.target.files && e.target.files.length > 0) {
                                          const files = Array.from(e.target.files)
                                          setAttachedFiles(prev => [...prev, ...files])
                                          // Автоматически открыть превью первого файла
                                          const firstFile = files[0]
                                          if (firstFile.type.startsWith('image/') || firstFile.type.startsWith('video/')) {
                                            setPreviewFile({ file: firstFile, url: URL.createObjectURL(firstFile) })
                                          }
                                        }
                                        setShowAttachMenu(false)
                                      }} />
                                    </label>
                                    <label className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 cursor-pointer text-sm text-slate-700">
                                      <span className="text-lg">📄</span> Файл
                                      <input type="file" multiple className="hidden" onChange={e => {
                                        if (e.target.files && e.target.files.length > 0) {
                                          const files = Array.from(e.target.files)
                                          setAttachedFiles(prev => [...prev, ...files])
                                          // Показать превью для изображений и видео
                                          const firstFile = files[0]
                                          if (firstFile.type.startsWith('image/') || firstFile.type.startsWith('video/')) {
                                            setPreviewFile({ file: firstFile, url: URL.createObjectURL(firstFile) })
                                          }
                                        }
                                        setShowAttachMenu(false)
                                      }} />
                                    </label>
                                  </div>
                                )}
                              </div>

                              {/* Text input with @ mention support */}
                              <div className="flex-1 relative">
                                <textarea
                                  ref={textareaRef}
                                  value={replyText}
                                  onChange={e => {
                                    const value = e.target.value
                                    setReplyText(value)
                                    
                                    // Check for @ mention
                                    const cursorPos = e.target.selectionStart
                                    const textBeforeCursor = value.slice(0, cursorPos)
                                    const atMatch = textBeforeCursor.match(/@(\w*)$/)
                                    
                                    if (atMatch) {
                                      const query = atMatch[1].toLowerCase()
                                      setMentionQuery(query)
                                      
                                      // Get users from current channel's messages
                                      const users = new Map<string, { name: string; username: string }>()
                                      channel.recentMessages?.forEach((m: any) => {
                                        if (m.senderName && m.senderRole !== 'support') {
                                          users.set(m.senderName, { 
                                            name: m.senderName, 
                                            username: m.senderUsername || m.senderName 
                                          })
                                        }
                                      })
                                      // Add chat users
                                      chatUsers.forEach(u => {
                                        if (u.name) {
                                          users.set(u.name, { name: u.name, username: u.telegramUsername || u.name })
                                        }
                                      })
                                      
                                      const results = Array.from(users.values())
                                        .filter(u => u.name.toLowerCase().includes(query) || u.username.toLowerCase().includes(query))
                                        .slice(0, 5)
                                      setMentionResults(results)
                                    } else {
                                      setMentionQuery(null)
                                      setMentionResults([])
                                    }
                                  }}
                                  onKeyDown={e => {
                                    // Handle mention selection
                                    if (mentionResults.length > 0 && (e.key === 'Tab' || e.key === 'Enter')) {
                                      if (mentionQuery !== null) {
                                        e.preventDefault()
                                        const user = mentionResults[0]
                                        const cursorPos = textareaRef.current?.selectionStart || 0
                                        const textBeforeCursor = replyText.slice(0, cursorPos)
                                        const atIndex = textBeforeCursor.lastIndexOf('@')
                                        const newText = replyText.slice(0, atIndex) + '@' + user.username + ' ' + replyText.slice(cursorPos)
                                        setReplyText(newText)
                                        setMentionQuery(null)
                                        setMentionResults([])
                                        return
                                      }
                                    }
                                    
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault()
                                      sendChatMessage(channel.id, replyText, attachedFiles.length > 0 ? attachedFiles : undefined)
                                      setReplyToMessage(null)
                                      setMentionQuery(null)
                                      setMentionResults([])
                                    }
                                    // Escape to close chat
                                    if (e.key === 'Escape') {
                                      if (mentionQuery !== null) {
                                        setMentionQuery(null)
                                        setMentionResults([])
                                      } else {
                                        e.preventDefault()
                                        setExpandedChannels(new Set())
                                        setSelectedTopic(null)
                                        setReplyToMessage(null)
                                        setReplyText('')
                                      }
                                    }
                                  }}
                                  placeholder={selectedTopic && channel.topics?.find((t: any) => t.threadId === selectedTopic) 
                                    ? `Сообщение в #${channel.topics.find((t: any) => t.threadId === selectedTopic)?.name}...` 
                                    : 'Сообщение... (@ для упоминания)'}
                                  className="w-full p-3 border rounded-xl resize-none focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue text-sm bg-slate-50"
                                  rows={1}
                                  style={{ minHeight: '44px', maxHeight: '120px' }}
                                />
                                
                                {/* Mention autocomplete dropdown */}
                                {mentionResults.length > 0 && (
                                  <div className="absolute bottom-full left-0 mb-1 w-64 bg-white rounded-lg shadow-lg border py-1 z-10">
                                    <div className="px-3 py-1 text-xs text-slate-500 border-b">Упомянуть пользователя</div>
                                    {mentionResults.map((user, i) => (
                                      <button
                                        key={i}
                                        onClick={() => {
                                          const cursorPos = textareaRef.current?.selectionStart || replyText.length
                                          const textBeforeCursor = replyText.slice(0, cursorPos)
                                          const atIndex = textBeforeCursor.lastIndexOf('@')
                                          const newText = replyText.slice(0, atIndex) + '@' + user.username + ' ' + replyText.slice(cursorPos)
                                          setReplyText(newText)
                                          setMentionQuery(null)
                                          setMentionResults([])
                                          textareaRef.current?.focus()
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left"
                                      >
                                        <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-xs text-blue-600">
                                          {user.name.charAt(0)}
                                        </div>
                                        <div>
                                          <div className="text-sm font-medium text-slate-700">{user.name}</div>
                                          <div className="text-xs text-slate-400">@{user.username}</div>
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              
                              {/* Emoji button */}
                              <div className="emoji-picker-container relative">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setShowEmojiPicker(!showEmojiPicker)
                                  }}
                                  className="p-2.5 text-slate-400 hover:text-brand-blue hover:bg-slate-100 rounded-full transition-colors"
                                >
                                  <span className="text-xl">😊</span>
                                </button>
                                
                                {/* Emoji picker */}
                                {showEmojiPicker && (
                                  <div 
                                    className="absolute bottom-full right-0 mb-2 bg-white rounded-xl shadow-lg border p-3 w-72 z-50"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="text-xs text-slate-500 mb-2">Часто используемые</div>
                                    <div className="grid grid-cols-8 gap-1 mb-3">
                                      {quickEmojis.map(emoji => (
                                        <button
                                          key={emoji}
                                          onClick={() => {
                                            setReplyText(prev => prev + emoji)
                                            setShowEmojiPicker(false)
                                          }}
                                          className="w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded text-xl cursor-pointer"
                                        >
                                          {emoji}
                                        </button>
                                      ))}
                                    </div>
                                    <div className="text-xs text-slate-500 mb-2">Смайлы</div>
                                    <div className="grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
                                      {allEmojis.map(emoji => (
                                        <button
                                          key={emoji}
                                          onClick={() => {
                                            setReplyText(prev => prev + emoji)
                                            setShowEmojiPicker(false)
                                          }}
                                          className="w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded text-xl cursor-pointer"
                                        >
                                          {emoji}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Send or Voice button */}
                              {replyText.trim() || attachedFiles.length > 0 ? (
                                <button
                                  onClick={() => {
                                    sendChatMessage(channel.id, replyText, attachedFiles.length > 0 ? attachedFiles : undefined)
                                    setReplyToMessage(null)
                                  }}
                                  disabled={sendingMessage}
                                  className="p-2.5 bg-brand-blue text-white rounded-full hover:bg-brand-darkBlue disabled:opacity-50 transition-colors"
                                >
                                  {sendingMessage ? (
                                    <RefreshCw className="w-5 h-5 animate-spin" />
                                  ) : (
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                    </svg>
                                  )}
                                </button>
                              ) : (
                                <button
                                  onClick={() => startRecording(channel.id)}
                                  className="p-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                                  title="Записать голосовое сообщение"
                                >
                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                  </svg>
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </>
                  )
                })()
              )}
            </div>

            {/* Right Sidebar - AI Context & Reminders - скрыт на мобильном и планшете */}
            <div className="hidden xl:block w-72 space-y-4 flex-shrink-0 sticky top-4 self-start max-h-[calc(100vh-6rem)] overflow-y-auto">
              {/* AI Context Panel */}
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl shadow-sm p-4 border border-indigo-100">
                <h3 className="font-medium text-slate-800 mb-3 flex items-center gap-2">
                  <Bot className="w-4 h-4 text-indigo-500" />
                  AI Помощник
                  {loadingAiContext && <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />}
                </h3>
                
                {aiContext ? (
                  <div className="space-y-3 text-sm">
                    {/* Summary */}
                    <div className="bg-white/70 rounded-lg p-2">
                      <div className="text-xs text-slate-500 mb-1">Сводка</div>
                      <div className="text-slate-700">{aiContext.summary}</div>
                    </div>
                    
                    {/* Status & Urgency */}
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        aiContext.sentiment === 'negative' || aiContext.sentiment === 'escalating' 
                          ? 'bg-red-100 text-red-700' 
                          : aiContext.sentiment === 'positive' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-slate-100 text-slate-700'
                      }`}>
                        {aiContext.sentiment === 'negative' ? '😟 Негатив' : 
                         aiContext.sentiment === 'escalating' ? '🔥 Эскалация' :
                         aiContext.sentiment === 'positive' ? '😊 Позитив' : '😐 Нейтрально'}
                      </span>
                      {aiContext.urgencyLevel >= 4 && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          ⚡ Срочно
                        </span>
                      )}
                    </div>
                    
                    {/* Client Waiting */}
                    {aiContext.clientWaitingTime !== null && aiContext.clientWaitingTime > 0 && (
                      <div className={`flex items-center gap-2 text-xs ${
                        aiContext.clientWaitingTime > 60 ? 'text-red-600' : 
                        aiContext.clientWaitingTime > 30 ? 'text-orange-600' : 'text-slate-600'
                      }`}>
                        <Clock className="w-3 h-3" />
                        Клиент ждёт {aiContext.clientWaitingTime > 60 
                          ? `${Math.floor(aiContext.clientWaitingTime / 60)}ч ${aiContext.clientWaitingTime % 60}м`
                          : `${aiContext.clientWaitingTime}м`}
                      </div>
                    )}
                    
                    {/* Main Issues */}
                    {aiContext.mainIssues.length > 0 && (
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Проблемы</div>
                        <ul className="space-y-1">
                          {aiContext.mainIssues.slice(0, 3).map((issue, i) => (
                            <li key={i} className="flex items-start gap-1 text-slate-700">
                              <AlertCircle className="w-3 h-3 text-orange-500 mt-0.5 shrink-0" />
                              {issue}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {/* Pending Actions */}
                    {aiContext.pendingActions.length > 0 && (
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Что сделать</div>
                        <ul className="space-y-1">
                          {aiContext.pendingActions.slice(0, 3).map((action, i) => (
                            <li key={i} className="flex items-start gap-1 text-slate-700">
                              <CheckCircle className="w-3 h-3 text-green-500 mt-0.5 shrink-0" />
                              {action}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {/* Suggested Response */}
                    {aiContext.suggestedResponse && (
                      <div className="bg-green-50 rounded-lg p-2 border border-green-200">
                        <div className="text-xs text-green-600 mb-1">💡 Рекомендованный ответ</div>
                        <div className="text-slate-700 text-xs">{aiContext.suggestedResponse}</div>
                        <button 
                          onClick={() => setReplyText(aiContext.suggestedResponse || '')}
                          className="mt-2 text-xs text-green-600 hover:text-green-700 font-medium"
                        >
                          Использовать →
                        </button>
                      </div>
                    )}
                    
                    {/* Key Topics */}
                    {aiContext.keyTopics.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {aiContext.keyTopics.slice(0, 5).map((topic, i) => (
                          <span key={i} className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs">
                            {topic}
                          </span>
                        ))}
                      </div>
                    )}
                    
                    {/* Similar Dialogs from Learning Database - Priority! */}
                    {similarDialogs.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-indigo-200">
                        <div className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-amber-500" />
                          <span className="text-amber-600 font-medium">Похожие решённые вопросы</span>
                        </div>
                        <div className="space-y-2">
                          {similarDialogs.slice(0, 3).map((dialog) => (
                            <div key={dialog.id} className="bg-amber-50/80 rounded-lg p-2 text-xs border border-amber-200">
                              <div className="flex items-center gap-1 mb-1">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  dialog.confidence >= 0.8 ? 'bg-green-100 text-green-700' :
                                  dialog.confidence >= 0.6 ? 'bg-amber-100 text-amber-700' :
                                  'bg-slate-100 text-slate-600'
                                }`}>
                                  {Math.round(dialog.confidence * 100)}%
                                </span>
                                {dialog.wasHelpful === true && <span title="Помогло" className="text-green-500">✓</span>}
                                <span className="text-slate-400 text-[10px]">• {dialog.usedCount}x</span>
                              </div>
                              <div className="text-slate-500 text-[10px] mb-1 line-clamp-1">Q: {dialog.question}</div>
                              <div className="text-slate-700 line-clamp-2">{dialog.answer}</div>
                              <button 
                                onClick={() => setReplyText(dialog.answer)}
                                className="mt-1.5 text-[10px] text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1"
                              >
                                <Copy className="w-3 h-3" /> Использовать ответ
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Similar Solutions from Knowledge Base */}
                    {aiContext.similarSolutions && aiContext.similarSolutions.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-indigo-200">
                        <div className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                          <Search className="w-3 h-3" />
                          Похожие решения
                        </div>
                        <div className="space-y-2">
                          {aiContext.similarSolutions.slice(0, 2).map((sol, i) => (
                            <div key={i} className="bg-white/80 rounded-lg p-2 text-xs">
                              <div className="flex items-center gap-1 mb-1">
                                {sol.isVerified && <span title="Проверено">✓</span>}
                                <span className="text-indigo-600 font-medium">{sol.category}</span>
                                <span className="text-slate-400">• {sol.successScore}/5</span>
                              </div>
                              <div className="text-slate-700 line-clamp-2">{sol.text}</div>
                              {sol.steps && sol.steps.length > 0 && (
                                <div className="mt-1 text-slate-500">
                                  Шаги: {sol.steps.length}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Documentation from GitBook */}
                    {autoDocsResults.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-indigo-200">
                        <div className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                          <BookOpen className="w-3 h-3" />
                          Документация
                        </div>
                        <div className="space-y-1.5">
                          {autoDocsResults.map((doc) => (
                            <a 
                              key={doc.id}
                              href={doc.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-start gap-2 p-1.5 bg-white/80 rounded-lg hover:bg-white transition-colors group"
                            >
                              <FileText className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-slate-700 group-hover:text-blue-600 line-clamp-1">
                                  {doc.title}
                                </div>
                                <div className="text-[10px] text-slate-400">{doc.category}</div>
                              </div>
                              <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-blue-500 shrink-0" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 text-center py-4">
                    {loadingAiContext ? 'Анализирую контекст...' : 'Выберите канал для анализа'}
                  </div>
                )}
              </div>
              
              {/* Documentation Search Panel */}
              <div className="bg-white rounded-xl shadow-sm p-4">
                <h3 className="font-medium text-slate-800 mb-3 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-blue-500" />
                  База знаний
                </h3>
                
                {/* Search Input */}
                <div className="relative mb-3">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={docsSearchQuery}
                    onChange={(e) => {
                      setDocsSearchQuery(e.target.value)
                      if (e.target.value.length >= 2) {
                        searchDocs(e.target.value)
                      } else {
                        setDocsSearchResults([])
                      }
                    }}
                    placeholder="Поиск в документации..."
                    className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  {searchingDocs && (
                    <RefreshCw className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 animate-spin" />
                  )}
                </div>
                
                {/* Search Results */}
                {docsSearchResults.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {docsSearchResults.map((doc) => (
                      <a
                        key={doc.id}
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-2 bg-slate-50 rounded-lg hover:bg-blue-50 transition-colors group"
                      >
                        <div className="flex items-start gap-2">
                          <FileText className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-700 group-hover:text-blue-600">
                              {doc.title}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                              {doc.excerpt}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded">
                                {doc.category}
                              </span>
                              {doc.relevance && (
                                <span className="text-[10px] text-slate-400">
                                  {doc.relevance}% совпадение
                                </span>
                              )}
                            </div>
                          </div>
                          <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500 shrink-0" />
                        </div>
                      </a>
                    ))}
                  </div>
                )}
                
                {docsSearchQuery.length >= 2 && docsSearchResults.length === 0 && !searchingDocs && (
                  <div className="text-xs text-slate-500 text-center py-3">
                    Ничего не найдено
                  </div>
                )}
                
                {docsSearchQuery.length < 2 && (
                  <div className="text-xs text-slate-400 text-center py-2">
                    Введите минимум 2 символа для поиска
                  </div>
                )}
              </div>
              
              {/* Stats - 2 rows */}
              <div className="bg-white rounded-xl shadow-sm p-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5 px-2 py-1.5 bg-slate-50 rounded">
                    <span className="font-bold text-slate-700">{messagesStats.total || 0}</span>
                    <span className="text-slate-400">всего</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1.5 bg-blue-50 rounded">
                    <span className="font-bold text-blue-600">{messagesStats.unread || 0}</span>
                    <span className="text-blue-400">новых</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1.5 bg-orange-50 rounded">
                    <span className="font-bold text-orange-600">{remindersStats.active}</span>
                    <span className="text-orange-400">обещаний</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1.5 bg-red-50 rounded">
                    <span className="font-bold text-red-600">{remindersStats.overdue}</span>
                    <span className="text-red-400">просрочено</span>
                  </div>
                </div>
                
                {/* AI Learning Stats */}
                {learningStats && (
                  <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                      <Brain className="w-3 h-3 text-purple-500" />
                      <span className="text-purple-600 font-medium">AI</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-purple-600">{learningStats.totalDialogs} диал.</span>
                      <span className="text-green-600">{learningStats.successRate}%</span>
                      <span className="text-amber-600">{Math.round(learningStats.avgConfidence * 100)}%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============ AUTOMATIONS TAB ============ */}
        {activeTab === 'automations' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-medium text-slate-800">Автоматизации</h2>
                <p className="text-sm text-slate-500">Правила автоматической обработки событий</p>
              </div>
              <button 
                onClick={() => setShowNewAutomationModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue"
              >
                <Plus className="w-4 h-4" />
                Новое правило
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
              </div>
            ) : automations.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center shadow-sm">
                <Zap className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-800">Нет автоматизаций</h3>
                <p className="text-slate-500 mt-1">Создайте правила для автоматической обработки событий</p>
                <button 
                  onClick={() => setShowNewAutomationModal(true)}
                  className="mt-4 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue"
                >
                  Создать первую автоматизацию
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {automations.map(auto => (
                  <div key={auto.id} className="bg-white rounded-xl p-5 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${auto.isActive ? 'bg-green-100' : 'bg-slate-100'}`}>
                          <Zap className={`w-5 h-5 ${auto.isActive ? 'text-green-600' : 'text-slate-400'}`} />
                        </div>
                        <div>
                          <h3 className="font-medium text-slate-800">{auto.name}</h3>
                          <p className="text-sm text-slate-500 mt-1">{auto.description || 'Без описания'}</p>
                          <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
                            <span className="flex items-center gap-1">
                              <Activity className="w-3 h-3" />
                              Триггер: {{
                                'message_received': 'Новое сообщение',
                                'message_problem_detected': 'Проблема в сообщении',
                                'media_received': 'Получено медиа',
                                'escalation_detected': 'Эскалация',
                                'lead_stage_change': 'Смена стадии лида',
                                'case_status_change': 'Смена статуса кейса'
                              }[auto.triggerType] || auto.triggerType || 'Не указан'}
                            </span>
                            <span>→</span>
                            <span>Действие: {{
                              'create_case': 'Создать кейс',
                              'create_task': 'Создать задачу',
                              'send_notification': 'Уведомление',
                              'escalate': 'Эскалация',
                              'assign_manager': 'Назначить менеджера',
                              'transcribe_and_analyze': 'Транскрибировать'
                            }[auto.actionType] || auto.actionType || 'Не указано'}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-sm font-medium text-slate-700">{auto.executionsCount || 0}</div>
                          <div className="text-xs text-slate-400">выполнений</div>
                        </div>
                        <button 
                          onClick={async () => {
                            const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
                            try {
                              await fetch('/api/support/automations', {
                                method: 'PUT',
                                headers: { 
                                  'Content-Type': 'application/json',
                                  Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` 
                                },
                                body: JSON.stringify({ id: auto.id, isActive: !auto.isActive })
                              })
                              setAutomations(prev => prev.map(a => 
                                a.id === auto.id ? { ...a, isActive: !a.isActive } : a
                              ))
                            } catch (e) {
                              console.error('Failed to toggle automation:', e)
                            }
                          }}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${auto.isActive ? 'bg-green-500' : 'bg-slate-200'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${auto.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                        <button
                          onClick={() => {
                            setConfirmDialog({
                              show: true,
                              title: 'Удаление автоматизации',
                              message: 'Вы уверены, что хотите удалить эту автоматизацию?',
                              danger: true,
                              onConfirm: async () => {
                                const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
                                try {
                                  await fetch(`/api/support/automations?id=${auto.id}`, {
                                    method: 'DELETE',
                                    headers: { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` }
                                  })
                                  setAutomations(prev => prev.filter(a => a.id !== auto.id))
                                } catch (e) {
                                  console.error('Failed to delete automation:', e)
                                }
                              }
                            })
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* New Automation Modal */}
            {showNewAutomationModal && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white rounded-2xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Новая автоматизация</h3>
                    <button onClick={() => setShowNewAutomationModal(false)} className="p-1 hover:bg-slate-100 rounded">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Название</label>
                      <input
                        type="text"
                        value={newAutomation.name}
                        onChange={e => setNewAutomation({ ...newAutomation, name: e.target.value })}
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                        placeholder="Например: Проблема → Кейс"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Описание</label>
                      <textarea
                        value={newAutomation.description}
                        onChange={e => setNewAutomation({ ...newAutomation, description: e.target.value })}
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                        rows={2}
                        placeholder="Что делает эта автоматизация"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Триггер (когда срабатывает)</label>
                      <select
                        value={newAutomation.triggerType}
                        onChange={e => setNewAutomation({ ...newAutomation, triggerType: e.target.value })}
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                      >
                        <option value="message_received">Получено сообщение</option>
                        <option value="message_problem_detected">Обнаружена проблема в сообщении</option>
                        <option value="media_received">Получено медиа (голосовое/видео)</option>
                        <option value="escalation_detected">Обнаружена эскалация</option>
                        <option value="lead_stage_change">Смена стадии лида</option>
                        <option value="case_status_change">Смена статуса кейса</option>
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Действие (что делать)</label>
                      <select
                        value={newAutomation.actionType}
                        onChange={e => setNewAutomation({ ...newAutomation, actionType: e.target.value })}
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                      >
                        <option value="create_case">Создать кейс поддержки</option>
                        <option value="create_task">Создать задачу</option>
                        <option value="send_notification">Отправить уведомление</option>
                        <option value="escalate">Эскалировать</option>
                        <option value="assign_manager">Назначить менеджера</option>
                        <option value="transcribe_and_analyze">Транскрибировать и анализировать</option>
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Приоритет (выше = раньше)</label>
                      <input
                        type="number"
                        value={newAutomation.priority}
                        onChange={e => setNewAutomation({ ...newAutomation, priority: parseInt(e.target.value) || 0 })}
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                        min="0"
                        max="100"
                      />
                    </div>
                  </div>
                  
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={() => setShowNewAutomationModal(false)}
                      className="flex-1 px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
                    >
                      Отмена
                    </button>
                    <button
                      onClick={async () => {
                        if (!newAutomation.name.trim()) {
                          alert('Введите название')
                          return
                        }
                        const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
                        try {
                          const res = await fetch('/api/support/automations', {
                            method: 'POST',
                            headers: { 
                              'Content-Type': 'application/json',
                              Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` 
                            },
                            body: JSON.stringify(newAutomation)
                          })
                          if (res.ok) {
                            const data = await res.json()
                            setAutomations(prev => [...prev, {
                              id: data.automationId,
                              ...newAutomation,
                              isActive: true,
                              executionsCount: 0
                            }])
                            setShowNewAutomationModal(false)
                            setNewAutomation({
                              name: '',
                              description: '',
                              triggerType: 'message_problem_detected',
                              actionType: 'create_case',
                              triggerConfig: {},
                              actionConfig: {},
                              priority: 0
                            })
                          }
                        } catch (e) {
                          console.error('Failed to create automation:', e)
                          alert('Ошибка создания автоматизации')
                        }
                      }}
                      className="flex-1 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue"
                    >
                      Создать
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ============ ANALYTICS TAB ============ */}
        {activeTab === 'analytics' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-medium text-slate-800">Аналитика Support</h2>
              <div className="flex gap-2">
                {['7d', '30d', '90d'].map(p => (
                  <button
                    key={p}
                    onClick={() => setAnalyticsPeriod(p)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                      analyticsPeriod === p ? 'bg-brand-blue text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {p === '7d' ? '7 дней' : p === '30d' ? '30 дней' : '90 дней'}
                  </button>
                ))}
              </div>
            </div>

            {loading || !analytics ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Overview Cards - Clickable for details */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <button 
                    onClick={() => setShowConversationsModal({ type: 'all', title: 'Все кейсы' })}
                    className="bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow text-left"
                  >
                    <div className="text-sm text-slate-500 mb-1">Всего кейсов</div>
                    <div className="text-3xl font-bold text-slate-800">{analytics.overview.totalCases}</div>
                    <div className="text-xs text-slate-400 mt-1">100%</div>
                  </button>
                  <button 
                    onClick={() => setShowConversationsModal({ type: 'open', title: 'Открытые кейсы' })}
                    className="bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow text-left"
                  >
                    <div className="text-sm text-slate-500 mb-1">Открытых</div>
                    <div className="text-3xl font-bold text-orange-500">{analytics.overview.openCases}</div>
                    <div className="text-xs text-orange-400 mt-1">
                      {analytics.overview.totalCases > 0 
                        ? `${Math.round((analytics.overview.openCases / analytics.overview.totalCases) * 100)}%`
                        : '0%'}
                    </div>
                  </button>
                  <button 
                    onClick={() => setShowConversationsModal({ type: 'resolved', title: 'Решённые кейсы' })}
                    className="bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow text-left"
                  >
                    <div className="text-sm text-slate-500 mb-1">Решённых</div>
                    <div className="text-3xl font-bold text-green-500">{analytics.overview.resolvedCases}</div>
                    <div className="text-xs text-green-400 mt-1">
                      {analytics.overview.totalCases > 0 
                        ? `${Math.round((analytics.overview.resolvedCases / analytics.overview.totalCases) * 100)}%`
                        : '0%'}
                    </div>
                  </button>
                  <div className="bg-white rounded-xl p-5 shadow-sm">
                    <div className="text-sm text-slate-500 mb-1">Ср. решение</div>
                    <div className="text-3xl font-bold text-blue-500">{analytics.overview.avgResolutionHours}ч</div>
                    <div className="text-xs text-blue-400 mt-1">среднее время</div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  {/* Problem Patterns */}
                  <div className="bg-white rounded-xl p-5 shadow-sm">
                    <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-orange-500" />
                      Паттерны проблем
                    </h3>
                    {analytics.patterns.byCategory.length === 0 ? (
                      <p className="text-slate-500 text-sm">Нет данных за период</p>
                    ) : (
                      <div className="space-y-3">
                        {analytics.patterns.byCategory.slice(0, 6).map((cat, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <span className="text-sm text-slate-600">
                              {{
                                technical: '🔧 Техническая',
                                billing: '💳 Биллинг',
                                integration: '🔗 Интеграция',
                                onboarding: '🚀 Онбординг',
                                feature_request: '💡 Запрос функции',
                                complaint: '😤 Жалоба',
                                question: '❓ Вопрос',
                                feedback: '💬 Обратная связь',
                                general: '📋 Общее'
                              }[cat.category] || cat.category}
                            </span>
                            <div className="flex items-center gap-2">
                              <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-orange-500 rounded-full"
                                  style={{ width: `${(cat.count / (analytics.patterns.byCategory[0]?.count || 1)) * 100}%` }}
                                />
                              </div>
                              <span className="text-sm font-medium w-8 text-right">{cat.count}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Sentiment Distribution */}
                  <div className="bg-white rounded-xl p-5 shadow-sm">
                    <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                      <Activity className="w-5 h-5 text-purple-500" />
                      Настроение сообщений
                    </h3>
                    {analytics.patterns.bySentiment.length === 0 ? (
                      <p className="text-slate-500 text-sm">Нет данных за период</p>
                    ) : (
                      <div className="space-y-3">
                        {analytics.patterns.bySentiment.map((s, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${sentimentColors[s.sentiment] || 'bg-slate-100'}`}>
                              {{ positive: 'Позитивное', neutral: 'Нейтральное', negative: 'Негативное', frustrated: 'Раздражённое' }[s.sentiment] || s.sentiment}
                            </span>
                            <span className="text-sm font-medium">{s.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Churn Signals */}
                <div className="bg-white rounded-xl p-5 shadow-sm">
                  <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-red-500" />
                    Риск оттока клиентов
                  </h3>
                  
                  {analytics.churnSignals.highRiskCompanies.length === 0 ? (
                    <div className="text-center py-8">
                      <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                      <p className="text-slate-600">Компаний с высоким риском оттока не обнаружено</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 font-medium text-slate-500">Компания</th>
                            <th className="text-left py-2 font-medium text-slate-500">Выручка</th>
                            <th className="text-left py-2 font-medium text-slate-500">Риск</th>
                            <th className="text-left py-2 font-medium text-slate-500">Открытых кейсов</th>
                            <th className="text-left py-2 font-medium text-slate-500">Повторных</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analytics.churnSignals.highRiskCompanies.map((c, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-2 font-medium">{c.companyName || c.companyId}</td>
                              <td className="py-2">${c.mrr}</td>
                              <td className="py-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  c.riskScore >= 10 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                                }`}>
                                  {c.riskScore}
                                </span>
                              </td>
                              <td className="py-2">{c.openCases}</td>
                              <td className="py-2">{c.recurringCases}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Team Performance */}
                <div className="bg-white rounded-xl p-5 shadow-sm">
                  <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-500" />
                    Метрики команды
                  </h3>
                  
                  {analytics.teamMetrics.byManager.length === 0 ? (
                    <p className="text-slate-500 text-sm">Нет данных за период</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 font-medium text-slate-500">Менеджер</th>
                            <th className="text-left py-2 font-medium text-slate-500">Кейсов</th>
                            <th className="text-left py-2 font-medium text-slate-500">Решено</th>
                            <th className="text-left py-2 font-medium text-slate-500">% решённых</th>
                            <th className="text-left py-2 font-medium text-slate-500">Ср. время</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analytics.teamMetrics.byManager.map((m, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-2 font-medium">{m.managerName === 'Unassigned' ? 'Не назначен' : m.managerName}</td>
                              <td className="py-2">{m.totalCases}</td>
                              <td className="py-2">{m.resolvedCases}</td>
                              <td className="py-2">
                                <span className={`font-medium ${m.resolutionRate >= 80 ? 'text-green-600' : m.resolutionRate >= 50 ? 'text-orange-500' : 'text-red-500'}`}>
                                  {m.resolutionRate}%
                                </span>
                              </td>
                              <td className="py-2">{Math.round(m.avgResolutionMinutes / 60)}ч</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Messages Analytics */}
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Message Stats */}
                  <div className="bg-white rounded-xl p-5 shadow-sm">
                    <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-blue-500" />
                      Статистика сообщений
                    </h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Всего сообщений</span>
                        <span className="font-semibold">{messagesStats?.total || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Непрочитанных</span>
                        <span className="font-semibold text-orange-600">{messagesStats?.unread || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Проблемных</span>
                        <span className="font-semibold text-red-600">{messagesStats?.problems || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Каналов активных</span>
                        <span className="font-semibold">{messagesStats?.channelsWithMessages || 0}</span>
                      </div>
                    </div>
                  </div>

                  {/* AI Analysis Summary */}
                  <div className="bg-white rounded-xl p-5 shadow-sm">
                    <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                      <Zap className="w-5 h-5 text-purple-500" />
                      AI обработка
                    </h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Голосовых транскрибировано</span>
                        <span className="font-semibold text-purple-600">
                          {messages.filter(m => m.transcript).length}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Изображений проанализировано</span>
                        <span className="font-semibold text-blue-600">
                          {messages.filter(m => m.aiImageAnalysis).length}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Срочные (4-5)</span>
                        <span className="font-semibold text-red-600">
                          {messages.filter(m => (m.aiUrgency || 0) >= 4).length}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Категоризировано</span>
                        <span className="font-semibold text-green-600">
                          {messages.filter(m => m.aiCategory).length}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ========== АНАЛИТИКА КАНАЛОВ ========== */}
                <div className="mt-8 pt-6 border-t-2 border-slate-200">
                  <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-3">
                    <Radio className="w-6 h-6 text-blue-500" />
                    Аналитика каналов
                  </h2>

                  {/* 1. Топ каналов по активности */}
                  <div className="grid md:grid-cols-2 gap-6 mb-6">
                    <div className="bg-white rounded-xl p-5 shadow-sm">
                      <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-green-500" />
                        Топ-5 активных каналов
                      </h3>
                      {(() => {
                        const channelStats = groupedMessages
                          .map((ch: any) => ({
                            ...ch,
                            msgCount: ch.messages?.length || 0,
                            caseCount: cases.filter(c => c.channelId === ch.id).length,
                          }))
                          .sort((a: any, b: any) => b.msgCount - a.msgCount)
                          .slice(0, 5)
                        
                        return channelStats.length === 0 ? (
                          <p className="text-slate-500 text-sm">Нет данных</p>
                        ) : (
                          <div className="space-y-3">
                            {channelStats.map((ch: any, i: number) => (
                              <div key={ch.id} className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                  i === 0 ? 'bg-yellow-100 text-yellow-700' :
                                  i === 1 ? 'bg-slate-100 text-slate-700' :
                                  i === 2 ? 'bg-orange-100 text-orange-700' :
                                  'bg-slate-50 text-slate-500'
                                }`}>
                                  {i + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{ch.name}</div>
                                  <div className="text-xs text-slate-400">{ch.msgCount} сообщ. • {ch.caseCount} кейсов</div>
                                </div>
                                <div className={`text-xs px-2 py-1 rounded ${
                                  ch.awaitingReply ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                                }`}>
                                  {ch.awaitingReply ? 'Ждёт' : 'OK'}
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </div>

                    {/* 2. Здоровье каналов (светофор) */}
                    <div className="bg-white rounded-xl p-5 shadow-sm">
                      <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                        <Activity className="w-5 h-5 text-blue-500" />
                        Здоровье каналов
                      </h3>
                      {(() => {
                        const healthStats = {
                          green: groupedMessages.filter((ch: any) => !ch.awaitingReply).length,
                          yellow: groupedMessages.filter((ch: any) => {
                            if (!ch.awaitingReply || !ch.lastClientMessageAt) return false
                            const waitMin = Math.floor((Date.now() - new Date(ch.lastClientMessageAt).getTime()) / 60000)
                            return waitMin <= KPI.FIRST_RESPONSE_MIN
                          }).length,
                          red: groupedMessages.filter((ch: any) => {
                            if (!ch.awaitingReply || !ch.lastClientMessageAt) return false
                            const waitMin = Math.floor((Date.now() - new Date(ch.lastClientMessageAt).getTime()) / 60000)
                            return waitMin > KPI.FIRST_RESPONSE_MIN
                          }).length,
                        }
                        const total = groupedMessages.length || 1
                        
                        return (
                          <div className="space-y-4">
                            <div className="flex gap-2">
                              <div className="flex-1 text-center p-3 bg-green-50 rounded-lg">
                                <div className="text-2xl font-bold text-green-600">{healthStats.green}</div>
                                <div className="text-xs text-green-600">В норме</div>
                              </div>
                              <div className="flex-1 text-center p-3 bg-yellow-50 rounded-lg">
                                <div className="text-2xl font-bold text-yellow-600">{healthStats.yellow}</div>
                                <div className="text-xs text-yellow-600">Внимание</div>
                              </div>
                              <div className="flex-1 text-center p-3 bg-red-50 rounded-lg">
                                <div className="text-2xl font-bold text-red-600">{healthStats.red}</div>
                                <div className="text-xs text-red-600">Просрочено</div>
                              </div>
                            </div>
                            <div className="h-4 rounded-full overflow-hidden flex bg-slate-100">
                              <div className="bg-green-500 h-full" style={{ width: `${(healthStats.green / total) * 100}%` }} />
                              <div className="bg-yellow-500 h-full" style={{ width: `${(healthStats.yellow / total) * 100}%` }} />
                              <div className="bg-red-500 h-full" style={{ width: `${(healthStats.red / total) * 100}%` }} />
                            </div>
                            <div className="text-center text-sm text-slate-500">
                              SLA {KPI.FIRST_RESPONSE_MIN} мин: {Math.round(((healthStats.green + healthStats.yellow) / total) * 100)}% выполнение
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  </div>

                  {/* 3. Проблемные каналы */}
                  <div className="bg-white rounded-xl p-5 shadow-sm mb-6">
                    <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-500" />
                      Проблемные каналы (требуют внимания)
                    </h3>
                    {(() => {
                      const problemChannels = groupedMessages
                        .filter((ch: any) => {
                          const waitMin = ch.lastClientMessageAt 
                            ? Math.floor((Date.now() - new Date(ch.lastClientMessageAt).getTime()) / 60000) 
                            : 0
                          const openCases = cases.filter(c => c.channelId === ch.id && c.status !== 'resolved').length
                          return ch.awaitingReply && (waitMin > KPI.FIRST_RESPONSE_MIN || openCases > 2)
                        })
                        .map((ch: any) => {
                          const waitMin = ch.lastClientMessageAt 
                            ? Math.floor((Date.now() - new Date(ch.lastClientMessageAt).getTime()) / 60000) 
                            : 0
                          const openCases = cases.filter(c => c.channelId === ch.id && c.status !== 'resolved').length
                          return { ...ch, waitMin, openCases }
                        })
                        .sort((a: any, b: any) => b.waitMin - a.waitMin)
                        .slice(0, 5)
                      
                      return problemChannels.length === 0 ? (
                        <div className="text-center py-6 text-green-600">
                          <CheckCircle className="w-10 h-10 mx-auto mb-2" />
                          <p>Нет проблемных каналов</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left py-2 font-medium text-slate-500">Канал</th>
                                <th className="text-left py-2 font-medium text-slate-500">Ожидание</th>
                                <th className="text-left py-2 font-medium text-slate-500">Открыто кейсов</th>
                                <th className="text-left py-2 font-medium text-slate-500">Действие</th>
                              </tr>
                            </thead>
                            <tbody>
                              {problemChannels.map((ch: any) => (
                                <tr key={ch.id} className="border-b last:border-0 hover:bg-red-50">
                                  <td className="py-2 font-medium">{ch.name}</td>
                                  <td className="py-2">
                                    <span className="text-red-600 font-bold">{ch.waitMin} мин</span>
                                    <span className="text-xs text-slate-400 ml-1">(+{ch.waitMin - KPI.FIRST_RESPONSE_MIN})</span>
                                  </td>
                                  <td className="py-2">
                                    <span className={ch.openCases > 2 ? 'text-red-600 font-bold' : ''}>{ch.openCases}</span>
                                  </td>
                                  <td className="py-2">
                                    <button
                                      onClick={() => {
                                        setActiveTab('messages')
                                        setExpandedChannels(new Set([ch.id]))
                                      }}
                                      className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600"
                                    >
                                      Открыть
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    })()}
                  </div>

                  {/* 4. Активность по времени */}
                  <div className="grid md:grid-cols-2 gap-6 mb-6">
                    <div className="bg-white rounded-xl p-5 shadow-sm">
                      <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                        <Clock className="w-5 h-5 text-purple-500" />
                        Активность по часам
                      </h3>
                      {(() => {
                        const hourStats = Array(24).fill(0)
                        messages.forEach(m => {
                          const hour = new Date(m.createdAt).getHours()
                          hourStats[hour]++
                        })
                        const maxHour = Math.max(...hourStats)
                        const peakHour = hourStats.indexOf(maxHour)
                        
                        return (
                          <div>
                            <div className="flex items-end gap-0.5 h-24 mb-2">
                              {hourStats.map((count, hour) => (
                                <div
                                  key={hour}
                                  className={`flex-1 rounded-t ${
                                    hour === peakHour ? 'bg-purple-500' :
                                    count > maxHour * 0.7 ? 'bg-purple-400' :
                                    count > maxHour * 0.3 ? 'bg-purple-300' :
                                    'bg-purple-100'
                                  }`}
                                  style={{ height: `${maxHour > 0 ? (count / maxHour) * 100 : 0}%`, minHeight: count > 0 ? '4px' : '0' }}
                                  title={`${hour}:00 - ${count} сообщ.`}
                                />
                              ))}
                            </div>
                            <div className="flex justify-between text-[10px] text-slate-400">
                              <span>00:00</span>
                              <span>06:00</span>
                              <span>12:00</span>
                              <span>18:00</span>
                              <span>23:00</span>
                            </div>
                            <div className="mt-3 text-center text-sm">
                              Пик активности: <span className="font-bold text-purple-600">{peakHour}:00</span>
                            </div>
                          </div>
                        )
                      })()}
                    </div>

                    <div className="bg-white rounded-xl p-5 shadow-sm">
                      <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-blue-500" />
                        Активность по дням
                      </h3>
                      {(() => {
                        const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
                        const dayStats = Array(7).fill(0)
                        messages.forEach(m => {
                          const day = new Date(m.createdAt).getDay()
                          dayStats[day]++
                        })
                        const maxDay = Math.max(...dayStats)
                        
                        return (
                          <div className="space-y-2">
                            {[1, 2, 3, 4, 5, 6, 0].map(day => (
                              <div key={day} className="flex items-center gap-2">
                                <span className="w-6 text-xs text-slate-500">{dayNames[day]}</span>
                                <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${day === 0 || day === 6 ? 'bg-blue-300' : 'bg-blue-500'}`}
                                    style={{ width: `${maxDay > 0 ? (dayStats[day] / maxDay) * 100 : 0}%` }}
                                  />
                                </div>
                                <span className="w-10 text-xs text-right font-medium">{dayStats[day]}</span>
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </div>
                  </div>

                  {/* 5. Типы каналов */}
                  <div className="bg-white rounded-xl p-5 shadow-sm mb-6">
                    <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                      <Filter className="w-5 h-5 text-slate-500" />
                      Типы каналов
                    </h3>
                    {(() => {
                      const typeStats = {
                        forums: groupedMessages.filter((ch: any) => ch.isForum).length,
                        regular: groupedMessages.filter((ch: any) => !ch.isForum).length,
                        active: groupedMessages.filter((ch: any) => ch.messages?.length > 0).length,
                        inactive: groupedMessages.filter((ch: any) => !ch.messages || ch.messages.length === 0).length,
                      }
                      const total = groupedMessages.length || 1
                      
                      return (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="text-center p-3 bg-blue-50 rounded-lg">
                            <div className="text-2xl font-bold text-blue-600">{typeStats.forums}</div>
                            <div className="text-xs text-blue-600">Форумы</div>
                            <div className="text-[10px] text-slate-400">{Math.round((typeStats.forums / total) * 100)}%</div>
                          </div>
                          <div className="text-center p-3 bg-slate-50 rounded-lg">
                            <div className="text-2xl font-bold text-slate-600">{typeStats.regular}</div>
                            <div className="text-xs text-slate-600">Обычные группы</div>
                            <div className="text-[10px] text-slate-400">{Math.round((typeStats.regular / total) * 100)}%</div>
                          </div>
                          <div className="text-center p-3 bg-green-50 rounded-lg">
                            <div className="text-2xl font-bold text-green-600">{typeStats.active}</div>
                            <div className="text-xs text-green-600">Активные</div>
                            <div className="text-[10px] text-slate-400">{Math.round((typeStats.active / total) * 100)}%</div>
                          </div>
                          <div className="text-center p-3 bg-orange-50 rounded-lg">
                            <div className="text-2xl font-bold text-orange-600">{typeStats.inactive}</div>
                            <div className="text-xs text-orange-600">Без сообщений</div>
                            <div className="text-[10px] text-slate-400">{Math.round((typeStats.inactive / total) * 100)}%</div>
                          </div>
                        </div>
                      )
                    })()}
                  </div>

                  {/* 6. Матрица всех каналов */}
                  <div className="bg-white rounded-xl p-5 shadow-sm">
                    <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-slate-500" />
                      Все каналы ({groupedMessages.length})
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-slate-50">
                            <th className="text-left py-3 px-2 font-medium text-slate-600">Канал</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600">Сообщ.</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600">Кейсы</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600">Ожидание</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600">Тип</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600">Статус</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupedMessages
                            .map((ch: any) => ({
                              ...ch,
                              msgCount: ch.messages?.length || 0,
                              caseCount: cases.filter(c => c.channelId === ch.id).length,
                              waitMin: ch.lastClientMessageAt && ch.awaitingReply
                                ? Math.floor((Date.now() - new Date(ch.lastClientMessageAt).getTime()) / 60000)
                                : 0,
                            }))
                            .sort((a: any, b: any) => b.msgCount - a.msgCount)
                            .slice(0, 20)
                            .map((ch: any) => (
                              <tr 
                                key={ch.id} 
                                className="border-b last:border-0 hover:bg-slate-50 cursor-pointer"
                                onClick={() => {
                                  setActiveTab('messages')
                                  setExpandedChannels(new Set([ch.id]))
                                }}
                              >
                                <td className="py-2 px-2">
                                  <div className="font-medium truncate max-w-[200px]">{ch.name}</div>
                                </td>
                                <td className="py-2 px-2 text-center font-medium">{ch.msgCount}</td>
                                <td className="py-2 px-2 text-center">
                                  <span className={ch.caseCount > 0 ? 'text-orange-600 font-medium' : ''}>{ch.caseCount}</span>
                                </td>
                                <td className="py-2 px-2 text-center">
                                  {ch.awaitingReply ? (
                                    <span className={`font-medium ${ch.waitMin > KPI.FIRST_RESPONSE_MIN ? 'text-red-600' : 'text-yellow-600'}`}>
                                      {ch.waitMin} мин
                                    </span>
                                  ) : (
                                    <span className="text-green-600">-</span>
                                  )}
                                </td>
                                <td className="py-2 px-2 text-center">
                                  <span className={`text-xs px-2 py-0.5 rounded ${ch.isForum ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-600'}`}>
                                    {ch.isForum ? 'Форум' : 'Группа'}
                                  </span>
                                </td>
                                <td className="py-2 px-2 text-center">
                                  <span className={`inline-block w-3 h-3 rounded-full ${
                                    !ch.awaitingReply ? 'bg-green-500' :
                                    ch.waitMin <= KPI.FIRST_RESPONSE_MIN ? 'bg-yellow-500' :
                                    'bg-red-500'
                                  }`} />
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* ========== АНАЛИТИКА СОТРУДНИКОВ ========== */}
                <div className="mt-8 pt-6 border-t-2 border-slate-200">
                  <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-3">
                    <Users className="w-6 h-6 text-purple-500" />
                    Аналитика сотрудников
                  </h2>

                  {/* Топ-5 сотрудников */}
                  <div className="grid md:grid-cols-2 gap-6 mb-6">
                    <div className="bg-white rounded-xl p-5 shadow-sm">
                      <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                        <Award className="w-5 h-5 text-yellow-500" />
                        Топ-5 по эффективности
                      </h3>
                      {(() => {
                        const agentStats = agents
                          .map(a => ({
                            ...a,
                            points: (a.metrics?.messagesHandled || 0) * GAMIFICATION.POINTS.MESSAGE_SENT +
                                   (a.metrics?.resolvedConversations || 0) * GAMIFICATION.POINTS.CASE_RESOLVED,
                            level: getAgentLevel(
                              (a.metrics?.messagesHandled || 0) * GAMIFICATION.POINTS.MESSAGE_SENT +
                              (a.metrics?.resolvedConversations || 0) * GAMIFICATION.POINTS.CASE_RESOLVED
                            )
                          }))
                          .sort((a, b) => b.points - a.points)
                          .slice(0, 5)
                        
                        return agentStats.length === 0 ? (
                          <p className="text-slate-500 text-sm">Нет данных</p>
                        ) : (
                          <div className="space-y-3">
                            {agentStats.map((agent, i) => (
                              <div key={agent.id} className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-lg ${
                                  i === 0 ? 'bg-yellow-100' :
                                  i === 1 ? 'bg-slate-100' :
                                  i === 2 ? 'bg-orange-100' :
                                  'bg-slate-50'
                                }`}>
                                  {agent.level.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{agent.name}</div>
                                  <div className="text-xs text-slate-400">
                                    {agent.metrics?.resolvedConversations || 0} решено • {agent.metrics?.messagesHandled || 0} сообщ.
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="font-bold text-purple-600">{agent.points}</div>
                                  <div className="text-[10px] text-slate-400">очков</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </div>

                    {/* Статус команды */}
                    <div className="bg-white rounded-xl p-5 shadow-sm">
                      <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                        <Activity className="w-5 h-5 text-green-500" />
                        Статус команды
                      </h3>
                      {(() => {
                        const statusStats = {
                          online: agents.filter(a => a.status === 'online').length,
                          away: agents.filter(a => a.status === 'away').length,
                          offline: agents.filter(a => a.status === 'offline').length,
                        }
                        const total = agents.length || 1
                        const totalMessages = agents.reduce((sum, a) => sum + (a.metrics?.messagesHandled || 0), 0)
                        const totalResolved = agents.reduce((sum, a) => sum + (a.metrics?.resolvedConversations || 0), 0)
                        
                        return (
                          <div className="space-y-4">
                            <div className="flex gap-2">
                              <div className="flex-1 text-center p-3 bg-green-50 rounded-lg">
                                <div className="text-2xl font-bold text-green-600">{statusStats.online}</div>
                                <div className="text-xs text-green-600">Онлайн</div>
                              </div>
                              <div className="flex-1 text-center p-3 bg-yellow-50 rounded-lg">
                                <div className="text-2xl font-bold text-yellow-600">{statusStats.away}</div>
                                <div className="text-xs text-yellow-600">Отошёл</div>
                              </div>
                              <div className="flex-1 text-center p-3 bg-slate-50 rounded-lg">
                                <div className="text-2xl font-bold text-slate-600">{statusStats.offline}</div>
                                <div className="text-xs text-slate-600">Офлайн</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="p-3 bg-blue-50 rounded-lg text-center">
                                <div className="text-xl font-bold text-blue-600">{totalMessages}</div>
                                <div className="text-xs text-blue-600">Всего сообщений</div>
                              </div>
                              <div className="p-3 bg-purple-50 rounded-lg text-center">
                                <div className="text-xl font-bold text-purple-600">{totalResolved}</div>
                                <div className="text-xs text-purple-600">Всего решено</div>
                              </div>
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  </div>

                  {/* Матрица всех сотрудников */}
                  <div className="bg-white rounded-xl p-5 shadow-sm">
                    <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-slate-500" />
                      Все сотрудники ({agents.length})
                      <span className="text-xs text-slate-400 ml-auto">Эфф. = работа - штрафы</span>
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-slate-50">
                            <th className="text-left py-3 px-2 font-medium text-slate-600">Сотрудник</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600">Статус</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600">Роль</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600">На сайте</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600">Активное</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600 bg-purple-50" title="Эффективность = (сообщения + кейсы - штрафы) / норма">Эфф.%</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600">Сообщ.</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600">Решено</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600 bg-red-50" title="Просрочено: обещаний / кейсов">⚠️</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600">Уровень</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600">Очки</th>
                          </tr>
                        </thead>
                        <tbody>
                          {agents
                            .map(a => {
                              const activity = agentActivity.find((act: any) => act.agentId === a.id)
                              const effData = calculateEfficiencyScore(a, cases, reminders)
                              return {
                                ...a,
                                points: (a.metrics?.messagesHandled || 0) * GAMIFICATION.POINTS.MESSAGE_SENT +
                                       (a.metrics?.resolvedConversations || 0) * GAMIFICATION.POINTS.CASE_RESOLVED,
                                level: getAgentLevel(
                                  (a.metrics?.messagesHandled || 0) * GAMIFICATION.POINTS.MESSAGE_SENT +
                                  (a.metrics?.resolvedConversations || 0) * GAMIFICATION.POINTS.CASE_RESOLVED
                                ),
                                totalWork: activity?.summary?.totalWorkFormatted || '-',
                                effectiveWork: activity?.summary?.effectiveFormatted || '-',
                                effData,
                              }
                            })
                            .sort((a, b) => b.effData.score - a.effData.score)
                            .map((agent, i) => (
                              <tr key={agent.id} className={`border-b last:border-0 hover:bg-slate-50 ${i === 0 ? 'bg-yellow-50' : ''}`}>
                                <td className="py-2 px-2">
                                  <div className="flex items-center gap-2">
                                    {i === 0 && <span className="text-yellow-500">👑</span>}
                                    <span className="font-medium">{agent.name}</span>
                                  </div>
                                </td>
                                <td className="py-2 px-2 text-center">
                                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                                    agent.status === 'online' ? 'bg-green-100 text-green-700' :
                                    agent.status === 'away' ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-slate-100 text-slate-600'
                                  }`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${
                                      agent.status === 'online' ? 'bg-green-500' :
                                      agent.status === 'away' ? 'bg-yellow-500' :
                                      'bg-slate-400'
                                    }`} />
                                    {agent.status === 'online' ? 'Онлайн' : agent.status === 'away' ? 'Отошёл' : 'Офлайн'}
                                  </span>
                                </td>
                                <td className="py-2 px-2 text-center">
                                  <span className={`text-xs px-2 py-0.5 rounded ${
                                    agent.role === 'manager' ? 'bg-purple-100 text-purple-700' :
                                    agent.role === 'lead' ? 'bg-blue-100 text-blue-700' :
                                    agent.role === 'senior' ? 'bg-green-100 text-green-700' :
                                    'bg-slate-100 text-slate-600'
                                  }`}>
                                    {{ agent: 'Агент', senior: 'Старший', lead: 'Тимлид', manager: 'Менеджер' }[agent.role] || agent.role}
                                  </span>
                                </td>
                                <td className="py-2 px-2 text-center text-slate-600" title="Общее время на сайте">
                                  {agent.totalWork}
                                </td>
                                <td className="py-2 px-2 text-center text-blue-600 font-medium" title="Активное рабочее время">
                                  {agent.effectiveWork}
                                </td>
                                <td className="py-2 px-2 text-center bg-purple-50/50">
                                  <div 
                                    className="group relative cursor-help"
                                    title={`+${agent.effData.positivePoints} за работу, -${agent.effData.negativePoints} штрафы`}
                                  >
                                    <span className={`font-bold ${agent.effData.color}`}>
                                      {agent.effData.score > 0 ? `${agent.effData.score}%` : '-'}
                                    </span>
                                    <div className="absolute z-20 hidden group-hover:block bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 text-white text-xs rounded shadow-lg">
                                      <div className="font-medium mb-1">{agent.effData.label}</div>
                                      <div className="text-green-300">+{agent.effData.details.messagesHandled} сообщ. × 1</div>
                                      <div className="text-green-300">+{agent.effData.details.casesResolved} кейсов × 10</div>
                                      {agent.effData.negativePoints > 0 && (
                                        <>
                                          <div className="border-t border-slate-600 my-1"></div>
                                          {agent.effData.details.overdueReminders > 0 && (
                                            <div className="text-red-300">-{agent.effData.details.overdueReminders} обещаний × 10</div>
                                          )}
                                          {agent.effData.details.openOverdueCases > 0 && (
                                            <div className="text-red-300">-{agent.effData.details.openOverdueCases} кейсов × 5</div>
                                          )}
                                        </>
                                      )}
                                      <div className="border-t border-slate-600 mt-1 pt-1 font-medium">
                                        Итого: {agent.effData.positivePoints - agent.effData.negativePoints} / 80 норма
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-2 px-2 text-center font-medium">{agent.metrics?.messagesHandled || 0}</td>
                                <td className="py-2 px-2 text-center font-medium text-green-600">{agent.metrics?.resolvedConversations || 0}</td>
                                <td className="py-2 px-2 text-center bg-red-50/50">
                                  {(agent.effData.details.overdueReminders + agent.effData.details.openOverdueCases) > 0 ? (
                                    <span 
                                      className="text-red-600 font-medium cursor-help"
                                      title={`Просрочено: ${agent.effData.details.overdueReminders} обещаний, ${agent.effData.details.openOverdueCases} кейсов`}
                                    >
                                      {agent.effData.details.overdueReminders}/{agent.effData.details.openOverdueCases}
                                    </span>
                                  ) : (
                                    <span className="text-green-500">✓</span>
                                  )}
                                </td>
                                <td className="py-2 px-2 text-center">
                                  <span className="text-lg" title={agent.level.name}>{agent.level.icon}</span>
                                </td>
                                <td className="py-2 px-2 text-center font-bold text-purple-600">{agent.points}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

              </div>
            )}
          </>
        )}

        {/* ============ USERS TAB ============ */}
        {activeTab === 'users' && (
          <div className="flex gap-6">
            {/* Left: Users List */}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-medium text-slate-800">Пользователи</h2>
                  <p className="text-sm text-slate-500">
                    Все участники чатов • {usersStats.total} всего • {usersStats.byRole?.employee || 0} сотрудников
                  </p>
                </div>
              </div>

              {/* Filters */}
              <div className="flex gap-2 mb-4">
                {(['all', 'employee', 'partner', 'client'] as const).map(filter => (
                  <button
                    key={filter}
                    onClick={() => setUsersFilter(filter)}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      usersFilter === filter
                        ? 'bg-brand-blue text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {filter === 'all' ? 'Все' : 
                     filter === 'employee' ? `Сотрудники (${usersStats.byRole?.employee || 0})` :
                     filter === 'partner' ? `Партнёры (${usersStats.byRole?.partner || 0})` :
                     `Клиенты (${usersStats.byRole?.client || 0})`}
                  </button>
                ))}
              </div>

              {/* Users Table */}
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Пользователь</th>
                      <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Роль</th>
                      <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Каналы</th>
                      <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Последняя активность</th>
                      <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {chatUsers
                      .filter(u => usersFilter === 'all' || u.role === usersFilter)
                      .map(user => (
                        <tr 
                          key={user.id} 
                          className={`hover:bg-slate-50 cursor-pointer ${selectedUser?.id === user.id ? 'bg-blue-50' : ''}`}
                          onClick={() => {
                            setSelectedUser(user)
                            if (user.role === 'employee') {
                              loadUserMetrics(user.telegramId)
                            } else {
                              setUserMetrics(null)
                            }
                          }}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              {user.photoUrl ? (
                                <img src={user.photoUrl} alt="" className="w-8 h-8 rounded-full" />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 text-sm font-medium">
                                  {user.name.charAt(0)}
                                </div>
                              )}
                              <div>
                                <div className="font-medium text-slate-800">{user.name}</div>
                                {user.telegramUsername && (
                                  <div className="text-xs text-slate-500">@{user.telegramUsername}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={user.role}
                              onChange={(e) => updateUserRole(user.id, e.target.value as any)}
                              onClick={(e) => e.stopPropagation()}
                              className={`text-xs px-2 py-1 rounded-lg border-0 cursor-pointer ${
                                user.role === 'employee' ? 'bg-green-100 text-green-700' :
                                user.role === 'partner' ? 'bg-blue-100 text-blue-700' :
                                'bg-slate-100 text-slate-600'
                              }`}
                            >
                              <option value="client">Клиент</option>
                              <option value="employee">Сотрудник</option>
                              <option value="partner">Партнёр</option>
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {user.channels.slice(0, 2).map((ch, i) => (
                                <span key={i} className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                                  {ch.name?.slice(0, 15) || 'Канал'}
                                </span>
                              ))}
                              {user.channels.length > 2 && (
                                <span className="text-xs text-slate-400">+{user.channels.length - 2}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-500">
                            {new Date(user.lastSeenAt).toLocaleDateString('ru')}
                          </td>
                          <td className="px-4 py-3">
                            {user.role === 'employee' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedUser(user)
                                  loadUserMetrics(user.telegramId)
                                }}
                                className="text-xs text-brand-blue hover:underline"
                              >
                                Метрики
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                
                {chatUsers.filter(u => usersFilter === 'all' || u.role === usersFilter).length === 0 && (
                  <div className="text-center py-12 text-slate-500">
                    Пользователи не найдены
                  </div>
                )}
              </div>
            </div>

            {/* Right: User Details / Metrics */}
            {selectedUser && (
              <div className="w-80 shrink-0">
                <div className="bg-white rounded-xl shadow-sm p-4 sticky top-4">
                  <div className="flex items-center gap-3 mb-4">
                    {selectedUser.photoUrl ? (
                      <img src={selectedUser.photoUrl} alt="" className="w-12 h-12 rounded-full" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 text-lg font-medium">
                        {selectedUser.name.charAt(0)}
                      </div>
                    )}
                    <div>
                      <div className="font-medium text-slate-800">{selectedUser.name}</div>
                      {selectedUser.telegramUsername && (
                        <div className="text-sm text-slate-500">@{selectedUser.telegramUsername}</div>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        selectedUser.role === 'employee' ? 'bg-green-100 text-green-700' :
                        selectedUser.role === 'partner' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {selectedUser.role === 'employee' ? 'Сотрудник' :
                         selectedUser.role === 'partner' ? 'Партнёр' : 'Клиент'}
                      </span>
                    </div>
                  </div>

                  {/* Department & Position */}
                  {selectedUser.role === 'employee' && (
                    <div className="mb-4 space-y-2">
                      <input
                        type="text"
                        placeholder="Отдел"
                        defaultValue={selectedUser.department || ''}
                        onBlur={(e) => updateUserDetails(selectedUser.id, { department: e.target.value })}
                        className="w-full px-3 py-2 text-sm border rounded-lg"
                      />
                      <input
                        type="text"
                        placeholder="Должность"
                        defaultValue={selectedUser.position || ''}
                        onBlur={(e) => updateUserDetails(selectedUser.id, { position: e.target.value })}
                        className="w-full px-3 py-2 text-sm border rounded-lg"
                      />
                    </div>
                  )}

                  {/* Channels */}
                  <div className="mb-4">
                    <div className="text-xs text-slate-500 mb-2">Каналы ({selectedUser.channels.length})</div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {selectedUser.channels.map((ch, i) => (
                        <div key={i} className="text-sm text-slate-700 flex items-center gap-2">
                          <MessageSquare className="w-3 h-3 text-slate-400" />
                          {ch.name || 'Канал'}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Employee Metrics */}
                  {selectedUser.role === 'employee' && (
                    <>
                      {loadingUserMetrics ? (
                        <div className="flex justify-center py-4">
                          <RefreshCw className="w-5 h-5 animate-spin text-slate-400" />
                        </div>
                      ) : userMetrics ? (
                        <div className="space-y-3">
                          <div className="text-xs text-slate-500 font-medium mb-2">Метрики за 30 дней</div>
                          
                          <div className="grid grid-cols-2 gap-2">
                            <div className="bg-slate-50 rounded-lg p-2">
                              <div className="text-lg font-semibold text-slate-800">
                                {userMetrics.responseTime?.avgMinutes || 0}м
                              </div>
                              <div className="text-xs text-slate-500">Ср. ответ</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2">
                              <div className="text-lg font-semibold text-slate-800">
                                {userMetrics.responseTime?.totalResponses || 0}
                              </div>
                              <div className="text-xs text-slate-500">Ответов</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2">
                              <div className="text-lg font-semibold text-slate-800">
                                {userMetrics.resolutions?.resolutionRate || 0}%
                              </div>
                              <div className="text-xs text-slate-500">Решено</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2">
                              <div className="text-lg font-semibold text-slate-800">
                                {userMetrics.messageStats?.channels_active || 0}
                              </div>
                              <div className="text-xs text-slate-500">Каналов</div>
                            </div>
                          </div>

                          {/* Client Sentiment */}
                          {userMetrics.clientSentiment && Object.keys(userMetrics.clientSentiment).length > 0 && (
                            <div className="mt-3">
                              <div className="text-xs text-slate-500 mb-1">Sentiment клиентов</div>
                              <div className="flex gap-1">
                                {Object.entries(userMetrics.clientSentiment).map(([sentiment, count]) => (
                                  <span key={sentiment} className={`text-xs px-2 py-0.5 rounded ${
                                    sentiment === 'positive' ? 'bg-green-100 text-green-700' :
                                    sentiment === 'negative' ? 'bg-red-100 text-red-700' :
                                    'bg-slate-100 text-slate-600'
                                  }`}>
                                    {sentiment}: {count as number}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500 text-center py-4">
                          Нажмите "Метрики" для загрузки
                        </div>
                      )}
                    </>
                  )}

                  {/* Notes */}
                  <div className="mt-4">
                    <textarea
                      placeholder="Заметки..."
                      defaultValue={selectedUser.notes || ''}
                      onBlur={(e) => updateUserDetails(selectedUser.id, { notes: e.target.value })}
                      className="w-full px-3 py-2 text-sm border rounded-lg resize-none h-20"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============ SETTINGS TAB ============ */}
        {activeTab === 'settings' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-medium text-slate-800">Настройки Support</h2>
                <p className="text-sm text-slate-500">Конфигурация бота, AI и автоматизаций</p>
              </div>
              <button
                onClick={saveSettings}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue disabled:opacity-50"
              >
                <Save className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
                Сохранить
              </button>
            </div>

            {/* Settings Sub-tabs */}
            <div className="flex gap-2 mb-6 border-b border-slate-200">
              <button
                onClick={() => setSettingsTab('general')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  settingsTab === 'general' 
                    ? 'border-brand-blue text-brand-blue' 
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Основные
              </button>
              <button
                onClick={() => setSettingsTab('patterns')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  settingsTab === 'patterns' 
                    ? 'border-brand-blue text-brand-blue' 
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                AI Паттерны
              </button>
              <button
                onClick={() => setSettingsTab('scoring')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  settingsTab === 'scoring' 
                    ? 'border-brand-blue text-brand-blue' 
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Скоринг
              </button>
              <button
                onClick={() => setSettingsTab('team')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  settingsTab === 'team' 
                    ? 'border-brand-blue text-brand-blue' 
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Команда
              </button>
              <button
                onClick={() => setSettingsTab('roles')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  settingsTab === 'roles' 
                    ? 'border-brand-blue text-brand-blue' 
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Роли и доступы
              </button>
            </div>

            {loading || !settings ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
              </div>
            ) : (
              <>
              {/* GENERAL SETTINGS TAB */}
              {settingsTab === 'general' && (
              <div className="space-y-6">
                {/* Bot Settings */}
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <Bot className="w-5 h-5 text-blue-500" />
                    Telegram Bot
                  </h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Bot Token</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={settings.telegram_bot_token}
                          onChange={e => setSettings({ ...settings, telegram_bot_token: e.target.value })}
                          placeholder="Оставьте пустым для использования env"
                          className="flex-1 px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                        />
                        <button
                          onClick={testBot}
                          className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
                        >
                          <TestTube className="w-4 h-4" />
                          Тест
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Env статус: {envStatus.TELEGRAM_BOT_TOKEN ? '✅ настроен' : '❌ не настроен'}
                      </p>
                      {botTestResult && (
                        <div className={`mt-2 p-3 rounded-lg text-sm ${botTestResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                          {botTestResult.success 
                            ? `✅ Бот подключен: @${botTestResult.bot?.username}` 
                            : `❌ Ошибка: ${botTestResult.error}`
                          }
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Chat ID для уведомлений</label>
                      <input
                        type="text"
                        value={settings.notify_chat_id}
                        onChange={e => setSettings({ ...settings, notify_chat_id: e.target.value })}
                        placeholder="ID чата или группы"
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                      />
                    </div>
                  </div>
                </div>

                {/* AI Settings */}
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <Key className="w-5 h-5 text-purple-500" />
                    AI / OpenAI
                  </h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">AI Model</label>
                      <select
                        value={settings.ai_model}
                        onChange={e => setSettings({ ...settings, ai_model: e.target.value })}
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                      >
                        <option value="gpt-4o-mini">GPT-4o Mini (быстрый, дешёвый)</option>
                        <option value="gpt-4o">GPT-4o (умный)</option>
                        <option value="gpt-4-turbo">GPT-4 Turbo</option>
                      </select>
                    </div>
                    
                    <p className="text-xs text-slate-500">
                      OpenAI API Key: {envStatus.OPENAI_API_KEY ? '✅ настроен в env' : '❌ не настроен'}
                    </p>
                  </div>
                </div>

                {/* Automation Settings */}
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <Bell className="w-5 h-5 text-orange-500" />
                    Автоматизация
                  </h3>
                  
                  <div className="space-y-4">
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={settings.auto_create_cases}
                        onChange={e => setSettings({ ...settings, auto_create_cases: e.target.checked })}
                        className="w-4 h-4 rounded border-slate-300"
                      />
                      <span className="text-sm text-slate-700">Автоматически создавать кейсы при обнаружении проблем</span>
                    </label>

                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={settings.auto_transcribe_voice}
                        onChange={e => setSettings({ ...settings, auto_transcribe_voice: e.target.checked })}
                        className="w-4 h-4 rounded border-slate-300"
                      />
                      <span className="text-sm text-slate-700">Автоматически транскрибировать голосовые сообщения</span>
                    </label>

                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={settings.notify_on_problem}
                        onChange={e => setSettings({ ...settings, notify_on_problem: e.target.checked })}
                        className="w-4 h-4 rounded border-slate-300"
                      />
                      <span className="text-sm text-slate-700">Отправлять уведомления при обнаружении проблем</span>
                    </label>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Минимальный urgency для создания кейса (0-5)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="5"
                        value={settings.min_urgency_for_case}
                        onChange={e => setSettings({ ...settings, min_urgency_for_case: parseInt(e.target.value) || 0 })}
                        className="w-24 px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                      />
                    </div>
                  </div>
                </div>
              </div>
              )}

              {/* AI PATTERNS TAB */}
              {settingsTab === 'patterns' && (
              <div className="space-y-6">
                {/* Uzbek Keywords */}
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <span className="text-xl">🇺🇿</span>
                    Узбекские ключевые слова
                  </h3>
                  <p className="text-sm text-slate-500 mb-4">
                    Слова на узбекском языке для определения категорий и проблем
                  </p>
                  
                  <div className="space-y-4">
                    {aiPatterns?.uzbek_keywords && Object.entries(aiPatterns.uzbek_keywords).map(([category, words]: [string, any]) => (
                      <div key={category}>
                        <label className="block text-sm font-medium text-slate-700 mb-1 capitalize">{category}</label>
                        <input
                          type="text"
                          value={Array.isArray(words) ? words.join(', ') : ''}
                          onChange={e => {
                            const newWords = e.target.value.split(',').map(w => w.trim()).filter(Boolean)
                            setAiPatterns({
                              ...aiPatterns,
                              uzbek_keywords: {
                                ...aiPatterns.uzbek_keywords,
                                [category]: newWords
                              }
                            })
                          }}
                          className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20 text-sm"
                          placeholder="слово1, слово2, слово3"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Russian Problem Words */}
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <span className="text-xl">🇷🇺</span>
                    Русские слова-проблемы
                  </h3>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Слова указывающие на проблему
                    </label>
                    <textarea
                      value={aiPatterns?.russian_problem_words?.join(', ') || ''}
                      onChange={e => {
                        const words = e.target.value.split(',').map(w => w.trim()).filter(Boolean)
                        setAiPatterns({ ...aiPatterns, russian_problem_words: words })
                      }}
                      rows={3}
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20 text-sm"
                      placeholder="не работает, ошибка, проблема, баг..."
                    />
                  </div>
                </div>

                {/* Categories */}
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <span className="text-xl">📁</span>
                    Категории сообщений
                  </h3>
                  
                  <div className="space-y-3">
                    {aiPatterns?.categories?.map((cat: any, idx: number) => (
                      <div key={cat.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                        <input
                          type="text"
                          value={cat.name}
                          onChange={e => {
                            const newCats = [...aiPatterns.categories]
                            newCats[idx] = { ...cat, name: e.target.value }
                            setAiPatterns({ ...aiPatterns, categories: newCats })
                          }}
                          className="w-40 px-3 py-1.5 border border-slate-200 rounded text-sm"
                          placeholder="Название"
                        />
                        <input
                          type="text"
                          value={cat.keywords?.join(', ') || ''}
                          onChange={e => {
                            const newCats = [...aiPatterns.categories]
                            newCats[idx] = { ...cat, keywords: e.target.value.split(',').map((w: string) => w.trim()).filter(Boolean) }
                            setAiPatterns({ ...aiPatterns, categories: newCats })
                          }}
                          className="flex-1 px-3 py-1.5 border border-slate-200 rounded text-sm"
                          placeholder="ключевые слова через запятую"
                        />
                        <code className="text-xs text-slate-400 bg-slate-200 px-2 py-1 rounded">{cat.id}</code>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Save Patterns Button */}
                <button
                  onClick={async () => {
                    setSaving(true)
                    try {
                      await fetch('/api/support/patterns', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin' },
                        body: JSON.stringify({ patterns: aiPatterns })
                      })
                      alert('Паттерны сохранены')
                    } catch (e) {
                      alert('Ошибка сохранения')
                    }
                    setSaving(false)
                  }}
                  disabled={saving}
                  className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-50 font-medium"
                >
                  Сохранить паттерны
                </button>
              </div>
              )}

              {/* SCORING TAB */}
              {settingsTab === 'scoring' && (
              <div className="space-y-6">
                {/* Urgency Rules */}
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <span className="text-xl">🎯</span>
                    Правила Urgency скоринга
                  </h3>
                  <p className="text-sm text-slate-500 mb-4">
                    Автоматическое повышение urgency на основе условий
                  </p>
                  
                  <div className="space-y-3">
                    {aiPatterns?.urgency_rules?.map((rule: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                        <div className="flex-1">
                          <div className="font-medium text-sm text-slate-700">{rule.description}</div>
                          <div className="text-xs text-slate-400 mt-1">
                            {rule.mrr_threshold && `MRR >= $${rule.mrr_threshold}`}
                            {rule.hours && `Время: ${rule.hours} часов`}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-slate-500">+</span>
                          <input
                            type="number"
                            min="0"
                            max="5"
                            value={rule.score}
                            onChange={e => {
                              const newRules = [...aiPatterns.urgency_rules]
                              newRules[idx] = { ...rule, score: parseInt(e.target.value) || 0 }
                              setAiPatterns({ ...aiPatterns, urgency_rules: newRules })
                            }}
                            className="w-16 px-2 py-1 border border-slate-200 rounded text-center text-sm"
                          />
                          <span className="text-sm text-slate-500">к urgency</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Commitment Detection */}
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <span className="text-xl">🤝</span>
                    Обнаружение обещаний
                  </h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Размытые обещания (опасные!)
                      </label>
                      <textarea
                        value={aiPatterns?.commitment_patterns?.vague?.join(', ') || ''}
                        onChange={e => {
                          const words = e.target.value.split(',').map(w => w.trim()).filter(Boolean)
                          setAiPatterns({
                            ...aiPatterns,
                            commitment_patterns: {
                              ...aiPatterns?.commitment_patterns,
                              vague: words
                            }
                          })
                        }}
                        rows={2}
                        className="w-full px-4 py-2 border border-orange-200 bg-orange-50 rounded-lg text-sm"
                        placeholder="посмотрим, разберёмся, решим..."
                      />
                      <p className="text-xs text-orange-600 mt-1">
                        Эти слова создают напоминание через 4 часа
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Слова обратного звонка
                      </label>
                      <input
                        type="text"
                        value={aiPatterns?.commitment_patterns?.callback?.join(', ') || ''}
                        onChange={e => {
                          const words = e.target.value.split(',').map(w => w.trim()).filter(Boolean)
                          setAiPatterns({
                            ...aiPatterns,
                            commitment_patterns: {
                              ...aiPatterns?.commitment_patterns,
                              callback: words
                            }
                          })
                        }}
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm"
                        placeholder="перезвоню, напишу, свяжусь..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Слова действия
                      </label>
                      <input
                        type="text"
                        value={aiPatterns?.commitment_patterns?.action?.join(', ') || ''}
                        onChange={e => {
                          const words = e.target.value.split(',').map(w => w.trim()).filter(Boolean)
                          setAiPatterns({
                            ...aiPatterns,
                            commitment_patterns: {
                              ...aiPatterns?.commitment_patterns,
                              action: words
                            }
                          })
                        }}
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm"
                        placeholder="отправлю, исправлю, подключу..."
                      />
                    </div>
                  </div>
                </div>

                {/* Save Scoring Button */}
                <button
                  onClick={async () => {
                    setSaving(true)
                    try {
                      await fetch('/api/support/patterns', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin' },
                        body: JSON.stringify({ patterns: aiPatterns })
                      })
                      alert('Скоринг сохранён')
                    } catch (e) {
                      alert('Ошибка сохранения')
                    }
                    setSaving(false)
                  }}
                  disabled={saving}
                  className="w-full py-3 bg-orange-600 text-white rounded-xl hover:bg-orange-700 disabled:opacity-50 font-medium"
                >
                  Сохранить скоринг
                </button>
              </div>
              )}

              {/* TEAM SETTINGS TAB */}
              {settingsTab === 'team' && (
              <div className="space-y-6">
                {/* Team Metrics Overview */}
                {teamMetrics && (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div className="bg-white rounded-xl p-4 shadow-sm text-center">
                      <div className="text-2xl font-bold text-blue-600">{teamMetrics.avgFirstResponseMin}м</div>
                      <div className="text-xs text-slate-500 mt-1">Ср. первый ответ</div>
                    </div>
                    <div className="bg-white rounded-xl p-4 shadow-sm text-center">
                      <div className="text-2xl font-bold text-green-600">{teamMetrics.avgResolutionMin}м</div>
                      <div className="text-xs text-slate-500 mt-1">Ср. решение</div>
                    </div>
                    <div className="bg-white rounded-xl p-4 shadow-sm text-center">
                      <div className="text-2xl font-bold text-slate-700">{teamMetrics.totalConversations}</div>
                      <div className="text-xs text-slate-500 mt-1">Всего разговоров</div>
                    </div>
                    <div className="bg-white rounded-xl p-4 shadow-sm text-center">
                      <div className="text-2xl font-bold text-emerald-600">{teamMetrics.resolvedToday}</div>
                      <div className="text-xs text-slate-500 mt-1">Решено сегодня</div>
                    </div>
                    <div className="bg-white rounded-xl p-4 shadow-sm text-center">
                      <div className="text-2xl font-bold text-orange-600">{teamMetrics.activeNow}</div>
                      <div className="text-xs text-slate-500 mt-1">Активных сейчас</div>
                    </div>
                    <div className="bg-white rounded-xl p-4 shadow-sm text-center">
                      <div className="text-2xl font-bold text-purple-600">{teamMetrics.satisfactionAvg}⭐</div>
                      <div className="text-xs text-slate-500 mt-1">Ср. оценка</div>
                    </div>
                  </div>
                )}

                {/* Team Members */}
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium text-slate-800 flex items-center gap-2">
                      <Users className="w-5 h-5 text-blue-500" />
                      Сотрудники поддержки
                    </h3>
                    <button
                      onClick={() => setEditingAgent({ id: '', name: '', username: '', email: '', telegramId: '', role: 'agent', status: 'offline', assignedChannels: 0, activeChats: 0, metrics: { totalConversations: 0, resolvedConversations: 0, avgFirstResponseMin: 0, avgResolutionMin: 0, satisfactionScore: 0, messagesHandled: 0, escalations: 0 } })}
                      className="px-3 py-1.5 text-sm bg-brand-blue text-white rounded-lg hover:bg-blue-600"
                    >
                      + Добавить
                    </button>
                  </div>

                  {agents.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-8">
                      Нет сотрудников. Добавьте первого!
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {agents.map(agent => (
                        <div key={agent.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-medium ${
                              agent.status === 'online' ? 'bg-green-500' : agent.status === 'away' ? 'bg-yellow-500' : 'bg-slate-400'
                            }`}>
                              {agent.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-medium text-slate-800">{agent.name}</div>
                              <div className="text-xs text-slate-500">
                                {agent.username ? `@${agent.username}` : 'No username'} • {agent.role}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 text-sm">
                            <div className="text-center">
                              <div className="font-semibold text-slate-700">{agent.assignedChannels}</div>
                              <div className="text-xs text-slate-500">Каналов</div>
                            </div>
                            <div className="text-center">
                              <div className="font-semibold text-blue-600">{agent.metrics.avgFirstResponseMin}м</div>
                              <div className="text-xs text-slate-500">First resp</div>
                            </div>
                            <div className="text-center">
                              <div className="font-semibold text-green-600">{agent.metrics.resolvedConversations}</div>
                              <div className="text-xs text-slate-500">Решено</div>
                            </div>
                            <div className="text-center">
                              <div className="font-semibold text-purple-600">{agent.metrics.satisfactionScore}⭐</div>
                              <div className="text-xs text-slate-500">Rating</div>
                            </div>
                            {/* Start/Stop shift + Edit/Delete buttons */}
                            <div className="flex items-center gap-1 ml-2">
                              {localStorage.getItem('support_agent_id') === agent.id ? (
                                <button
                                  onClick={async () => {
                                    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
                                    await fetch('/api/support/agents/activity', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json', Authorization: token },
                                      body: JSON.stringify({ agentId: agent.id, action: 'logout' })
                                    })
                                    localStorage.removeItem('support_agent_id')
                                    loadData()
                                  }}
                                  className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                                >
                                  Закончить
                                </button>
                              ) : (
                                <button
                                  onClick={async () => {
                                    localStorage.setItem('support_agent_id', agent.id)
                                    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
                                    await fetch('/api/support/agents/activity', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json', Authorization: token },
                                      body: JSON.stringify({ agentId: agent.id, action: 'login' })
                                    })
                                    loadData()
                                  }}
                                  className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-lg hover:bg-green-200"
                                >
                                  Начать смену
                                </button>
                              )}
                              <button
                                onClick={() => setEditingAgent(agent)}
                                className="p-2 text-slate-400 hover:text-brand-blue hover:bg-white rounded-lg transition-colors"
                                title="Редактировать"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  setConfirmDialog({
                                    show: true,
                                    title: 'Удаление сотрудника',
                                    message: `Удалить сотрудника ${agent.name}?`,
                                    danger: true,
                                    onConfirm: async () => {
                                      try {
                                        await fetch(`/api/support/agents?id=${agent.id}`, {
                                          method: 'DELETE',
                                          headers: { Authorization: 'Bearer admin' }
                                        })
                                        loadData()
                                      } catch (e) {
                                        console.error('Ошибка удаления')
                                      }
                                    }
                                  })
                                }}
                                className="p-2 text-slate-400 hover:text-red-500 hover:bg-white rounded-lg transition-colors"
                                title="Удалить"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Work Time Tracking */}
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium text-slate-800 flex items-center gap-2">
                      <Clock className="w-5 h-5 text-purple-500" />
                      Учёт рабочего времени
                    </h3>
                    <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
                      {(['day', 'week', 'month'] as const).map(p => (
                        <button
                          key={p}
                          onClick={() => setActivityPeriod(p)}
                          className={`px-3 py-1 text-xs rounded-md transition-colors ${
                            activityPeriod === p 
                              ? 'bg-white text-slate-800 shadow-sm' 
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          {p === 'day' ? 'День' : p === 'week' ? 'Неделя' : 'Месяц'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {agentActivity.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-8">
                      Нет данных о рабочем времени. Данные появятся когда сотрудники начнут работу.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {agentActivity.map((agent: any) => (
                        <div key={agent.agentId} className="border rounded-xl p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 font-medium text-sm">
                                {agent.agentName?.charAt(0) || '?'}
                              </div>
                              <span className="font-medium text-slate-800">{agent.agentName}</span>
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              agent.summary.efficiency >= 70 ? 'bg-green-100 text-green-700' :
                              agent.summary.efficiency >= 40 ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              Эффективность: {agent.summary.efficiency}%
                            </span>
                          </div>

                          <div className="grid grid-cols-4 gap-3 mb-3">
                            <div className="text-center p-2 bg-slate-50 rounded-lg">
                              <div className="text-lg font-bold text-slate-800">{agent.summary.totalWorkFormatted}</div>
                              <div className="text-[10px] text-slate-500">Рабочее время</div>
                            </div>
                            <div className="text-center p-2 bg-purple-50 rounded-lg">
                              <div className="text-lg font-bold text-purple-600">{agent.summary.effectiveFormatted}</div>
                              <div className="text-[10px] text-slate-500">Эффективное</div>
                            </div>
                            <div className="text-center p-2 bg-blue-50 rounded-lg">
                              <div className="text-lg font-bold text-blue-600">{agent.activity.messagesSent}</div>
                              <div className="text-[10px] text-slate-500">Сообщений</div>
                            </div>
                            <div className="text-center p-2 bg-green-50 rounded-lg">
                              <div className="text-lg font-bold text-green-600">{agent.summary.daysWorked}</div>
                              <div className="text-[10px] text-slate-500">Дней</div>
                            </div>
                          </div>

                          {/* Daily breakdown */}
                          {agent.daily && agent.daily.length > 0 && (
                            <div className="border-t pt-3">
                              <div className="text-xs text-slate-500 mb-2">Детализация по дням:</div>
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {agent.daily.slice(0, 7).map((day: any, i: number) => (
                                  <div key={i} className="flex items-center justify-between text-xs">
                                    <span className="text-slate-600">
                                      {new Date(day.date).toLocaleDateString('ru', { weekday: 'short', day: 'numeric', month: 'short' })}
                                    </span>
                                    <div className="flex items-center gap-3">
                                      <span className="text-slate-400">
                                        {day.firstLogin ? new Date(day.firstLogin).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : '—'} 
                                        {' → '}
                                        {day.lastLogout ? new Date(day.lastLogout).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : '—'}
                                      </span>
                                      <span className="font-medium text-slate-700 w-16 text-right">{day.workFormatted}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent Conversations */}
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-green-500" />
                    Недавние разговоры
                  </h3>
                  
                  {conversations.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-8">
                      Нет данных о разговорах
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 font-medium text-slate-500">Канал</th>
                            <th className="text-left py-2 font-medium text-slate-500">Начало</th>
                            <th className="text-left py-2 font-medium text-slate-500">Первый ответ</th>
                            <th className="text-left py-2 font-medium text-slate-500">Длительность</th>
                            <th className="text-left py-2 font-medium text-slate-500">Статус</th>
                            <th className="text-left py-2 font-medium text-slate-500">Агент</th>
                          </tr>
                        </thead>
                        <tbody>
                          {conversations.slice(0, 10).map(conv => (
                            <tr key={conv.id} className="border-b last:border-0 hover:bg-slate-50">
                              <td className="py-2 font-medium">{conv.channelName}</td>
                              <td className="py-2 text-slate-600">
                                {new Date(conv.startedAt).toLocaleString('ru')}
                              </td>
                              <td className="py-2">
                                {conv.firstResponseTimeMin !== null ? (
                                  <span className={`font-medium ${conv.firstResponseTimeMin <= 5 ? 'text-green-600' : conv.firstResponseTimeMin <= 15 ? 'text-yellow-600' : 'text-red-600'}`}>
                                    {conv.firstResponseTimeMin}м
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="py-2">
                                {conv.resolutionTimeMin !== null ? (
                                  <span className="text-slate-600">{conv.resolutionTimeMin}м</span>
                                ) : (
                                  <span className="text-orange-500">В процессе</span>
                                )}
                              </td>
                              <td className="py-2">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                  conv.status === 'resolved' ? 'bg-green-100 text-green-700' :
                                  conv.status === 'active' ? 'bg-blue-100 text-blue-700' :
                                  'bg-slate-100 text-slate-600'
                                }`}>
                                  {conv.status}
                                </span>
                              </td>
                              <td className="py-2 text-slate-600">{conv.agentName || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
              )}
              </>
            )}
          </>
        )}
      </main>

      {/* Case Detail Sidebar */}
      {selectedCase && (
        <div className="fixed inset-0 bg-black/20 z-50" onClick={() => setSelectedCase(null)}>
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-lg bg-white shadow-xl overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {selectedCase.ticketNumber && (
                  <span className="px-2 py-1 bg-brand-blue text-white rounded-lg font-mono text-sm font-bold">
                    #{String(selectedCase.ticketNumber).padStart(3, '0')}
                  </span>
                )}
                <h2 className="font-semibold text-lg">Тикет</h2>
              </div>
              <button onClick={() => setSelectedCase(null)} className="p-2 hover:bg-slate-100 rounded-lg">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Заголовок и описание */}
              <div>
                <h3 className="text-xl font-medium text-slate-800">{selectedCase.title}</h3>
                <p className="text-slate-500 mt-2">{selectedCase.description || 'Нет описания'}</p>
              </div>
              
              {/* Канал и сообщения */}
              <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 text-sm">
                  <Hash className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-600">Канал:</span>
                  <span className="font-medium">{selectedCase.channelName || '—'}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MessageSquare className="w-4 h-4 text-slate-400" />
                  <span className="font-medium">{selectedCase.messagesCount || 0} сообщ.</span>
                </div>
              </div>
              
              {/* Основная информация */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-slate-400 uppercase mb-1">Статус</div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[selectedCase.status]}`}>
                    {statusLabels[selectedCase.status]}
                  </span>
                </div>
                <div>
                  <div className="text-xs text-slate-400 uppercase mb-1">Приоритет</div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${priorityBgColors[selectedCase.priority]}`}>
                    {priorityLabels[selectedCase.priority] || selectedCase.priority}
                  </span>
                </div>
                <div>
                  <div className="text-xs text-slate-400 uppercase mb-1">Клиент</div>
                  <div className="text-sm font-medium">{selectedCase.companyName || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 uppercase mb-1">Категория</div>
                  <div className="text-sm font-medium">
                    {{ 
                      technical: '🔧 Техническая',
                      billing: '💳 Биллинг',
                      integration: '🔗 Интеграция',
                      onboarding: '🚀 Онбординг',
                      feature_request: '💡 Запрос функции',
                      complaint: '😤 Жалоба',
                      question: '❓ Вопрос',
                      feedback: '💬 Обратная связь',
                      general: '📋 Общее'
                    }[selectedCase.category] || selectedCase.category || '—'}
                  </div>
                </div>
              </div>
              
              {/* Временные метрики */}
              <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                <div className="text-xs text-slate-400 uppercase mb-2">Временные метрики</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-400" />
                    <span className="text-slate-600">Создан:</span>
                    <span className="font-medium">{new Date(selectedCase.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Timer className="w-4 h-4 text-slate-400" />
                    <span className="text-slate-600">В работе:</span>
                    <span className="font-medium">
                      {(() => {
                        const mins = Math.floor((Date.now() - new Date(selectedCase.createdAt).getTime()) / 60000)
                        if (mins < 60) return `${mins} мин`
                        if (mins < 1440) return `${Math.floor(mins / 60)} ч`
                        return `${Math.floor(mins / 1440)} дн`
                      })()}
                    </span>
                  </div>
                  {selectedCase.resolvedAt && (
                    <div className="flex items-center gap-2 col-span-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <span className="text-slate-600">Решён:</span>
                      <span className="font-medium text-green-600">{new Date(selectedCase.resolvedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Ответственный */}
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <UserCheck className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Ответственный</div>
                    <div className="font-medium">{selectedCase.assignedTo || 'Не назначен'}</div>
                  </div>
                </div>
                <button className="text-sm text-blue-600 hover:text-blue-700">Изменить</button>
              </div>
              
              {/* Ссылка на исходное сообщение */}
              {(selectedCase as any).messageId && (
                <button
                  onClick={() => {
                    // Найти канал с этим сообщением
                    const channel = groupedMessages.find(ch => 
                      ch.recentMessages?.some((m: any) => m.id === (selectedCase as any).messageId)
                    )
                    if (channel) {
                      setExpandedChannels(new Set([channel.id]))
                      setActiveTab('messages')
                      setSelectedCase(null)
                      // Scroll to message after render
                      setTimeout(() => {
                        const msgEl = document.getElementById(`msg-${(selectedCase as any).messageId}`)
                        msgEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        msgEl?.classList.add('ring-2', 'ring-purple-500')
                        setTimeout(() => msgEl?.classList.remove('ring-2', 'ring-purple-500'), 3000)
                      }, 300)
                    }
                  }}
                  className="w-full flex items-center justify-between p-3 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                      <MessageSquare className="w-5 h-5 text-purple-600" />
                    </div>
                    <div className="text-left">
                      <div className="text-xs text-slate-400">Исходное сообщение</div>
                      <div className="font-medium text-purple-700">Перейти к сообщению →</div>
                    </div>
                  </div>
                </button>
              )}
              <div className="border-t pt-4 space-y-3">
                <div className="text-xs text-slate-400 uppercase mb-2">Изменить статус</div>
                <div className="flex flex-wrap gap-2">
                  {selectedCase.status !== 'in_progress' && (
                    <button 
                      onClick={() => updateCaseStatus(selectedCase.id, 'in_progress')}
                      disabled={actionLoading}
                      className="flex-1 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue disabled:opacity-50"
                    >
                      В работу
                    </button>
                  )}
                  {selectedCase.status !== 'waiting' && (
                    <button 
                      onClick={() => updateCaseStatus(selectedCase.id, 'waiting')}
                      disabled={actionLoading}
                      className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 disabled:opacity-50"
                    >
                      Ожидание
                    </button>
                  )}
                  {selectedCase.status !== 'resolved' && (
                    <button 
                      onClick={() => updateCaseStatus(selectedCase.id, 'resolved')}
                      disabled={actionLoading}
                      className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 disabled:opacity-50"
                    >
                      Решено
                    </button>
                  )}
                  {selectedCase.status !== 'blocked' && (
                    <button 
                      onClick={() => updateCaseStatus(selectedCase.id, 'blocked')}
                      disabled={actionLoading}
                      className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
                    >
                      Блокер
                    </button>
                  )}
                </div>
              </div>
              
              {/* История изменений */}
              <div className="border-t pt-4">
                <div className="text-xs text-slate-400 uppercase mb-3 flex items-center gap-2">
                  <History className="w-4 h-4" />
                  История изменений
                </div>
                {caseActivities.length === 0 ? (
                  <div className="text-sm text-slate-400 text-center py-4">
                    Нет записей
                  </div>
                ) : (
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {caseActivities.map((activity, idx) => (
                      <div key={activity.id || idx} className="flex gap-3">
                        {/* Timeline dot */}
                        <div className="flex flex-col items-center">
                          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                            activity.type === 'created' ? 'bg-green-500' :
                            activity.type === 'status_change' ? 'bg-blue-500' :
                            activity.type === 'assignment' ? 'bg-purple-500' :
                            'bg-slate-300'
                          }`} />
                          {idx < caseActivities.length - 1 && (
                            <div className="w-0.5 h-full bg-slate-200 mt-1" />
                          )}
                        </div>
                        {/* Content */}
                        <div className="flex-1 pb-3">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="font-medium text-slate-700">{activity.title}</span>
                            {activity.fromStatus && activity.toStatus && (
                              <span className="text-xs text-slate-400">
                                {statusLabels[activity.fromStatus] || activity.fromStatus} → {statusLabels[activity.toStatus] || activity.toStatus}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                            {activity.managerName && (
                              <span className="font-medium text-slate-600">{activity.managerName}</span>
                            )}
                            <span>{new Date(activity.createdAt).toLocaleString('ru-RU', { 
                              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' 
                            })}</span>
                          </div>
                          {activity.description && (
                            <div className="text-xs text-slate-500 mt-1">{activity.description}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Case Modal */}
      {showNewCaseModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNewCaseModal(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">Новый кейс</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Название *</label>
                <input
                  type="text"
                  value={newCase.title}
                  onChange={e => {
                    const title = e.target.value
                    const lower = title.toLowerCase()
                    // Auto-detect category from keywords
                    let category = newCase.category
                    let priority = newCase.priority
                    
                    if (/ошибк|баг|не работ|сломал|crash|error/i.test(lower)) {
                      category = 'technical'
                      priority = 'high'
                    } else if (/оплат|счёт|счет|деньг|billing|invoice/i.test(lower)) {
                      category = 'billing'
                      priority = 'high'
                    } else if (/интеграц|подключ|api|webhook/i.test(lower)) {
                      category = 'integration'
                    } else if (/новый клиент|онбординг|начал/i.test(lower)) {
                      category = 'onboarding'
                    } else if (/хотел бы|можно ли|добавить|feature|фича/i.test(lower)) {
                      category = 'feature_request'
                      priority = 'low'
                    }
                    
                    if (/срочно|urgent|asap|критич|блокер/i.test(lower)) {
                      priority = 'urgent'
                    }
                    
                    setNewCase({ ...newCase, title, category, priority })
                  }}
                  placeholder="Краткое описание проблемы"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Описание</label>
                <textarea
                  value={newCase.description}
                  onChange={e => setNewCase({ ...newCase, description: e.target.value })}
                  placeholder="Подробности..."
                  rows={3}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                />
              </div>
              
              {/* AI suggestion chips */}
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-slate-500">Быстрые теги:</span>
                {['🔧 Техническое', '💰 Биллинг', '🔌 Интеграция', '🚀 Онбординг', '💡 Фича'].map(tag => {
                  const [emoji, label] = tag.split(' ')
                  const categoryMap: Record<string, string> = { 
                    'Техническое': 'technical', 
                    'Биллинг': 'billing', 
                    'Интеграция': 'integration',
                    'Онбординг': 'onboarding',
                    'Фича': 'feature_request'
                  }
                  const cat = categoryMap[label]
                  return (
                    <button
                      key={tag}
                      onClick={() => setNewCase({ ...newCase, category: cat })}
                      className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                        newCase.category === cat 
                          ? 'bg-brand-blue text-white border-brand-blue' 
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {emoji} {label}
                    </button>
                  )
                })}
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Категория</label>
                  <select
                    value={newCase.category}
                    onChange={e => setNewCase({ ...newCase, category: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                  >
                    <option value="general">Общее</option>
                    <option value="technical">Техническое</option>
                    <option value="billing">Биллинг</option>
                    <option value="integration">Интеграция</option>
                    <option value="onboarding">Онбординг</option>
                    <option value="feature_request">Запрос фичи</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Приоритет</label>
                  <select
                    value={newCase.priority}
                    onChange={e => setNewCase({ ...newCase, priority: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                  >
                    <option value="low">Низкий</option>
                    <option value="medium">Средний</option>
                    <option value="high">Высокий</option>
                    <option value="urgent">Срочный</option>
                  </select>
                </div>
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowNewCaseModal(false)}
                className="flex-1 px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Отмена
              </button>
              <button
                onClick={createCase}
                disabled={!newCase.title.trim() || actionLoading}
                className="flex-1 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue disabled:opacity-50"
              >
                {actionLoading ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Channel Modal */}
      {showNewChannelModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNewChannelModal(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">Подключить Telegram группу</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Chat ID *</label>
                <input
                  type="text"
                  value={newChannel.telegramChatId}
                  onChange={e => setNewChannel({ ...newChannel, telegramChatId: e.target.value })}
                  placeholder="-1001234567890"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Добавьте бота в группу и используйте /chatid команду
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Название группы *</label>
                <input
                  type="text"
                  value={newChannel.name}
                  onChange={e => setNewChannel({ ...newChannel, name: e.target.value })}
                  placeholder="Название клиента или группы"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Тип</label>
                <select
                  value={newChannel.type}
                  onChange={e => setNewChannel({ ...newChannel, type: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                >
                  <option value="client">Клиентский</option>
                  <option value="internal">Внутренний</option>
                </select>
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowNewChannelModal(false)}
                className="flex-1 px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Отмена
              </button>
              <button
                onClick={createChannel}
                disabled={!newChannel.telegramChatId || !newChannel.name.trim() || actionLoading}
                className="flex-1 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue disabled:opacity-50"
              >
                {actionLoading ? 'Подключение...' : 'Подключить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Agent Edit/Create Modal */}
      {editingAgent && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditingAgent(null)}>
          <div className="bg-white rounded-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">
              {editingAgent.id ? 'Редактировать сотрудника' : 'Новый сотрудник'}
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Имя *</label>
                <input
                  type="text"
                  value={newAgentForm.name || editingAgent.name}
                  onChange={e => setNewAgentForm({ ...newAgentForm, name: e.target.value })}
                  placeholder="Иван Иванов"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Telegram username</label>
                <div className="flex">
                  <span className="px-3 py-2 bg-slate-100 border border-r-0 border-slate-200 rounded-l-lg text-slate-500">@</span>
                  <input
                    type="text"
                    value={newAgentForm.username || editingAgent.username || ''}
                    onChange={e => setNewAgentForm({ ...newAgentForm, username: e.target.value.replace('@', '') })}
                    placeholder="username"
                    className="flex-1 px-4 py-2 border border-slate-200 rounded-r-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={newAgentForm.email || editingAgent.email || ''}
                  onChange={e => setNewAgentForm({ ...newAgentForm, email: e.target.value })}
                  placeholder="email@example.com"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Роль</label>
                <select
                  value={newAgentForm.role || editingAgent.role}
                  onChange={e => setNewAgentForm({ ...newAgentForm, role: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                >
                  <option value="agent">Агент</option>
                  <option value="senior">Старший агент</option>
                  <option value="lead">Тимлид</option>
                  <option value="manager">Менеджер</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {editingAgent.id ? 'Новый пароль (оставьте пустым, чтобы не менять)' : 'Пароль для входа *'}
                </label>
                <div className="relative">
                  <input
                    type={newAgentForm.showPassword ? 'text' : 'password'}
                    value={newAgentForm.password}
                    onChange={e => setNewAgentForm({ ...newAgentForm, password: e.target.value })}
                    placeholder="••••••••"
                    className="w-full px-4 py-2 pr-12 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                  />
                  <button
                    type="button"
                    onClick={() => setNewAgentForm({ ...newAgentForm, showPassword: !newAgentForm.showPassword })}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {newAgentForm.showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
                {newAgentForm.password && (
                  <div className="mt-1 text-xs text-slate-500">
                    Длина: {newAgentForm.password.length} символов
                  </div>
                )}
              </div>

              {/* Access Permissions */}
              <div className="border-t pt-4 mt-4">
                <label className="block text-sm font-medium text-slate-700 mb-3">Доступ к модулям</label>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    { key: 'cases', label: 'Кейсы' },
                    { key: 'channels', label: 'Каналы' },
                    { key: 'messages', label: 'Сообщения' },
                    { key: 'analytics', label: 'Аналитика' },
                    { key: 'users', label: 'Пользователи' },
                    { key: 'automations', label: 'Автоматизации' },
                    { key: 'settings', label: 'Настройки' },
                  ].map(perm => {
                    const role = newAgentForm.role || editingAgent.role
                    const isEnabled = role === 'manager' ? true 
                      : role === 'lead' ? !['settings'].includes(perm.key)
                      : role === 'senior' ? ['cases', 'channels', 'messages', 'analytics', 'users'].includes(perm.key)
                      : ['cases', 'channels', 'messages'].includes(perm.key)
                    
                    return (
                      <label key={perm.key} className={`flex items-center gap-2 p-2 rounded-lg ${isEnabled ? 'bg-green-50' : 'bg-slate-50'}`}>
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          disabled
                          className="rounded border-slate-300"
                        />
                        <span className={isEnabled ? 'text-green-700' : 'text-slate-400'}>{perm.label}</span>
                      </label>
                    )
                  })}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  * Доступы определяются ролью сотрудника
                </p>
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setEditingAgent(null)
                  setNewAgentForm({ name: '', username: '', email: '', role: 'agent', password: '', showPassword: false })
                }}
                className="flex-1 px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Отмена
              </button>
              <button
                onClick={async () => {
                  const name = newAgentForm.name || editingAgent.name
                  if (!name.trim()) {
                    alert('Введите имя')
                    return
                  }
                  if (!editingAgent.id && !newAgentForm.password) {
                    alert('Введите пароль')
                    return
                  }
                  
                  try {
                    const method = editingAgent.id ? 'PUT' : 'POST'
                    const body = editingAgent.id 
                      ? {
                          id: editingAgent.id,
                          name: newAgentForm.name || editingAgent.name,
                          username: newAgentForm.username || editingAgent.username,
                          role: newAgentForm.role || editingAgent.role,
                          password: newAgentForm.password || undefined
                        }
                      : {
                          name: newAgentForm.name,
                          username: newAgentForm.username || null,
                          email: newAgentForm.email || null,
                          role: newAgentForm.role,
                          password: newAgentForm.password
                        }
                    
                    const res = await fetch('/api/support/agents', {
                      method,
                      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin' },
                      body: JSON.stringify(body)
                    })
                    
                    if (res.ok) {
                      setEditingAgent(null)
                      setNewAgentForm({ name: '', username: '', email: '', role: 'agent', password: '', showPassword: false })
                      loadData()
                    } else {
                      const error = await res.json()
                      alert('Ошибка: ' + error.error)
                    }
                  } catch (e) {
                    alert('Ошибка сохранения')
                  }
                }}
                className="flex-1 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue"
              >
                {editingAgent.id ? 'Сохранить' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Channel Context Menu */}
      {channelContextMenu && (
        <div 
          className="fixed inset-0 z-50"
          onClick={() => setChannelContextMenu(null)}
        >
          <div 
            className="absolute bg-white rounded-xl shadow-xl border py-2 min-w-[220px]"
            style={{ 
              left: Math.min(channelContextMenu.x, window.innerWidth - 240),
              top: Math.min(channelContextMenu.y, window.innerHeight - 250)
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-slate-100 mb-1">
              <span className="font-medium text-sm text-slate-800 truncate block">{channelContextMenu.channelName}</span>
            </div>
            
            {/* Preview - open without marking read */}
            <button
              onClick={() => {
                previewChannel(channelContextMenu.channelId)
                setChannelContextMenu(null)
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors"
            >
              <Eye className="w-4 h-4 text-blue-500" />
              <div>
                <span className="text-sm text-slate-700 block">Предпросмотр</span>
                <span className="text-xs text-slate-400">Открыть без отметки прочитанным</span>
              </div>
            </button>
            
            {/* Mark as unread */}
            <button
              onClick={() => {
                markChannelUnread(channelContextMenu.channelId)
                setChannelContextMenu(null)
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors"
            >
              <MailWarning className="w-4 h-4 text-orange-500" />
              <div>
                <span className="text-sm text-slate-700 block">Пометить непрочитанным</span>
                <span className="text-xs text-slate-400">Чтобы вернуться позже</span>
              </div>
            </button>
            
            {/* Separator */}
            <div className="border-t border-slate-100 my-1" />
            
            {/* Open channel normally */}
            <button
              onClick={() => {
                setPreviewChannelId(null)
                setExpandedChannels(new Set([channelContextMenu.channelId]))
                loadAiContext(channelContextMenu.channelId)
                markAsRead(undefined, channelContextMenu.channelId)
                setChannelContextMenu(null)
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors"
            >
              <MessageSquare className="w-4 h-4 text-green-500" />
              <span className="text-sm text-slate-700">Открыть и прочитать</span>
            </button>
          </div>
        </div>
      )}

      {/* Context Menu for Messages */}
      {contextMenu && (
        <div 
          className="fixed inset-0 z-50"
          onClick={() => { setContextMenu(null); setChannelContextMenu(null) }}
        >
          <div 
            className="absolute bg-white rounded-xl shadow-xl border py-2 min-w-[220px] max-h-[80vh] overflow-y-auto"
            style={{ 
              left: Math.min(contextMenu.x, window.innerWidth - 240), 
              top: Math.max(10, Math.min(contextMenu.y, window.innerHeight - 450))
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Quick reactions bar */}
            <div className="flex items-center justify-center gap-1 px-3 py-2 border-b">
              {quickEmojis.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => {
                    sendReaction(contextMenu.messageId, emoji)
                    setContextMenu(null)
                  }}
                  className="w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-full text-xl transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
            
            <button 
              onClick={() => {
                setReplyToMessage({ 
                  id: contextMenu.messageId, 
                  telegramMessageId: contextMenu.telegramMessageId,
                  senderName: contextMenu.senderName, 
                  text: contextMenu.text.slice(0, 50) 
                })
                setContextMenu(null)
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-sm text-slate-700"
            >
              <span className="text-lg">↩️</span> Ответить
            </button>
            <button 
              onClick={() => copyToClipboard(contextMenu.text)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-sm text-slate-700"
            >
              <span className="text-lg">📋</span> Копировать текст
            </button>
            <button 
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-sm text-slate-700"
              onClick={() => { setContextMenu(null); setChannelContextMenu(null) }}
            >
              <span className="text-lg">📌</span> Закрепить
            </button>
            <div className="border-t my-1" />
            <button 
              onClick={() => {
                createCaseFromMessage(contextMenu.messageId, contextMenu.text)
                setContextMenu(null)
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-orange-50 text-sm text-orange-700"
            >
              <span className="text-lg">🎫</span> Создать тикет
            </button>
            <button 
              onClick={() => {
                escalateMessage(contextMenu.messageId)
                setContextMenu(null)
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-red-50 text-sm text-red-600"
            >
              <span className="text-lg">🚨</span> Эскалация
            </button>
            <div className="border-t my-1" />
            {/* Delete team messages (not from clients) */}
            {(() => {
              // Check if this is a team message (from support/bot/agent, not client)
              const agentData = localStorage.getItem('support_agent_data')
              const currentAgent = agentData ? JSON.parse(agentData) : null
              
              // Allow deletion for: own messages, Support, Bot, AI, Автоответчик, or any non-client message
              const teamSenders = ['Support', 'Bot', 'AI', 'Автоответчик', 'System', 'Delever Bot']
              const isTeamMessage = currentAgent && (
                contextMenu.senderName === currentAgent.name ||
                contextMenu.senderName === currentAgent.username ||
                teamSenders.some(s => contextMenu.senderName?.includes(s)) ||
                contextMenu.isFromTeam === true
              )
              
              return isTeamMessage ? (
                <button 
                  onClick={() => {
                    setContextMenu(null)
                    setConfirmDialog({
                      show: true,
                      title: 'Удаление сообщения',
                      message: 'Удалить сообщение? Оно будет удалено из Telegram.',
                      danger: true,
                      onConfirm: () => {
                        deleteMessage(contextMenu.messageId, contextMenu.telegramMessageId)
                      }
                    })
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-red-50 text-sm text-red-600"
                >
                  <span className="text-lg">🗑️</span> Удалить сообщение
                </button>
              ) : (
                <button 
                  disabled
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-400 cursor-not-allowed"
                  title="Можно удалить только сообщения команды"
                >
                  <span className="text-lg">🗑️</span> Удалить (только команды)
                </button>
              )
            })()}
          </div>
        </div>
      )}

      {/* Channel Context Modal */}
      {selectedChannel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedChannel(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  selectedChannel.company?.isVIP ? 'bg-yellow-100' : 'bg-blue-100'
                }`}>
                  {selectedChannel.company?.isVIP ? (
                    <span className="text-2xl">⭐</span>
                  ) : (
                    <Users className="w-6 h-6 text-blue-600" />
                  )}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-800">{selectedChannel.channel.name}</h2>
                  <p className="text-sm text-slate-500">{selectedChannel.context.summary}</p>
                </div>
              </div>
              <button onClick={() => setSelectedChannel(null)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Channel Settings */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-medium text-slate-800 mb-3 flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Настройки канала
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="bg-white rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Тип канала</div>
                    <select
                      value={selectedChannel.channel.type}
                      onChange={e => updateChannel(selectedChannel.channel.id, { type: e.target.value })}
                      className="w-full p-2 border rounded-lg text-sm"
                    >
                      <option value="client">Клиентский</option>
                      <option value="partner">Партнёрский</option>
                      <option value="internal">Внутренний</option>
                      <option value="other">Другой</option>
                    </select>
                  </div>
                  <div className="bg-white rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Тип чата</div>
                    <div className="font-medium text-sm">
                      {channels.find(c => c.id === selectedChannel.channel.id)?.isForum ? '📂 Форум с ветками' : '💬 Обычная группа'}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Telegram ID</div>
                    <div className="font-medium text-sm font-mono">
                      {channels.find(c => c.id === selectedChannel.channel.id)?.telegramChatId}
                    </div>
                  </div>
                </div>
              </div>

              {/* Company Info */}
              {selectedChannel.company && (
                <div className="bg-slate-50 rounded-xl p-4">
                  <h3 className="font-medium text-slate-800 mb-3 flex items-center gap-2">
                    <Building className="w-4 h-4" />
                    Компания
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-white rounded-lg p-3">
                      <div className="text-xs text-slate-500">Название</div>
                      <div className="font-medium">{selectedChannel.company.name}</div>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <div className="text-xs text-slate-500">MRR</div>
                      <div className="font-medium text-green-600">${selectedChannel.company.mrr}</div>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <div className="text-xs text-slate-500">План</div>
                      <div className="font-medium">{selectedChannel.company.plan || '—'}</div>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <div className="text-xs text-slate-500">Сегмент</div>
                      <div className="font-medium">{selectedChannel.company.segment || '—'}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Risk Alert */}
              {selectedChannel.risk.level !== 'low' && (
                <div className={`rounded-xl p-4 ${
                  selectedChannel.risk.level === 'high' ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'
                }`}>
                  <h3 className={`font-medium mb-2 flex items-center gap-2 ${
                    selectedChannel.risk.level === 'high' ? 'text-red-700' : 'text-yellow-700'
                  }`}>
                    <AlertCircle className="w-4 h-4" />
                    {selectedChannel.risk.level === 'high' ? 'Высокий риск оттока' : 'Средний риск'}
                  </h3>
                  <ul className="text-sm space-y-1">
                    {selectedChannel.risk.reasons.map((reason, i) => (
                      <li key={i} className={selectedChannel.risk.level === 'high' ? 'text-red-600' : 'text-yellow-600'}>
                        • {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-blue-600">{selectedChannel.caseStats.open}</div>
                  <div className="text-xs text-slate-500">Открытых кейсов</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">{selectedChannel.caseStats.resolved}</div>
                  <div className="text-xs text-slate-500">Решено</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-purple-600">{selectedChannel.messageStats.total}</div>
                  <div className="text-xs text-slate-500">Сообщений</div>
                </div>
                <div className="bg-orange-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-orange-600">{selectedChannel.caseStats.avgResolutionFormatted}</div>
                  <div className="text-xs text-slate-500">Ср. решение</div>
                </div>
              </div>

              {/* Top Categories */}
              {selectedChannel.topCategories.length > 0 && (
                <div>
                  <h3 className="font-medium text-slate-800 mb-2">Частые темы</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedChannel.topCategories.map((cat, i) => {
                      const categoryLabels: Record<string, string> = {
                        technical: '🔧 Техническая',
                        billing: '💳 Биллинг',
                        integration: '🔗 Интеграция',
                        onboarding: '🚀 Онбординг',
                        feature_request: '💡 Запрос',
                        complaint: '😤 Жалоба',
                        question: '❓ Вопрос',
                        feedback: '💬 Обратная связь',
                        general: '📋 Общее',
                        response: '💬 Ответ'
                      }
                      return (
                        <span key={i} className="px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-sm">
                          {categoryLabels[cat.category] || cat.category} ({cat.count})
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* AI Recommendations */}
              {selectedChannel.recommendations && selectedChannel.recommendations.length > 0 && (
                <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-4 border border-purple-100">
                  <h3 className="font-medium text-slate-800 mb-3 flex items-center gap-2">
                    <span className="text-lg">💡</span>
                    Рекомендации по решению
                  </h3>
                  <div className="space-y-3">
                    {selectedChannel.recommendations.map((rec, i) => (
                      <div key={rec.id} className="bg-white rounded-lg p-3 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            rec.confidence >= 80 ? 'bg-green-100 text-green-700' :
                            rec.confidence >= 60 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {rec.confidence}% уверенность
                          </span>
                          <span className="text-xs text-slate-400">
                            Решено {rec.usedCount} раз
                          </span>
                        </div>
                        <p className="text-sm text-slate-700">{rec.solutionText}</p>
                        {rec.avgResolutionMinutes && (
                          <div className="text-xs text-slate-500 mt-2">
                            ⏱ Обычно решается за {rec.avgResolutionMinutes < 60 
                              ? `${rec.avgResolutionMinutes} мин` 
                              : `${Math.round(rec.avgResolutionMinutes / 60)}ч`}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Resolved Cases */}
              {selectedChannel.recentCases.length > 0 && (
                <div>
                  <h3 className="font-medium text-slate-800 mb-2">Недавно решённые кейсы</h3>
                  <div className="space-y-2">
                    {selectedChannel.recentCases.slice(0, 3).map(c => (
                      <div key={c.id} className="bg-slate-50 rounded-lg p-3">
                        <div className="font-medium text-sm">{c.title}</div>
                        {c.resolution && (
                          <div className="text-xs text-slate-500 mt-1">💡 {c.resolution}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Topics/Threads */}
              {channelTopics.length > 0 && (
                <div>
                  <h3 className="font-medium text-slate-800 mb-2">Ветки ({channelTopics.length})</h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {channelTopics.map(topic => (
                      <div 
                        key={topic.id}
                        onClick={() => setSelectedTopic(selectedTopic === topic.threadId ? null : topic.threadId)}
                        className={`p-3 rounded-lg cursor-pointer transition-colors ${
                          selectedTopic === topic.threadId 
                            ? 'bg-blue-100 border-2 border-blue-500' 
                            : 'bg-slate-50 hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">{topic.name}</span>
                          <div className="flex items-center gap-2">
                            {topic.unreadCount > 0 && (
                              <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                                {topic.unreadCount}
                              </span>
                            )}
                            {topic.awaitingReply && (
                              <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full">
                                Ждёт
                              </span>
                            )}
                          </div>
                        </div>
                        {topic.recentMessages[0] && (
                          <div className="text-xs text-slate-500 mt-1 truncate">
                            {topic.recentMessages[0].senderName}: {topic.recentMessages[0].text}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reply Input */}
              <div className="border-t pt-4">
                <h3 className="font-medium text-slate-800 mb-2 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Ответить {selectedTopic ? `в "${channelTopics.find(t => t.threadId === selectedTopic)?.name}"` : 'в канал'}
                </h3>
                <div className="flex gap-2">
                  <textarea
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder="Введите сообщение..."
                    className="flex-1 p-3 border rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    rows={3}
                  />
                </div>
                <div className="flex justify-between items-center mt-2">
                  <div className="text-xs text-slate-500">
                    {selectedTopic && (
                      <button 
                        onClick={() => setSelectedTopic(null)}
                        className="text-blue-500 hover:underline"
                      >
                        Отменить выбор ветки
                      </button>
                    )}
                  </div>
                  <button
                    onClick={sendMessage}
                    disabled={!replyText.trim() || sendingMessage}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {sendingMessage ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Отправка...
                      </>
                    ) : (
                      <>
                        <MessageSquare className="w-4 h-4" />
                        Отправить
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Quick Actions - Fixed buttons */}
              <div className="flex gap-2 pt-2 border-t">
                {/* View Cases */}
                <button 
                  onClick={() => {
                    // Filter cases for this channel and show modal
                    setShowConversationsModal({ 
                      type: 'all', 
                      title: `Кейсы: ${selectedChannel.channel.name}`,
                      channelId: selectedChannel.channel.id
                    })
                    setSelectedChannel(null)
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600"
                >
                  Посмотреть кейсы ({selectedChannel.caseStats.open + selectedChannel.caseStats.resolved})
                </button>
                
                {/* Create Case */}
                <button 
                  onClick={() => {
                    setNewCase({ 
                      ...newCase, 
                      title: `Обращение: ${selectedChannel.channel.name}`,
                      description: selectedChannel.context.summary || ''
                    })
                    setShowNewCaseModal(true)
                    setSelectedChannel(null)
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Создать кейс
                </button>
                
                {/* View History */}
                <button 
                  onClick={() => {
                    // Open channel in messages tab
                    setExpandedChannels(new Set([selectedChannel.channel.id]))
                    setActiveTab('messages')
                    setSelectedChannel(null)
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  История
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Conversations Detail Modal */}
      {showConversationsModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowConversationsModal(null)}>
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-xl font-bold text-slate-800">{showConversationsModal.title}</h2>
              <button onClick={() => setShowConversationsModal(null)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              {(() => {
                // Filter cases based on type AND channelId
                const filteredCases = cases.filter(c => {
                  // Filter by channel if specified
                  if (showConversationsModal.channelId && c.channelId !== showConversationsModal.channelId) {
                    return false
                  }
                  // Filter by status
                  if (showConversationsModal.type === 'open') return ['new', 'detected', 'in_progress', 'waiting'].includes(c.status)
                  if (showConversationsModal.type === 'resolved') return c.status === 'resolved'
                  return true
                })
                
                if (filteredCases.length === 0) {
                  return (
                    <div className="text-center py-12">
                      <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                      <p className="text-slate-500">Нет кейсов в этой категории</p>
                    </div>
                  )
                }
                
                return (
                  <div className="space-y-4">
                    {filteredCases.map(c => (
                      <div 
                        key={c.id} 
                        className="bg-slate-50 rounded-xl p-4 hover:bg-slate-100 transition-colors cursor-pointer"
                        onClick={() => {
                          setSelectedCase(c)
                          setShowConversationsModal(null)
                        }}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <h3 className="font-medium text-slate-800">{c.title}</h3>
                            <p className="text-sm text-slate-500 mt-1 line-clamp-2">{c.description || 'Нет описания'}</p>
                          </div>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ml-3 ${
                            c.status === 'resolved' ? 'bg-green-100 text-green-700' :
                            c.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                            c.status === 'waiting' ? 'bg-purple-100 text-purple-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {statusLabels[c.status] || c.status}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div>
                            <span className="text-slate-400">Канал:</span>
                            <span className="ml-1 text-slate-700">{c.channelName || '—'}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">Категория:</span>
                            <span className="ml-1 text-slate-700">
                              {{
                                technical: 'Техническая',
                                billing: 'Биллинг',
                                integration: 'Интеграция',
                                onboarding: 'Онбординг',
                                feature_request: 'Запрос функции',
                                complaint: 'Жалоба',
                                general: 'Общее'
                              }[c.category] || c.category || '—'}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Приоритет:</span>
                            <span className={`ml-1 font-medium ${
                              c.priority === 'urgent' ? 'text-red-600' :
                              c.priority === 'high' ? 'text-orange-600' :
                              c.priority === 'medium' ? 'text-blue-600' :
                              'text-slate-600'
                            }`}>
                              {priorityLabels[c.priority] || c.priority}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Создан:</span>
                            <span className="ml-1 text-slate-700">
                              {new Date(c.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                            </span>
                          </div>
                        </div>
                        
                        {c.resolvedAt && (
                          <div className="mt-3 pt-3 border-t border-slate-200 flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-1 text-green-600">
                              <CheckCircle className="w-4 h-4" />
                              <span>Решён {new Date(c.resolvedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <div className="text-slate-500">
                              Время решения: {(() => {
                                const mins = Math.round((new Date(c.resolvedAt).getTime() - new Date(c.createdAt).getTime()) / 60000)
                                if (mins < 60) return `${mins} мин`
                                if (mins < 1440) return `${Math.round(mins / 60)} ч`
                                return `${Math.round(mins / 1440)} дн`
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
            
            <div className="p-4 border-t bg-slate-50 flex justify-between items-center">
              <span className="text-sm text-slate-500">
                Показано {cases.filter(c => {
                  if (showConversationsModal.channelId && c.channelId !== showConversationsModal.channelId) return false
                  if (showConversationsModal.type === 'open') return ['new', 'detected', 'in_progress', 'waiting'].includes(c.status)
                  if (showConversationsModal.type === 'resolved') return c.status === 'resolved'
                  return true
                }).length} кейсов
              </span>
              <button
                onClick={() => setShowConversationsModal(null)}
                className="px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Link Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowInviteModal(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Приглашение создано</h2>
              <p className="text-slate-500 mt-2">Отправьте ссылку сотруднику для регистрации</p>
            </div>
            
            <div className="bg-slate-50 rounded-xl p-4 mb-4">
              <div className="text-xs text-slate-500 mb-2">Ссылка для регистрации:</div>
              <div className="font-mono text-sm text-slate-700 break-all bg-white p-3 rounded-lg border">
                {inviteUrl}
              </div>
            </div>
            
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
              <Clock className="w-4 h-4" />
              <span>Действительна 7 дней</span>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => setShowInviteModal(false)}
                className="flex-1 px-4 py-3 border border-slate-200 rounded-xl hover:bg-slate-50 font-medium"
              >
                Закрыть
              </button>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(inviteUrl)
                  setInviteCopied(true)
                  setTimeout(() => setInviteCopied(false), 2000)
                }}
                className={`flex-1 px-4 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors ${
                  inviteCopied 
                    ? 'bg-green-100 text-green-700' 
                    : 'bg-brand-blue text-white hover:bg-brand-darkBlue'
                }`}
              >
                {inviteCopied ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Скопировано!
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                    Копировать
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <div 
          className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4" 
          onClick={() => setPreviewFile(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] w-full flex flex-col items-center" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 bg-gradient-to-b from-black/50 to-transparent z-10">
              <div className="text-white">
                <p className="font-medium truncate max-w-[300px]">{previewFile.file.name}</p>
                <p className="text-sm text-white/70">
                  {previewFile.file.size < 1024 ? `${previewFile.file.size} B` 
                    : previewFile.file.size < 1024 * 1024 ? `${(previewFile.file.size / 1024).toFixed(1)} KB`
                    : `${(previewFile.file.size / (1024 * 1024)).toFixed(1)} MB`}
                </p>
              </div>
              <button 
                onClick={() => setPreviewFile(null)}
                className="p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors"
              >
                <X className="w-6 h-6 text-white" />
              </button>
            </div>
            
            {/* Content */}
            <div className="flex-1 flex items-center justify-center w-full">
              {previewFile.file.type.startsWith('image/') ? (
                <img 
                  src={previewFile.url} 
                  alt={previewFile.file.name}
                  className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
                />
              ) : previewFile.file.type.startsWith('video/') ? (
                <video 
                  src={previewFile.url} 
                  controls
                  autoPlay
                  className="max-w-full max-h-[80vh] rounded-lg shadow-2xl"
                />
              ) : previewFile.file.type.startsWith('audio/') ? (
                <div className="bg-white rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-4">
                  <span className="text-6xl">🎵</span>
                  <p className="font-medium text-slate-800">{previewFile.file.name}</p>
                  <audio src={previewFile.url} controls autoPlay className="w-full max-w-md" />
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-4">
                  <span className="text-6xl">
                    {previewFile.file.name.endsWith('.pdf') ? '📄' : 
                     previewFile.file.name.endsWith('.doc') || previewFile.file.name.endsWith('.docx') ? '📝' :
                     previewFile.file.name.endsWith('.xls') || previewFile.file.name.endsWith('.xlsx') ? '📊' :
                     '📎'}
                  </span>
                  <p className="font-medium text-slate-800">{previewFile.file.name}</p>
                  <p className="text-sm text-slate-500">Превью недоступно для этого типа файла</p>
                </div>
              )}
            </div>
            
            {/* Footer Actions */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-3 p-4 bg-gradient-to-t from-black/50 to-transparent">
              <button
                onClick={() => {
                  setPreviewFile(null)
                  setAttachedFiles(files => files.filter(f => f !== previewFile.file))
                }}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                Удалить
              </button>
              <button
                onClick={() => setPreviewFile(null)}
                className="px-4 py-2 bg-white text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
              >
                Готово
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <div 
          className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4" 
          onClick={() => setPreviewFile(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] w-full" onClick={e => e.stopPropagation()}>
            {/* Close button */}
            <button 
              onClick={() => setPreviewFile(null)}
              className="absolute -top-12 right-0 p-2 text-white/80 hover:text-white transition-colors"
            >
              <X className="w-8 h-8" />
            </button>
            
            {/* File info */}
            <div className="absolute -top-12 left-0 text-white">
              <p className="font-medium">{previewFile.file.name}</p>
              <p className="text-sm text-white/60">
                {previewFile.file.size < 1024 ? `${previewFile.file.size} B` 
                  : previewFile.file.size < 1024 * 1024 ? `${(previewFile.file.size / 1024).toFixed(1)} KB`
                  : `${(previewFile.file.size / (1024 * 1024)).toFixed(1)} MB`}
              </p>
            </div>
            
            {/* Content */}
            {previewFile.file.type.startsWith('image/') ? (
              <img 
                src={previewFile.url} 
                alt={previewFile.file.name}
                className="max-w-full max-h-[80vh] mx-auto rounded-lg shadow-2xl object-contain"
              />
            ) : previewFile.file.type.startsWith('video/') ? (
              <video 
                src={previewFile.url}
                controls
                autoPlay
                className="max-w-full max-h-[80vh] mx-auto rounded-lg shadow-2xl"
              />
            ) : (
              <div className="bg-white rounded-xl p-8 text-center">
                <span className="text-6xl mb-4 block">
                  {previewFile.file.name.endsWith('.pdf') ? '📄' : 
                   previewFile.file.name.endsWith('.doc') || previewFile.file.name.endsWith('.docx') ? '📝' :
                   previewFile.file.name.endsWith('.xls') || previewFile.file.name.endsWith('.xlsx') ? '📊' :
                   '📎'}
                </span>
                <p className="text-lg font-medium text-slate-800">{previewFile.file.name}</p>
                <p className="text-slate-500 mt-1">Предпросмотр недоступен для этого типа файла</p>
              </div>
            )}
            
            {/* Action buttons */}
            <div className="flex justify-center gap-3 mt-4">
              <button
                onClick={() => setPreviewFile(null)}
                className="px-6 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
              >
                Закрыть
              </button>
              <button
                onClick={() => {
                  // Файл уже в attachedFiles, просто закрываем
                  setPreviewFile(null)
                }}
                className="px-6 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue transition-colors"
              >
                Готово к отправке
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Broadcast Modal - Массовая рассылка (компактная) */}
      {showBroadcastModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2" onClick={() => setShowBroadcastModal(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-indigo-500" />
                Рассылка
              </h2>
              <button onClick={() => setShowBroadcastModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Тип сообщения - компактно */}
            <div className="mb-3">
              <div className="flex gap-1.5">
                {[
                  { value: 'announcement', label: '📢 Объявление', color: 'bg-indigo-100 text-indigo-700 border-indigo-400' },
                  { value: 'update', label: '🔄 Обновление', color: 'bg-blue-100 text-blue-700 border-blue-400' },
                  { value: 'warning', label: '⚠️ Важное', color: 'bg-orange-100 text-orange-700 border-orange-400' }
                ].map(type => (
                  <button
                    key={type.value}
                    onClick={() => setBroadcastType(type.value as any)}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors ${
                      broadcastType === type.value
                        ? `${type.color} border-2`
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border-2 border-transparent'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Фильтр получателей - компактно */}
            <div className="mb-3">
              <div className="flex gap-1.5 mb-2">
                <button
                  onClick={() => { setBroadcastFilter('all'); setSelectedBroadcastChannels(new Set()); loadBroadcastPreview('all') }}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors ${
                    broadcastFilter === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Все ({broadcastPreview?.count || 0})
                </button>
                <button
                  onClick={() => { setBroadcastFilter('active'); setSelectedBroadcastChannels(new Set()); loadBroadcastPreview('active') }}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors ${
                    broadcastFilter === 'active' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Активные
                </button>
                <button
                  onClick={() => { setBroadcastFilter('selected'); setBroadcastChannelSearch(''); loadBroadcastPreview('all') }}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors ${
                    broadcastFilter === 'selected' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Выбор ({selectedBroadcastChannels.size})
                </button>
              </div>
              
              {/* Выборочный выбор каналов с поиском */}
              {broadcastFilter === 'selected' && broadcastPreview?.channels && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  {/* Поиск */}
                  <div className="p-2 bg-slate-50 border-b">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Поиск канала..."
                        value={broadcastChannelSearch}
                        onChange={(e) => setBroadcastChannelSearch(e.target.value)}
                        className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-slate-500">Выбрано: {selectedBroadcastChannels.size}</span>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => {
                            const filtered = broadcastPreview.channels.filter(c => 
                              c.name.toLowerCase().includes(broadcastChannelSearch.toLowerCase())
                            )
                            setSelectedBroadcastChannels(new Set(filtered.map(c => c.id)))
                          }}
                          className="text-[10px] text-blue-600 hover:text-blue-700"
                        >
                          Выбрать все
                        </button>
                        <button 
                          onClick={() => setSelectedBroadcastChannels(new Set())}
                          className="text-[10px] text-slate-500 hover:text-slate-700"
                        >
                          Сбросить
                        </button>
                      </div>
                    </div>
                  </div>
                  {/* Список каналов */}
                  <div className="max-h-48 overflow-y-auto">
                    {broadcastPreview.channels
                      .filter(c => c.name.toLowerCase().includes(broadcastChannelSearch.toLowerCase()))
                      .map(channel => (
                      <label 
                        key={channel.id} 
                        className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0"
                      >
                        <input 
                          type="checkbox"
                          checked={selectedBroadcastChannels.has(channel.id)}
                          onChange={(e) => {
                            const newSet = new Set(selectedBroadcastChannels)
                            if (e.target.checked) newSet.add(channel.id)
                            else newSet.delete(channel.id)
                            setSelectedBroadcastChannels(newSet)
                          }}
                          className="w-3.5 h-3.5 text-indigo-500 rounded border-slate-300"
                        />
                        <span className="text-xs text-slate-700 truncate">{channel.name}</span>
                      </label>
                    ))}
                    {broadcastPreview.channels.filter(c => c.name.toLowerCase().includes(broadcastChannelSearch.toLowerCase())).length === 0 && (
                      <div className="p-3 text-center text-xs text-slate-400">Ничего не найдено</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            
            {/* Текст сообщения - компактно */}
            <div className="mb-3">
              <textarea
                value={broadcastMessage}
                onChange={(e) => setBroadcastMessage(e.target.value)}
                placeholder="Текст сообщения..."
                className="w-full h-20 p-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
              />
            </div>
            
            {/* Планирование - компактно */}
            <div className="mb-3 p-2 bg-slate-50 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-600">Когда:</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setBroadcastScheduleMode(false); setBroadcastScheduleDate('') }}
                    className={`px-2 py-1 text-[10px] rounded-full transition-colors ${
                      !broadcastScheduleMode ? 'bg-indigo-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Сейчас
                  </button>
                  <button
                    onClick={() => {
                      setBroadcastScheduleMode(true)
                      const d = new Date(); d.setHours(d.getHours() + 1); d.setMinutes(0)
                      setBroadcastScheduleDate(d.toISOString().slice(0, 16))
                    }}
                    className={`px-2 py-1 text-[10px] rounded-full transition-colors flex items-center gap-1 ${
                      broadcastScheduleMode ? 'bg-purple-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Calendar className="w-2.5 h-2.5" />
                    План
                  </button>
                </div>
              </div>
              {broadcastScheduleMode && (
                <input
                  type="datetime-local"
                  value={broadcastScheduleDate}
                  onChange={(e) => setBroadcastScheduleDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                  className="w-full mt-2 px-2 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              )}
            </div>
            
            {/* Прогресс-бар во время отправки */}
            {sendingBroadcast && broadcastProgress && (
              <div className="mb-4 p-4 bg-indigo-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-indigo-700">
                    Отправка рассылки...
                  </span>
                  <span className="text-sm text-indigo-600">
                    {broadcastProgress.sent} / {broadcastProgress.total}
                  </span>
                </div>
                <div className="w-full bg-indigo-200 rounded-full h-2">
                  <div 
                    className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(broadcastProgress.sent / broadcastProgress.total) * 100}%` }}
                  />
                </div>
                {broadcastProgress.current && (
                  <div className="text-xs text-indigo-500 mt-1 truncate">
                    → {broadcastProgress.current}
                  </div>
                )}
              </div>
            )}
            
            {/* Результат */}
            {broadcastResult && !sendingBroadcast && (
              <div className={`mb-4 p-3 rounded-lg ${broadcastResult.failed > 0 ? 'bg-orange-50' : 'bg-green-50'}`}>
                <div className="flex items-center justify-between">
                  <div className={broadcastResult.failed > 0 ? 'text-orange-700' : 'text-green-700'}>
                    ✓ Отправлено: {broadcastResult.successful} | Ошибок: {broadcastResult.failed}
                  </div>
                  {broadcastResult.broadcastId && (
                    <button
                      onClick={() => {
                        const bcId = broadcastResult.broadcastId!
                        setConfirmDialog({
                          show: true,
                          title: 'Удаление рассылки',
                          message: 'Удалить все отправленные сообщения этой рассылки из чатов?',
                          danger: true,
                          onConfirm: async () => {
                            setDeletingBroadcast(bcId)
                            try {
                              const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
                              const res = await fetch('/api/support/broadcast/delete', {
                                method: 'POST',
                                headers: { 
                                  'Content-Type': 'application/json',
                                  Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
                                },
                                body: JSON.stringify({ broadcastId: bcId })
                              })
                              const data = await res.json()
                              if (data.success) {
                                setBroadcastResult(null)
                                loadBroadcastPreview(broadcastFilter === 'selected' ? 'all' : broadcastFilter)
                              }
                            } catch (e) {
                              console.error('Ошибка удаления')
                            } finally {
                              setDeletingBroadcast(null)
                            }
                          }
                        })
                      }}
                      disabled={!!deletingBroadcast}
                      className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1"
                    >
                      {deletingBroadcast === broadcastResult.broadcastId ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                      Отменить
                    </button>
                  )}
                </div>
              </div>
            )}
            
            {/* Кнопка отправки / планирования */}
            <button
              onClick={async () => {
                if (broadcastScheduleMode) {
                  // Планирование
                  if (!broadcastScheduleDate) {
                    alert('Выберите дату и время')
                    return
                  }
                  try {
                    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
                    const agentData = localStorage.getItem('support_agent_data')
                    const createdBy = agentData ? JSON.parse(agentData).name : 'Unknown'
                    
                    const res = await fetch('/api/support/broadcast/schedule', {
                      method: 'POST',
                      headers: { 
                        'Content-Type': 'application/json',
                        Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
                      },
                      body: JSON.stringify({
                        messageText: broadcastMessage,
                        messageType: broadcastType,
                        filterType: broadcastFilter === 'selected' ? 'selected' : broadcastFilter,
                        selectedChannels: broadcastFilter === 'selected' ? Array.from(selectedBroadcastChannels) : [],
                        scheduledAt: broadcastScheduleDate,
                        createdBy
                      })
                    })
                    
                    if (res.ok) {
                      const data = await res.json()
                      alert(`Рассылка запланирована на ${new Date(broadcastScheduleDate).toLocaleString('ru-RU')}`)
                      setBroadcastMessage('')
                      setBroadcastScheduleMode(false)
                      setBroadcastScheduleDate('')
                      setSelectedBroadcastChannels(new Set())
                      // Обновляем список запланированных
                      loadBroadcastPreview(broadcastFilter === 'selected' ? 'all' : broadcastFilter)
                    } else {
                      const error = await res.json()
                      alert('Ошибка: ' + error.error)
                    }
                  } catch (e) {
                    alert('Ошибка планирования')
                  }
                } else {
                  // Обычная отправка
                  sendBroadcast()
                }
              }}
              disabled={sendingBroadcast || !broadcastMessage.trim() || (broadcastFilter === 'selected' ? selectedBroadcastChannels.size === 0 : (broadcastPreview?.count || 0) === 0) || (broadcastScheduleMode && !broadcastScheduleDate)}
              className={`w-full py-3 ${broadcastScheduleMode ? 'bg-purple-500 hover:bg-purple-600' : 'bg-indigo-500 hover:bg-indigo-600'} disabled:bg-slate-300 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2`}
            >
              {sendingBroadcast ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Отправка...
                </>
              ) : broadcastScheduleMode ? (
                <>
                  <Calendar className="w-4 h-4" />
                  Запланировать на {broadcastScheduleDate ? new Date(broadcastScheduleDate).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '...'}
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Отправить в {broadcastFilter === 'selected' ? selectedBroadcastChannels.size : broadcastPreview?.count || 0} чатов
                </>
              )}
            </button>
            
            {/* Запланированные рассылки */}
            {scheduledBroadcasts.filter(s => s.status === 'pending').length > 0 && (
              <div className="mt-6 pt-4 border-t border-slate-200">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-slate-700 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-purple-500" />
                    Запланированные
                  </h3>
                  <span className="text-xs text-purple-500 font-medium">{scheduledBroadcasts.filter(s => s.status === 'pending').length}</span>
                </div>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {scheduledBroadcasts.filter(s => s.status === 'pending').map((item) => {
                    const typeEmoji = item.messageType === 'announcement' ? '📢' : item.messageType === 'update' ? '🔄' : '⚠️'
                    const scheduledDate = new Date(item.scheduledAt)
                    return (
                      <div key={item.id} className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-sm">
                              <span>{typeEmoji}</span>
                              <span className="font-medium text-slate-700 truncate">{item.messageText}</span>
                            </div>
                            <div className="text-xs text-purple-600 mt-1 font-medium">
                              📅 {scheduledDate.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              const schId = item.id
                              setConfirmDialog({
                                show: true,
                                title: 'Отмена рассылки',
                                message: 'Отменить запланированную рассылку?',
                                danger: true,
                                onConfirm: async () => {
                                  try {
                                    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
                                    const res = await fetch(`/api/support/broadcast/schedule?id=${schId}`, {
                                      method: 'DELETE',
                                      headers: { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` }
                                    })
                                    if (res.ok) {
                                      setScheduledBroadcasts(prev => prev.filter(s => s.id !== schId))
                                    }
                                  } catch (e) {
                                    console.error('Ошибка отмены')
                                  }
                                }
                              })
                            }}
                            className="text-xs text-red-500 hover:text-red-600 p-1"
                            title="Отменить"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            
            {/* История рассылок */}
            {broadcastHistory.length > 0 && (
              <div className="mt-6 pt-4 border-t border-slate-200">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-slate-700 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    История рассылок
                  </h3>
                  <span className="text-xs text-slate-400">{broadcastHistory.length} последних</span>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {broadcastHistory.map((item) => {
                    const typeEmoji = item.type === 'announcement' ? '📢' : item.type === 'update' ? '🔄' : '⚠️'
                    const date = new Date(item.createdAt)
                    return (
                      <div key={item.id} className="p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-sm">
                              <span>{typeEmoji}</span>
                              <span className="font-medium text-slate-700 truncate">{item.message}</span>
                            </div>
                            <div className="text-xs text-slate-400 mt-1">
                              {item.sender} • {date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                        {/* Статистика и действия */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 text-xs">
                            <div className="flex items-center gap-1" title="Отправлено">
                              <Send className="w-3 h-3 text-slate-400" />
                              <span className="text-green-600 font-medium">{item.successful}</span>
                              {item.failed > 0 && <span className="text-red-500">/ {item.failed}</span>}
                            </div>
                            {(item.clicks || 0) > 0 && (
                              <div className="flex items-center gap-1" title="Переходы по ссылкам">
                                <ExternalLink className="w-3 h-3 text-blue-400" />
                                <span className="text-blue-600 font-medium">{item.clicks}</span>
                                {(item.uniqueClicks || 0) > 0 && item.uniqueClicks !== item.clicks && (
                                  <span className="text-slate-400">({item.uniqueClicks} уник.)</span>
                                )}
                              </div>
                            )}
                            {(item.forwards || 0) > 0 && (
                              <div className="flex items-center gap-1" title="Поделились">
                                <RefreshCw className="w-3 h-3 text-purple-400" />
                                <span className="text-purple-600 font-medium">{item.forwards}</span>
                              </div>
                            )}
                          </div>
                          {/* Кнопка удаления рассылки */}
                          {item.type !== 'deleted' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                const bcId = item.id
                                setConfirmDialog({
                                  show: true,
                                  title: 'Удаление рассылки',
                                  message: 'Удалить все сообщения этой рассылки из чатов?',
                                  danger: true,
                                  onConfirm: async () => {
                                    setDeletingBroadcast(bcId)
                                    try {
                                      const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
                                      const res = await fetch('/api/support/broadcast/delete', {
                                        method: 'POST',
                                        headers: { 
                                          'Content-Type': 'application/json',
                                          Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
                                        },
                                        body: JSON.stringify({ broadcastId: bcId })
                                      })
                                      const data = await res.json()
                                      if (data.success) {
                                        loadBroadcastPreview(broadcastFilter === 'selected' ? 'all' : broadcastFilter)
                                      }
                                    } catch (e) {
                                      console.error('Ошибка удаления')
                                    } finally {
                                      setDeletingBroadcast(null)
                                    }
                                  }
                                })
                              }}
                              disabled={deletingBroadcast === item.id}
                              className="text-xs text-red-500 hover:text-red-600 p-1"
                              title="Удалить сообщения"
                            >
                              {deletingBroadcast === item.id ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <Trash2 className="w-3 h-3" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Calendar Modal - Календарь событий */}
      {showCalendarModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowCalendarModal(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Calendar className="w-5 h-5 text-orange-500" />
                Календарь событий
              </h2>
              <button onClick={() => setShowCalendarModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Запланированные рассылки */}
            {scheduledBroadcasts.filter(s => s.status === 'pending').length > 0 && (
              <div className="mb-4 p-4 bg-purple-50 rounded-xl border border-purple-200">
                <div className="flex items-center gap-2 mb-3">
                  <Send className="w-4 h-4 text-purple-600" />
                  <span className="font-medium text-purple-800">Запланированные рассылки</span>
                  <span className="ml-auto bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full font-medium">
                    {scheduledBroadcasts.filter(s => s.status === 'pending').length}
                  </span>
                </div>
                <div className="space-y-2">
                  {scheduledBroadcasts.filter(s => s.status === 'pending').slice(0, 3).map((item) => {
                    const typeEmoji = item.messageType === 'announcement' ? '📢' : item.messageType === 'update' ? '🔄' : '⚠️'
                    const scheduledDate = new Date(item.scheduledAt)
                    const now = new Date()
                    const diffMs = scheduledDate.getTime() - now.getTime()
                    const diffHours = Math.floor(diffMs / 3600000)
                    const diffDays = Math.floor(diffHours / 24)
                    let timeText = ''
                    if (diffDays > 0) timeText = `через ${diffDays}д`
                    else if (diffHours > 0) timeText = `через ${diffHours}ч`
                    else timeText = `через ${Math.floor(diffMs / 60000)}м`
                    
                    return (
                      <div key={item.id} className="flex items-start gap-3 p-2 bg-white rounded-lg">
                        <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <span className="text-sm">{typeEmoji}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-700 truncate">{item.messageText}</div>
                          <div className="flex items-center gap-2 text-xs text-purple-600 mt-0.5">
                            <span>{scheduledDate.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                            <span className="text-purple-400">•</span>
                            <span className="font-medium">{timeText}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {scheduledBroadcasts.filter(s => s.status === 'pending').length > 3 && (
                    <div className="text-center text-xs text-purple-600 pt-1">
                      +{scheduledBroadcasts.filter(s => s.status === 'pending').length - 3} ещё
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Статистика обещаний */}
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-orange-500" />
              <span className="font-medium text-slate-700">Обещания</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-orange-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-orange-600">{remindersStats.active}</div>
                <div className="text-xs text-orange-600">Активных</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-600">{remindersStats.overdue}</div>
                <div className="text-xs text-red-600">Просрочено</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-600">{remindersStats.completed}</div>
                <div className="text-xs text-green-600">Выполнено</div>
              </div>
            </div>
            
            {/* Список напоминаний */}
            <div className="space-y-3">
              {reminders.filter(r => r.status === 'active' || r.status === 'overdue' || r.isOverdue).length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  Нет активных напоминаний
                </div>
              ) : (
                reminders
                  .filter(r => r.status === 'active' || r.status === 'overdue' || r.isOverdue)
                  .sort((a, b) => {
                    // Сначала просроченные, потом по времени
                    if (a.isOverdue && !b.isOverdue) return -1
                    if (!a.isOverdue && b.isOverdue) return 1
                    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
                  })
                  .map(reminder => {
                    const deadlineDate = new Date(reminder.deadline)
                    const now = new Date()
                    const isOverdue = reminder.isOverdue || deadlineDate < now
                    const diffMs = deadlineDate.getTime() - now.getTime()
                    const diffMins = Math.floor(Math.abs(diffMs) / 60000)
                    const diffHours = Math.floor(diffMins / 60)
                    const diffDays = Math.floor(diffHours / 24)
                    
                    let timeLeftText = ''
                    if (isOverdue) {
                      if (diffDays > 0) timeLeftText = `${diffDays}д ${diffHours % 24}ч просрочено`
                      else if (diffHours > 0) timeLeftText = `${diffHours}ч ${diffMins % 60}м просрочено`
                      else timeLeftText = `${diffMins}м просрочено`
                    } else {
                      if (diffDays > 0) timeLeftText = `осталось ${diffDays}д ${diffHours % 24}ч`
                      else if (diffHours > 0) timeLeftText = `осталось ${diffHours}ч ${diffMins % 60}м`
                      else timeLeftText = `осталось ${diffMins}м`
                    }
                    
                    return (
                      <div key={reminder.id} className={`p-4 rounded-xl border-2 ${
                        isOverdue 
                          ? 'bg-red-50 border-red-300' 
                          : diffHours < 2 
                            ? 'bg-orange-50 border-orange-300'
                            : 'bg-white border-slate-200'
                      }`}>
                        {/* Заголовок с каналом и статусом */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-xs ${
                              isOverdue ? 'bg-red-500' : 'bg-blue-500'
                            }`}>
                              {reminder.channelName?.charAt(0) || '?'}
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-slate-800">{reminder.channelName || 'Неизвестный канал'}</div>
                              <div className="text-[10px] text-slate-400">
                                {reminder.commitmentType || 'Обещание'}
                              </div>
                            </div>
                          </div>
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            isOverdue 
                              ? 'bg-red-100 text-red-700' 
                              : diffHours < 2 
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-green-100 text-green-700'
                          }`}>
                            {isOverdue ? '⚠️ Просрочено' : diffHours < 2 ? '🔥 Скоро' : '✓ Активно'}
                          </span>
                        </div>
                        
                        {/* Полный контекст сообщения */}
                        <div className="text-sm text-slate-700 mb-3 bg-white/50 p-2 rounded-lg">
                          <div className="text-[10px] text-slate-400 mb-1 flex items-center gap-1">
                            {reminder.messageSender && (
                              <span>От: <strong>{reminder.messageSender}</strong></span>
                            )}
                          </div>
                          <div className="italic">
                            "{reminder.messageContext || reminder.commitmentText}"
                          </div>
                          {reminder.commitmentText !== reminder.messageContext && (
                            <div className="text-[10px] text-orange-600 mt-1.5 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              Ключевое слово: <strong>{reminder.commitmentText}</strong>
                            </div>
                          )}
                        </div>
                        
                        {/* Детали в таблице */}
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs bg-slate-50 p-2 rounded-lg">
                          <div className="flex items-center gap-1.5 text-slate-600">
                            <Clock className="w-3.5 h-3.5 text-blue-500" />
                            <span>Дедлайн:</span>
                          </div>
                          <div className="font-medium text-slate-800">
                            {deadlineDate.toLocaleString('ru-RU', {
                              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                            })}
                          </div>
                          
                          <div className="flex items-center gap-1.5 text-slate-600">
                            <AlertCircle className={`w-3.5 h-3.5 ${isOverdue ? 'text-red-500' : 'text-orange-500'}`} />
                            <span>{isOverdue ? 'Просрочено:' : 'Осталось:'}</span>
                          </div>
                          <div className={`font-medium ${isOverdue ? 'text-red-600' : 'text-orange-600'}`}>
                            {timeLeftText.replace('осталось ', '').replace(' просрочено', '')}
                          </div>
                          
                          <div className="flex items-center gap-1.5 text-slate-600">
                            <User className="w-3.5 h-3.5 text-green-500" />
                            <span>Обещал:</span>
                          </div>
                          <div className="font-medium text-slate-800">
                            {reminder.assignedName || reminder.createdBy || 'Не указан'}
                          </div>
                          
                          <div className="flex items-center gap-1.5 text-slate-600">
                            <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
                            <span>Клиент:</span>
                          </div>
                          <div className="font-medium text-slate-800">
                            {reminder.channelName}
                          </div>
                          
                          <div className="flex items-center gap-1.5 text-slate-600">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            <span>Создано:</span>
                          </div>
                          <div className="text-slate-600">
                            {new Date(reminder.createdAt).toLocaleString('ru-RU', {
                              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                            })}
                          </div>
                        </div>
                        
                        {/* Кнопка перехода к сообщению */}
                        <button
                          onClick={() => {
                            setShowCalendarModal(false)
                            navigateToMessage(reminder.channelId, reminder.messageId)
                          }}
                          className="mt-3 w-full py-2 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors flex items-center justify-center gap-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Перейти к сообщению
                        </button>
                      </div>
                    )
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Unanswered Messages Modal - Улучшенная версия с KPI */}
      {showUnansweredModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowUnansweredModal(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5 text-red-500" />
                Ожидают ответа
              </h2>
              <button onClick={() => setShowUnansweredModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* KPI индикатор */}
            {(() => {
              const waitingChannels = groupedMessages.filter((ch: any) => ch.awaitingReply)
              const overdueCount = waitingChannels.filter((ch: any) => {
                const waitMin = ch.lastClientMessageAt ? Math.floor((Date.now() - new Date(ch.lastClientMessageAt).getTime()) / 60000) : 0
                return waitMin > KPI.FIRST_RESPONSE_MIN
              }).length
              const slaPercent = waitingChannels.length > 0 
                ? Math.round(((waitingChannels.length - overdueCount) / waitingChannels.length) * 100)
                : 100
              
              return (
                <div className={`p-3 rounded-xl mb-4 ${overdueCount > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Норматив: {KPI.FIRST_RESPONSE_MIN} мин</span>
                    <span className={`text-sm font-bold ${overdueCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {overdueCount > 0 ? `${overdueCount} просрочено` : 'Все в норме'}
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all ${overdueCount > 0 ? 'bg-red-500' : 'bg-green-500'}`}
                      style={{ width: `${slaPercent}%` }}
                    />
                  </div>
                  <div className="text-xs text-slate-500 mt-1 text-right">{slaPercent}% в рамках SLA</div>
                </div>
              )
            })()}
            
            <div className="space-y-2">
              {groupedMessages.filter((ch: any) => ch.awaitingReply).length === 0 ? (
                <div className="text-center py-8 text-green-600">
                  <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-400" />
                  <div className="font-medium">Все сообщения отвечены</div>
                  <div className="text-sm text-slate-500">SLA выполнен на 100%</div>
                </div>
              ) : (
                groupedMessages
                  .filter((ch: any) => ch.awaitingReply)
                  .sort((a: any, b: any) => {
                    // Сначала просроченные, потом по времени ожидания (дольше ждут - выше)
                    const aTime = a.lastClientMessageAt ? new Date(a.lastClientMessageAt).getTime() : Date.now()
                    const bTime = b.lastClientMessageAt ? new Date(b.lastClientMessageAt).getTime() : Date.now()
                    const aWait = (Date.now() - aTime) / 60000
                    const bWait = (Date.now() - bTime) / 60000
                    const aOverdue = aWait > KPI.FIRST_RESPONSE_MIN
                    const bOverdue = bWait > KPI.FIRST_RESPONSE_MIN
                    if (aOverdue && !bOverdue) return -1
                    if (!aOverdue && bOverdue) return 1
                    return bWait - aWait // Больше ждёт - выше
                  })
                  .map((channel: any) => {
                    const waitingMin = channel.lastClientMessageAt 
                      ? Math.floor((Date.now() - new Date(channel.lastClientMessageAt).getTime()) / 60000)
                      : 0
                    const isOverdue = waitingMin > KPI.FIRST_RESPONSE_MIN
                    const isWarning = waitingMin > KPI.FIRST_RESPONSE_MIN * 0.8 && !isOverdue
                    const isCoreIssue = channel.category && KPI.CORE_CATEGORIES.includes(channel.category.toLowerCase())
                    
                    return (
                      <div
                        key={channel.id}
                        className={`p-3 rounded-lg border-l-4 transition-colors ${
                          isOverdue ? 'bg-red-50 border-l-red-500' :
                          isWarning ? 'bg-orange-50 border-l-orange-400' :
                          'bg-slate-50 border-l-green-400'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-800 truncate">{channel.name}</span>
                              {isCoreIssue && (
                                <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-[10px] rounded font-medium">CORE</span>
                              )}
                              {channel.priority === 'urgent' && (
                                <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-[10px] rounded font-medium">Срочно</span>
                              )}
                            </div>
                            <div className="text-sm text-slate-600 mt-1 line-clamp-2">
                              {channel.lastMessagePreview || 'Нет превью сообщения'}
                            </div>
                            {channel.lastSenderName && (
                              <div className="text-xs text-slate-400 mt-1">
                                От: {channel.lastSenderName}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                              isOverdue ? 'bg-red-100 text-red-700' :
                              isWarning ? 'bg-orange-100 text-orange-700' :
                              'bg-green-100 text-green-700'
                            }`}>
                              {waitingMin} мин
                            </span>
                            {isOverdue && (
                              <span className="text-[10px] text-red-500">
                                +{waitingMin - KPI.FIRST_RESPONSE_MIN} мин
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setShowUnansweredModal(false)
                            setActiveTab('messages')
                            setExpandedChannels(new Set([channel.id]))
                          }}
                          className={`mt-2 w-full py-1.5 rounded text-sm font-medium transition-colors ${
                            isOverdue 
                              ? 'bg-red-500 text-white hover:bg-red-600' 
                              : 'bg-blue-500 text-white hover:bg-blue-600'
                          }`}
                        >
                          {isOverdue ? 'Ответить срочно' : 'Ответить'}
                        </button>
                      </div>
                    )
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* SLA Details Modal - Улучшенная версия с жёсткими KPI */}
      {showSlaModal && teamMetrics && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowSlaModal(null)}>
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                {showSlaModal === 'response' && <><Zap className="w-5 h-5 text-blue-500" />Время ответа</>}
                {showSlaModal === 'resolution' && <><Timer className="w-5 h-5 text-green-500" />Время решения</>}
                {showSlaModal === 'percent' && <><TrendingUp className="w-5 h-5 text-purple-500" />SLA показатели</>}
              </h2>
              <button onClick={() => setShowSlaModal(null)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* === ВРЕМЯ ОТВЕТА === */}
            {showSlaModal === 'response' && (() => {
              const currentMin = Math.round(teamMetrics.avgFirstResponseMin || 0)
              const targetMin = KPI.FIRST_RESPONSE_MIN
              const ratio = targetMin > 0 ? currentMin / targetMin : 0
              const isOk = currentMin <= targetMin
              const waitingChannels = groupedMessages.filter((ch: any) => ch.awaitingReply)
              const overdueChannels = waitingChannels.filter((ch: any) => {
                const wait = ch.lastClientMessageAt ? Math.floor((Date.now() - new Date(ch.lastClientMessageAt).getTime()) / 60000) : 0
                return wait > targetMin
              })
              
              return (
                <>
                  {/* Главный индикатор */}
                  <div className={`p-4 rounded-xl mb-4 ${isOk ? 'bg-green-50' : 'bg-red-50'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className={`text-3xl font-bold ${isOk ? 'text-green-600' : 'text-red-600'}`}>
                          {currentMin} мин
                        </div>
                        <div className="text-sm text-slate-500">Среднее время ответа</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-medium text-slate-600">Цель: {targetMin} мин</div>
                        {!isOk && (
                          <div className="text-sm text-red-500 font-medium">
                            Превышение в {ratio.toFixed(1)}x
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                      <div 
                        className={`h-3 rounded-full transition-all ${isOk ? 'bg-green-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(100, (targetMin / Math.max(currentMin, 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                  
                  {/* Конкретные проблемы */}
                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-orange-500" />
                      Требуют внимания ({overdueChannels.length})
                    </h3>
                    
                    {overdueChannels.length === 0 ? (
                      <div className="text-center py-4 text-green-600 bg-green-50 rounded-lg">
                        <CheckCircle className="w-8 h-8 mx-auto mb-1" />
                        Нет просроченных чатов
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {/* Сортируем по убыванию времени ожидания (самый старый первый) */}
                        {[...overdueChannels]
                          .sort((a: any, b: any) => {
                            const waitA = a.lastClientMessageAt ? Date.now() - new Date(a.lastClientMessageAt).getTime() : 0
                            const waitB = b.lastClientMessageAt ? Date.now() - new Date(b.lastClientMessageAt).getTime() : 0
                            return waitB - waitA // По убыванию (старые первыми)
                          })
                          .map((ch: any) => {
                          const wait = ch.lastClientMessageAt ? Math.floor((Date.now() - new Date(ch.lastClientMessageAt).getTime()) / 60000) : 0
                          return (
                            <div
                              key={ch.id}
                              className="p-3 bg-red-50 hover:bg-red-100 rounded-lg border border-red-100"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <button
                                  onClick={() => {
                                    setShowSlaModal(null)
                                    setActiveTab('messages')
                                    setExpandedChannels(new Set([ch.id]))
                                  }}
                                  className="flex-1 text-left"
                                >
                                  <div className="font-medium text-red-800 text-sm">{ch.name}</div>
                                  <div className="text-xs text-red-600 truncate mt-0.5">{ch.lastMessagePreview}</div>
                                </button>
                                <span className="text-red-600 font-bold text-sm whitespace-nowrap">{wait} мин</span>
                              </div>
                              {/* Кнопки действий */}
                              <div className="flex gap-2 mt-2">
                                <button
                                  onClick={() => {
                                    setShowSlaModal(null)
                                    setActiveTab('messages')
                                    setExpandedChannels(new Set([ch.id]))
                                  }}
                                  className="flex-1 py-1.5 bg-red-500 text-white text-xs font-medium rounded hover:bg-red-600"
                                >
                                  Ответить
                                </button>
                                <button
                                  onClick={async () => {
                                    // Отметить как не требующий ответа
                                    try {
                                      const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
                                      await fetch(`/api/support/channels/${ch.id}`, {
                                        method: 'PUT',
                                        headers: { 
                                          'Content-Type': 'application/json',
                                          Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
                                        },
                                        body: JSON.stringify({ awaitingReply: false })
                                      })
                                      loadData() // Обновить данные
                                    } catch (e) {
                                      console.error('Error:', e)
                                    }
                                  }}
                                  className="flex-1 py-1.5 bg-slate-200 text-slate-700 text-xs font-medium rounded hover:bg-slate-300"
                                >
                                  Не требует ответа
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  
                  {/* Действия - кнопка для самого старого */}
                  {overdueChannels.length > 0 && (() => {
                    // Находим самый старый канал
                    const sortedChannels = [...overdueChannels].sort((a: any, b: any) => {
                      const waitA = a.lastClientMessageAt ? Date.now() - new Date(a.lastClientMessageAt).getTime() : 0
                      const waitB = b.lastClientMessageAt ? Date.now() - new Date(b.lastClientMessageAt).getTime() : 0
                      return waitB - waitA
                    })
                    const oldest = sortedChannels[0]
                    return (
                      <button
                        onClick={() => {
                          if (oldest) {
                            setShowSlaModal(null)
                            setActiveTab('messages')
                            setExpandedChannels(new Set([oldest.id]))
                          }
                        }}
                        className="w-full py-2.5 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 mb-4"
                      >
                        Ответить на самый старый ({oldest?.name?.slice(0, 20)}...)
                      </button>
                    )
                  })()}
                </>
              )
            })()}
            
            {/* === ВРЕМЯ РЕШЕНИЯ === */}
            {showSlaModal === 'resolution' && (() => {
              const currentMin = Math.round(teamMetrics.avgResolutionMin || 0)
              const targetL1 = KPI.RESOLUTION_L1_MIN
              const targetL2Min = KPI.RESOLUTION_L2_MIN
              const targetL2Max = KPI.RESOLUTION_L2_MAX
              const hours = Math.floor(currentMin / 60)
              const mins = currentMin % 60
              
              // Определяем в каком диапазоне
              const isL1Ok = currentMin <= targetL1
              const isL2Ok = currentMin <= targetL2Max
              
              return (
                <>
                  {/* Главный индикатор */}
                  <div className={`p-4 rounded-xl mb-4 ${isL1Ok ? 'bg-green-50' : isL2Ok ? 'bg-orange-50' : 'bg-red-50'}`}>
                    <div className="text-center mb-3">
                      <div className={`text-3xl font-bold ${isL1Ok ? 'text-green-600' : isL2Ok ? 'text-orange-600' : 'text-red-600'}`}>
                        {hours > 0 ? `${hours}ч ${mins}м` : `${mins} мин`}
                      </div>
                      <div className="text-sm text-slate-500">Среднее время решения</div>
                    </div>
                  </div>
                  
                  {/* Нормативы по линиям */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className={`p-3 rounded-lg border-2 ${isL1Ok ? 'border-green-300 bg-green-50' : 'border-slate-200'}`}>
                      <div className="text-xs text-slate-500 mb-1">L1 (простые)</div>
                      <div className="font-bold text-lg">{targetL1} мин</div>
                      <div className={`text-xs ${isL1Ok ? 'text-green-600' : 'text-slate-400'}`}>
                        {isL1Ok ? '✓ Выполняется' : 'Не выполняется'}
                      </div>
                    </div>
                    <div className={`p-3 rounded-lg border-2 ${!isL1Ok && isL2Ok ? 'border-orange-300 bg-orange-50' : 'border-slate-200'}`}>
                      <div className="text-xs text-slate-500 mb-1">L2 (сложные)</div>
                      <div className="font-bold text-lg">{targetL2Min/60}-{targetL2Max/60}ч</div>
                      <div className={`text-xs ${isL2Ok ? 'text-green-600' : 'text-red-600'}`}>
                        {isL2Ok ? '✓ В рамках' : '✗ Превышено'}
                      </div>
                    </div>
                  </div>
                  
                  {/* Core проблемы */}
                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-red-700 mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Core-проблемы (приём заказов)
                    </h3>
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <div className="text-sm text-red-800">
                        Проблемы категорий: <strong>{KPI.CORE_CATEGORIES.join(', ')}</strong>
                      </div>
                      <div className="text-xs text-red-600 mt-1">
                        Решаются с максимальным приоритетом
                      </div>
                    </div>
                  </div>
                  
                  {/* Статистика */}
                  <div className="space-y-2">
                    {remindersStats.overdue > 0 && (
                      <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                        <AlertTriangle className="w-5 h-5 text-red-500" />
                        <div className="flex-1">
                          <div className="font-medium text-red-700">{remindersStats.overdue} просроченных обещаний</div>
                          <div className="text-xs text-red-500">Требуют немедленного внимания</div>
                        </div>
                        <button 
                          onClick={() => {
                            setShowSlaModal(null)
                            setActiveTab('cases')
                          }}
                          className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600"
                        >
                          Смотреть
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                      <CheckCircle className="w-5 h-5 text-green-500" />
                      <div>
                        <div className="font-medium text-green-700">Решено сегодня: {teamMetrics.resolvedToday}</div>
                        <div className="text-xs text-green-500">из {teamMetrics.totalConversations} разговоров</div>
                      </div>
                    </div>
                  </div>
                </>
              )
            })()}
            
            {/* === SLA ПРОЦЕНТ === */}
            {showSlaModal === 'percent' && (() => {
              const resolved = teamMetrics.resolvedToday || 0
              const total = teamMetrics.totalConversations || 0
              const waiting = groupedMessages.filter((ch: any) => ch.awaitingReply).length
              const currentSla = total > 0 ? Math.round((resolved / total) * 100) : 0
              const targetSla = KPI.SLA_TARGET_PERCENT
              const isOk = currentSla >= targetSla
              const gap = targetSla - currentSla
              const needToResolve = gap > 0 ? Math.ceil((gap * total) / 100) : 0
              
              return (
                <>
                  {/* Главный индикатор */}
                  <div className={`p-4 rounded-xl mb-4 ${isOk ? 'bg-green-50' : 'bg-red-50'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className={`text-4xl font-bold ${isOk ? 'text-green-600' : 'text-red-600'}`}>
                          {currentSla}%
                        </div>
                        <div className="text-sm text-slate-500">Текущий SLA</div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-slate-600">{targetSla}%</div>
                        <div className="text-sm text-slate-500">Цель</div>
                      </div>
                    </div>
                    
                    {/* Прогресс бар */}
                    <div className="relative w-full bg-slate-200 rounded-full h-4 overflow-hidden">
                      <div 
                        className={`h-4 rounded-full transition-all ${isOk ? 'bg-green-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(100, currentSla)}%` }}
                      />
                      {/* Маркер цели */}
                      <div 
                        className="absolute top-0 bottom-0 w-0.5 bg-slate-800"
                        style={{ left: `${targetSla}%` }}
                      />
                    </div>
                    
                    {!isOk && (
                      <div className="mt-2 text-sm text-red-600 font-medium text-center">
                        До цели: решить ещё {needToResolve} кейс(ов)
                      </div>
                    )}
                  </div>
                  
                  {/* Детальная статистика */}
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-green-500" />
                        <span className="font-medium text-green-700">Решено</span>
                      </div>
                      <span className="text-2xl font-bold text-green-600">{resolved}</span>
                    </div>
                    
                    <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-blue-500" />
                        <span className="font-medium text-blue-700">Всего разговоров</span>
                      </div>
                      <span className="text-2xl font-bold text-blue-600">{total}</span>
                    </div>
                    
                    <div className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Clock className="w-5 h-5 text-orange-500" />
                        <span className="font-medium text-orange-700">Ожидают ответа</span>
                      </div>
                      <span className="text-2xl font-bold text-orange-600">{waiting}</span>
                    </div>
                    
                    {total - resolved - waiting > 0 && (
                      <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <Activity className="w-5 h-5 text-slate-500" />
                          <span className="font-medium text-slate-700">В работе</span>
                        </div>
                        <span className="text-2xl font-bold text-slate-600">{total - resolved - waiting}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Рекомендация */}
                  {!isOk && (
                    <div className="bg-blue-50 rounded-lg p-3">
                      <div className="font-medium text-blue-700 mb-1">Как достичь {targetSla}%:</div>
                      <ul className="text-sm text-blue-600 space-y-1">
                        <li>• Закрыть {needToResolve} открытых разговоров</li>
                        {waiting > 0 && <li>• Ответить на {waiting} ожидающих сообщений</li>}
                        <li>• Фокус на просроченных обещаниях</li>
                      </ul>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* Leaderboard Modal - Геймификация */}
      {showLeaderboard && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowLeaderboard(false)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <span className="text-2xl">🏆</span>
                Рейтинг сотрудников
              </h2>
              <button onClick={() => setShowLeaderboard(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {(() => {
              // Вычисляем очки агентов
              const agentScores = agents.map(a => {
                const points = 
                  (a.metrics?.messagesHandled || 0) * GAMIFICATION.POINTS.MESSAGE_SENT +
                  (a.metrics?.resolvedConversations || 0) * GAMIFICATION.POINTS.CASE_RESOLVED
                const level = getAgentLevel(points)
                return { ...a, points, level }
              }).sort((a, b) => b.points - a.points)
              
              const currentAgentId = localStorage.getItem('support_agent_id')
              
              return (
                <>
                  {/* Подиум - Топ 3 */}
                  <div className="flex justify-center items-end gap-4 mb-8 px-4">
                    {/* 2 место */}
                    {agentScores[1] && (
                      <div className="flex flex-col items-center">
                        <div className="text-3xl mb-2">🥈</div>
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold ${
                          agentScores[1].status === 'online' ? 'bg-gradient-to-br from-blue-400 to-blue-600' : 'bg-slate-400'
                        }`}>
                          {agentScores[1].name?.split(' ').map(n => n[0]).slice(0, 2).join('') || '?'}
                        </div>
                        <div className="mt-2 text-center">
                          <div className="font-semibold text-sm">{agentScores[1].name?.split(' ')[0]}</div>
                          <div className="text-xs text-slate-500">{agentScores[1].points} очков</div>
                          <div className="text-xs">{agentScores[1].level.icon} {agentScores[1].level.name}</div>
                        </div>
                        <div className="w-20 h-16 bg-gradient-to-t from-slate-300 to-slate-200 rounded-t-lg mt-2" />
                      </div>
                    )}
                    
                    {/* 1 место */}
                    {agentScores[0] && (
                      <div className="flex flex-col items-center">
                        <div className="text-4xl mb-2 animate-bounce">👑</div>
                        <div className={`w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold ring-4 ring-yellow-400 ${
                          agentScores[0].status === 'online' ? 'bg-gradient-to-br from-yellow-400 to-orange-500' : 'bg-slate-400'
                        }`}>
                          {agentScores[0].name?.split(' ').map(n => n[0]).slice(0, 2).join('') || '?'}
                        </div>
                        <div className="mt-2 text-center">
                          <div className="font-bold">{agentScores[0].name?.split(' ')[0]}</div>
                          <div className="text-sm text-yellow-600 font-semibold">{agentScores[0].points} очков</div>
                          <div className="text-sm">{agentScores[0].level.icon} {agentScores[0].level.name}</div>
                        </div>
                        <div className="w-24 h-24 bg-gradient-to-t from-yellow-400 to-yellow-300 rounded-t-lg mt-2" />
                      </div>
                    )}
                    
                    {/* 3 место */}
                    {agentScores[2] && (
                      <div className="flex flex-col items-center">
                        <div className="text-3xl mb-2">🥉</div>
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold ${
                          agentScores[2].status === 'online' ? 'bg-gradient-to-br from-orange-400 to-orange-600' : 'bg-slate-400'
                        }`}>
                          {agentScores[2].name?.split(' ').map(n => n[0]).slice(0, 2).join('') || '?'}
                        </div>
                        <div className="mt-2 text-center">
                          <div className="font-semibold text-sm">{agentScores[2].name?.split(' ')[0]}</div>
                          <div className="text-xs text-slate-500">{agentScores[2].points} очков</div>
                          <div className="text-xs">{agentScores[2].level.icon} {agentScores[2].level.name}</div>
                        </div>
                        <div className="w-20 h-12 bg-gradient-to-t from-orange-300 to-orange-200 rounded-t-lg mt-2" />
                      </div>
                    )}
                  </div>
                  
                  {/* Полный рейтинг */}
                  <div className="space-y-2">
                    {agentScores.map((agent, idx) => {
                      const isCurrentUser = agent.id === currentAgentId
                      const progressToNext = agent.level.nextLevel 
                        ? Math.round(((agent.points - agent.level.minPoints) / (agent.level.nextLevel.minPoints - agent.level.minPoints)) * 100)
                        : 100
                      
                      return (
                        <div 
                          key={agent.id}
                          className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
                            isCurrentUser 
                              ? 'bg-gradient-to-r from-purple-100 to-pink-100 border-2 border-purple-300' 
                              : 'bg-slate-50 hover:bg-slate-100'
                          }`}
                        >
                          {/* Место */}
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                            idx === 0 ? 'bg-yellow-400 text-yellow-900' :
                            idx === 1 ? 'bg-slate-300 text-slate-700' :
                            idx === 2 ? 'bg-orange-300 text-orange-800' :
                            'bg-slate-100 text-slate-500'
                          }`}>
                            {idx + 1}
                          </div>
                          
                          {/* Аватар */}
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-medium ${
                            agent.status === 'online' ? 'bg-green-500' : 'bg-slate-400'
                          }`}>
                            {agent.name?.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?'}
                          </div>
                          
                          {/* Инфо */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">{agent.name}</span>
                              <span className="text-sm">{agent.level.icon}</span>
                              {isCurrentUser && <span className="text-xs bg-purple-200 text-purple-700 px-1.5 rounded">Вы</span>}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span>{agent.level.name}</span>
                              <span>•</span>
                              <span>{agent.metrics?.messagesHandled || 0} сообщ.</span>
                              <span>•</span>
                              <span>{agent.metrics?.resolvedConversations || 0} решено</span>
                            </div>
                            {/* Прогресс до след. уровня */}
                            {agent.level.nextLevel && (
                              <div className="mt-1 flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-gradient-to-r from-purple-400 to-pink-400 rounded-full transition-all"
                                    style={{ width: `${progressToNext}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-slate-400">{agent.level.nextLevel.icon}</span>
                              </div>
                            )}
                          </div>
                          
                          {/* Очки */}
                          <div className="text-right">
                            <div className="font-bold text-lg text-purple-600">{agent.points}</div>
                            <div className="text-[10px] text-slate-400">очков</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  
                  {/* Легенда уровней */}
                  <div className="mt-6 p-4 bg-slate-50 rounded-xl">
                    <div className="text-sm font-medium text-slate-700 mb-3">Уровни</div>
                    <div className="flex flex-wrap gap-3">
                      {GAMIFICATION.LEVELS.map((level, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 text-xs">
                          <span className="text-lg">{level.icon}</span>
                          <span className="text-slate-600">{level.name}</span>
                          <span className="text-slate-400">({level.minPoints}+)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {/* Система очков */}
                  <div className="mt-4 p-4 bg-blue-50 rounded-xl">
                    <div className="text-sm font-medium text-blue-700 mb-3">Как заработать очки</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex justify-between"><span>Ответ на сообщение</span><span className="font-semibold text-blue-600">+{GAMIFICATION.POINTS.MESSAGE_SENT}</span></div>
                      <div className="flex justify-between"><span>Быстрый ответ (&lt;5 мин)</span><span className="font-semibold text-blue-600">+{GAMIFICATION.POINTS.FAST_RESPONSE}</span></div>
                      <div className="flex justify-between"><span>Решённый кейс</span><span className="font-semibold text-blue-600">+{GAMIFICATION.POINTS.CASE_RESOLVED}</span></div>
                      <div className="flex justify-between"><span>SLA выполнен</span><span className="font-semibold text-blue-600">+{GAMIFICATION.POINTS.SLA_MET}</span></div>
                      <div className="flex justify-between"><span>Благодарность клиента</span><span className="font-semibold text-blue-600">+{GAMIFICATION.POINTS.CLIENT_THANKS}</span></div>
                      <div className="flex justify-between"><span>Первый ответ дня</span><span className="font-semibold text-blue-600">+{GAMIFICATION.POINTS.FIRST_OF_DAY}</span></div>
                    </div>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* Leaderboard Modal - Геймификация */}
      {showLeaderboard && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowLeaderboard(false)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-600 to-pink-600 p-6 text-white">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Award className="w-6 h-6" />
                  Рейтинг сотрудников
                </h2>
                <button onClick={() => setShowLeaderboard(false)} className="p-1 hover:bg-white/20 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              {/* Current user stats */}
              {(() => {
                const currentAgentId = localStorage.getItem('support_agent_id')
                const agentScores = agents.map(a => {
                  const points = 
                    (a.metrics?.messagesHandled || 0) * GAMIFICATION.POINTS.MESSAGE_SENT +
                    (a.metrics?.resolvedConversations || 0) * GAMIFICATION.POINTS.CASE_RESOLVED
                  return { ...a, points }
                }).sort((a, b) => b.points - a.points)
                
                const currentAgent = agentScores.find(a => a.id === currentAgentId)
                const currentRank = currentAgent ? agentScores.findIndex(a => a.id === currentAgentId) + 1 : 0
                const level = currentAgent ? getAgentLevel(currentAgent.points) : getAgentLevel(0)
                
                return currentAgent ? (
                  <div className="bg-white/20 rounded-xl p-4">
                    <div className="flex items-center gap-4">
                      <div className="text-4xl">{level.icon}</div>
                      <div className="flex-1">
                        <div className="font-bold text-lg">{currentAgent.name}</div>
                        <div className="text-white/80 text-sm">{level.name} • #{currentRank} в рейтинге</div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold">{currentAgent.points}</div>
                        <div className="text-white/80 text-sm">очков</div>
                      </div>
                    </div>
                    {level.nextLevel && (
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-white/70 mb-1">
                          <span>{level.name}</span>
                          <span>{level.nextLevel.name} ({level.nextLevel.minPoints} очков)</span>
                        </div>
                        <div className="w-full bg-white/30 rounded-full h-2">
                          <div 
                            className="bg-white rounded-full h-2 transition-all"
                            style={{ width: `${level.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ) : null
              })()}
            </div>
            
            {/* Leaderboard list */}
            <div className="p-4 overflow-y-auto max-h-[50vh]">
              <div className="space-y-2">
                {(() => {
                  const agentScores = agents.map(a => {
                    const points = 
                      (a.metrics?.messagesHandled || 0) * GAMIFICATION.POINTS.MESSAGE_SENT +
                      (a.metrics?.resolvedConversations || 0) * GAMIFICATION.POINTS.CASE_RESOLVED
                    return { ...a, points }
                  }).sort((a, b) => b.points - a.points)
                  
                  const currentAgentId = localStorage.getItem('support_agent_id')
                  
                  return agentScores.map((agent, index) => {
                    const level = getAgentLevel(agent.points)
                    const isCurrentUser = agent.id === currentAgentId
                    const rankIcon = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`
                    
                    return (
                      <div 
                        key={agent.id}
                        className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${
                          isCurrentUser 
                            ? 'bg-purple-100 border-2 border-purple-300' 
                            : 'bg-slate-50 hover:bg-slate-100'
                        }`}
                      >
                        {/* Rank */}
                        <div className={`w-10 text-center font-bold ${
                          index < 3 ? 'text-2xl' : 'text-slate-400'
                        }`}>
                          {rankIcon}
                        </div>
                        
                        {/* Avatar */}
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${
                          agent.status === 'online' ? 'bg-green-500' : 
                          agent.status === 'away' ? 'bg-yellow-500' : 'bg-slate-400'
                        }`}>
                          {agent.name?.charAt(0).toUpperCase() || '?'}
                        </div>
                        
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-800 truncate flex items-center gap-2">
                            {agent.name}
                            {isCurrentUser && <span className="text-xs text-purple-600">(Вы)</span>}
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-2">
                            <span>{level.icon} {level.name}</span>
                            <span>•</span>
                            <span>{agent.metrics?.resolvedConversations || 0} решено</span>
                          </div>
                        </div>
                        
                        {/* Points */}
                        <div className="text-right">
                          <div className="font-bold text-lg text-purple-600">{agent.points}</div>
                          <div className="text-xs text-slate-400">очков</div>
                        </div>
                        
                        {/* Status indicator */}
                        <div className={`w-2 h-2 rounded-full ${
                          agent.status === 'online' ? 'bg-green-500' : 
                          agent.status === 'away' ? 'bg-yellow-500' : 'bg-slate-300'
                        }`} />
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
            
            {/* Footer with achievements preview */}
            <div className="border-t p-4 bg-slate-50">
              <div className="text-sm font-medium text-slate-700 mb-2">Достижения</div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {GAMIFICATION.ACHIEVEMENTS.map(achievement => (
                  <div 
                    key={achievement.id}
                    className="flex-shrink-0 px-3 py-2 bg-white rounded-lg border text-center min-w-[80px]"
                    title={achievement.desc}
                  >
                    <div className="text-2xl mb-1">{achievement.icon}</div>
                    <div className="text-[10px] text-slate-600">{achievement.name}</div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-slate-400 mt-2">
                Как начисляются очки: Сообщение +{GAMIFICATION.POINTS.MESSAGE_SENT}, 
                Решённый кейс +{GAMIFICATION.POINTS.CASE_RESOLVED}, 
                Быстрый ответ +{GAMIFICATION.POINTS.FAST_RESPONSE}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard Modal - Геймификация */}
      {showLeaderboard && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowLeaderboard(false)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold flex items-center gap-3">
                <span className="text-2xl">🏆</span>
                Рейтинг сотрудников
              </h2>
              <button onClick={() => setShowLeaderboard(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {(() => {
              // Вычисляем рейтинг
              const agentScores = agents.map(a => {
                const points = 
                  (a.metrics?.messagesHandled || 0) * GAMIFICATION.POINTS.MESSAGE_SENT +
                  (a.metrics?.resolvedConversations || 0) * GAMIFICATION.POINTS.CASE_RESOLVED
                const level = getAgentLevel(points)
                return { ...a, points, level }
              }).sort((a, b) => b.points - a.points)
              
              const currentAgentId = localStorage.getItem('support_agent_id')
              
              return (
                <>
                  {/* Топ-3 подиум */}
                  <div className="flex justify-center items-end gap-4 mb-8">
                    {/* 2-е место */}
                    {agentScores[1] && (
                      <div className="flex flex-col items-center">
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold ${
                          agentScores[1].id === currentAgentId ? 'ring-4 ring-purple-400' : ''
                        } bg-gradient-to-br from-slate-200 to-slate-300`}>
                          {agentScores[1].level.icon}
                        </div>
                        <div className="mt-2 text-center">
                          <div className="text-2xl">🥈</div>
                          <div className="font-medium text-sm truncate max-w-[80px]">{agentScores[1].name?.split(' ')[0]}</div>
                          <div className="text-xs text-slate-500">{agentScores[1].points} очк.</div>
                        </div>
                        <div className="w-16 h-20 bg-gradient-to-t from-slate-200 to-slate-100 rounded-t-lg mt-2"></div>
                      </div>
                    )}
                    
                    {/* 1-е место */}
                    {agentScores[0] && (
                      <div className="flex flex-col items-center -mt-4">
                        <div className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold ${
                          agentScores[0].id === currentAgentId ? 'ring-4 ring-purple-400' : ''
                        } bg-gradient-to-br from-yellow-300 to-yellow-500 shadow-lg`}>
                          {agentScores[0].level.icon}
                        </div>
                        <div className="mt-2 text-center">
                          <div className="text-3xl">👑</div>
                          <div className="font-bold truncate max-w-[100px]">{agentScores[0].name?.split(' ')[0]}</div>
                          <div className="text-sm text-yellow-600 font-medium">{agentScores[0].points} очк.</div>
                        </div>
                        <div className="w-20 h-28 bg-gradient-to-t from-yellow-300 to-yellow-100 rounded-t-lg mt-2"></div>
                      </div>
                    )}
                    
                    {/* 3-е место */}
                    {agentScores[2] && (
                      <div className="flex flex-col items-center">
                        <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold ${
                          agentScores[2].id === currentAgentId ? 'ring-4 ring-purple-400' : ''
                        } bg-gradient-to-br from-orange-200 to-orange-300`}>
                          {agentScores[2].level.icon}
                        </div>
                        <div className="mt-2 text-center">
                          <div className="text-xl">🥉</div>
                          <div className="font-medium text-sm truncate max-w-[70px]">{agentScores[2].name?.split(' ')[0]}</div>
                          <div className="text-xs text-slate-500">{agentScores[2].points} очк.</div>
                        </div>
                        <div className="w-14 h-14 bg-gradient-to-t from-orange-200 to-orange-100 rounded-t-lg mt-2"></div>
                      </div>
                    )}
                  </div>
                  
                  {/* Полная таблица */}
                  <div className="space-y-2">
                    {agentScores.map((agent, index) => {
                      const isCurrentUser = agent.id === currentAgentId
                      const progressToNext = agent.level.nextLevel 
                        ? ((agent.points - agent.level.minPoints) / (agent.level.nextLevel.minPoints - agent.level.minPoints)) * 100
                        : 100
                      
                      return (
                        <div 
                          key={agent.id}
                          className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
                            isCurrentUser 
                              ? 'bg-purple-50 border-2 border-purple-300' 
                              : 'bg-slate-50 hover:bg-slate-100'
                          }`}
                        >
                          {/* Позиция */}
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                            index === 0 ? 'bg-yellow-400 text-yellow-900' :
                            index === 1 ? 'bg-slate-300 text-slate-700' :
                            index === 2 ? 'bg-orange-300 text-orange-800' :
                            'bg-slate-200 text-slate-600'
                          }`}>
                            {index + 1}
                          </div>
                          
                          {/* Аватар с уровнем */}
                          <div className="relative">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                              agent.status === 'online' ? 'bg-green-100' : 'bg-slate-100'
                            }`}>
                              {agent.level.icon}
                            </div>
                            {agent.status === 'online' && (
                              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div>
                            )}
                          </div>
                          
                          {/* Инфо */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`font-medium truncate ${isCurrentUser ? 'text-purple-700' : ''}`}>
                                {agent.name}
                              </span>
                              {isCurrentUser && (
                                <span className="text-[10px] bg-purple-200 text-purple-700 px-1.5 py-0.5 rounded">Вы</span>
                              )}
                              <span className="text-xs text-slate-400">{agent.level.name}</span>
                            </div>
                            {/* Прогресс до след уровня */}
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-gradient-to-r from-purple-400 to-pink-400 rounded-full transition-all"
                                  style={{ width: `${Math.min(100, progressToNext)}%` }}
                                />
                              </div>
                              {agent.level.nextLevel && (
                                <span className="text-[10px] text-slate-400">
                                  {agent.level.nextLevel.minPoints - agent.points} до {agent.level.nextLevel.icon}
                                </span>
                              )}
                            </div>
                          </div>
                          
                          {/* Статистика */}
                          <div className="text-right">
                            <div className="font-bold text-purple-600">{agent.points}</div>
                            <div className="text-[10px] text-slate-400">очков</div>
                          </div>
                          
                          {/* Детальная стата */}
                          <div className="hidden md:flex items-center gap-3 text-xs text-slate-500">
                            <div className="text-center">
                              <div className="font-medium text-slate-700">{agent.metrics?.messagesHandled || 0}</div>
                              <div>сообщ.</div>
                            </div>
                            <div className="text-center">
                              <div className="font-medium text-slate-700">{agent.metrics?.resolvedConversations || 0}</div>
                              <div>решено</div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  
                  {/* Легенда уровней */}
                  <div className="mt-6 pt-4 border-t">
                    <h3 className="text-sm font-medium text-slate-600 mb-3">Уровни</h3>
                    <div className="flex flex-wrap gap-2">
                      {GAMIFICATION.LEVELS.map((level, i) => (
                        <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 rounded-lg text-xs">
                          <span>{level.icon}</span>
                          <span className="font-medium">{level.name}</span>
                          <span className="text-slate-400">{level.minPoints}+</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {/* Очки */}
                  <div className="mt-4">
                    <h3 className="text-sm font-medium text-slate-600 mb-3">Как заработать очки</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                      <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg">
                        <span className="text-blue-500 font-bold">+{GAMIFICATION.POINTS.MESSAGE_SENT}</span>
                        <span>Сообщение</span>
                      </div>
                      <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg">
                        <span className="text-green-500 font-bold">+{GAMIFICATION.POINTS.CASE_RESOLVED}</span>
                        <span>Решён кейс</span>
                      </div>
                      <div className="flex items-center gap-2 p-2 bg-yellow-50 rounded-lg">
                        <span className="text-yellow-600 font-bold">+{GAMIFICATION.POINTS.FAST_RESPONSE}</span>
                        <span>Быстрый ответ</span>
                      </div>
                      <div className="flex items-center gap-2 p-2 bg-purple-50 rounded-lg">
                        <span className="text-purple-500 font-bold">+{GAMIFICATION.POINTS.SLA_MET}</span>
                        <span>SLA выполнен</span>
                      </div>
                      <div className="flex items-center gap-2 p-2 bg-pink-50 rounded-lg">
                        <span className="text-pink-500 font-bold">+{GAMIFICATION.POINTS.CLIENT_THANKS}</span>
                        <span>Благодарность</span>
                      </div>
                      <div className="flex items-center gap-2 p-2 bg-orange-50 rounded-lg">
                        <span className="text-orange-500 font-bold">+{GAMIFICATION.POINTS.FIRST_OF_DAY}</span>
                        <span>Первый дня</span>
                      </div>
                    </div>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* Profile Modal */}
      <ProfileModal 
        show={showProfileModal} 
        onClose={() => setShowProfileModal(false)} 
        setConfirmDialog={setConfirmDialog}
        onLogout={() => {
          localStorage.removeItem('support_agent_token')
          localStorage.removeItem('support_agent_id')
          localStorage.removeItem('support_agent_data')
          navigate('/support/login')
        }}
      />

      {/* Mobile Bottom Navigation - как в Telegram */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40 md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex items-stretch">
          <button
            onClick={() => handleTabChange('messages')}
            className={`flex-1 flex flex-col items-center justify-center py-2 relative ${
              activeTab === 'messages' ? 'text-brand-blue' : 'text-slate-400'
            }`}
          >
            <div className="relative">
              <MessageSquare className="w-6 h-6" />
              {(messagesStats.unread || 0) > 0 && (
                <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {messagesStats.unread > 99 ? '99+' : messagesStats.unread}
                </span>
              )}
            </div>
            <span className="text-[10px] mt-0.5">Чаты</span>
          </button>
          
          <button
            onClick={() => handleTabChange('cases')}
            className={`flex-1 flex flex-col items-center justify-center py-2 relative ${
              activeTab === 'cases' ? 'text-brand-blue' : 'text-slate-400'
            }`}
          >
            <div className="relative">
              <AlertCircle className="w-6 h-6" />
              {(stats.detected || 0) > 0 && (
                <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {stats.detected > 99 ? '99+' : stats.detected}
                </span>
              )}
            </div>
            <span className="text-[10px] mt-0.5">Кейсы</span>
          </button>
          
          <button
            onClick={() => {
              try {
                const agentData = localStorage.getItem('support_agent_data')
                const agent = agentData ? JSON.parse(agentData) : null
                if (agent) {
                  setProfileForm({
                    name: agent.name || '',
                    email: agent.email || '',
                    phone: agent.phone || '',
                    telegram: agent.username || '',
                    position: agent.position || '',
                    department: agent.department || ''
                  })
                  setShowProfileModal(true)
                }
              } catch (e) {
                console.error('Profile parse error:', e)
                setShowProfileModal(true)
              }
            }}
            className="flex-1 flex flex-col items-center justify-center py-2 text-slate-400"
          >
            <Settings className="w-6 h-6" />
            <span className="text-[10px] mt-0.5">Ещё</span>
          </button>
        </div>
      </nav>

      {/* Spacer for mobile nav */}
      <div className="h-14 md:hidden" />

      {/* Кастомный диалог подтверждения */}
      {confirmDialog.show && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-slate-600 mb-5">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog(prev => ({ ...prev, show: false }))}
                className="flex-1 py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm()
                  setConfirmDialog(prev => ({ ...prev, show: false }))
                }}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                  confirmDialog.danger 
                    ? 'bg-red-500 hover:bg-red-600 text-white' 
                    : 'bg-indigo-500 hover:bg-indigo-600 text-white'
                }`}
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Кастомный диалог подтверждения */}
      {confirmDialog.show && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setConfirmDialog(prev => ({ ...prev, show: false }))}>
          <div className="bg-white rounded-xl max-w-sm w-full p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                confirmDialog.danger ? 'bg-red-100' : 'bg-blue-100'
              }`}>
                {confirmDialog.danger ? (
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-blue-600" />
                )}
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">{confirmDialog.title}</h3>
                <p className="text-sm text-slate-600 mt-1">{confirmDialog.message}</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDialog(prev => ({ ...prev, show: false }))}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm()
                  setConfirmDialog(prev => ({ ...prev, show: false }))
                }}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
                  confirmDialog.danger 
                    ? 'bg-red-500 hover:bg-red-600' 
                    : 'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Custom Confirm Dialog */}
      {confirmDialog.show && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={() => setConfirmDialog({ ...confirmDialog, show: false })}>
          <div className="bg-white rounded-xl max-w-sm w-full p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${confirmDialog.danger ? 'bg-red-100' : 'bg-blue-100'}`}>
                <AlertCircle className={`w-5 h-5 ${confirmDialog.danger ? 'text-red-600' : 'text-blue-600'}`} />
              </div>
              <h3 className="text-lg font-semibold text-slate-800">{confirmDialog.title}</h3>
            </div>
            <p className="text-sm text-slate-600 mb-5">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog({ ...confirmDialog, show: false })}
                className="flex-1 py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm()
                  setConfirmDialog({ ...confirmDialog, show: false })
                }}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                  confirmDialog.danger 
                    ? 'bg-red-500 hover:bg-red-600 text-white' 
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                }`}
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Кастомный Confirm Dialog */}
      {confirmDialog.show && (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-slate-600 mb-5">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog(prev => ({ ...prev, show: false }))}
                className="flex-1 py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm()
                  setConfirmDialog(prev => ({ ...prev, show: false }))
                }}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                  confirmDialog.danger 
                    ? 'bg-red-500 hover:bg-red-600 text-white' 
                    : 'bg-indigo-500 hover:bg-indigo-600 text-white'
                }`}
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({ title, value, color }: { title: string; value: string | number; color: 'slate' | 'orange' | 'green' | 'blue' }) {
  const colors = {
    slate: 'text-slate-800',
    orange: 'text-orange-500',
    green: 'text-green-500',
    blue: 'text-blue-500',
  }
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm">
      <div className="text-sm text-slate-500 mb-1">{title}</div>
      <div className={`text-3xl font-bold ${colors[color]}`}>{value}</div>
    </div>
  )
}
