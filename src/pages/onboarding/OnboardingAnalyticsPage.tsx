import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ChevronLeft, ChevronRight, TrendingUp, Clock, CheckCircle2,
  AlertTriangle, Zap, Users,
} from 'lucide-react'
import { useToast, LoadingSpinner } from '@/shared/ui'
import type { OnboardingAnalytics } from '@/entities/onboarding'
import { fetchOnboardingAnalytics } from '@/shared/api/onboarding'

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

function KPICard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-4 flex-1 min-w-[180px]">
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-sm text-slate-500">{label}</span>
      </div>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function HorizontalBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-slate-600 w-36 truncate">{label}</span>
      <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-medium text-slate-700 w-8 text-right">{value}</span>
    </div>
  )
}

function DonutChart({ data }: { data: { us: number; client: number; partner: number } }) {
  const total = data.us + data.client + data.partner || 1
  const segments = [
    { label: 'Мы', value: data.us, color: '#3b82f6' },
    { label: 'Клиент', value: data.client, color: '#f97316' },
    { label: 'Партнёр', value: data.partner, color: '#8b5cf6' },
  ]

  let offset = 0
  const radius = 50
  const circumference = 2 * Math.PI * radius

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 120 120" className="w-32 h-32">
        {segments.map(s => {
          const pct = s.value / total
          const dash = circumference * pct
          const gap = circumference - dash
          const currentOffset = offset
          offset += pct * 360
          return (
            <circle
              key={s.label}
              cx="60" cy="60" r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth="16"
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={-circumference * currentOffset / 360}
              transform="rotate(-90 60 60)"
            />
          )
        })}
      </svg>
      <div className="space-y-2">
        {segments.map(s => (
          <div key={s.label} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-sm text-slate-600">{s.label}</span>
            <span className="text-sm font-medium text-slate-800">
              {s.value} ({Math.round((s.value / total) * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function OnboardingAnalyticsPage() {
  const toast = useToast()

  const [data, setData] = useState<OnboardingAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [year, setYear] = useState(() => new Date().getFullYear())

  const period = useMemo(() => {
    const from = new Date(year, month, 1).toISOString().slice(0, 10)
    const to = new Date(year, month + 1, 0).toISOString().slice(0, 10)
    return { from, to }
  }, [month, year])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const result = await fetchOnboardingAnalytics(period)
      setData(result)
    } catch {
      toast.error('Ошибка', 'Не удалось загрузить аналитику')
    } finally {
      setLoading(false)
    }
  }, [period, toast])

  useEffect(() => { loadData() }, [loadData])

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  const maxByStage = data ? Math.max(...data.byStage.map(s => s.count), 1) : 1

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-6 overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Аналитика</h1>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-slate-100">
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>
          <span className="text-sm font-medium text-slate-700 min-w-[140px] text-center">
            {MONTHS[month]} {year}
          </span>
          <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-slate-100">
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button>
        </div>
      </div>

      {data && (
        <>
          <div className="flex gap-4 mb-6 flex-wrap">
            <KPICard icon={TrendingUp} label="Всего подключений" value={data.totalConnections} color="bg-blue-100 text-blue-600" />
            <KPICard icon={Clock} label="Среднее время" value={`${data.avgLaunchDays} дн.`} color="bg-amber-100 text-amber-600" />
            <KPICard icon={CheckCircle2} label="Вовремя" value={`${data.onTimePercentage}%`} color="bg-green-100 text-green-600" />
            <KPICard icon={AlertTriangle} label="Просрочено" value={data.overdueCount} sub={`Активных: ${data.activeCount}`} color="bg-red-100 text-red-600" />
          </div>

          <div className="grid grid-cols-2 gap-6 mb-6">
            <div className="rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Подключения по этапам</h3>
              <div className="space-y-3">
                {data.byStage.map(s => (
                  <HorizontalBar key={s.name} label={s.name} value={s.count} max={maxByStage} />
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Распределение мяча</h3>
              <DonutChart data={data.ballDistribution} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" /> Узкие места
              </h3>
              <div className="space-y-3">
                {data.bottlenecks.map(b => (
                  <div key={b.stageName} className="flex items-center gap-3 text-sm">
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    <div className="flex-1">
                      <span className="font-medium text-slate-700">{b.stageName}</span>
                      <span className="text-slate-500 ml-2">
                        {b.avgDays} дн. (план {b.plannedDays})
                      </span>
                    </div>
                    <span className="text-red-600 font-medium">+{b.delayPercentage}%</span>
                  </div>
                ))}
                {data.bottlenecks.length === 0 && (
                  <p className="text-sm text-slate-400">Узких мест не обнаружено</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-500" /> Эффективность сотрудников
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-left">
                    <th className="pb-2 font-medium">Сотрудник</th>
                    <th className="pb-2 font-medium text-right">Подкл.</th>
                    <th className="pb-2 font-medium text-right">Ср. дни</th>
                    <th className="pb-2 font-medium text-right">Вовремя</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agentEfficiency.map(a => (
                    <tr key={a.agentId} className="border-t border-slate-100">
                      <td className="py-2 font-medium text-slate-700">{a.agentName}</td>
                      <td className="py-2 text-right text-slate-600">{a.connectionsCount}</td>
                      <td className="py-2 text-right text-slate-600">{a.avgDays}</td>
                      <td className="py-2 text-right">
                        <span className={a.onTimePercentage >= 80 ? 'text-green-600' : 'text-amber-600'}>
                          {a.onTimePercentage}%
                        </span>
                      </td>
                    </tr>
                  ))}
                  {data.agentEfficiency.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-slate-400">Нет данных</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
