/**
 * Компактная полоса из 4 ключевых метрик с бенчмарками. Для встраивания
 * в Dashboard и любые другие страницы, где нужен «быстрый снимок».
 *
 * Использует тот же семантический слой, что PulseTab, но без секционных
 * заголовков — просто 4 карточки в ряд.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Target, Smile, Repeat, ArrowRight, CheckCircle2 } from 'lucide-react'
import { BenchmarkCard } from './BenchmarkCard'
import { fetchMetric, type MetricResult, type FetchMetricParams } from '@/shared/api'

const STRIP_METRICS: Array<{
  key: string
  label: string
  unit: 'minutes' | 'hours' | 'percent'
  icon: React.ReactNode
  formula: string
}> = [
  {
    key: 'frt_avg_minutes',
    label: 'Время ответа',
    unit: 'minutes',
    icon: <Clock className="w-4 h-4 text-violet-500" />,
    formula: 'Среднее время от нового запроса клиента до первого ответа агента.',
  },
  {
    key: 'resolution_time_hours',
    label: 'Время решения',
    unit: 'hours',
    icon: <CheckCircle2 className="w-4 h-4 text-teal-500" />,
    formula: 'Среднее время от создания кейса до его закрытия (resolved/closed). По кейсам, закрытым в периоде.',
  },
  {
    key: 'sla_compliance_rate',
    label: 'SLA Compliance',
    unit: 'percent',
    icon: <Target className="w-4 h-4 text-blue-500" />,
    formula: 'Доля первых ответов с временем ≤ 10 мин.',
  },
  {
    key: 'sentiment_positive_rate',
    label: 'Позитив',
    unit: 'percent',
    icon: <Smile className="w-4 h-4 text-emerald-500" />,
    formula: '% сообщений клиента с положительным sentiment.',
  },
  {
    key: 'repeat_contact_rate',
    label: 'Повторные',
    unit: 'percent',
    icon: <Repeat className="w-4 h-4 text-amber-500" />,
    formula: '% каналов, обратившихся 2+ раза. Меньше = выше FCR.',
  },
]

interface PulseStripProps {
  period: FetchMetricParams['period']
  source?: string
  /** URL ссылки «Подробнее →». По умолчанию ведёт в полную аналитику. */
  detailsHref?: string
  /** Если задано — вместо встроенного заголовка показывается это. */
  title?: string
}

export function PulseStrip({
  period,
  source,
  detailsHref = '/analytics?tab=pulse',
  title = 'Pulse',
}: PulseStripProps) {
  const [metrics, setMetrics] = useState<Record<string, MetricResult | null | undefined>>({})

  useEffect(() => {
    let cancelled = false
    setMetrics(Object.fromEntries(STRIP_METRICS.map((m) => [m.key, null])))

    Promise.all(
      STRIP_METRICS.map((m) =>
        fetchMetric({
          key: m.key,
          period,
          source: source === 'all' ? undefined : source,
        })
          .then((r) => ({ key: m.key, result: r.result }))
          .catch(() => ({ key: m.key, result: undefined as MetricResult | undefined })),
      ),
    ).then((results) => {
      if (cancelled) return
      const next: Record<string, MetricResult | undefined> = {}
      for (const r of results) next[r.key] = r.result
      setMetrics(next)
    })

    return () => {
      cancelled = true
    }
  }, [period, source])

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <Link
          to={detailsHref}
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
        >
          Полная аналитика
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {STRIP_METRICS.map((m) => (
          <BenchmarkCard
            key={m.key}
            metric={metrics[m.key]}
            label={m.label}
            unit={m.unit}
            formula={m.formula}
            icon={m.icon}
          />
        ))}
      </div>
    </section>
  )
}
