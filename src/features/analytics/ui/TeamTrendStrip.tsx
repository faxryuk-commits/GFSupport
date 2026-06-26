/**
 * Полоса трендов команды — 4 mini-карточки со sparkline и chip направления
 * (улучшается / стабильно / ухудшается). Без бенчмарков и таблиц — компактно
 * для Pulse, чтобы видеть «куда движемся».
 *
 * Использует тот же endpoint /agent-trend без agentId → team-wide trend.
 * Уважает roles-фильтр (если задан в скоупе страницы).
 */

import { useEffect, useState } from 'react'
import { Loader2, TrendingUp, TrendingDown, Minus, HelpCircle } from 'lucide-react'
import {
  fetchAgentTrend,
  type AgentTrendResponse,
  type TrendDirection,
} from '@/shared/api'

interface TeamTrendStripProps {
  metricKeys: string[]
  source?: string
  roles?: string[] | null
  granularity?: 'weekly' | 'monthly'
  periods?: number
}

export function TeamTrendStrip({
  metricKeys,
  source,
  roles,
  granularity = 'weekly',
  periods = 8,
}: TeamTrendStripProps) {
  const [data, setData] = useState<Record<string, AgentTrendResponse | null>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setData(Object.fromEntries(metricKeys.map((k) => [k, null])))
    Promise.all(
      metricKeys.map((key) =>
        fetchAgentTrend({
          key,
          granularity,
          periods,
          source: source === 'all' ? undefined : source,
          roles: roles && roles.length > 0 ? roles : null,
        })
          .then((r) => ({ key, result: r }))
          .catch(() => ({ key, result: null })),
      ),
    ).then((results) => {
      if (cancelled) return
      const next: Record<string, AgentTrendResponse | null> = {}
      for (const r of results) next[r.key] = r.result
      setData(next)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [metricKeys, source, roles, granularity, periods])

  return (
    <section className="bg-white border border-[#e8edf3] rounded-xl p-4">
      <header className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
            Динамика команды
            <span className="ml-2 text-[10px] text-slate-400 normal-case font-normal">
              — улучшается ли работа из недели в неделю
            </span>
          </h3>
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {metricKeys.map((key) => (
          <TrendMini key={key} metricKey={key} data={data[key]} loading={loading} />
        ))}
      </div>
    </section>
  )
}

interface TrendMiniProps {
  metricKey: string
  data: AgentTrendResponse | null | undefined
  loading: boolean
}

const TREND_STYLES: Record<TrendDirection, { chip: string; label: string; icon: React.ReactNode }> = {
  improving: {
    chip: 'bg-emerald-50 text-emerald-800',
    label: 'улучшается',
    icon: <TrendingUp className="w-3 h-3" />,
  },
  stable: {
    chip: 'bg-slate-100 text-slate-700',
    label: 'стабильно',
    icon: <Minus className="w-3 h-3" />,
  },
  declining: {
    chip: 'bg-rose-50 text-rose-800',
    label: 'ухудшается',
    icon: <TrendingDown className="w-3 h-3" />,
  },
  insufficient_data: {
    chip: 'bg-slate-50 text-slate-500',
    label: 'мало данных',
    icon: <HelpCircle className="w-3 h-3" />,
  },
}

function TrendMini({ data, loading }: TrendMiniProps) {
  if (loading && !data) {
    return (
      <div className="border border-slate-100 rounded-lg p-3 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
        <span className="text-xs text-slate-500">Загрузка…</span>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="border border-slate-100 rounded-lg p-3 text-xs text-slate-500">
        Нет данных
      </div>
    )
  }

  const trendInfo = TREND_STYLES[data.trend]
  const lastValid = [...data.points].reverse().find((p) => p.value !== null)
  return (
    <div className="border border-slate-100 rounded-lg p-3">
      <div className="text-[11px] font-medium text-slate-700 mb-1.5 truncate" title={data.descriptor.labelRu}>
        {data.descriptor.labelRu}
      </div>
      <MiniSparkline
        points={data.points.map((p) => p.value)}
        direction={data.descriptor.direction}
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-sm font-semibold tabular-nums text-slate-900">
          {lastValid && lastValid.value !== null
            ? formatValue(lastValid.value, data.descriptor.unit)
            : '—'}
        </span>
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded ${trendInfo.chip}`}
        >
          {trendInfo.icon}
          {trendInfo.label}
          {data.changePct !== null && data.trend !== 'insufficient_data' && (
            <span className="opacity-80">
              {data.changePct > 0 ? '+' : ''}
              {data.changePct}%
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

function MiniSparkline({
  points,
  direction,
}: {
  points: Array<number | null>
  direction: 'higher_better' | 'lower_better'
}) {
  const W = 140
  const H = 24
  const padding = 2
  const valid = points.map((v) => (v === null || !Number.isFinite(v) ? null : v))
  const nums = valid.filter((v): v is number => v !== null)
  if (nums.length < 2) {
    return <div className="text-[10px] text-slate-400 italic h-[24px]">мало точек</div>
  }
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const span = max - min || 1
  const yMin = min - span * 0.1
  const yMax = max + span * 0.1
  const yScale = (v: number) => H - padding - ((v - yMin) / (yMax - yMin)) * (H - padding * 2)
  const xScale = (i: number) => padding + (i / (points.length - 1)) * (W - padding * 2)

  const pathD = points
    .map((v, i) => {
      if (v === null) return null
      return `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(v)}`
    })
    .filter(Boolean)
    .join(' ')

  const first = nums[0]
  const last = nums[nums.length - 1]
  const dirSign = direction === 'lower_better' ? 1 : -1
  const lineColor =
    Math.abs(last - first) / Math.max(first, 1) < 0.05
      ? '#64748b'
      : (last - first) * dirSign > 0
      ? '#10b981'
      : '#f43f5e'

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth={1.5} />
      {points.map((v, i) =>
        v !== null ? <circle key={i} cx={xScale(i)} cy={yScale(v)} r={1.5} fill={lineColor} /> : null,
      )}
    </svg>
  )
}

function formatValue(v: number, unit: string): string {
  switch (unit) {
    case 'minutes':
      return v < 1 ? `${(v * 60).toFixed(0)}с` : `${v.toFixed(1)} мин`
    case 'percent':
      return `${v.toFixed(1)}%`
    case 'hours':
      return `${v.toFixed(1)} ч`
    case 'seconds':
      return `${v.toFixed(0)} с`
    case 'ratio':
      return v.toFixed(2)
    case 'count':
      return v.toFixed(0)
    default:
      return String(v)
  }
}
