import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { 
  Clock, AlertTriangle, MessageSquare, ChevronRight, TrendingUp, TrendingDown,
  Users, Briefcase, Zap, RefreshCw, Bell, CheckCircle, XCircle, ArrowUpRight,
  BarChart3, Activity, Target, Award, Calendar, Filter
} from 'lucide-react'
import { Avatar, Badge, Tabs, TabPanel, EmptyState, LoadingState } from '@/shared/ui'

// Types
interface Metric {
  label: string
  value: string | number
  change?: number
  changeLabel?: string
  icon: typeof Clock
  color: string
  trend?: 'up' | 'down' | 'neutral'
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
  userAvatar?: string
}

interface AgentStatus {
  id: string
  name: string
  avatar?: string
  status: 'online' | 'away' | 'busy' | 'offline'
  activeCases: number
  todayResolved: number
}

// Mock data
const mockMetrics: Metric[] = [
  { label: 'Waiting', value: 7, change: -2, changeLabel: 'vs yesterday', icon: Clock, color: 'blue', trend: 'down' },
  { label: 'Avg Response', value: '4m 32s', change: -15, changeLabel: '15% faster', icon: Zap, color: 'green', trend: 'down' },
  { label: 'SLA Met', value: '98.5%', change: 2.5, changeLabel: 'vs last week', icon: Target, color: 'emerald', trend: 'up' },
  { label: 'Open Cases', value: 23, change: 5, changeLabel: 'new today', icon: Briefcase, color: 'amber', trend: 'up' },
]

const mockNeedsAttention: AttentionItem[] = [
  { id: '1', name: 'Acme Corp', waitTime: '14m', issue: 'Critical API integration failure affecting orders', priority: 'urgent', type: 'chat' },
  { id: '2', name: 'TechSolutions', waitTime: '10m', issue: 'Payment gateway returns error 500', priority: 'high', type: 'case' },
  { id: '3', name: 'Global Finance', waitTime: '8m', issue: 'Unable to access dashboard after update', priority: 'normal', type: 'chat' },
  { id: '4', name: 'StartupXYZ', waitTime: '5m', issue: 'Feature request for bulk export', priority: 'normal', type: 'chat' },
]

const mockRecentActivity: RecentActivity[] = [
  { id: '1', type: 'case_resolved', title: 'Case #1234 Resolved', description: 'Payment issue for Enterprise Inc', time: '2m ago', user: 'Sarah J.' },
  { id: '2', type: 'message', title: 'New message from VIP', description: 'Acme Corp sent a new message', time: '5m ago' },
  { id: '3', type: 'assignment', title: 'Case assigned', description: 'Case #1235 assigned to Mike Chen', time: '12m ago', user: 'System' },
  { id: '4', type: 'case_created', title: 'New case created', description: 'High priority issue from TechCorp', time: '18m ago' },
  { id: '5', type: 'case_resolved', title: 'Case #1233 Resolved', description: 'Login issue for Local Café', time: '25m ago', user: 'Emily P.' },
]

const mockAgentStatuses: AgentStatus[] = [
  { id: '1', name: 'Sarah Jenkins', status: 'online', activeCases: 5, todayResolved: 12 },
  { id: '2', name: 'Mike Chen', status: 'busy', activeCases: 8, todayResolved: 8 },
  { id: '3', name: 'Emily Patel', status: 'online', activeCases: 3, todayResolved: 15 },
  { id: '4', name: 'David Lee', status: 'away', activeCases: 2, todayResolved: 6 },
  { id: '5', name: 'Jessica Kim', status: 'offline', activeCases: 0, todayResolved: 10 },
]

const hourlyData = [
  { hour: '8AM', messages: 12, cases: 2 },
  { hour: '9AM', messages: 28, cases: 5 },
  { hour: '10AM', messages: 45, cases: 8 },
  { hour: '11AM', messages: 38, cases: 6 },
  { hour: '12PM', messages: 22, cases: 3 },
  { hour: '1PM', messages: 35, cases: 7 },
  { hour: '2PM', messages: 52, cases: 9 },
  { hour: '3PM', messages: 48, cases: 8 },
  { hour: '4PM', messages: 40, cases: 6 },
  { hour: '5PM', messages: 25, cases: 4 },
]

