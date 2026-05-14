import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Loader2,
  AlertCircle,
  Heart,
  HeartCrack,
  Activity,
  TrendingDown,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import {
  fetchCustomerHealth,
  type CustomerHealthResponse,
  type CustomerHealthRow,
  type HealthBand,
} from '@/shared/api'
import { ChurnDetailsModal } from './ChurnDetailsModal'

interface Props {
  period: '7d' | '30d' | '90d'
  source?: 'all' | 'telegram' | 'whatsapp'
}

const BAND_STYLES: Record<HealthBand, { bar: string; chip: string; label: string }> = {
  healthy: {
    bar: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    label: 'Здоров',
  },
  at_risk: {
    bar: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-800 border-amber-200',
    label: 'В зоне риска',
  },
  critical: {
    bar: 'bg-rose-500',
    chip: 'bg-rose-50 text-rose-800 border-rose-200',
    label: 'Критично',
  },
  unknown: { bar: 'bg-slate-300', chip: 'bg-slate-50 text-slate-500 border-slate-200', label: '—' },
}

function formatDays(days: number | null): string {
  if (days === null) return 'нет данных'
  if (days < 1) return `${Math.round(days * 24)} ч назад`
  if (days < 30) return `${Math.round(days)} дн назад`
  return `${Math.round(days)} дн назад`
}

