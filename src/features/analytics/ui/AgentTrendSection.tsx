/**
 * Динамика per-agent метрики по неделям/месяцам.
 *
 * Используется в Agent360Modal — показывает «улучшается / стабильно / ухудшается»
 * на основе сравнения первой и второй половины окон.
 */

import { useEffect, useState } from 'react'
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  HelpCircle,
  ChevronDown,
} from 'lucide-react'
import {
  fetchAgentTrend,
  type AgentTrendResponse,
  type TrendDirection,
  type TrendGranularity,
  type TrendPoint,
  type MetricStatus,
} from '@/shared/api'

interface AgentTrendSectionProps {
  agentId: string
  /** Какие метрики показать (default: FRT + SLA). */
  metricKeys?: string[]
  source?: 'all' | 'telegram' | 'whatsapp'
}

const DEFAULT_METRICS = ['frt_avg_minutes', 'sla_compliance_rate']

export function AgentTrendSection({
  agentId,
  metricKeys = DEFAULT_METRICS,
  source,
}: AgentTrendSectionProps) {
  const [granularity, setGranularity] = useState<TrendGranularity>('weekly')

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4">
      <header className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-800">Динамика по периодам</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Сравнение первой и второй половины окон даёт направление: улучшается / стабильно / ухудшается.
          </p>
        </div>
        <div className="flex bg-slate-100 rounded-md p-0.5 text-xs">
          <button
            onClick={() => setGranularity('weekly')}
            className={`px-3 py-1 rounded ${
              granularity === 'weekly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            8 недель
          </button>
          <button
            onClick={() => setGranularity('monthly')}
            className={`px-3 py-1 rounded ${
              granularity === 'monthly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            6 месяцев
          </button>
        </div>
      </header>

      <div className="space-y-3">
        {metricKeys.map((key) => (
          <TrendRow
            key={`${key}-${granularity}`}
            agentId={agentId}
            metricKey={key}
            granularity={granularity}
            periods={granularity === 'weekly' ? 8 : 6}
            source={source}
          />
        ))}
      </div>
    </section>
  )
}

interface TrendRowProps {
  agentId: string
  metricKey: string
  granularity: TrendGranularity
  periods: number
  source?: string
}

function TrendRow({ agentId, metricKey, granularity, periods, source }: TrendRowProps) {
  const [data, setData] = useState<AgentTrendResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchAgentTrend({
      agentId,
      key: metricKey,
      granularity,
      periods,
      source: source === 'all' ? undefined : source,
    })
      .then((r) => {
        if (!cancelled) setData(r)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [agentId, metricKey, granularity, periods, source])

  if (loading) {
    return (
      <div className="border border-slate-100 rounded-lg p-3 flex items-center gap-3">
        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
        <span className="text-sm text-slate-500">Загрузка тренда…</span>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="border border-slate-100 rounded-lg p-3 text-sm text-slate-500">
        Не удалось загрузить тренд для {metricKey}
      </div>
    )
  }

  const lastValue = [...data.points].reverse().find((p) => p.value !== null)
  const trendInfo = TREND_INFO[data.trend]

  return (
    <div className="border border-slate-100 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full p-3 flex items-center gap-3 hover:bg-slate-50 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-sm font-medium text-slate-800">{data.descriptor.labelRu}</span>
            <span className="text-[10px] text-slate-400 font-mono">{data.descriptor.key}</span>
          </div>
          <Sparkline
            points={data.points}
            unit={data.descriptor.unit}
            benchmarks={data.benchmarks}
            direction={data.descriptor.direction}
          />
        </div>

        <div className="flex flex-col items-end gap-1 min-w-[140px]">
          {lastValue && lastValue.value !== null ? (
            <div className="text-lg font-semibold tabular-nums text-slate-900">
              {formatValue(lastValue.value, data.descriptor.unit)}
            </div>
          ) : (
            <div className="text-lg text-slate-400">—</div>
          )}
          <div
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded ${trendInfo.chip}`}
          >
            {trendInfo.icon}
            {trendInfo.label}
            {data.changePct !== null && data.trend !== 'insufficient_data' && (
              <span className="opacity-80">
                ({data.changePct > 0 ? '+' : ''}
                {data.changePct}%)
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50 p-3">
          <table className="w-full text-xs">
            <thead className="text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="text-left py-1">Период</th>
                <th className="text-right py-1">Значение</th>
                <th className="text-right py-1">Сессий</th>
                <th className="text-center py-1">vs. бенчмарк</th>
              </tr>
            </thead>
            <tbody>
              {data.points.map((p) => (
                <tr key={p.periodStart}>
                  <td className="py-1 text-slate-700">{p.label}</td>
                  <td className="py-1 text-right tabular-nums">
                    {p.value !== null ? formatValue(p.value, data.descriptor.unit) : '—'}
                  </td>
                  <td className="py-1 text-right tabular-nums text-slate-500">{p.sampleSize}</td>
                  <td className="py-1 text-center">
                    <StatusDot status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.benchmarks && (
            <div className="mt-2 pt-2 border-t border-slate-200 flex flex-wrap gap-3 text-[10px] text-slate-500">
              <span>Цели:</span>
              {data.benchmarks.bronze && (
                <span>🥉 {formatValue(data.benchmarks.bronze.value, data.descriptor.unit)}</span>
              )}
              {data.benchmarks.silver && (
                <span>🥈 {formatValue(data.benchmarks.silver.value, data.descriptor.unit)}</span>
              )}
              {data.benchmarks.gold && (
                <span>🥇 {formatValue(data.benchmarks.gold.value, data.descriptor.unit)}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const TREND_INFO: Record<TrendDirection, { chip: string; label: string; icon: React.ReactNode }> = {
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

const STATUS_DOT: Record<MetricStatus, string> = {
  gold: 'bg-emerald-500',
  silver: 'bg-amber-500',
  bronze: 'bg-orange-500',
  below_bronze: 'bg-rose-500',
  unknown: 'bg-slate-300',
}

function StatusDot({ status }: { status: MetricStatus }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_DOT[status]}`} />
}

interface SparklineProps {
  points: TrendPoint[]
  unit: string
  benchmarks: AgentTrendResponse['benchmarks']
  direction: 'higher_better' | 'lower_better'
}

function Sparkline({ points, unit, benchmarks, direction }: SparklineProps) {
  const W = 280
  const H = 40
  const padding = 4
  const values = points.map((p) => p.value).filter((v): v is number => v !== null)
  if (values.length < 2) {
    return <div className="text-xs text-slate-400 italic">недостаточно точек для графика</div>
  }
  // Расширяем мин/макс на 10%, чтобы линия не упиралась в края
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const yMin = min - span * 0.1
  const yMax = max + span * 0.1
  const yScale = (v: number) => H - padding - ((v - yMin) / (yMax - yMin)) * (H - padding * 2)
  const xScale = (i: number) => padding + (i / (points.length - 1)) * (W - padding * 2)

  const pathD = points
    .map((p, i) => {
      if (p.value === null) return null
      return `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.value)}`
    })
    .filter(Boolean)
    .join(' ')

  // Зона между bronze и gold — фоновая
  const bronzeY = benchmarks?.bronze ? yScale(benchmarks.bronze.value) : null
  const goldY = benchmarks?.gold ? yScale(benchmarks.gold.value) : null

  // Цвет последней половины: улучшается → emerald, ухудшается → rose, стабильно → slate
  // Тут грубо по последнему значению vs первого
  const firstValid = values[0]
  const lastValid = values[values.length - 1]
  const dirSign = direction === 'lower_better' ? 1 : -1
  const trendLineColor =
    Math.abs(lastValid - firstValid) / Math.max(firstValid, 1) < 0.05
      ? '#64748b' // slate
      : (lastValid - firstValid) * dirSign > 0
      ? '#10b981' // improving (lower_better && went down)
      : '#f43f5e' // declining

  return (
    <svg
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="block"
    >
      {/* benchmark zone */}
      {bronzeY !== null && goldY !== null && (
        <rect
          x={0}
          y={Math.min(bronzeY, goldY)}
          width={W}
          height={Math.abs(bronzeY - goldY)}
          fill="rgba(16, 185, 129, 0.05)"
        />
      )}
      {bronzeY !== null && (
        <line x1={0} y1={bronzeY} x2={W} y2={bronzeY} stroke="#fbbf24" strokeDasharray="2,2" strokeWidth={1} />
      )}
      {goldY !== null && (
        <line x1={0} y1={goldY} x2={W} y2={goldY} stroke="#10b981" strokeDasharray="2,2" strokeWidth={1} />
      )}
      {/* line */}
      <path d={pathD} fill="none" stroke={trendLineColor} strokeWidth={1.5} />
      {/* points */}
      {points.map((p, i) =>
        p.value !== null ? (
          <circle
            key={i}
            cx={xScale(i)}
            cy={yScale(p.value)}
            r={2.5}
            fill={trendLineColor}
          >
            <title>
              {p.label}: {formatValue(p.value, unit)} ({p.sampleSize} наблюдений)
            </title>
          </circle>
        ) : null,
      )}
    </svg>
  )
}

function formatValue(v: number, unit: string): string {
  switch (unit) {
    case 'minutes':
      return v < 1 ? `${(v * 60).toFixed(0)}с` : `${v.toFixed(1)} мин`
    case 'hours':
      return `${v.toFixed(1)} ч`
    case 'seconds':
      return `${v.toFixed(0)} с`
    case 'percent':
      return `${v.toFixed(1)}%`
    case 'ratio':
      return v.toFixed(2)
    case 'count':
      return v.toFixed(0)
    case 'currency':
      return `${v.toFixed(0)} ₽`
    default:
      return String(v)
  }
}
