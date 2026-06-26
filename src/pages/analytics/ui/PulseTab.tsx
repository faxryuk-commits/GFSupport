import { useEffect, useState } from 'react'
import { Clock, Target, Smile, Repeat, Bot, CheckCircle2 } from 'lucide-react'
import { BenchmarkCard, CustomerHealthBanner, TeamTrendStrip } from '@/features/analytics'
import { fetchMetric, type MetricResult, type FetchMetricParams } from '@/shared/api'

const PULSE_METRICS: Array<{
  key: string
  label: string
  unit: 'minutes' | 'hours' | 'percent'
  formula: string
  icon: React.ReactNode
}> = [
  {
    key: 'frt_avg_minutes',
    label: 'Среднее время первого ответа',
    unit: 'minutes',
    formula:
      'Время от нового запроса клиента до первого ответа агента (4-часовое окно, фильтр коротких «спасибо/ок»).',
    icon: <Clock className="w-4 h-4 text-violet-500" />,
  },
  {
    key: 'resolution_time_hours',
    label: 'Время решения',
    unit: 'hours',
    formula:
      'Среднее время от создания кейса до его закрытия (resolved/closed). Считается по кейсам, закрытым в периоде.',
    icon: <CheckCircle2 className="w-4 h-4 text-teal-500" />,
  },
  {
    key: 'sla_compliance_rate',
    label: 'SLA Compliance',
    unit: 'percent',
    formula: 'Доля первых ответов с временем ≤ 10 минут (та же выборка, что у FRT).',
    icon: <Target className="w-4 h-4 text-blue-500" />,
  },
  {
    key: 'sentiment_positive_rate',
    label: 'Позитивные сообщения',
    unit: 'percent',
    formula: '% сообщений клиента с положительным sentiment из оценённых ИИ.',
    icon: <Smile className="w-4 h-4 text-emerald-500" />,
  },
  {
    key: 'repeat_contact_rate',
    label: 'Повторные обращения',
    unit: 'percent',
    formula:
      '% каналов, обратившихся 2+ раза за период. Proxy первоконтактного решения (FCR).',
    icon: <Repeat className="w-4 h-4 text-amber-500" />,
  },
  {
    key: 'escalation_rate',
    label: 'Эскалации AI',
    unit: 'percent',
    formula:
      'Доля решений AI с action=escalate из всех решений. Меньше = AI чаще справляется сам.',
    icon: <Bot className="w-4 h-4 text-slate-500" />,
  },
]

interface PulseTabProps {
  period: FetchMetricParams['period']
  source?: string
  roles?: string[] | null
}

export function PulseTab({ period, source, roles }: PulseTabProps) {
  // null = ещё грузится, undefined = ошибка/нет, MetricResult = есть данные
  const [metrics, setMetrics] = useState<Record<string, MetricResult | null | undefined>>({})

  useEffect(() => {
    let cancelled = false
    // Сразу ставим все в "загрузка"
    setMetrics(
      Object.fromEntries(PULSE_METRICS.map((m) => [m.key, null])) as Record<string, null>,
    )

    Promise.all(
      PULSE_METRICS.map((m) =>
        fetchMetric({
          key: m.key,
          period,
          source: source === 'all' ? undefined : source,
          roles: roles && roles.length > 0 ? roles : null,
        })
          .then((r) => ({ key: m.key, result: r.result as MetricResult }))
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
  }, [period, source, roles])

  // Группировка по уровню — L2 indicators сверху, L3 activity ниже
  const indicators = PULSE_METRICS.filter(
    (m) => m.key === 'sentiment_positive_rate' || m.key === 'repeat_contact_rate',
  )
  const activity = PULSE_METRICS.filter(
    (m) =>
      m.key === 'frt_avg_minutes' ||
      m.key === 'resolution_time_hours' ||
      m.key === 'sla_compliance_rate' ||
      m.key === 'escalation_rate',
  )

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-3">
          Бизнес-результат
          <span className="ml-2 text-[10px] text-slate-400 normal-case font-normal">
            — состояние покупателей Delever (L1 Driver)
          </span>
        </h3>
        <CustomerHealthBanner period={period} source={source} />
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-3">
          Клиентский опыт
          <span className="ml-2 text-[10px] text-slate-400 normal-case font-normal">
            — что чувствуют покупатели (L2 Indicators)
          </span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {indicators.map((m) => (
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

      <section>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-3">
          Скорость поддержки
          <span className="ml-2 text-[10px] text-slate-400 normal-case font-normal">
            — что делает команда (L3 Activity)
          </span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {activity.map((m) => (
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

      <TeamTrendStrip
        metricKeys={PULSE_METRICS.map((m) => m.key)}
        source={source}
        roles={roles && roles.length > 0 ? roles : null}
        granularity="weekly"
        periods={8}
      />

      <div className="text-xs text-slate-500 bg-slate-50 border border-[#e8edf3] rounded-md px-4 py-3">
        <strong>Pulse</strong> — сводка по 4 ключевым метрикам с целевыми уровнями Bronze (минимум) /
        Silver (медиана) / Gold (отлично). Цели считаются по перцентилям команды за 60 дней истории
        и автоматически пересчитываются раз в неделю. Управление целями —{' '}
        <a href="/benchmarks" className="underline text-blue-600 hover:text-blue-700">
          /benchmarks
        </a>
        .
      </div>
    </div>
  )
}
