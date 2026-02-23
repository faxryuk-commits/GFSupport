import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { 
  Clock, AlertTriangle, MessageSquare, ChevronRight, TrendingUp, TrendingDown,
  Users, Briefcase, Zap, RefreshCw, Bell, CheckCircle, ArrowUpRight,
  Activity, Target, BarChart3, Mic, Video, AlertCircle, ChevronDown, ChevronUp,
  Lightbulb, Shield, ThumbsUp, ThumbsDown, TrendingDown as TrendDown, XCircle
} from 'lucide-react'
import { Avatar, Badge, EmptyState, LoadingState } from '@/shared/ui'
import { fetchDashboardMetrics, fetchAnalytics, type DashboardMetrics, type AnalyticsData, type SlaCategory, SLA_CATEGORY_CONFIG } from '@/shared/api'
import { fetchChannels } from '@/shared/api'
import { fetchAgents } from '@/shared/api'
import type { Channel } from '@/entities/channel'
import type { Agent } from '@/entities/agent'
import { ResponseTimeDetailsModal } from '@/pages/analytics/ui/ResponseTimeDetailsModal'
import { CommitmentsPanel } from '@/features/commitments/ui'
import { ProblemDetailsModal } from './ProblemDetailsModal'

// AI Рекомендации на основе данных
interface AIRecommendation {
  id: string
  type: 'warning' | 'success' | 'info' | 'action'
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  action?: { label: string; link: string }
}

function generateAIRecommendations(
  analytics: AnalyticsData | null,
  metrics: DashboardMetrics | null,
  agents: Agent[]
): AIRecommendation[] {
  const recommendations: AIRecommendation[] = []
  
  if (!analytics || !metrics) return recommendations

  // 1. Проверка времени ответа
  const avgResponse = analytics.channels?.avgFirstResponse || 0
  if (avgResponse > 30) {
    recommendations.push({
      id: 'response-time',
      type: 'warning',
      title: 'Высокое время ответа',
      description: `Среднее время первого ответа ${avgResponse} минут. Рекомендуется сократить до 15 минут для лучшего клиентского опыта.`,
      priority: 'high',
      action: { label: 'Посмотреть очередь', link: '/chats' }
    })
  } else if (avgResponse > 0 && avgResponse <= 10) {
    recommendations.push({
      id: 'response-time-good',
      type: 'success',
      title: 'Отличное время ответа!',
      description: `Среднее время ответа ${avgResponse} минут - это отличный показатель.`,
      priority: 'low'
    })
  }

  // 2. Проверка срочных кейсов - только ОТКРЫТЫЕ срочные кейсы
  // Используем urgentOpen (открытые срочные), а не urgent (все срочные включая закрытые)
  const urgentOpenCases = analytics.cases?.urgentOpen || 0
  if (urgentOpenCases > 0) {
    recommendations.push({
      id: 'urgent-cases',
      type: 'warning',
      title: `${urgentOpenCases} срочных кейсов`,
      description: 'Есть открытые кейсы требующие немедленного внимания. Приоритизируйте их обработку.',
      priority: 'high',
      action: { label: 'Открыть кейсы', link: '/cases?priority=urgent' }
    })
  }

  // 3. Проверка негативного настроения
  const frustrated = analytics.patterns?.bySentiment?.find(s => s.sentiment === 'frustrated')
  const negative = analytics.patterns?.bySentiment?.find(s => s.sentiment === 'negative')
  const totalNegative = (frustrated?.count || 0) + (negative?.count || 0)
  const totalMessages = analytics.messages?.total || 1
  const negativePercent = (totalNegative / totalMessages) * 100

  if (negativePercent > 15) {
    recommendations.push({
      id: 'negative-sentiment',
      type: 'warning',
      title: 'Повышенный негатив',
      description: `${negativePercent.toFixed(0)}% обращений с негативным настроением. Проанализируйте причины и улучшите качество сервиса.`,
      priority: 'medium'
    })
  }

  // 4. Команда онлайн
  const onlineAgents = agents.filter(a => a.status === 'online').length
  const awayAgents = agents.filter(a => a.status === 'away').length
  const totalAgents = agents.length

  if (totalAgents > 0 && onlineAgents === 0 && metrics.waiting > 0) {
    recommendations.push({
      id: 'no-online',
      type: 'warning',
      title: 'Нет агентов онлайн',
      description: `${metrics.waiting} клиентов ожидают ответа, но все агенты офлайн.`,
      priority: 'high'
    })
  } else if (onlineAgents > 0) {
    recommendations.push({
      id: 'team-online',
      type: 'info',
      title: `${onlineAgents} агентов онлайн`,
      description: awayAgents > 0 ? `Ещё ${awayAgents} отошли ненадолго` : 'Команда готова обрабатывать обращения',
      priority: 'low'
    })
  }

  // 5. Повторяющиеся проблемы
  const topProblem = analytics.patterns?.recurringProblems?.[0]
  if (topProblem && topProblem.count >= 5) {
    recommendations.push({
      id: 'recurring-problem',
      type: 'action',
      title: `Частая проблема: ${topProblem.issue}`,
      description: `${topProblem.count} обращений. Рассмотрите создание FAQ или автоматизацию ответа.`,
      priority: 'medium',
      action: { label: 'Автоматизация', link: '/settings?tab=automations' }
    })
  }

  // 6. SLA
  const sla = metrics.slaPercent || 0
  if (sla < 80) {
    recommendations.push({
      id: 'sla-low',
      type: 'warning',
      title: 'SLA ниже нормы',
      description: `Текущий SLA ${sla}%. Целевой показатель 90%+.`,
      priority: 'high'
    })
  } else if (sla >= 95) {
    recommendations.push({
      id: 'sla-excellent',
      type: 'success',
      title: 'Отличный SLA!',
      description: `${sla}% обращений обработано вовремя.`,
      priority: 'low'
    })
  }

  // Сортируем по приоритету
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  return recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
}

// Перевод категорий на русский
const categoryLabels: Record<string, string> = {
  technical: 'Техническая проблема',
  integration: 'Интеграция',
  general: 'Общие вопросы',
  complaint: 'Жалоба',
  billing: 'Оплата и биллинг',
  feature_request: 'Запрос функции',
  onboarding: 'Подключение',
  question: 'Вопрос',
  feedback: 'Обратная связь',
  order: 'Заказы',
  delivery: 'Доставка',
  payment: 'Платежи',
  menu: 'Меню',
  app: 'Приложение',
  website: 'Сайт',
  pos: 'POS система',
  aggregator: 'Агрегаторы',
}

