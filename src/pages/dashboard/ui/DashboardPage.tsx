import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { 
  Clock, AlertTriangle, MessageSquare, ChevronRight, TrendingUp, TrendingDown,
  Users, Briefcase, Zap, RefreshCw, Bell, CheckCircle, ArrowUpRight,
  Activity, Target
} from 'lucide-react'
import { Avatar, Badge, EmptyState, LoadingState } from '@/shared/ui'
import { fetchDashboardMetrics, fetchAnalytics, type DashboardMetrics, type AnalyticsData } from '@/shared/api'
import { fetchChannels } from '@/shared/api'
import { fetchAgents } from '@/shared/api'
import type { Channel } from '@/entities/channel'
import type { Agent } from '@/entities/agent'

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
