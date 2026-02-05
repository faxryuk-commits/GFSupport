import { useState, useEffect } from 'react'
import { X, TrendingUp, Building2, AlertTriangle, CheckCircle, Clock, BarChart3, MessageSquare, ChevronRight } from 'lucide-react'
import { Modal, Badge, LoadingSpinner } from '@/shared/ui'

interface ProblemDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  category: string
  categoryLabel: string
}

interface ProblemDetails {
  category: string
  period: string
  summary: {
    totalCases: number
    resolved: number
    active: number
    resolutionRate: number
  }
  rootCauses: Array<{
    cause: string
    count: number
    percentage: number
    examples: string[]
  }>
  topChannels: Array<{
    name: string
    count: number
    resolved: number
    resolutionRate: number
    avgResolutionHours: number
  }>
  byPriority: Record<string, number>
  byStatus: Record<string, number>
  dailyTrend: Array<{ date: string; count: number }>
  sampleMessages: Array<{
    text: string
    sender: string
    channel: string
    date: string
  }>
}

const priorityLabels: Record<string, string> = {
  critical: 'Критический',
  urgent: 'Срочный',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий'
}

const priorityColors: Record<string, string> = {
  critical: 'bg-red-500',
  urgent: 'bg-orange-500',
  high: 'bg-yellow-500',
  medium: 'bg-blue-500',
  low: 'bg-slate-400'
}

const statusLabels: Record<string, string> = {
  detected: 'Обнаружено',
  in_progress: 'В работе',
  waiting: 'Ожидание',
  blocked: 'Заблокировано',
  resolved: 'Решено'
}

