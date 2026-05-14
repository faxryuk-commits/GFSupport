import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Search, AlertCircle, ChevronUp, ChevronDown, ExternalLink } from 'lucide-react'
import { Agent360Modal } from '@/features/analytics'
import {
  fetchMetricPerAgent,
  type MetricPerAgentResponse,
  type MetricPerAgentRow,
  type MetricStatus,
} from '@/shared/api'

interface DetailTabProps {
  period: '7d' | '30d' | '90d'
  source?: 'all' | 'telegram' | 'whatsapp'
}

type SortKey = 'agentName' | 'frt' | 'sla' | 'sessions'
type SortDir = 'asc' | 'desc'

interface MergedRow {
  agentId: string
  agentName: string | null
  frt: MetricPerAgentRow | null
  sla: MetricPerAgentRow | null
  sessions: number
}

const STATUS_CHIP: Record<MetricStatus, string> = {
  good: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  borderline: 'bg-amber-50 text-amber-800 border-amber-200',
  bad: 'bg-rose-50 text-rose-800 border-rose-200',
  unknown: 'bg-slate-50 text-slate-500 border-slate-200',
}
const STATUS_LABEL: Record<MetricStatus, string> = {
  good: 'Gold',
  borderline: 'Silver',
  bad: 'ниже Bronze',
  unknown: '—',
}

function formatMinutes(v: number): string {
  if (v < 1) return `${(v * 60).toFixed(0)}с`
  return `${v.toFixed(1)} мин`
}