export function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [dateRange, setDateRange] = useState('today')
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1000)
    return () => clearTimeout(timer)
  }, [])

  const handleRefresh = () => {
    setIsRefreshing(true)
    setTimeout(() => setIsRefreshing(false), 1500)
  }

  if (isLoading) {
    return <LoadingState text="Loading dashboard..." />
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

  const statusColors = {
    online: 'bg-green-500',
    away: 'bg-amber-500',
    busy: 'bg-red-500',
    offline: 'bg-slate-300',
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-slate-500 mt-0.5">Welcome back! Here's what's happening today.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4">
        {mockMetrics.map((metric, i) => {
          const Icon = metric.icon
          return (
            <div key={i} className="bg-white rounded-xl p-5 border border-slate-200 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className={`w-10 h-10 rounded-lg bg-${metric.color}-100 flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 text-${metric.color}-600`} />
                </div>
                {metric.change !== undefined && (
                  <div className={`flex items-center gap-1 text-xs font-medium ${
                    metric.trend === 'up' ? (metric.label === 'Open Cases' ? 'text-amber-600' : 'text-green-600') :
                    metric.trend === 'down' ? (metric.label === 'Waiting' || metric.label === 'Avg Response' ? 'text-green-600' : 'text-red-600') :
                    'text-slate-500'
                  }`}>
                    {metric.trend === 'up' ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    {Math.abs(metric.change)}%
                  </div>
                )}
              </div>
              <div className="mt-3">
                <p className="text-2xl font-bold text-slate-800">{metric.value}</p>
                <p className="text-sm text-slate-500 mt-0.5">{metric.label}</p>
                {metric.changeLabel && (
                  <p className="text-xs text-slate-400 mt-1">{metric.changeLabel}</p>
                )}
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
              <h2 className="font-semibold text-slate-800">Needs Attention</h2>
              <Badge variant="warning" size="sm">{mockNeedsAttention.length}</Badge>
            </div>
            <Link to="/chats" className="text-sm text-blue-500 hover:underline flex items-center gap-1">
              View all <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {mockNeedsAttention.length === 0 ? (
              <EmptyState
                title="All caught up!"
                description="No items need your attention right now"
                size="sm"
              />
            ) : (
              mockNeedsAttention.map(item => (
                <Link
                  key={item.id}
                  to={item.type === 'chat' ? `/chats/${item.id}` : `/cases/${item.id}`}
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
                        {item.waitTime} wait
                      </span>
                      {item.priority === 'urgent' && (
                        <Badge variant="danger" size="sm">URGENT</Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 truncate mt-0.5">{item.issue}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={item.type === 'chat' ? 'primary' : 'default'} size="sm">
                      {item.type === 'chat' ? 'Chat' : 'Case'}
                    </Badge>
                    <ChevronRight className="w-5 h-5 text-slate-400" />
                  </div>
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
              <h2 className="font-semibold text-slate-800">Team Status</h2>
            </div>
            <Link to="/team" className="text-sm text-blue-500 hover:underline flex items-center gap-1">
              Manage <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {mockAgentStatuses.map(agent => (
              <div key={agent.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                <div className="relative">
                  <Avatar name={agent.name} size="sm" />
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${statusColors[agent.status]}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{agent.name}</p>
                  <p className="text-xs text-slate-500 capitalize">{agent.status}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-slate-800">{agent.activeCases}</p>
                  <p className="text-xs text-slate-500">active</p>
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-xl">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Today's resolved:</span>
              <span className="font-semibold text-green-600">
                {mockAgentStatuses.reduce((sum, a) => sum + a.todayResolved, 0)} cases
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Activity Chart */}
        <div className="col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-500" />
              <h2 className="font-semibold text-slate-800">Today's Activity</h2>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-blue-500" />
                Messages
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-emerald-500" />
                Cases
              </span>
            </div>
          </div>
          <div className="h-48 flex items-end gap-2">
            {hourlyData.map((data, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col gap-0.5">
                  <div 
                    className="w-full bg-blue-500 rounded-t transition-all hover:bg-blue-600"
                    style={{ height: `${(data.messages / 60) * 120}px` }}
                    title={`${data.messages} messages`}
                  />
                  <div 
                    className="w-full bg-emerald-500 rounded-b transition-all hover:bg-emerald-600"
                    style={{ height: `${(data.cases / 10) * 40}px` }}
                    title={`${data.cases} cases`}
                  />
                </div>
                <span className="text-[10px] text-slate-400">{data.hour}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-purple-500" />
              <h2 className="font-semibold text-slate-800">Recent Activity</h2>
            </div>
          </div>
          <div className="divide-y divide-slate-100 max-h-[280px] overflow-y-auto">
            {mockRecentActivity.map(activity => {
              const Icon = activityIcons[activity.type]
              return (
                <div key={activity.id} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${activityColors[activity.type]}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800">{activity.title}</p>
                    <p className="text-xs text-slate-500 truncate">{activity.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-400">{activity.time}</span>
                      {activity.user && (
                        <>
                          <span className="text-xs text-slate-300">•</span>
                          <span className="text-xs text-slate-500">{activity.user}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
