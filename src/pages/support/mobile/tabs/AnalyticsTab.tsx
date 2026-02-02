import { useState, useMemo } from 'react'
import { 
  TrendingUp, TrendingDown, MessageSquare, Briefcase, 
  Clock, CheckCircle, Users, AlertCircle, RefreshCw,
  BarChart3, PieChart, Activity
} from 'lucide-react'
import type { AnalyticsData, SupportChannel, SupportCase } from '../types'

interface AnalyticsTabProps {
  data: AnalyticsData
  channels: SupportChannel[]
  cases: SupportCase[]
  onRefresh: () => void
}

interface MetricCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: React.ReactNode
  trend?: { value: number; isPositive: boolean }
  color?: string
}

function MetricCard({ title, value, subtitle, icon, trend, color = 'bg-white' }: MetricCardProps) {
  return (
    <div className={`${color} rounded-xl p-4 shadow-sm border border-slate-100`}>
      <div className="flex items-start justify-between mb-2">
        <div className="p-2 bg-slate-100 rounded-lg">
          {icon}
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {trend.isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(trend.value)}%
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      <p className="text-sm text-slate-500">{title}</p>
      {subtitle && (
        <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
      )}
    </div>
  )
}

export function AnalyticsTab({ data, channels, cases, onRefresh }: AnalyticsTabProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  
  // Calculate derived metrics
  const metrics = useMemo(() => {
    const openCases = cases.filter(c => c.status === 'open' || c.status === 'in_progress')
    const resolvedToday = cases.filter(c => {
      if (!c.resolvedAt) return false
      const resolved = new Date(c.resolvedAt)
      const today = new Date()
      return resolved.toDateString() === today.toDateString()
    })
    
    const awaitingReply = channels.filter(c => c.awaitingReply)
    const activeChannels = channels.filter(c => c.isActive)
    
    // Calculate average response time
    const avgResponse = data.avgResponseTime || 0
    const avgResponseFormatted = avgResponse < 60 
      ? `${Math.round(avgResponse)} мин` 
      : `${Math.round(avgResponse / 60)} ч`
    
    return {
      totalChannels: channels.length,
      activeChannels: activeChannels.length,
      awaitingReply: awaitingReply.length,
      totalMessages: data.totalMessages || 0,
      todayMessages: data.todayMessages || 0,
      openCases: openCases.length,
      resolvedToday: resolvedToday.length,
      totalCases: cases.length,
      avgResponse: avgResponseFormatted,
      slaCompliance: data.slaCompliance || 0,
    }
  }, [data, channels, cases])
  
  // Handle refresh
  const handleRefresh = async () => {
    setIsRefreshing(true)
    await onRefresh()
    setIsRefreshing(false)
  }
  
  // Status distribution
  const statusDistribution = useMemo(() => {
    const distribution = cases.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    
    return [
      { status: 'open', label: 'Открыт', count: distribution.open || 0, color: 'bg-blue-500' },
      { status: 'in_progress', label: 'В работе', count: distribution.in_progress || 0, color: 'bg-yellow-500' },
      { status: 'waiting', label: 'Ожидание', count: distribution.waiting || 0, color: 'bg-orange-500' },
      { status: 'resolved', label: 'Решён', count: distribution.resolved || 0, color: 'bg-green-500' },
      { status: 'closed', label: 'Закрыт', count: distribution.closed || 0, color: 'bg-slate-400' },
    ].filter(s => s.count > 0)
  }, [cases])
  
  // Priority distribution
  const priorityDistribution = useMemo(() => {
    const distribution = cases.reduce((acc, c) => {
      acc[c.priority] = (acc[c.priority] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    
    return [
      { priority: 'critical', label: 'Критический', count: distribution.critical || 0, color: 'bg-red-500' },
      { priority: 'high', label: 'Высокий', count: distribution.high || 0, color: 'bg-orange-500' },
      { priority: 'medium', label: 'Средний', count: distribution.medium || 0, color: 'bg-yellow-500' },
      { priority: 'low', label: 'Низкий', count: distribution.low || 0, color: 'bg-slate-400' },
    ].filter(p => p.count > 0)
  }, [cases])
  
  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">Аналитика</h2>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-2 text-slate-500 hover:text-slate-700"
        >
          <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      
      {/* Main metrics grid */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          title="Активных каналов"
          value={metrics.activeChannels}
          subtitle={`из ${metrics.totalChannels}`}
          icon={<Users className="w-5 h-5 text-blue-600" />}
        />
        
        <MetricCard
          title="Ждут ответа"
          value={metrics.awaitingReply}
          icon={<Clock className="w-5 h-5 text-orange-600" />}
          color={metrics.awaitingReply > 0 ? 'bg-orange-50' : 'bg-white'}
        />
        
        <MetricCard
          title="Открытых кейсов"
          value={metrics.openCases}
          subtitle={`из ${metrics.totalCases}`}
          icon={<Briefcase className="w-5 h-5 text-purple-600" />}
        />
        
        <MetricCard
          title="Решено сегодня"
          value={metrics.resolvedToday}
          icon={<CheckCircle className="w-5 h-5 text-green-600" />}
        />
        
        <MetricCard
          title="Сообщений сегодня"
          value={metrics.todayMessages}
          subtitle={`всего ${metrics.totalMessages}`}
          icon={<MessageSquare className="w-5 h-5 text-emerald-600" />}
        />
        
        <MetricCard
          title="Среднее время ответа"
          value={metrics.avgResponse}
          icon={<Activity className="w-5 h-5 text-indigo-600" />}
        />
      </div>
      
      {/* SLA Compliance */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-slate-700">SLA Compliance</span>
          <span className={`text-lg font-bold ${metrics.slaCompliance >= 95 ? 'text-green-600' : metrics.slaCompliance >= 80 ? 'text-yellow-600' : 'text-red-600'}`}>
            {metrics.slaCompliance}%
          </span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all ${
              metrics.slaCompliance >= 95 ? 'bg-green-500' : 
              metrics.slaCompliance >= 80 ? 'bg-yellow-500' : 'bg-red-500'
            }`}
            style={{ width: `${metrics.slaCompliance}%` }}
          />
        </div>
        <p className="text-xs text-slate-400 mt-2">Цель: 99%</p>
      </div>
      
      {/* Status distribution */}
      {statusDistribution.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <h3 className="text-sm font-medium text-slate-700 mb-3">Статусы кейсов</h3>
          <div className="space-y-2">
            {statusDistribution.map(item => (
              <div key={item.status} className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${item.color}`} />
                <span className="text-sm text-slate-600 flex-1">{item.label}</span>
                <span className="text-sm font-medium text-slate-800">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Priority distribution */}
      {priorityDistribution.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <h3 className="text-sm font-medium text-slate-700 mb-3">Приоритеты</h3>
          <div className="space-y-2">
            {priorityDistribution.map(item => (
              <div key={item.priority} className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${item.color}`} />
                <span className="text-sm text-slate-600 flex-1">{item.label}</span>
                <span className="text-sm font-medium text-slate-800">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Bottom padding for nav */}
      <div className="h-4" />
    </div>
  )
}

export default AnalyticsTab
