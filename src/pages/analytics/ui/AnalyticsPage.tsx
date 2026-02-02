import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import { fetchAnalytics, type AnalyticsData } from '@/shared/api'

const periods = [
  { value: '7d', label: 'Последние 7 дней' },
  { value: '30d', label: 'Последние 30 дней' },
  { value: '90d', label: 'Последние 90 дней' },
]

export function AnalyticsPage() {
  const [period, setPeriod] = useState('7d')
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AnalyticsData | null>(null)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await fetchAnalytics(period)
      setData(result)
    } catch (err) {
      console.error('Ошибка загрузки аналитики:', err)
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    loadData()
  }, [loadData])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-slate-500">Загрузка аналитики...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-8 h-8 text-red-500" />
          <p className="text-slate-700 font-medium">Ошибка загрузки</p>
          <p className="text-slate-500 text-sm">{error}</p>
          <button 
            onClick={loadData}
            className="mt-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Повторить
          </button>
        </div>
      </div>
    )
  }

  const selectedPeriod = periods.find(p => p.value === period)

  // Calculate metrics
  const resolutionRate = data.cases.total > 0 
    ? Math.round((data.cases.resolved / data.cases.total) * 100) 
    : 0

  const metrics: Array<{ label: string; value: string | number; isPercent?: boolean }> = [
    { label: 'Всего обращений', value: data.cases.total },
    { label: 'Среднее время ответа', value: `${Math.round(data.channels.avgFirstResponse)}м` },
    { label: 'Процент решения', value: resolutionRate, isPercent: true },
    { label: 'Срочных', value: data.cases.urgent },
  ]

  // Build chart data from dailyTrend
  const chartData = data.team?.dailyTrend?.map(d => ({
    date: new Date(d.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
    cases: d.cases,
    messages: d.messages,
  })) || []

  // Build category data
  const categoryData = data.patterns?.byCategory 
    ? Object.entries(data.patterns.byCategory).map(([name, value]) => ({ name, value }))
    : []

  const maxCategory = Math.max(...categoryData.map(c => c.value), 1)

  // Build manager data
  const managerData = data.team?.byManager || []

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Аналитика</h1>
          <p className="text-slate-500 mt-0.5">Статистика и отчёты</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <div className="relative">
            <button 
              onClick={() => setIsOpen(!isOpen)}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm hover:bg-slate-50 transition-colors"
            >
              {selectedPeriod?.label}
              <ChevronDown className="w-4 h-4" />
            </button>
            {isOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-10">
                {periods.map(p => (
                  <button
                    key={p.value}
                    onClick={() => { setPeriod(p.value); setIsOpen(false) }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 ${
                      period === p.value ? 'bg-blue-50 text-blue-600' : ''
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4">
        {metrics.map((metric, i) => (
          <div key={i} className="bg-white rounded-xl p-5 border border-slate-200">
            <p className="text-sm text-slate-500 mb-1">{metric.label}</p>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold text-slate-800">
                {metric.value}{metric.isPercent && '%'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Chart */}
        <div className="bg-white rounded-xl p-5 border border-slate-200">
          <h2 className="font-semibold text-slate-800 mb-4">Обращения по дням</h2>
          {chartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-slate-400">
              Нет данных за период
            </div>
          ) : (
            <div className="h-48 flex items-end gap-2">
              {chartData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div 
                    className="w-full bg-blue-500 rounded-t transition-all hover:bg-blue-600"
                    style={{ height: `${Math.max((d.cases / Math.max(...chartData.map(x => x.cases), 1)) * 150, 4)}px` }}
                    title={`${d.cases} обращений`}
                  />
                  <span className="text-[10px] text-slate-400 truncate w-full text-center">{d.date}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Categories */}
        <div className="bg-white rounded-xl p-5 border border-slate-200">
          <h2 className="font-semibold text-slate-800 mb-4">По категориям</h2>
          {categoryData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-slate-400">
              Нет данных
            </div>
          ) : (
            <div className="space-y-3">
              {categoryData.slice(0, 5).map((cat, i) => (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-700">{cat.name}</span>
                    <span className="text-slate-500">{cat.value}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${(cat.value / maxCategory) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Manager stats */}
        <div className="bg-white rounded-xl p-5 border border-slate-200">
          <h2 className="font-semibold text-slate-800 mb-4">По менеджерам</h2>
          {managerData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-slate-400">
              Нет данных
            </div>
          ) : (
            <div className="space-y-3">
              {managerData.slice(0, 5).map((m, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <span className="text-slate-700">{m.name}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-slate-500">{m.resolved} решено</span>
                    <span className="text-sm text-slate-500">{m.avgTime}м сред.</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recurring problems */}
        <div className="bg-white rounded-xl p-5 border border-slate-200">
          <h2 className="font-semibold text-slate-800 mb-4">Частые проблемы</h2>
          {(!data.patterns?.recurringProblems || data.patterns.recurringProblems.length === 0) ? (
            <div className="h-48 flex items-center justify-center text-slate-400">
              Нет данных
            </div>
          ) : (
            <div className="space-y-2">
              {data.patterns.recurringProblems.slice(0, 5).map((p, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <span className="text-slate-700 text-sm">{p.issue}</span>
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{p.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-xl p-5 border border-slate-200">
        <h2 className="font-semibold text-slate-800 mb-4">Сводка</h2>
        <div className="grid grid-cols-3 gap-6">
          <div className="p-4 bg-blue-50 rounded-lg">
            <p className="text-2xl font-bold text-blue-600">{data.messages.total}</p>
            <p className="text-sm text-blue-600/70">Сообщений</p>
          </div>
          <div className="p-4 bg-green-50 rounded-lg">
            <p className="text-2xl font-bold text-green-600">{data.cases.resolved}</p>
            <p className="text-sm text-green-600/70">Решено</p>
          </div>
          <div className="p-4 bg-purple-50 rounded-lg">
            <p className="text-2xl font-bold text-purple-600">{data.channels.active}</p>
            <p className="text-sm text-purple-600/70">Активных каналов</p>
          </div>
        </div>
      </div>
    </div>
  )
}