const getCategoryLabel = (name: string): string => {
  if (!name) return 'Без категории'
  return categoryLabels[name.toLowerCase()] || name
}

interface ResponseTimeModalData {
  bucket: string
  bucketLabel: string
  count: number
  avgMinutes: number
  color: string
}

interface AttentionItem {
  id: string
  name: string
  avatar?: string
  waitTime: string
  issue: string
  priority: 'normal' | 'high' | 'urgent'
  type: 'chat' | 'case'
}

interface RecentActivity {
  id: string
  type: 'message' | 'case_resolved' | 'case_created' | 'assignment'
  title: string
  description: string
  time: string
  user?: string
}

export function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState('today')
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  
  // Data states
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [_channels, setChannels] = useState<Channel[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [needsAttention, setNeedsAttention] = useState<AttentionItem[]>([])
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([])
  const [responseTimeModal, setResponseTimeModal] = useState<ResponseTimeModalData | null>(null)
  const [showDetailedAnalytics, setShowDetailedAnalytics] = useState(true)
  const [problemDetailsModal, setProblemDetailsModal] = useState<{ category: string; label: string } | null>(null)
  const [slaCategoryModal, setSlaCategoryModal] = useState<{ category: string; label: string } | null>(null)
  const [slaCategoryMessages, setSlaCategoryMessages] = useState<any[]>([])
  const [slaCategoryLoading, setSlaCategoryLoading] = useState(false)

  const loadData = useCallback(async () => {
    try {
      setError(null)
      
      const [metricsData, analyticsData, channelsData, agentsData] = await Promise.all([
        fetchDashboardMetrics(dateRange),
        fetchAnalytics(dateRange),
        fetchChannels(),
        fetchAgents()
      ])

      setMetrics(metricsData)
      setAnalytics(analyticsData)
      setChannels(channelsData)
      setAgents(agentsData)

      // Build needs attention from channels awaiting reply
      const attentionItems: AttentionItem[] = channelsData
        .filter(ch => ch.awaitingReply)
        .slice(0, 15)
        .map(ch => ({
          id: ch.id,
          name: ch.name || ch.companyName || `Канал ${ch.id}`,
          waitTime: formatWaitTime(ch.lastMessageAt ?? undefined),
          issue: ch.lastMessageText || 'Ожидает ответа',
          priority: ch.unreadCount > 5 ? 'urgent' : ch.unreadCount > 2 ? 'high' : 'normal',
          type: 'chat' as const
        }))
      setNeedsAttention(attentionItems)

      // Recent activity from analytics
      if (analyticsData.team?.dailyTrend) {
        const activities: RecentActivity[] = []
        // Add some recent activity based on analytics data
        if (analyticsData?.cases?.resolved && analyticsData.cases.resolved > 0) {
          activities.push({
            id: '1',
            type: 'case_resolved',
            title: `${analyticsData.cases.resolved} кейсов решено`,
            description: 'За выбранный период',
            time: 'сегодня'
          })
        }
        if (analyticsData?.messages?.total && analyticsData.messages.total > 0) {
          activities.push({
            id: '2',
            type: 'message',
            title: `${analyticsData.messages.total} сообщений`,
            description: 'Обработано за период',
            time: 'сегодня'
          })
        }
        setRecentActivity(activities)
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err)
      setError('Не удалось загрузить данные')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [dateRange])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleRefresh = () => {
    setIsRefreshing(true)
    loadData()
  }

  const loadSlaCategoryDetails = async (category: string, label: string) => {
    setSlaCategoryModal({ category, label })
    setSlaCategoryLoading(true)
    try {
      const token = localStorage.getItem('support_agent_token')
      const periodParam = dateRange.startsWith('custom:') 
        ? `from=${dateRange.split(':')[1]}&to=${dateRange.split(':')[2]}`
        : `period=${dateRange}`
      const res = await fetch(
        `/api/support/analytics/response-time-details?bucket=all&${periodParam}&sla_category=${encodeURIComponent(category)}&limit=100`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (res.ok) {
        const data = await res.json()
        setSlaCategoryMessages(data.messages || [])
      }
    } catch (e) {
      console.error('Failed to load SLA category details:', e)
    } finally {
      setSlaCategoryLoading(false)
    }
  }

  // Generate AI recommendations - MUST be before any early returns
  const aiRecommendations = useMemo(() => 
    generateAIRecommendations(analytics, metrics, agents),
    [analytics, metrics, agents]
  )

  if (isLoading) {
    return <LoadingState text="Загрузка дашборда..." />
  }

  if (error) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<AlertTriangle className="w-12 h-12 text-red-500" />}
          title="Ошибка загрузки"
          description={error}
          action={{ label: 'Повторить', onClick: loadData }}
        />
      </div>
    )
  }

  const priorityColors = {
    normal: 'bg-slate-100 text-slate-600 border-slate-200',
    high: 'bg-orange-50 text-orange-600 border-orange-200',
    urgent: 'bg-red-50 text-red-600 border-red-200 animate-pulse',
  }

  const activityIcons = {
    message: MessageSquare,
    case_resolved: CheckCircle,
    case_created: Briefcase,
    assignment: Users,
  }

  const activityColors = {
    message: 'bg-blue-100 text-blue-600',
    case_resolved: 'bg-green-100 text-green-600',
    case_created: 'bg-amber-100 text-amber-600',
    assignment: 'bg-purple-100 text-purple-600',
  }

  const statusColors: Record<string, string> = {
    online: 'bg-green-500',
    away: 'bg-amber-500',
    busy: 'bg-red-500',
    offline: 'bg-slate-300',
  }

  const metricsDisplay = [
    { 
      label: 'Ожидают ответа', 
      value: metrics?.waiting || 0, 
      icon: Clock, 
      color: 'blue',
      trend: 'neutral' as const
    },
    { 
      label: 'Среднее время', 
      value: metrics?.avgResponseTime || '-', 
      icon: Zap, 
      color: 'green',
      trend: 'neutral' as const
    },
    { 
      label: 'SLA выполнено', 
      value: `${metrics?.slaPercent || 0}%`, 
      icon: Target, 
      color: 'emerald',
      trend: 'up' as const
    },
    { 
      label: 'Открытых кейсов', 
      value: analytics?.cases?.open || 0, 
      icon: Briefcase, 
      color: 'amber',
      trend: 'neutral' as const
    },
  ]

  // Calculate online agents
  const onlineAgents = agents.filter(a => a.status === 'online' || a.status === 'away')
  const resolvedToday = analytics?.cases?.resolved || 0

  // Icons and colors for recommendations
  const recommendationStyles = {
    warning: { icon: AlertTriangle, bg: 'bg-amber-50', border: 'border-amber-200', iconColor: 'text-amber-600' },
    success: { icon: CheckCircle, bg: 'bg-green-50', border: 'border-green-200', iconColor: 'text-green-600' },
    info: { icon: Lightbulb, bg: 'bg-blue-50', border: 'border-blue-200', iconColor: 'text-blue-600' },
    action: { icon: Zap, bg: 'bg-purple-50', border: 'border-purple-200', iconColor: 'text-purple-600' },
  }

  const handleCustomDateApply = () => {
    if (customDateFrom && customDateTo) {
      setDateRange(`custom:${customDateFrom}:${customDateTo}`)
      setShowDatePicker(false)
    }
  }

  const getDateRangeLabel = () => {
    if (dateRange.startsWith('custom:')) {
      const [, from, to] = dateRange.split(':')
      return `${new Date(from).toLocaleDateString('ru-RU')} - ${new Date(to).toLocaleDateString('ru-RU')}`
    }
    const labels: Record<string, string> = {
      today: 'Сегодня',
      yesterday: 'Вчера',
      week: 'Эта неделя',
      month: 'Этот месяц',
    }
    return labels[dateRange] || dateRange
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Sticky Header with Filters */}
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Обзор</h1>
            <p className="text-slate-500 mt-0.5">Добро пожаловать! Вот что происходит сегодня.</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Period Select */}
            <div className="relative">
              <select
                value={dateRange.startsWith('custom:') ? 'custom' : dateRange}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setShowDatePicker(true)
                  } else {
                    setDateRange(e.target.value)
                    setShowDatePicker(false)
                  }
                }}
                className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[140px]"
              >
                <option value="today">Сегодня</option>
                <option value="yesterday">Вчера</option>
                <option value="week">Эта неделя</option>
                <option value="month">Этот месяц</option>
                <option value="custom">Выбрать даты...</option>
              </select>
              
              {/* Custom Date Picker Dropdown */}
              {showDatePicker && (
                <div className="absolute right-0 top-full mt-2 bg-white border border-slate-200 rounded-xl shadow-lg p-4 z-20 min-w-[280px]">
                  <div className="text-sm font-medium text-slate-700 mb-3">Выберите период</div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">От</label>
                      <input
                        type="date"
                        value={customDateFrom}
                        onChange={(e) => setCustomDateFrom(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">До</label>
                      <input
                        type="date"
                        value={customDateTo}
                        onChange={(e) => setCustomDateTo(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => setShowDatePicker(false)}
                        className="flex-1 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                      >
                        Отмена
                      </button>
                      <button
                        onClick={handleCustomDateApply}
                        disabled={!customDateFrom || !customDateTo}
                        className="flex-1 px-3 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
                      >
                        Применить
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Show selected custom range */}
            {dateRange.startsWith('custom:') && (
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">
                {getDateRangeLabel()}
              </span>
            )}
            
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Обновить
            </button>
          </div>
        </div>
      </div>
      
      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

      {/* AI Recommendations */}
      {aiRecommendations.length > 0 && (
        <div className="bg-gradient-to-r from-slate-50 to-blue-50 rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
              <Lightbulb className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-800">AI Рекомендации</h2>
              <p className="text-xs text-slate-500">На основе анализа данных за период</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {aiRecommendations.slice(0, 4).map(rec => {
              const style = recommendationStyles[rec.type]
              const Icon = style.icon
              return (
                <div 
                  key={rec.id} 
                  className={`${style.bg} ${style.border} border rounded-lg p-3 flex items-start gap-3`}
                >
                  <Icon className={`w-5 h-5 ${style.iconColor} flex-shrink-0 mt-0.5`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800">{rec.title}</p>
                    <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{rec.description}</p>
                    {rec.action && (
                      <Link 
                        to={rec.action.link} 
                        className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                      >
                        {rec.action.label} →
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Quick Stats - Ключевые метрики */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-medium text-slate-600">Ключевые показатели</h3>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {metricsDisplay.map((metric, i) => {
            const Icon = metric.icon
            return (
              <div key={i} className="bg-white rounded-xl p-5 border border-slate-200 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className={`w-10 h-10 rounded-lg bg-${metric.color}-100 flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 text-${metric.color}-600`} />
                  </div>
                  {metric.trend !== 'neutral' && (
                    <div className={`flex items-center gap-1 text-xs font-medium ${
                      metric.trend === 'up' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {metric.trend === 'up' ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    </div>
                  )}
                </div>
                <div className="mt-3">
                  <p className="text-2xl font-bold text-slate-800">{metric.value}</p>
                  <p className="text-sm text-slate-500 mt-0.5">{metric.label}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* SLA Metrics by Category */}
      {analytics?.byCategory && Object.keys(analytics.byCategory).length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-medium text-slate-600">Метрики по типам каналов (SLA)</h3>
            <span className="text-xs text-slate-400">• Приоритет 1 - клиентские каналы</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {(Object.entries(analytics.byCategory) as [SlaCategory, typeof analytics.byCategory[SlaCategory]][]).map(([category, data]) => {
              const config = SLA_CATEGORY_CONFIG[category]
              const isPriority = config.priority === 1
              const colorClasses: Record<string, { bg: string; border: string; text: string; icon: string }> = {
                blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: 'text-blue-500' },
                purple: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', icon: 'text-purple-500' },
                green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', icon: 'text-green-500' },
                slate: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700', icon: 'text-slate-500' },
              }
              const colors = colorClasses[config.color] || colorClasses.slate
              
              return (
                <div 
                  key={category} 
                  className={`${colors.bg} ${colors.border} border-2 rounded-xl p-5 ${isPriority ? 'ring-2 ring-offset-2 ring-blue-200' : ''}`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Target className={`w-5 h-5 ${colors.icon}`} />
                      <h4 className={`font-semibold ${colors.text}`}>{data.label}</h4>
                    </div>
                    {isPriority && (
                      <Badge variant="info" size="sm">Приоритет 1</Badge>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-4 gap-3">
                    <div className="bg-white rounded-lg p-3 text-center">
                      <div className="flex items-center justify-center mb-1">
                        <Clock className="w-4 h-4 text-blue-500" />
                      </div>
                      <p className="text-xl font-bold text-slate-800">{data.channels.waitingReply}</p>
                      <p className="text-xs text-slate-500">Ожидают ответа</p>
                    </div>
                    
                    <button 
                      onClick={() => loadSlaCategoryDetails(category, data.label)}
                      className="bg-white rounded-lg p-3 text-center hover:bg-blue-50 hover:ring-2 hover:ring-blue-200 transition-all cursor-pointer"
                    >
                      <div className="flex items-center justify-center mb-1">
                        <Zap className="w-4 h-4 text-green-500" />
                      </div>
                      <p className="text-xl font-bold text-slate-800">
                        {data.response.avgMinutes > 0 ? `${data.response.avgMinutes}м` : '—'}
                      </p>
                      <p className="text-xs text-slate-500">Среднее время</p>
                    </button>
                    
                    <div className="bg-white rounded-lg p-3 text-center">
                      <div className="flex items-center justify-center mb-1">
                        <Target className="w-4 h-4 text-emerald-500" />
                      </div>
                      <p className={`text-xl font-bold ${data.slaPercent >= 90 ? 'text-green-600' : data.slaPercent >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                        {data.slaPercent}%
                      </p>
                      <p className="text-xs text-slate-500">SLA выполнено</p>
                    </div>
                    
                    <div className="bg-white rounded-lg p-3 text-center">
                      <div className="flex items-center justify-center mb-1">
                        <Briefcase className="w-4 h-4 text-amber-500" />
                      </div>
                      <p className="text-xl font-bold text-slate-800">{data.cases.open}</p>
                      <p className="text-xs text-slate-500">Открытых кейсов</p>
                    </div>
                  </div>
                  
                  {/* Additional stats */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/50 text-xs">
                    <span className="text-slate-600">
                      Всего каналов: <span className="font-semibold">{data.channels.total}</span>
                    </span>
                    <span className="text-slate-600">
                      Непрочитанных: <span className="font-semibold">{data.channels.totalUnread}</span>
                    </span>
                    <span className="text-slate-600">
                      Срочных: <span className="font-semibold text-red-600">{data.cases.urgent}</span>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Section: Операционная деятельность */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-medium text-slate-600">Операционная деятельность</h3>
          <span className="text-xs text-slate-400">• Текущие задачи и команда</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Needs Attention */}
        <div className="col-span-2 bg-white rounded-xl border border-slate-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              <h2 className="font-semibold text-slate-800">Требует внимания</h2>
              <span className="text-xs text-slate-400 ml-2">Диалоги ожидающие ответа</span>
              <Badge variant="warning" size="sm">{needsAttention.length}</Badge>
            </div>
            <Link to="/chats" className="text-sm text-blue-500 hover:underline flex items-center gap-1">
              Все <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {needsAttention.length === 0 ? (
              <EmptyState
                title="Всё обработано!"
                description="Нет диалогов, требующих внимания"
                size="sm"
              />
            ) : (
              needsAttention.map(item => (
                <Link
                  key={item.id}
                  to={`/chats/${item.id}`}
                  className={`flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors border-l-4 ${
                    item.priority === 'urgent' ? 'border-l-red-500 bg-red-50/30' :
                    item.priority === 'high' ? 'border-l-orange-500' :
                    'border-l-transparent'
                  }`}
                >
                  <Avatar name={item.name} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{item.name}</span>
                      <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${priorityColors[item.priority]}`}>
                        <Clock className="w-3 h-3" />
                        {item.waitTime}
                      </span>
                      {item.priority === 'urgent' && (
                        <Badge variant="danger" size="sm">СРОЧНО</Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 truncate mt-0.5">{item.issue}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-400" />
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Team Status */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-500" />
              <h2 className="font-semibold text-slate-800">Команда</h2>
            </div>
            <Link to="/team" className="text-sm text-blue-500 hover:underline flex items-center gap-1">
              Все <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {agents.length === 0 ? (
              <EmptyState
                title="Нет агентов"
                description="Добавьте агентов в команду"
                size="sm"
              />
            ) : (
              // Сортировка: online → away → offline
              [...agents]
                .sort((a, b) => {
                  const order = { online: 0, away: 1, offline: 2 }
                  return (order[a.status || 'offline'] || 2) - (order[b.status || 'offline'] || 2)
                })
                .slice(0, 15)
                .map(agent => {
                  // Расчёт времени онлайн
                  const getOnlineTime = () => {
                    if (agent.status !== 'online' && agent.status !== 'away') return null
                    if (!agent.lastActiveAt) return 'Только что'
                    const diff = Date.now() - new Date(agent.lastActiveAt).getTime()
                    const hours = Math.floor(diff / 3600000)
                    const minutes = Math.floor((diff % 3600000) / 60000)
                    if (hours > 0) return `${hours}ч ${minutes}м онлайн`
                    if (minutes > 0) return `${minutes}м онлайн`
                    return 'Только что'
                  }
                  const onlineTime = getOnlineTime()
                  
                  return (
                    <div key={agent.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                      <div className="relative">
                        <Avatar name={agent.name} size="sm" />
                        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${statusColors[agent.status || 'offline']}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{agent.name}</p>
                        <p className="text-xs text-slate-500">
                          {onlineTime || (agent.status === 'offline' ? 'Офлайн' : agent.status || 'Офлайн')}
                        </p>
                      </div>
                      {/* Статистика агента */}
                      <div className="flex items-center gap-3 text-xs">
                        {/* Отвеченные сообщения */}
                        <div className="text-center" title="Отвечено сообщений">
                          <p className="font-semibold text-blue-600">{agent.metrics?.messagesHandled || 0}</p>
                          <p className="text-slate-400">сообщ.</p>
                        </div>
                        {/* Закрытые тикеты */}
                        <div className="text-center" title="Закрыто тикетов">
                          <p className="font-semibold text-green-600">{agent.metrics?.resolvedConversations || 0}</p>
                          <p className="text-slate-400">закрыто</p>
                        </div>
                        {/* В процессе */}
                        <div className="text-center" title="Тикетов в процессе">
                          <p className="font-semibold text-orange-500">{agent.activeChats || 0}</p>
                          <p className="text-slate-400">в работе</p>
                        </div>
                      </div>
                    </div>
                  )
                })
            )}
          </div>
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-xl">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Онлайн сейчас:</span>
              <span className="font-semibold text-green-600">{onlineAgents.length} из {agents.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Section: Обязательства */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <CommitmentsPanel className="h-full" />
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-orange-500" />
            <h3 className="font-semibold text-slate-800">Напоминания</h3>
          </div>
          <div className="space-y-3">
            <p className="text-sm text-slate-500 text-center py-4">
              Нет активных напоминаний
            </p>
          </div>
        </div>
      </div>

      {/* Section: Статистика и активность */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-medium text-slate-600">Статистика и активность</h3>
          <span className="text-xs text-slate-400">• Обзор показателей за период</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Stats Overview */}
        <div className="col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-500" />
              <h2 className="font-semibold text-slate-800">Статистика за период</h2>
              <span className="text-xs text-slate-400 ml-2">Основные показатели работы</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-blue-50 rounded-lg">
              <p className="text-2xl font-bold text-blue-600">{analytics?.messages?.total || 0}</p>
              <p className="text-sm text-blue-600/70">Сообщений</p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <p className="text-2xl font-bold text-green-600">{resolvedToday}</p>
              <p className="text-sm text-green-600/70">Решено кейсов</p>
            </div>
            {/* Stacked Bar - Cases by Priority */}
            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-xs text-slate-500 mb-2">Кейсы за период</p>
              {(() => {
                const byPriority = analytics?.cases?.byPriority || { low: 0, medium: 0, high: 0, urgent: 0 }
                const total = byPriority.low + byPriority.medium + byPriority.high + byPriority.urgent
                if (total === 0) {
                  return <p className="text-sm text-slate-400">Нет данных</p>
                }
                const priorities = [
                  { key: 'urgent', label: 'Срочные', value: byPriority.urgent, color: 'bg-red-500', textColor: 'text-red-600' },
                  { key: 'high', label: 'Высокие', value: byPriority.high, color: 'bg-orange-500', textColor: 'text-orange-600' },
                  { key: 'medium', label: 'Средние', value: byPriority.medium, color: 'bg-amber-400', textColor: 'text-amber-600' },
                  { key: 'low', label: 'Низкие', value: byPriority.low, color: 'bg-green-500', textColor: 'text-green-600' },
                ]
                return (
                  <div className="flex gap-3">
                    {/* Stacked Bar */}
                    <div className="flex flex-col w-10 h-28 rounded-lg overflow-hidden border border-slate-200">
                      {priorities.map((p) => {
                        if (p.value === 0) return null
                        const height = Math.max((p.value / total) * 100, 10)
                        return (
                          <div
                            key={p.key}
                            className={`${p.color} flex items-center justify-center relative group cursor-pointer transition-all hover:opacity-90`}
                            style={{ height: `${height}%`, minHeight: p.value > 0 ? '16px' : '0' }}
                            title={`${p.label}: ${p.value}`}
                          >
                            {p.value > 0 && (
                              <span className="text-[10px] font-bold text-white drop-shadow">{p.value}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {/* Legend */}
                    <div className="flex flex-col justify-center gap-1 text-[10px]">
                      {priorities.map((p) => (
                        <div key={p.key} className="flex items-center gap-1">
                          <span className={`w-2 h-2 rounded-sm ${p.color}`} />
                          <span className={p.textColor}>{p.value}</span>
                          <span className="text-slate-400">{p.label}</span>
                        </div>
                      ))}
                      <div className="border-t border-slate-200 pt-1 mt-1 font-medium text-slate-700">
                        {total} всего
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
          {analytics?.patterns?.recurringProblems && analytics.patterns.recurringProblems.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-slate-700 mb-2">Частые проблемы</h3>
              <div className="space-y-2">
                {analytics.patterns.recurringProblems.slice(0, 3).map((problem, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{problem.issue}</span>
                    <Badge variant="default" size="sm">{problem.count}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-purple-500" />
              <h2 className="font-semibold text-slate-800">Активность</h2>
            </div>
          </div>
          <div className="divide-y divide-slate-100 max-h-[280px] overflow-y-auto">
            {recentActivity.length === 0 ? (
              <div className="p-5 text-center text-sm text-slate-500">
                Нет активности за период
              </div>
            ) : (
              recentActivity.map(activity => {
                const Icon = activityIcons[activity.type]
                return (
                  <div key={activity.id} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${activityColors[activity.type]}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800">{activity.title}</p>
                      <p className="text-xs text-slate-500 truncate">{activity.description}</p>
                      <span className="text-xs text-slate-400">{activity.time}</span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Response Time Distribution */}
      {analytics?.team?.responseTimeDistribution && analytics.team.responseTimeDistribution.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <Clock className="w-5 h-5 text-green-500" />
              Время первого ответа
            </h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-5 gap-4">
              {analytics.team.responseTimeDistribution.map((item, i) => {
                const total = analytics.team.responseTimeDistribution!.reduce((sum, r) => sum + r.count, 0)
                const percent = total > 0 ? Math.round((item.count / total) * 100) : 0
                const colors = [
                  'bg-green-500',
                  'bg-emerald-500',
                  'bg-amber-500',
                  'bg-orange-500',
                  'bg-red-500',
                ]
                const bucketLabels = [
                  'до 5 минут',
                  'до 10 минут', 
                  'до 30 минут',
                  'до 1 часа',
                  'более 1 часа'
                ]
                return (
                  <button 
                    key={i} 
                    onClick={() => setResponseTimeModal({
                      bucket: item.bucket,
                      bucketLabel: bucketLabels[i] || item.bucket,
                      count: item.count,
                      avgMinutes: item.avgMinutes,
                      color: colors[i] || 'bg-slate-400'
                    })}
                    className="text-center p-3 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
                  >
                    <div className="mb-2">
                      <div className="text-3xl font-bold text-slate-800 group-hover:text-blue-600 transition-colors">{item.count}</div>
                      <div className="text-xs text-slate-500">{percent}%</div>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
                      <div 
                        className={`h-full ${colors[i] || 'bg-slate-400'} rounded-full`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="text-sm font-medium text-slate-700">{item.bucket}</div>
                    <div className="text-xs text-slate-400">
                      сред. {item.avgMinutes > 0 ? `${Math.round(item.avgMinutes)} мин` : '—'}
                    </div>
                    <div className="text-xs text-blue-500 opacity-0 group-hover:opacity-100 mt-1 transition-opacity">
                      Нажмите для деталей →
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Response Time Details Modal */}
      {responseTimeModal && (
        <ResponseTimeDetailsModal
          isOpen={!!responseTimeModal}
          onClose={() => setResponseTimeModal(null)}
          bucket={responseTimeModal.bucket}
          bucketLabel={responseTimeModal.bucketLabel}
          count={responseTimeModal.count}
          avgMinutes={responseTimeModal.avgMinutes}
          period={dateRange === 'today' ? '7d' : dateRange === 'week' ? '7d' : '30d'}
          color={responseTimeModal.color}
        />
      )}

      {/* Section: Detailed Analytics Toggle */}
      <button
        onClick={() => setShowDetailedAnalytics(!showDetailedAnalytics)}
        className="w-full flex items-center justify-between px-5 py-4 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-500" />
          <div className="text-left">
            <span className="font-semibold text-slate-800">Подробная аналитика</span>
            <p className="text-xs text-slate-500">Детальные графики, категории и метрики команды</p>
          </div>
        </div>
        {showDetailedAnalytics ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
      </button>

      {showDetailedAnalytics && analytics && (
        <>
          {/* Analytics Overview Cards */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-5 border border-slate-200">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-600" />
                </div>
                <span className="text-sm text-slate-500">Всего каналов</span>
              </div>
              <p className="text-3xl font-bold text-slate-800">{analytics.channels?.total || 0}</p>
              <p className="text-sm text-green-600 mt-1">{analytics.channels?.active || 0} активных</p>
            </div>

            <div className="bg-white rounded-xl p-5 border border-slate-200">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-purple-600" />
                </div>
                <span className="text-sm text-slate-500">Сообщений</span>
              </div>
              <p className="text-3xl font-bold text-slate-800">{analytics.messages?.total || 0}</p>
              <div className="flex gap-2 mt-1 text-xs">
                {analytics.messages?.voice && analytics.messages.voice > 0 && (
                  <span className="flex items-center gap-1 text-slate-500">
                    <Mic className="w-3 h-3" /> {analytics.messages.voice}
                  </span>
                )}
                {analytics.messages?.video && analytics.messages.video > 0 && (
                  <span className="flex items-center gap-1 text-slate-500">
                    <Video className="w-3 h-3" /> {analytics.messages.video}
                  </span>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl p-5 border border-slate-200">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
                <span className="text-sm text-slate-500">Решено кейсов</span>
              </div>
              <p className="text-3xl font-bold text-slate-800">{analytics.cases?.resolved || 0}/{analytics.cases?.total || 0}</p>
              <p className="text-sm text-green-600 mt-1">
                {analytics.cases?.total ? Math.round((analytics.cases.resolved / analytics.cases.total) * 100) : 0}% решено
              </p>
            </div>

            <div className="bg-white rounded-xl p-5 border border-slate-200">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-orange-600" />
                </div>
                <span className="text-sm text-slate-500">Проблем</span>
              </div>
              <p className="text-3xl font-bold text-slate-800">
                {analytics.messages?.total ? ((analytics.messages.problems / analytics.messages.total) * 100).toFixed(1) : '0'}%
              </p>
              <p className="text-sm text-slate-500 mt-1">{analytics.messages?.problems || 0} сообщений</p>
            </div>
          </div>

          {/* Metrics Row */}
          <div className="grid grid-cols-5 gap-4">
            <div className="bg-white rounded-xl p-4 border border-slate-200 text-center">
              <Briefcase className="w-6 h-6 text-blue-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-slate-800">{analytics.cases?.open || 0}</p>
              <p className="text-xs text-slate-500">Открытых кейсов</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-slate-200">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-5 h-5 text-slate-400" />
                <span className="text-xs text-slate-500">По приоритету</span>
              </div>
              {(() => {
                const bp = analytics.cases?.byPriority || { low: 0, medium: 0, high: 0, urgent: 0 }
                const total = bp.low + bp.medium + bp.high + bp.urgent
                return (
                  <div className="flex items-center gap-1 h-5 rounded overflow-hidden bg-slate-100">
                    {bp.urgent > 0 && <div className="bg-red-500 h-full flex items-center justify-center px-1" style={{width: `${(bp.urgent/total)*100}%`, minWidth: '20px'}}><span className="text-[9px] text-white font-bold">{bp.urgent}</span></div>}
                    {bp.high > 0 && <div className="bg-orange-500 h-full flex items-center justify-center px-1" style={{width: `${(bp.high/total)*100}%`, minWidth: '20px'}}><span className="text-[9px] text-white font-bold">{bp.high}</span></div>}
                    {bp.medium > 0 && <div className="bg-amber-400 h-full flex items-center justify-center px-1" style={{width: `${(bp.medium/total)*100}%`, minWidth: '20px'}}><span className="text-[9px] text-white font-bold">{bp.medium}</span></div>}
                    {bp.low > 0 && <div className="bg-green-500 h-full flex items-center justify-center px-1" style={{width: `${(bp.low/total)*100}%`, minWidth: '20px'}}><span className="text-[9px] text-white font-bold">{bp.low}</span></div>}
                  </div>
                )
              })()}
              <p className="text-lg font-bold text-slate-800 mt-1">{(analytics.cases?.byPriority?.low || 0) + (analytics.cases?.byPriority?.medium || 0) + (analytics.cases?.byPriority?.high || 0) + (analytics.cases?.byPriority?.urgent || 0)}</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-slate-200 text-center">
              <TrendingUp className="w-6 h-6 text-amber-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-slate-800">{analytics.cases?.recurring || 0}</p>
              <p className="text-xs text-slate-500">Повторяющихся</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-slate-200 text-center">
              <Clock className="w-6 h-6 text-green-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-slate-800">{analytics.channels?.avgFirstResponse || '—'}м</p>
              <p className="text-xs text-slate-500">Сред. время ответа</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-slate-200 text-center">
              <CheckCircle className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-slate-800">{analytics.cases?.avgResolutionHours || '—'}ч</p>
              <p className="text-xs text-slate-500">Сред. решение</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Daily Trend Chart */}
            <div className="bg-white rounded-xl p-5 border border-slate-200">
              <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-blue-500" />
                Обращения по дням
              </h2>
              {!analytics.team?.dailyTrend || analytics.team.dailyTrend.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-slate-400 text-sm">Нет данных</div>
              ) : (
                <>
                  <div className="h-44 flex items-end gap-0.5 px-1">
                    {analytics.team.dailyTrend.map((d, i) => {
                      const maxVal = Math.max(...analytics.team.dailyTrend!.map(x => Math.max(x.cases, x.resolved)), 1)
                      const createdHeight = Math.max((d.cases / maxVal) * 100, d.cases > 0 ? 8 : 2)
                      const resolvedHeight = Math.max((d.resolved / maxVal) * 100, d.resolved > 0 ? 6 : 0)
                      const showLabel = d.cases > 0 || d.resolved > 0
                      
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center min-w-0">
                          {/* Число над столбцом */}
                          {showLabel && (
                            <div className="text-[9px] text-slate-600 font-medium mb-0.5 leading-none">
                              {d.cases > 0 ? d.cases : ''}
                            </div>
                          )}
                          {!showLabel && <div className="h-3" />}
                          
                          {/* Столбцы */}
                          <div className="w-full flex flex-col gap-px" style={{ height: `${createdHeight + resolvedHeight}px` }}>
                            {d.cases > 0 && (
                              <div 
                                className="w-full bg-blue-500 rounded-sm transition-all hover:bg-blue-600 cursor-pointer"
                                style={{ height: `${createdHeight}px`, minHeight: '4px' }}
                                title={`${d.cases} создано`}
                              />
                            )}
                            {d.resolved > 0 && (
                              <div 
                                className="w-full bg-green-400 rounded-sm cursor-pointer"
                                style={{ height: `${resolvedHeight}px`, minHeight: '4px' }}
                                title={`${d.resolved} решено`}
                              />
                            )}
                            {d.cases === 0 && d.resolved === 0 && (
                              <div className="w-full bg-slate-200 rounded-sm" style={{ height: '2px' }} />
                            )}
                          </div>
                          
                          {/* Дата */}
                          <span className="text-[8px] text-slate-400 truncate w-full text-center mt-1 leading-none">
                            {new Date(d.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex gap-4 mt-2 text-xs">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-blue-500 rounded-sm" /> Создано</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-green-400 rounded-sm" /> Решено</span>
                  </div>
                </>
              )}
            </div>

            {/* Categories */}
            <div className="bg-white rounded-xl p-5 border border-slate-200">
              <h2 className="font-semibold text-slate-800 mb-4">По категориям</h2>
              {!analytics.patterns?.byCategory || analytics.patterns.byCategory.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Нет данных</div>
              ) : (
                <div className="space-y-3">
                  {analytics.patterns.byCategory.slice(0, 6).map((cat, i) => {
                    const max = Math.max(...analytics.patterns.byCategory.map(c => c.count), 1)
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-slate-700 truncate">{getCategoryLabel(cat.name)}</span>
                          <div className="flex items-center gap-2">
                            {cat.openCount > 0 && (
                              <span className="text-xs text-orange-500">{cat.openCount} откр.</span>
                            )}
                            <span className="text-slate-500 font-medium">{cat.count}</span>
                          </div>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-blue-500 rounded-full transition-all"
                            style={{ width: `${(cat.count / max) * 100}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Top Demanding Channels - Каналы требующие внимания */}
          {analytics.topDemandingChannels && analytics.topDemandingChannels.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-500" />
                  Каналы требующие внимания
                  <span className="text-xs font-normal text-slate-400 ml-2">
                    Топ по нагрузке, проблемам и срочности
                  </span>
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-5 py-3 text-slate-600 font-medium">Канал</th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium">Индекс</th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium">Проблемы</th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium">Негатив</th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium">Срочные</th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium">Кейсы</th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium">Статус</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.topDemandingChannels.slice(0, 10).map((ch, i) => (
                      <tr key={ch.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div 
                              className={`w-2 h-2 rounded-full ${
                                ch.attentionScore >= 30 ? 'bg-red-500' : 
                                ch.attentionScore >= 15 ? 'bg-orange-500' : 'bg-yellow-500'
                              }`}
                            />
                            <span className="font-medium text-slate-800 truncate max-w-[200px]" title={ch.name}>
                              {ch.name}
                            </span>
                          </div>
                        </td>
                        <td className="text-center px-3 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                            ch.attentionScore >= 30 ? 'bg-red-100 text-red-700' : 
                            ch.attentionScore >= 15 ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {ch.attentionScore}
                          </span>
                        </td>
                        <td className="text-center px-3 py-3">
                          {ch.problemCount > 0 ? (
                            <span className="text-red-600 font-medium">{ch.problemCount}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="text-center px-3 py-3">
                          {ch.negativeCount > 0 ? (
                            <span className="text-orange-600 font-medium">{ch.negativeCount}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="text-center px-3 py-3">
                          {ch.urgentCount > 0 ? (
                            <span className="text-amber-600 font-medium">{ch.urgentCount}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="text-center px-3 py-3">
                          {ch.openCases > 0 ? (
                            <span className="text-blue-600 font-medium">{ch.openCases}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="text-center px-3 py-3">
                          <div className="flex items-center justify-center gap-1">
                            {ch.awaitingReply && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-700">
                                Ждёт
                              </span>
                            )}
                            {ch.unreadCount > 0 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                                {ch.unreadCount}
                              </span>
                            )}
                            {!ch.awaitingReply && ch.unreadCount === 0 && (
                              <span className="text-slate-400">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Slowest Clients - Медленно отвечающие клиенты */}
          {analytics.slowestClients && analytics.slowestClients.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-500" />
                  Медленно отвечающие клиенты
                  <span className="text-xs font-normal text-slate-400 ml-2">
                    Для аргументации при претензиях о скорости
                  </span>
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-5 py-3 text-slate-600 font-medium">Канал</th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium">Мы отвечаем</th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium">Клиент отвечает</th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium">Разница</th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium">Ответов</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.slowestClients.slice(0, 10).map((ch) => (
                      <tr key={ch.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-amber-500" />
                            <span className="font-medium text-slate-800 truncate max-w-[200px]" title={ch.name}>
                              {ch.name}
                            </span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              ch.slaCategory === 'partner' ? 'bg-purple-100 text-purple-700' :
                              ch.slaCategory === 'client_integration' ? 'bg-blue-100 text-blue-700' :
                              ch.slaCategory === 'internal' ? 'bg-slate-100 text-slate-700' :
                              'bg-green-100 text-green-700'
                            }`}>
                              {ch.slaCategory === 'partner' ? 'Партнёр' :
                               ch.slaCategory === 'client_integration' ? 'Интеграция' :
                               ch.slaCategory === 'internal' ? 'Внутренний' : 'Клиент'}
                            </span>
                          </div>
                        </td>
                        <td className="text-center px-3 py-3">
                          <span className="text-green-600 font-medium">~{ch.agentAvgFormatted}</span>
                        </td>
                        <td className="text-center px-3 py-3">
                          <span className={`font-medium ${ch.slowerParty === 'client' ? 'text-amber-600' : 'text-slate-600'}`}>
                            ~{ch.clientAvgFormatted}
                          </span>
                        </td>
                        <td className="text-center px-3 py-3">
                          {ch.slowerParty === 'client' ? (
                            <span className="text-amber-600 text-xs">
                              Клиент на {ch.differenceFormatted} медленнее
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="text-center px-3 py-3 text-slate-500 text-xs">
                          {ch.clientResponseCount + ch.agentResponseCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Team Metrics Table */}
          {analytics.team?.byManager && analytics.team.byManager.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200">
              <div className="px-5 py-4 border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-500" />
                    Активность команды
                  </h2>
                  <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">
                    за {analytics.periodDays || 30} дней
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Статистика по сотрудникам на основе отправленных сообщений в каналах поддержки
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-5 py-3 text-slate-600 font-medium">Сотрудник</th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium" title="Количество отправленных сообщений">
                        Отправлено
                      </th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium" title="Уникальных каналов где работал сотрудник">
                        Каналов
                      </th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium" title="Решённых / всего кейсов">
                        Кейсы
                      </th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium" title="Среднее время ответа">
                        Ср. ответ
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.team.byManager.slice(0, 8).map((m, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <div className="font-medium text-slate-800">{m.name || 'Неизвестный'}</div>
                          {m.channelsServed > 10 && (
                            <div className="text-xs text-green-600">Активный</div>
                          )}
                        </td>
                        <td className="text-center px-3 py-3">
                          <span className="text-lg font-semibold text-blue-600">{m.totalMessages}</span>
                          <div className="text-[10px] text-slate-400">сообщ.</div>
                        </td>
                        <td className="text-center px-3 py-3">
                          <span className="text-slate-700 font-medium">{m.channelsServed}</span>
                          <div className="text-[10px] text-slate-400">каналов</div>
                        </td>
                        <td className="text-center px-3 py-3">
                          {m.totalCases > 0 ? (
                            <div>
                              <span className="text-slate-700">{m.resolved}/{m.totalCases}</span>
                              <div className="text-[10px] text-green-600">
                                {Math.round((m.resolved / m.totalCases) * 100)}% решено
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs">нет кейсов</span>
                          )}
                        </td>
                        <td className="text-center px-3 py-3">
                          {m.avgTime && m.avgTime > 0 ? (
                            <span className={`font-medium ${m.avgTime <= 15 ? 'text-green-600' : m.avgTime <= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                              {m.avgTime < 60 ? `${m.avgTime}м` : `${Math.round(m.avgTime / 60)}ч`}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-500 rounded-b-xl">
                Данные собраны из сообщений где сотрудник отвечал клиентам (по telegram ID, username или имени)
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-6">
            {/* Recurring Problems */}
            <div className="bg-white rounded-xl p-5 border border-slate-200">
              <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-orange-500" />
                Повторяющиеся проблемы
                <span className="text-xs text-slate-400 font-normal ml-auto">Кликните для деталей</span>
              </h2>
              {!analytics.patterns?.recurringProblems || analytics.patterns.recurringProblems.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-sm">Нет данных</div>
              ) : (
                <div className="space-y-2">
                  {analytics.patterns.recurringProblems.slice(0, 6).map((p, i) => (
                    <div 
                      key={i} 
                      className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 rounded-lg px-2 -mx-2 transition-colors"
                      onClick={() => setProblemDetailsModal({ category: p.category || p.issue, label: p.issue })}
                    >
                      <span className="text-slate-700 text-sm truncate flex-1">{p.issue}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">{p.affected} комп.</span>
                        <Badge variant="warning" size="sm">{p.count}</Badge>
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sentiment Distribution */}
            <div className="bg-white rounded-xl p-5 border border-slate-200">
              <h2 className="font-semibold text-slate-800 mb-4">Настроение клиентов</h2>
              {!analytics.patterns?.bySentiment || analytics.patterns.bySentiment.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-sm">Нет данных</div>
              ) : (
                <div className="space-y-3">
                  {analytics.patterns.bySentiment.map((s, i) => {
                    const max = Math.max(...analytics.patterns.bySentiment.map(x => x.count), 1)
                    const colors: Record<string, string> = {
                      positive: 'bg-green-500',
                      neutral: 'bg-slate-400',
                      negative: 'bg-red-500',
                      frustrated: 'bg-orange-500',
                    }
                    const labels: Record<string, string> = {
                      positive: 'Позитивное',
                      neutral: 'Нейтральное',
                      negative: 'Негативное',
                      frustrated: 'Разочарование',
                    }
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-slate-700">{labels[s.sentiment] || s.sentiment}</span>
                          <span className="text-slate-500">{s.count}</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${colors[s.sentiment] || 'bg-slate-400'} rounded-full`}
                            style={{ width: `${(s.count / max) * 100}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Problem Details Modal */}
      {problemDetailsModal && (
        <ProblemDetailsModal
          isOpen={!!problemDetailsModal}
          onClose={() => setProblemDetailsModal(null)}
          category={problemDetailsModal.category}
          categoryLabel={problemDetailsModal.label}
        />
      )}

      {/* SLA Category Details Modal */}
      {slaCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSlaCategoryModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h3 className="font-semibold text-lg text-slate-900">
                  {slaCategoryModal.label} — Время ответа
                </h3>
                <p className="text-sm text-slate-500">Сообщения клиентов и время ответа сотрудников</p>
              </div>
              <button onClick={() => setSlaCategoryModal(null)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-auto max-h-[65vh]">
              {slaCategoryLoading ? (
                <div className="flex items-center justify-center py-16">
                  <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                </div>
              ) : slaCategoryMessages.length === 0 ? (
                <div className="text-center py-16 text-slate-500">Нет данных за выбранный период</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 px-4 font-medium text-slate-600">Канал</th>
                      <th className="text-left py-2 px-4 font-medium text-slate-600">Клиент</th>
                      <th className="text-left py-2 px-4 font-medium text-slate-600">Сообщение</th>
                      <th className="text-left py-2 px-4 font-medium text-slate-600">Время</th>
                      <th className="text-center py-2 px-4 font-medium text-slate-600">Ответ</th>
                      <th className="text-left py-2 px-4 font-medium text-slate-600">Ответил</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slaCategoryMessages.map((m: any, i: number) => (
                      <tr key={i} className={`border-b border-slate-100 hover:bg-slate-50 ${!m.respondedAt ? 'bg-red-50' : m.responseMinutes > 10 ? 'bg-yellow-50' : ''}`}>
                        <td className="py-2 px-4 font-medium">{m.channelName}</td>
                        <td className="py-2 px-4">{m.senderName}</td>
                        <td className="py-2 px-4 text-slate-500 max-w-48 truncate">{m.textPreview || '[медиа]'}</td>
                        <td className="py-2 px-4 text-xs text-slate-500">
                          {new Date(m.messageAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2 px-4 text-center">
                          {m.respondedAt ? (
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${m.responseMinutes <= 10 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {Math.round(m.responseMinutes)} мин
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700">Нет ответа</span>
                          )}
                        </td>
                        <td className="py-2 px-4">{m.responderName || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

// Helper function
function formatWaitTime(lastMessageAt?: string): string {
  if (!lastMessageAt) return '-'
  
  const diff = Date.now() - new Date(lastMessageAt).getTime()
  const minutes = Math.floor(diff / 60000)
  
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes}м`
  
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}ч`
  
  return `${Math.floor(hours / 24)}д`
}
