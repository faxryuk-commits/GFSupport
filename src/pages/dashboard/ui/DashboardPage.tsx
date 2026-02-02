import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { 
  Clock, AlertTriangle, MessageSquare, ChevronRight, TrendingUp, TrendingDown,
  Users, Briefcase, Zap, RefreshCw, Bell, CheckCircle, ArrowUpRight,
  Activity, Target, BarChart3, Mic, Video, AlertCircle, ChevronDown, ChevronUp
} from 'lucide-react'
import { Avatar, Badge, EmptyState, LoadingState } from '@/shared/ui'
import { fetchDashboardMetrics, fetchAnalytics, type DashboardMetrics, type AnalyticsData } from '@/shared/api'
import { fetchChannels } from '@/shared/api'
import { fetchAgents } from '@/shared/api'
import type { Channel } from '@/entities/channel'
import type { Agent } from '@/entities/agent'
import { ResponseTimeDetailsModal } from '@/pages/analytics/ui/ResponseTimeDetailsModal'

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

  const loadData = useCallback(async () => {
    try {
      setError(null)
      
      const [metricsData, analyticsData, channelsData, agentsData] = await Promise.all([
        fetchDashboardMetrics(),
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
        .slice(0, 5)
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

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Обзор</h1>
          <p className="text-slate-500 mt-0.5">Добро пожаловать! Вот что происходит сегодня.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="today">Сегодня</option>
            <option value="yesterday">Вчера</option>
            <option value="week">Эта неделя</option>
            <option value="month">Этот месяц</option>
          </select>
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

      {/* Metrics */}
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

      <div className="grid grid-cols-3 gap-6">
        {/* Needs Attention */}
        <div className="col-span-2 bg-white rounded-xl border border-slate-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              <h2 className="font-semibold text-slate-800">Требует внимания</h2>
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
              agents.slice(0, 5).map(agent => (
                <div key={agent.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                  <div className="relative">
                    <Avatar name={agent.name} size="sm" />
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${statusColors[agent.status || 'offline']}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{agent.name}</p>
                    <p className="text-xs text-slate-500 capitalize">{agent.status || 'offline'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-slate-800">{agent.metrics?.resolvedConversations || 0}</p>
                    <p className="text-xs text-slate-500">решено</p>
                  </div>
                </div>
              ))
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

      <div className="grid grid-cols-3 gap-6">
        {/* Stats Overview */}
        <div className="col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-500" />
              <h2 className="font-semibold text-slate-800">Статистика за период</h2>
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
            <div className="p-4 bg-amber-50 rounded-lg">
              <p className="text-2xl font-bold text-amber-600">{analytics?.cases?.urgent || 0}</p>
              <p className="text-sm text-amber-600/70">Срочных</p>
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

      {/* Detailed Analytics Toggle */}
      <button
        onClick={() => setShowDetailedAnalytics(!showDetailedAnalytics)}
        className="w-full flex items-center justify-between px-5 py-4 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-500" />
          <span className="font-semibold text-slate-800">Подробная аналитика</span>
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
            <div className="bg-white rounded-xl p-4 border border-slate-200 text-center">
              <AlertTriangle className="w-6 h-6 text-red-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-slate-800">{analytics.cases?.urgent || 0}</p>
              <p className="text-xs text-slate-500">Срочных</p>
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
                <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Нет данных</div>
              ) : (
                <>
                  <div className="h-48 flex items-end gap-1">
                    {analytics.team.dailyTrend.map((d, i) => {
                      const maxVal = Math.max(...analytics.team.dailyTrend!.map(x => x.cases), 1)
                      const height = Math.max((d.cases / maxVal) * 140, 4)
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full flex flex-col gap-0.5">
                            <div 
                              className="w-full bg-blue-500 rounded-t transition-all hover:bg-blue-600"
                              style={{ height: `${height}px` }}
                              title={`${d.cases} создано`}
                            />
                            {d.resolved > 0 && (
                              <div 
                                className="w-full bg-green-400 rounded-b"
                                style={{ height: `${Math.max((d.resolved / maxVal) * 140, 2)}px` }}
                                title={`${d.resolved} решено`}
                              />
                            )}
                          </div>
                          <span className="text-[9px] text-slate-400 truncate w-full text-center">
                            {new Date(d.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex gap-4 mt-3 text-xs">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-500 rounded" /> Создано</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-400 rounded" /> Решено</span>
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
                          <span className="text-slate-700 truncate">{cat.name || 'Без категории'}</span>
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

          {/* Team Metrics Table */}
          {analytics.team?.byManager && analytics.team.byManager.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-500" />
                  Активность команды
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-5 py-3 text-slate-600 font-medium">Сотрудник</th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium">Сообщений</th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium">Каналов</th>
                      <th className="text-center px-3 py-3 text-slate-600 font-medium">Кейсов</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.team.byManager.slice(0, 8).map((m, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <div className="font-medium text-slate-800">{m.name || 'Неизвестный'}</div>
                        </td>
                        <td className="text-center px-3 py-3">
                          <span className="text-lg font-semibold text-blue-600">{m.totalMessages}</span>
                        </td>
                        <td className="text-center px-3 py-3 text-slate-600">{m.channelsServed}</td>
                        <td className="text-center px-3 py-3">
                          {m.totalCases > 0 ? (
                            <span className="text-slate-600">{m.resolved}/{m.totalCases}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-6">
            {/* Recurring Problems */}
            <div className="bg-white rounded-xl p-5 border border-slate-200">
              <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-orange-500" />
                Повторяющиеся проблемы
              </h2>
              {!analytics.patterns?.recurringProblems || analytics.patterns.recurringProblems.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-sm">Нет данных</div>
              ) : (
                <div className="space-y-2">
                  {analytics.patterns.recurringProblems.slice(0, 6).map((p, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                      <span className="text-slate-700 text-sm truncate flex-1">{p.issue}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">{p.affected} комп.</span>
                        <Badge variant="warning" size="sm">{p.count}</Badge>
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
