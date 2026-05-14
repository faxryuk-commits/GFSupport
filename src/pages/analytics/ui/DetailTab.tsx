import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Search, AlertCircle, ChevronUp, ChevronDown, ExternalLink } from 'lucide-react'
import {
  fetchMetricPerAgent,
  type MetricPerAgentResponse,
  type MetricStatus,
} from '@/shared/api'

interface DetailTabProps {
  period: '7d' | '30d' | '90d'
  source?: 'all' | 'telegram' | 'whatsapp'
}

type SortKey = 'agentName' | 'value' | 'sampleSize'
type SortDir = 'asc' | 'desc'

const STATUS_STYLES: Record<MetricStatus, { chip: string; label: string }> = {
  good: { chip: 'bg-emerald-50 text-emerald-800 border-emerald-200', label: 'Gold' },
  borderline: { chip: 'bg-amber-50 text-amber-800 border-amber-200', label: 'Silver' },
  bad: { chip: 'bg-rose-50 text-rose-800 border-rose-200', label: 'ниже Bronze' },
  unknown: { chip: 'bg-slate-50 text-slate-500 border-slate-200', label: '—' },
}

function formatMinutes(v: number): string {
  if (v < 1) return `${(v * 60).toFixed(0)}с`
  return `${v.toFixed(1)} мин`
}

export function DetailTab({ period, source }: DetailTabProps) {
  const [data, setData] = useState<MetricPerAgentResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('value')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchMetricPerAgent({
      key: 'frt_avg_minutes',
      period,
      source: source === 'all' ? undefined : source,
    })
      .then((r) => {
        if (!cancelled) setData(r)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period, source])

  const sorted = useMemo(() => {
    if (!data) return []
    const filtered = search
      ? data.rows.filter((r) =>
          (r.agentName || r.agentId).toLowerCase().includes(search.toLowerCase()),
        )
      : data.rows
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'agentName':
          return (a.agentName || '').localeCompare(b.agentName || '') * dir
        case 'value':
          return (a.value - b.value) * dir
        case 'sampleSize':
          return (a.sampleSize - b.sampleSize) * dir
      }
    })
  }, [data, search, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'agentName' ? 'asc' : 'asc')
    }
  }

  const SortIcon = ({ active }: { active: boolean }) =>
    !active ? (
      <ChevronUp className="w-3 h-3 opacity-30" />
    ) : sortDir === 'asc' ? (
      <ChevronUp className="w-3 h-3" />
    ) : (
      <ChevronDown className="w-3 h-3" />
    )

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-900">
        <strong>Detail</strong> — построчные данные. Per-agent FRT с цветным статусом
        относительно бенчмарков. Поиск по имени, сортировка по любой колонке.
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <header className="flex items-center justify-between gap-3 p-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">
            Среднее время первого ответа — по агентам
          </h3>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Поиск агента..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-sm border border-slate-300 rounded-md w-56"
            />
          </div>
        </header>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        )}

        {error && (
          <div className="m-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-900">{error}</div>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {data.benchmarks.bronze || data.benchmarks.silver || data.benchmarks.gold ? (
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-600 flex items-center gap-4">
                <span className="font-medium">Целевые уровни:</span>
                {data.benchmarks.bronze && (
                  <span>🥉 Bronze {formatMinutes(data.benchmarks.bronze.value)}</span>
                )}
                {data.benchmarks.silver && (
                  <span>🥈 Silver {formatMinutes(data.benchmarks.silver.value)}</span>
                )}
                {data.benchmarks.gold && (
                  <span>🥇 Gold {formatMinutes(data.benchmarks.gold.value)}</span>
                )}
              </div>
            ) : (
              <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
                Бенчмарки не посчитаны.{' '}
                <Link to="/benchmarks" className="underline font-medium">
                  Запустить пересчёт
                </Link>{' '}
                — после этого статусы агентов появятся.
              </div>
            )}

            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">
                    <button
                      onClick={() => toggleSort('agentName')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      Агент <SortIcon active={sortKey === 'agentName'} />
                    </button>
                  </th>
                  <th className="text-right px-4 py-2 font-medium">
                    <button
                      onClick={() => toggleSort('value')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      Среднее FRT <SortIcon active={sortKey === 'value'} />
                    </button>
                  </th>
                  <th className="text-right px-4 py-2 font-medium">
                    <button
                      onClick={() => toggleSort('sampleSize')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      Сессий <SortIcon active={sortKey === 'sampleSize'} />
                    </button>
                  </th>
                  <th className="text-center px-4 py-2 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-8 text-slate-500">
                      {search ? 'По запросу ничего не найдено' : 'За период нет данных'}
                    </td>
                  </tr>
                )}
                {sorted.map((row) => {
                  const style = STATUS_STYLES[row.status]
                  return (
                    <tr key={row.agentId} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2 text-slate-900">
                        {row.agentName || (
                          <span className="text-slate-400 font-mono text-xs">{row.agentId}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatMinutes(row.value)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                        {row.sampleSize}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded border ${style.chip}`}
                        >
                          {style.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="text-xs text-slate-500 px-3">
        Расширенные таблицы (SLA-violations, expertise по категориям, экспорт в xlsx) пока живут
        на старом{' '}
        <Link
          to="/sla-report-legacy"
          className="underline text-blue-600 hover:text-blue-700"
        >
          legacy SLA-отчёте
          <ExternalLink className="inline w-3 h-3 ml-0.5" />
        </Link>
        . Постепенно мигрируем.
      </div>
    </div>
  )
}
