import { Link } from 'react-router-dom'
import {
  Clock, TrendingUp, TrendingDown, Briefcase, Zap, Target, Activity,
} from 'lucide-react'
import { Badge } from '@/shared/ui'
import type { AnalyticsData, DashboardMetrics, SlaCategory } from '@/shared/api'
import { SLA_CATEGORY_CONFIG } from '@/shared/api'

interface Props {
  metrics: DashboardMetrics | null
  analytics: AnalyticsData | null
  onSlaCategoryClick: (category: string, label: string) => void
}

export function MetricsSection({ metrics, analytics, onSlaCategoryClick }: Props) {
  const metricsDisplay = [
    { label: 'Ожидают ответа', value: metrics?.waiting || 0, icon: Clock, color: 'blue', trend: 'neutral' as const },
    { label: 'Среднее время', value: metrics?.avgResponseTime || '-', icon: Zap, color: 'green', trend: 'neutral' as const },
    { label: 'SLA выполнено', value: `${metrics?.slaPercent || 0}%`, icon: Target, color: 'emerald', trend: 'up' as const },
    { label: 'Открытых кейсов', value: analytics?.cases?.open || 0, icon: Briefcase, color: 'amber', trend: 'neutral' as const },
  ]

  return (
    <>
      {/* Key Metrics */}
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

      {/* SLA by Category */}
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
              const colorMap: Record<string, { bg: string; border: string; text: string; icon: string }> = {
                blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: 'text-blue-500' },
                purple: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', icon: 'text-purple-500' },
                green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', icon: 'text-green-500' },
                slate: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700', icon: 'text-slate-500' },
              }
              const colors = colorMap[config.color] || colorMap.slate

              return (
                <div key={category} className={`${colors.bg} ${colors.border} border-2 rounded-xl p-5 ${isPriority ? 'ring-2 ring-offset-2 ring-blue-200' : ''}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Target className={`w-5 h-5 ${colors.icon}`} />
                      <h4 className={`font-semibold ${colors.text}`}>{data.label}</h4>
                    </div>
                    {isPriority && <Badge variant="info" size="sm">Приоритет 1</Badge>}
                  </div>

                  <div className="grid grid-cols-4 gap-3">
                    <div className="bg-white rounded-lg p-3 text-center">
                      <div className="flex items-center justify-center mb-1"><Clock className="w-4 h-4 text-blue-500" /></div>
                      <p className="text-xl font-bold text-slate-800">{data.channels.waitingReply}</p>
                      <p className="text-xs text-slate-500">Ожидают ответа</p>
                    </div>
                    <button onClick={() => onSlaCategoryClick(category, data.label)}
                      className="bg-white rounded-lg p-3 text-center hover:bg-blue-50 hover:ring-2 hover:ring-blue-200 transition-all cursor-pointer">
                      <div className="flex items-center justify-center mb-1"><Zap className="w-4 h-4 text-green-500" /></div>
                      <p className="text-xl font-bold text-slate-800">
                        {data.response.avgMinutes > 0 ? `${data.response.avgMinutes}м` : '—'}
                      </p>
                      <p className="text-xs text-slate-500">Среднее время</p>
                    </button>
                    <div className="bg-white rounded-lg p-3 text-center">
                      <div className="flex items-center justify-center mb-1"><Target className="w-4 h-4 text-emerald-500" /></div>
                      <p className={`text-xl font-bold ${data.slaPercent >= 90 ? 'text-green-600' : data.slaPercent >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                        {data.slaPercent}%
                      </p>
                      <p className="text-xs text-slate-500">SLA выполнено</p>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center">
                      <div className="flex items-center justify-center mb-1"><Briefcase className="w-4 h-4 text-amber-500" /></div>
                      <p className="text-xl font-bold text-slate-800">{data.cases.open}</p>
                      <p className="text-xs text-slate-500">Открытых кейсов</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/50 text-xs">
                    <span className="text-slate-600">Всего каналов: <span className="font-semibold">{data.channels.total}</span></span>
                    <span className="text-slate-600">Непрочитанных: <span className="font-semibold">{data.channels.totalUnread}</span></span>
                    <span className="text-slate-600">Срочных: <span className="font-semibold text-red-600">{data.cases.urgent}</span></span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