export function ProblemDetailsModal({ isOpen, onClose, category, categoryLabel }: ProblemDetailsModalProps) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ProblemDetails | null>(null)
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d')

  useEffect(() => {
    if (isOpen && category) {
      loadData()
    }
  }, [isOpen, category, period])

  const loadData = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/support/analytics/problem-details?category=${encodeURIComponent(category)}&period=${period}`)
      const json = await res.json()
      setData(json)
    } catch (e) {
      console.error('Failed to load problem details:', e)
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" size="xl">
      <div className="max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 sticky top-0 bg-white pb-4 border-b">
          <div>
            <h2 className="text-xl font-bold text-slate-800">{categoryLabel}</h2>
            <p className="text-sm text-slate-500 mt-1">Детальный анализ категории проблем</p>
          </div>
          <div className="flex items-center gap-2">
            {(['7d', '30d', '90d'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                  period === p ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {p === '7d' ? '7 дней' : p === '30d' ? '30 дней' : '90 дней'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-20 flex justify-center">
            <LoadingSpinner />
          </div>
        ) : !data || !data.summary ? (
          <div className="py-20 text-center text-slate-500">Нет данных для этой категории</div>
        ) : (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-slate-50 rounded-lg p-4">
                <div className="text-2xl font-bold text-slate-800">{data.summary?.totalCases ?? 0}</div>
                <div className="text-sm text-slate-500">Всего кейсов</div>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <div className="text-2xl font-bold text-green-600">{data.summary?.resolved ?? 0}</div>
                <div className="text-sm text-green-600">Решено</div>
              </div>
              <div className="bg-orange-50 rounded-lg p-4">
                <div className="text-2xl font-bold text-orange-600">{data.summary?.active ?? 0}</div>
                <div className="text-sm text-orange-600">Активных</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-4">
                <div className="text-2xl font-bold text-blue-600">{data.summary?.resolutionRate ?? 0}%</div>
                <div className="text-sm text-blue-600">Решаемость</div>
              </div>
            </div>

            {/* Root Causes */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                Корневые причины
              </h3>
              <div className="space-y-3">
                {(data.rootCauses || []).map((cause, i) => (
                  <div key={i} className="border-b border-slate-100 last:border-0 pb-3 last:pb-0">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-slate-700">{cause.cause}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-500">{cause.percentage}%</span>
                        <Badge variant="warning" size="sm">{cause.count}</Badge>
                      </div>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 mb-2">
                      <div 
                        className="bg-orange-500 h-2 rounded-full transition-all"
                        style={{ width: `${cause.percentage}%` }}
                      />
                    </div>
                    {cause.examples.length > 0 && (
                      <div className="text-xs text-slate-500 space-y-1">
                        {cause.examples.map((ex, j) => (
                          <div key={j} className="truncate">• {ex}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Top Channels */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-500" />
                Топ каналов с этой проблемой
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b">
                      <th className="pb-2 font-medium">Канал</th>
                      <th className="pb-2 font-medium text-right">Кейсов</th>
                      <th className="pb-2 font-medium text-right">Решено</th>
                      <th className="pb-2 font-medium text-right">% решения</th>
                      <th className="pb-2 font-medium text-right">Ср. время</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.topChannels || []).map((ch, i) => (
                      <tr key={i} className="border-b border-slate-50 last:border-0">
                        <td className="py-2 font-medium text-slate-700">{ch.name}</td>
                        <td className="py-2 text-right">{ch.count}</td>
                        <td className="py-2 text-right text-green-600">{ch.resolved}</td>
                        <td className="py-2 text-right">
                          <span className={ch.resolutionRate >= 80 ? 'text-green-600' : ch.resolutionRate >= 50 ? 'text-yellow-600' : 'text-red-600'}>
                            {ch.resolutionRate}%
                          </span>
                        </td>
                        <td className="py-2 text-right text-slate-500">{ch.avgResolutionHours}ч</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Priority & Status Distribution */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-purple-500" />
                  По приоритету
                </h3>
                <div className="space-y-2">
                  {Object.entries(data.byPriority || {}).map(([priority, count]) => {
                    const total = Object.values(data.byPriority || {}).reduce((a, b) => a + b, 0)
                    const pct = total > 0 ? Math.round(count / total * 100) : 0
                    return (
                      <div key={priority} className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${priorityColors[priority] || 'bg-slate-400'}`} />
                        <span className="flex-1 text-sm text-slate-600">{priorityLabels[priority] || priority}</span>
                        <span className="text-sm font-medium">{count}</span>
                        <span className="text-xs text-slate-400 w-10 text-right">{pct}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  По статусу
                </h3>
                <div className="space-y-2">
                  {Object.entries(data.byStatus || {}).map(([status, count]) => {
                    const total = Object.values(data.byStatus || {}).reduce((a, b) => a + b, 0)
                    const pct = total > 0 ? Math.round(count / total * 100) : 0
                    const colors: Record<string, string> = {
                      detected: 'bg-slate-500',
                      in_progress: 'bg-blue-500',
                      waiting: 'bg-yellow-500',
                      blocked: 'bg-red-500',
                      resolved: 'bg-green-500'
                    }
                    return (
                      <div key={status} className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${colors[status] || 'bg-slate-400'}`} />
                        <span className="flex-1 text-sm text-slate-600">{statusLabels[status] || status}</span>
                        <span className="text-sm font-medium">{count}</span>
                        <span className="text-xs text-slate-400 w-10 text-right">{pct}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Daily Trend */}
            {(data.dailyTrend || []).length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-orange-500" />
                  Динамика по дням
                </h3>
                <div className="flex items-end gap-1 h-24">
                  {(data.dailyTrend || []).slice(-30).map((d, i) => {
                    const max = Math.max(...(data.dailyTrend || []).map(x => x.count), 1)
                    const height = (d.count / max) * 100
                    return (
                      <div
                        key={i}
                        className="flex-1 bg-orange-500 rounded-t hover:bg-orange-600 transition-colors cursor-pointer group relative"
                        style={{ height: `${Math.max(height, 4)}%` }}
                        title={`${d.date}: ${d.count}`}
                      >
                        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">
                          {d.date.slice(5)}: {d.count}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Sample Messages */}
            {(data.sampleMessages || []).length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-slate-500" />
                  Примеры обращений
                </h3>
                <div className="space-y-3">
                  {(data.sampleMessages || []).map((msg, i) => (
                    <div key={i} className="bg-slate-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2 text-xs text-slate-500">
                        <span className="font-medium">{msg.sender}</span>
                        <span>•</span>
                        <span>{msg.channel}</span>
                        <span>•</span>
                        <span>{msg.date}</span>
                      </div>
                      <p className="text-sm text-slate-700">{msg.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
