import type { MetricResult, MetricUnit } from '@/shared/api'
import { Loader2 } from 'lucide-react'

interface BenchmarkCardProps {
  /** Метрика. null = ещё грузится, undefined = ошибка/нет данных. */
  metric: MetricResult | null | undefined
  /** Описатель метрики — заголовок, единица, направление. */
  label: string
  unit: MetricUnit
  /** Подсказка-формула (tooltip). */
  formula?: string
  /** Иконка слева от заголовка. */
  icon?: React.ReactNode
  /** Колбек на клик. Если задан, карточка кликабельна. */
  onClick?: () => void
}

const STATUS_TONE: Record<string, { bar: string; chip: string; chipText: string; barWidth: string }> = {
  gold: { bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-800 border-emerald-200', chipText: 'Gold', barWidth: '100%' },
  silver: { bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800 border-amber-200', chipText: 'Silver', barWidth: '75%' },
  bronze: { bar: 'bg-orange-500', chip: 'bg-orange-50 text-orange-800 border-orange-200', chipText: 'Bronze', barWidth: '50%' },
  below_bronze: { bar: 'bg-rose-500', chip: 'bg-rose-50 text-rose-800 border-rose-200', chipText: 'ниже Bronze', barWidth: '25%' },
  unknown: { bar: 'bg-slate-300', chip: 'bg-slate-50 text-slate-500 border-slate-200', chipText: 'нет цели', barWidth: '0%' },
}

function formatValue(v: number, unit: MetricUnit): string {
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
  }
}

export function BenchmarkCard({
  metric,
  label,
  unit,
  formula,
  icon,
  onClick,
}: BenchmarkCardProps) {
  const isLoading = metric === null
  const tone = STATUS_TONE[metric?.status ?? 'unknown']
  const Wrapper = onClick ? 'button' : 'div'

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`bg-white border border-slate-200 rounded-xl p-4 text-left flex flex-col gap-2 ${
        onClick ? 'hover:border-slate-300 hover:shadow-sm transition cursor-pointer' : ''
      } ${isLoading ? 'opacity-60' : ''}`}
      title={formula}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {icon}
          <span>{label}</span>
        </div>
        {metric && (
          <span
            className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded border ${tone.chip}`}
          >
            {tone.chipText}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        ) : metric === undefined || metric.value === null ? (
          <span className="text-2xl font-bold text-slate-400">—</span>
        ) : (
          <span className="text-3xl font-bold text-slate-900 tabular-nums">
            {formatValue(metric.value, unit)}
          </span>
        )}
        {metric && metric.sampleSize > 0 && (
          <span className="text-xs text-slate-400">· {metric.sampleSize} набл.</span>
        )}
      </div>

      {/* Полоса бенчмарков */}
      {metric && (metric.benchmarks.bronze || metric.benchmarks.silver || metric.benchmarks.gold) && (
        <div className="space-y-1.5">
          <div className="h-1 w-full bg-slate-100 rounded overflow-hidden">
            <div className={`h-full ${tone.bar}`} style={{ width: tone.barWidth }} />
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            {metric.benchmarks.bronze && (
              <span title="Bronze (минимум)">🥉 {formatValue(metric.benchmarks.bronze.value, unit)}</span>
            )}
            {metric.benchmarks.silver && (
              <span title="Silver (медиана)">🥈 {formatValue(metric.benchmarks.silver.value, unit)}</span>
            )}
            {metric.benchmarks.gold && (
              <span title="Gold (отлично)">🥇 {formatValue(metric.benchmarks.gold.value, unit)}</span>
            )}
          </div>
        </div>
      )}

      {metric && !metric.benchmarks.bronze && !metric.benchmarks.silver && !metric.benchmarks.gold && (
        <div className="text-[10px] text-slate-400 italic">
          нет бенчмарка — запустите пересчёт на странице «Бенчмарки»
        </div>
      )}
    </Wrapper>
  )
}