export function CustomerHealthSection({ period, source }: Props) {
  const [data, setData] = useState<CustomerHealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [bandFilter, setBandFilter] = useState<HealthBand | 'all'>('all')
  const [page, setPage] = useState(0)
  const [churnModal, setChurnModal] = useState<{ channelId: string; channelName: string | null } | null>(null)
  const ROWS_PER_PAGE = 25

  // При смене фильтра/поиска возвращаемся на первую страницу
  useEffect(() => {
    setPage(0)
  }, [bandFilter, search, period, source])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchCustomerHealth({
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

  const filtered = useMemo(() => {
    if (!data) return []
    return data.rows.filter((r) => {
      if (bandFilter !== 'all' && r.band !== bandFilter) return false
      if (search && !(r.channelName || r.channelId).toLowerCase().includes(search.toLowerCase())) {
        return false
      }
      return true
    })
  }, [data, bandFilter, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE))
  const pageStart = page * ROWS_PER_PAGE
  const pageRows = filtered.slice(pageStart, pageStart + ROWS_PER_PAGE)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 bg-white border border-slate-200 rounded-xl">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-red-900">{error}</div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-3">
      {/* Сводка */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Всего покупателей"
          value={data.summary.total}
          icon={<Activity className="w-4 h-4" />}
          tone="slate"
        />
        <SummaryCard
          label="Здоровы"
          value={data.summary.healthy}
          icon={<Heart className="w-4 h-4" />}
          tone="emerald"
        />
        <SummaryCard
          label="В зоне риска"
          value={data.summary.atRisk}
          icon={<TrendingDown className="w-4 h-4" />}
          tone="amber"
        />
        <SummaryCard
          label="Критично"
          value={data.summary.critical}
          icon={<HeartCrack className="w-4 h-4" />}
          tone="rose"
        />
      </div>

      {/* Контролы */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <header className="flex items-center justify-between gap-3 p-3 border-b border-slate-200 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setBandFilter('all')}
              className={`px-3 py-1 text-xs rounded-md border ${
                bandFilter === 'all'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
              }`}
            >
              Все
            </button>
            {(['critical', 'at_risk', 'healthy'] as HealthBand[]).map((band) => (
              <button
                key={band}
                onClick={() => setBandFilter(band)}
                className={`px-3 py-1 text-xs rounded-md border ${
                  bandFilter === band
                    ? 'bg-slate-900 text-white border-slate-900'
                    : `bg-white text-slate-700 border-slate-300 hover:border-slate-400`
                }`}
              >
                {BAND_STYLES[band].label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Поиск канала..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-sm border border-slate-300 rounded-md w-56"
            />
          </div>
        </header>

        <div className="max-h-[560px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wider sticky top-0 z-10">
              <tr>
                <th
                  className="text-left px-4 py-2 font-medium"
                  title="Канал в Telegram или WhatsApp = один покупатель Delever. Клик откроет чат."
                >
                  Покупатель
                </th>
                <th
                  className="text-left px-4 py-2 font-medium"
                  title="Composite 0..100. Формула: activity 35% + sentiment 30% + resolution 20% + churn 15%."
                >
                  Health
                </th>
                <th
                  className="text-right px-4 py-2 font-medium"
                  title="Активность: 100 если ≤2 дней без сообщений, 0 при ≥30 дней."
                >
                  Активность
                </th>
                <th
                  className="text-right px-4 py-2 font-medium"
                  title="% сообщений клиента с positive sentiment из всех оценённых ИИ. В скобках — positive/scored."
                >
                  Sentiment
                </th>
                <th
                  className="text-right px-4 py-2 font-medium"
                  title="Решённых кейсов / всего созданных за период. «+N откр.» — ещё открытые."
                >
                  Кейсы
                </th>
                <th
                  className="text-right px-4 py-2 font-medium"
                  title="Сколько сообщений клиента содержат прямые сигналы оттока: «отключаемся», «расторгаем», «uzamiz», «cancel subscription» и т.п. Клик откроет список."
                >
                  Churn-сигналы
                </th>
                <th
                  className="text-right px-4 py-2 font-medium"
                  title="Время с момента последнего сообщения от клиента или агента в этом канале."
                >
                  Последнее
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-500">
                    Нет покупателей в этой выборке
                  </td>
                </tr>
              )}
              {pageRows.map((row) => (
                <CustomerRow
                  key={row.channelId}
                  row={row}
                  onChurnClick={(channelId, channelName) =>
                    setChurnModal({ channelId, channelName })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length > ROWS_PER_PAGE && (
          <footer className="flex items-center justify-between gap-3 p-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-600">
            <div>
              Показано <span className="font-medium">{pageStart + 1}–{Math.min(pageStart + ROWS_PER_PAGE, filtered.length)}</span>{' '}
              из <span className="font-medium">{filtered.length}</span>
              {filtered.length !== data.rows.length && (
                <span className="text-slate-400"> · отфильтровано из {data.rows.length}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="inline-flex items-center gap-1 px-2 py-1 border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Назад
              </button>
              <span className="px-2 tabular-nums">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="inline-flex items-center gap-1 px-2 py-1 border border-slate-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100"
              >
                Вперёд
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </footer>
        )}
      </div>

      <ChurnDetailsModal
        isOpen={churnModal !== null}
        onClose={() => setChurnModal(null)}
        channelId={churnModal?.channelId ?? null}
        channelName={churnModal?.channelName ?? null}
        period={period}
      />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: number
  icon: React.ReactNode
  tone: 'slate' | 'emerald' | 'amber' | 'rose'
}) {
  const toneClass: Record<typeof tone, string> = {
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  }
  return (
    <div className={`border rounded-xl p-3 ${toneClass[tone]}`}>
      <div className="flex items-center gap-2 text-xs font-medium">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  )
}

function CustomerRow({
  row,
  onChurnClick,
}: {
  row: CustomerHealthRow
  onChurnClick: (channelId: string, channelName: string | null) => void
}) {
  const style = BAND_STYLES[row.band]
  const healthTooltip =
    `Health ${row.healthScore ?? '—'}/100. Формула: ` +
    `activity (35%) · sentiment (30%) · resolution (20%) · churn (15%). ` +
    `Текущие компоненты: activity ${row.activityScore ?? '—'}, ` +
    `sentiment ${row.sentimentScore ?? '—'}, ` +
    `resolution ${row.resolutionScore ?? '—'}, ` +
    `churn ${row.churnScore}.`

  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50">
      <td className="px-4 py-2">
        <Link
          to={`/chats/${row.channelId}`}
          className="text-slate-900 hover:text-blue-600"
          title={`Открыть чат · ${row.totalMessages} сообщений за период`}
        >
          {row.channelName || (
            <span className="font-mono text-xs text-slate-500">{row.channelId}</span>
          )}
        </Link>
        <div className="text-[10px] text-slate-400">
          {row.source === 'whatsapp' ? 'WhatsApp' : 'Telegram'}
        </div>
      </td>
      <td className="px-4 py-2" title={healthTooltip}>
        <div className="flex items-center gap-2">
          <div className="w-20 h-1.5 bg-slate-100 rounded overflow-hidden">
            <div
              className={`h-full ${style.bar}`}
              style={{ width: `${Math.max(2, row.healthScore ?? 0)}%` }}
            />
          </div>
          <span className="text-sm font-semibold tabular-nums w-8">
            {row.healthScore ?? '—'}
          </span>
          <span
            className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded border ${style.chip}`}
          >
            {style.label}
          </span>
        </div>
      </td>
      <td
        className="px-4 py-2 text-right tabular-nums text-slate-600"
        title={
          row.daysSinceLastMessage === null
            ? 'Нет сообщений за период'
            : `${row.daysSinceLastMessage} дн без сообщений. 100 баллов при ≤2 дн, 0 при ≥30 дн.`
        }
      >
        {row.activityScore !== null ? row.activityScore : '—'}
      </td>
      <td
        className="px-4 py-2 text-right tabular-nums text-slate-600"
        title={
          row.scoredMessages === 0
            ? 'Нет сообщений с оценённым ИИ-настроением'
            : `${row.positiveMessages} позитивных из ${row.scoredMessages} оценённых ИИ`
        }
      >
        {row.sentimentScore !== null ? (
          <>
            {row.sentimentScore}
            <span className="text-[10px] text-slate-400 ml-1">
              ({row.positiveMessages}/{row.scoredMessages})
            </span>
          </>
        ) : (
          '—'
        )}
      </td>
      <td
        className="px-4 py-2 text-right tabular-nums text-slate-600"
        title={
          row.totalCases === 0
            ? 'Нет кейсов за период'
            : `${row.resolvedCases} решённых из ${row.totalCases} созданных${
                row.openCases > 0 ? `, ${row.openCases} ещё открыты` : ''
              }`
        }
      >
        {row.totalCases > 0 ? (
          <>
            {row.resolvedCases}/{row.totalCases}
            {row.openCases > 0 && (
              <span className="text-[10px] text-amber-600 ml-1">+{row.openCases} откр.</span>
            )}
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-2 text-right tabular-nums">
        {row.churnMatches === 0 ? (
          <span className="text-slate-300" title="Нет сообщений с фразами оттока">
            —
          </span>
        ) : (
          <button
            onClick={() => onChurnClick(row.channelId, row.channelName)}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded hover:opacity-80 ${
              row.churnMatches >= 3
                ? 'bg-rose-100 text-rose-800'
                : 'bg-amber-100 text-amber-800'
            }`}
            title={`${row.churnMatches} сообщений со словами «отключаемся», «расторгаем», «uzamiz» и т.п. Нажмите, чтобы увидеть.`}
          >
            ⚠ {row.churnMatches}
          </button>
        )}
      </td>
      <td
        className="px-4 py-2 text-right text-xs text-slate-500"
        title={row.lastMessageAt ? new Date(row.lastMessageAt).toLocaleString('ru-RU') : 'Нет сообщений'}
      >
        {formatDays(row.daysSinceLastMessage)}
      </td>
    </tr>
  )
}
