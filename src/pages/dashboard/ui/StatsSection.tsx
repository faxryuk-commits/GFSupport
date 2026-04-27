import { Link } from 'react-router-dom'
import {
  Clock, MessageSquare, Briefcase, Bell, CheckCircle, Activity, BarChart3, Users,
} from 'lucide-react'
import { Badge } from '@/shared/ui'
import type { AnalyticsData, DashboardMetrics } from '@/shared/api'
import type { RecentActivity, ResponseTimeModalData } from '../model/types'

interface Props {
  analytics: AnalyticsData | null
  metrics: DashboardMetrics | null
  recentActivity: RecentActivity[]
  onResponseTimeClick: (data: ResponseTimeModalData) => void
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

export function StatsSection({ analytics, metrics, recentActivity, onResponseTimeClick }: Props) {
  const resolvedToday = analytics?.cases?.resolved || 0

  return (
    <>
      {/* Section Header */}
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
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5 text-blue-500" />
            <h2 className="font-semibold text-slate-800">Статистика за период</h2>
            <span className="text-xs text-slate-400 ml-2">Основные показатели работы</span>
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
            <CasesPriorityChart analytics={analytics} />
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
              <div className="p-5 text-center text-sm text-slate-500">Нет активности за период</div>
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
                // Цвет берём по техническому ключу bucket, не по индексу — иначе при
                // отсутствии какого-то бакета цвета сдвигаются.
                const bucketColors: Record<string, string> = {
                  '5min': 'bg-green-500',
                  '10min': 'bg-emerald-500',
                  '30min': 'bg-amber-500',
                  '60min': 'bg-orange-500',
                  '60plus': 'bg-red-500',
                }
                const bucketTitles: Record<string, string> = {
                  '5min': 'до 5 минут',
                  '10min': 'до 10 минут',
                  '30min': 'до 30 минут',
                  '60min': 'до 1 часа',
                  '60plus': 'более 1 часа',
                }
                const color = bucketColors[item.bucket] || 'bg-slate-400'
                const label = item.bucketLabel || bucketTitles[item.bucket] || item.bucket
                return (
                  <button key={i}
                    onClick={() => onResponseTimeClick({
                      bucket: item.bucket,
                      bucketLabel: label,
                      count: item.count,
                      avgMinutes: item.avgMinutes,
                      color
                    })}
                    className="text-center p-3 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group">
                    <div className="mb-2">
                      <div className="text-3xl font-bold text-slate-800 group-hover:text-blue-600 transition-colors">{item.count}</div>
                      <div className="text-xs text-slate-500">{percent}%</div>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
                      <div className={`h-full ${color} rounded-full`} style={{ width: `${percent}%` }} />
                    </div>
                    <div className="text-sm font-medium text-slate-700">{label}</div>
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
    </>
  )
}

function CasesPriorityChart({ analytics }: { analytics: AnalyticsData | null }) {
  const byPriority = analytics?.cases?.byPriority || { low: 0, medium: 0, high: 0, urgent: 0 }
  const total = byPriority.low + byPriority.medium + byPriority.high + byPriority.urgent

  if (total === 0) {
    return (
      <div className="p-4 bg-slate-50 rounded-lg">
        <p className="text-xs text-slate-500 mb-2">Кейсы за период</p>
        <p className="text-sm text-slate-400">Нет данных</p>
      </div>
    )
  }

  const priorities = [
    { key: 'urgent', label: 'Срочные', value: byPriority.urgent, color: 'bg-red-500', textColor: 'text-red-600' },
    { key: 'high', label: 'Высокие', value: byPriority.high, color: 'bg-orange-500', textColor: 'text-orange-600' },
    { key: 'medium', label: 'Средние', value: byPriority.medium, color: 'bg-amber-400', textColor: 'text-amber-600' },
    { key: 'low', label: 'Низкие', value: byPriority.low, color: 'bg-green-500', textColor: 'text-green-600' },
  ]

  return (
    <div className="p-4 bg-slate-50 rounded-lg">
      <p className="text-xs text-slate-500 mb-2">Кейсы за период</p>
      <div className="flex gap-3">
        <div className="flex flex-col w-10 h-28 rounded-lg overflow-hidden border border-slate-200">
          {priorities.map(p => {
            if (p.value === 0) return null
            const height = Math.max((p.value / total) * 100, 10)
            return (
              <div key={p.key} className={`${p.color} flex items-center justify-center`}
                style={{ height: `${height}%`, minHeight: p.value > 0 ? '16px' : '0' }}
                title={`${p.label}: ${p.value}`}>
                {p.value > 0 && <span className="text-[10px] font-bold text-white drop-shadow">{p.value}</span>}
              </div>
            )
          })}
        </div>
        <div className="flex flex-col justify-center gap-1 text-[10px]">
          {priorities.map(p => (
            <div key={p.key} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-sm ${p.color}`} />
              <span className={p.textColor}>{p.value}</span>
              <span className="text-slate-400">{p.label}</span>
            </div>
          ))}
          <div className="border-t border-slate-200 pt-1 mt-1 font-medium text-slate-700">{total} всего</div>
        </div>
      </div>
    </div>
  )
}