function MetricCell({
  row,
  formatter,
}: {
  row: MetricPerAgentRow | null
  formatter: (v: number) => string
}) {
  if (!row) return <span className="text-slate-300">—</span>
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="tabular-nums">{formatter(row.value)}</span>
      <span
        className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded border ${STATUS_CHIP[row.status]}`}
      >
        {STATUS_LABEL[row.status]}
      </span>
    </div>
  )
}

export function DetailTab({ period, source }: DetailTabProps) {
  const [frtData, setFrtData] = useState<MetricPerAgentResponse | null>(null)
  const [slaData, setSlaData] = useState<MetricPerAgentResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('frt')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selectedAgent, setSelectedAgent] = useState<{ id: string; name: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setFrtData(null)
    setSlaData(null)

    Promise.all([
      fetchMetricPerAgent({
        key: 'frt_avg_minutes',
        period,
        source: source === 'all' ? undefined : source,
      }).catch(() => null),
      fetchMetricPerAgent({
        key: 'sla_compliance_rate',
        period,
        source: source === 'all' ? undefined : source,
      }).catch(() => null),
    ])
      .then(([frt, sla]) => {
        if (cancelled) return
        if (!frt && !sla) {
          setError('Не удалось загрузить ни одну из метрик')
        }
        setFrtData(frt)
        setSlaData(sla)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [period, source])

  const merged: MergedRow[] = useMemo(() => {
    const map = new Map<string, MergedRow>()
    if (frtData) {
      for (const r of frtData.rows) {
        map.set(r.agentId, {
          agentId: r.agentId,
          agentName: r.agentName,
          frt: r,
          sla: null,
          sessions: r.sampleSize,
        })
      }
    }
    if (slaData) {
      for (const r of slaData.rows) {
        const existing = map.get(r.agentId)
        if (existing) {
          existing.sla = r
          // sessions: max(FRT.sampleSize, SLA.sampleSize) — они должны быть равны,
          // но если SLA не запросилась, sessions из FRT, и наоборот.
          existing.sessions = Math.max(existing.sessions, r.sampleSize)
        } else {
          map.set(r.agentId, {
            agentId: r.agentId,
            agentName: r.agentName,
            frt: null,
            sla: r,
            sessions: r.sampleSize,
          })
        }
      }
    }
    return Array.from(map.values())
  }, [frtData, slaData])

  const sorted = useMemo(() => {
    const filtered = search
      ? merged.filter((r) =>
          (r.agentName || r.agentId).toLowerCase().includes(search.toLowerCase()),
        )
      : merged
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'agentName':
          return (a.agentName || '').localeCompare(b.agentName || '') * dir
        case 'frt':
          // null FRT в конец
          if (!a.frt && !b.frt) return 0
          if (!a.frt) return 1
          if (!b.frt) return -1
          return (a.frt.value - b.frt.value) * dir
        case 'sla':
          // null SLA в конец, для higher_better инвертируем
          if (!a.sla && !b.sla) return 0
          if (!a.sla) return 1
          if (!b.sla) return -1
          return (b.sla.value - a.sla.value) * dir // higher_better: desc по умолчанию
        case 'sessions':
          return (b.sessions - a.sessions) * dir
      }
    })
  }, [merged, search, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
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

  const frtBenchmarks = frtData?.benchmarks
  const slaBenchmarks = slaData?.benchmarks

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-900">
        <strong>Detail</strong> — построчные данные. Каждая строка — агент с FRT и SLA
        compliance, цветной chip показывает уровень относительно бенчмарка. Поиск и сортировка
        по любой колонке.
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <header className="flex items-center justify-between gap-3 p-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Per-agent breakdown</h3>
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

        {error && !loading && (
          <div className="m-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-900">{error}</div>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <span className="font-medium">FRT цели: </span>
                  {frtBenchmarks?.bronze ? `🥉 ${formatMinutes(frtBenchmarks.bronze.value)}` : '—'}
                  {' · '}
                  {frtBenchmarks?.silver ? `🥈 ${formatMinutes(frtBenchmarks.silver.value)}` : '—'}
                  {' · '}
                  {frtBenchmarks?.gold ? `🥇 ${formatMinutes(frtBenchmarks.gold.value)}` : '—'}
                </div>
                <div>
                  <span className="font-medium">SLA цели: </span>
                  {slaBenchmarks?.bronze ? `🥉 ${slaBenchmarks.bronze.value.toFixed(1)}%` : '—'}
                  {' · '}
                  {slaBenchmarks?.silver ? `🥈 ${slaBenchmarks.silver.value.toFixed(1)}%` : '—'}
                  {' · '}
                  {slaBenchmarks?.gold ? `🥇 ${slaBenchmarks.gold.value.toFixed(1)}%` : '—'}
                </div>
              </div>
              {!frtBenchmarks?.bronze && !slaBenchmarks?.bronze && (
                <div className="mt-1">
                  <Link to="/benchmarks" className="underline text-blue-600 hover:text-blue-700">
                    Запустить пересчёт бенчмарков
                  </Link>
                </div>
              )}
            </div>

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
                      onClick={() => toggleSort('frt')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      FRT <SortIcon active={sortKey === 'frt'} />
                    </button>
                  </th>
                  <th className="text-right px-4 py-2 font-medium">
                    <button
                      onClick={() => toggleSort('sla')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      SLA Compliance <SortIcon active={sortKey === 'sla'} />
                    </button>
                  </th>
                  <th className="text-right px-4 py-2 font-medium">
                    <button
                      onClick={() => toggleSort('sessions')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      Сессий <SortIcon active={sortKey === 'sessions'} />
                    </button>
                  </th>
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
                {sorted.map((row) => (
                  <tr key={row.agentId} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2 text-slate-900">
                      <button
                        onClick={() => setSelectedAgent({ id: row.agentId, name: row.agentName })}
                        className="text-left hover:text-blue-600 hover:underline"
                        title="Открыть 360°-профиль с динамикой по неделям"
                      >
                        {row.agentName || (
                          <span className="text-slate-400 font-mono text-xs">{row.agentId}</span>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <MetricCell row={row.frt} formatter={formatMinutes} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <MetricCell row={row.sla} formatter={(v) => `${v.toFixed(1)}%`} />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                      {row.sessions}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="text-xs text-slate-500 px-3">
        Клик по имени агента открывает 360°-профиль с динамикой метрик по неделям. Расширенные
        таблицы (SLA-violations, expertise по категориям, weekly heatmap, экспорт в xlsx) пока
        живут на старом{' '}
        <Link
          to="/sla-report-legacy"
          className="underline text-blue-600 hover:text-blue-700"
        >
          legacy SLA-отчёте
          <ExternalLink className="inline w-3 h-3 ml-0.5" />
        </Link>
        . Мигрируем постепенно.
      </div>

      {selectedAgent && (frtData || slaData) && (
        <Agent360Modal
          isOpen={!!selectedAgent}
          onClose={() => setSelectedAgent(null)}
          agentId={selectedAgent.id}
          agentName={selectedAgent.name}
          from={(frtData?.period.from || slaData?.period.from || '').slice(0, 10)}
          to={(frtData?.period.to || slaData?.period.to || '').slice(0, 10)}
          source={source || 'all'}
        />
      )}
    </div>
  )
}
