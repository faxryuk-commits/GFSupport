import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  TrendingUp, Clock, CheckCircle2, AlertTriangle, ArrowUpRight, Zap, Users,
} from 'lucide-react'
import { LoadingSpinner } from '@/shared/ui'
import { fetchOnboardingAnalytics } from '@/shared/api/onboarding'
import type { OnboardingAnalytics } from '@/entities/onboarding'

export function OnboardingOverviewPanel() {
  const [data, setData] = useState<OnboardingAnalytics | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const now = new Date()
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
      const result = await fetchOnboardingAnalytics({ from, to })
      setData(result)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-indigo-500" />
          <h2 className="font-semibold text-slate-800">Подключения</h2>
        </div>
        <div className="flex items-center justify-center h-32">
          <LoadingSpinner size="md" />
        </div>
      </div>
    )
  }

  if (!data) return null

  const topBottleneck = data.bottlenecks[0]

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-800">Подключения</h2>
            <p className="text-xs text-slate-500">Текущий месяц</p>
          </div>
        </div>
        <Link to="/onboarding/analytics" className="text-sm text-blue-500 hover:underline flex items-center gap-1">
          Подробнее <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <KPICard icon={TrendingUp} label="Всего" value={data.totalConnections}
          color="bg-blue-100 text-blue-600" />
        <KPICard icon={Clock} label="Ср. время" value={`${data.avgLaunchDays}д`}
          color="bg-amber-100 text-amber-600" />
        <KPICard icon={CheckCircle2} label="Вовремя" value={`${data.onTimePercentage}%`}
          color="bg-green-100 text-green-600" />
        <KPICard icon={AlertTriangle} label="Просрочено" value={data.overdueCount}
          color="bg-red-100 text-red-600" />
      </div>

      {/* Ball distribution mini */}
      <div className="flex items-center gap-4 mb-4">
        <span className="text-xs text-slate-500 w-20">Мяч у:</span>
        <BallBar data={data.ballDistribution} />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Top bottleneck */}
        {topBottleneck && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-amber-600" />
              <span className="text-xs font-medium text-amber-800">Узкое место</span>
            </div>
            <p className="text-sm font-semibold text-slate-800">{topBottleneck.stageName}</p>
            <p className="text-xs text-slate-500">
              {topBottleneck.avgDays}д vs план {topBottleneck.plannedDays}д
              <span className="text-red-600 ml-1">+{topBottleneck.delayPercentage}%</span>
            </p>
          </div>
        )}

        {/* Top agent */}
        {data.agentEfficiency[0] && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-medium text-blue-800">Лучший менеджер</span>
            </div>
            <p className="text-sm font-semibold text-slate-800">{data.agentEfficiency[0].agentName}</p>
            <p className="text-xs text-slate-500">
              {data.agentEfficiency[0].connectionsCount} подкл.,{' '}
              {data.agentEfficiency[0].onTimePercentage}% вовремя
            </p>
          </div>
        )}
      </div>

      {/* Stages mini-bar */}
      {data.byStage.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <p className="text-xs text-slate-500 mb-2">По этапам</p>
          <div className="space-y-1.5">
            {data.byStage.slice(0, 4).map(s => {
              const max = Math.max(...data.byStage.map(st => st.count), 1)
              const pct = Math.round((s.count / max) * 100)
              return (
                <div key={s.name} className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 w-28 truncate">{s.name}</span>
                  <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-medium text-slate-700 w-6 text-right">{s.count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function KPICard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string | number; color: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-center">
      <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center mx-auto mb-1.5`}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-lg font-bold text-slate-800">{value}</p>
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  )
}

function BallBar({ data }: { data: { us: number; client: number; partner: number } }) {
  const total = data.us + data.client + data.partner || 1
  const segments = [
    { label: 'Мы', value: data.us, color: 'bg-blue-500' },
    { label: 'Клиент', value: data.client, color: 'bg-orange-500' },
    { label: 'Партнёр', value: data.partner, color: 'bg-purple-500' },
  ]

  return (
    <div className="flex-1">
      <div className="flex h-5 rounded-full overflow-hidden bg-slate-100">
        {segments.map(s => {
          const pct = (s.value / total) * 100
          if (pct === 0) return null
          return (
            <div key={s.label} className={`${s.color} flex items-center justify-center`}
              style={{ width: `${pct}%`, minWidth: s.value > 0 ? '24px' : 0 }}
              title={`${s.label}: ${s.value}`}>
              <span className="text-[10px] font-bold text-white">{s.value}</span>
            </div>
          )
        })}
      </div>
      <div className="flex gap-3 mt-1">
        {segments.map(s => (
          <span key={s.label} className="flex items-center gap-1 text-[10px] text-slate-500">
            <span className={`w-1.5 h-1.5 rounded-full ${s.color}`} />{s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
