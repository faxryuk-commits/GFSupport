import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock,
  Loader2,
  ArrowUpDown,
  MessageSquare,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  PenLine,
} from 'lucide-react'
import {
  fetchResponseTimeDetails,
  type ResponseTimeDetailRow,
} from '@/shared/api/analytics'
import { FrtOverrideModal } from '@/features/analytics/ui/FrtOverrideModal'

type FilterMode = 'late' | 'unanswered'
type SortKey = 'responseMinutes' | 'clientMessageTime' | 'channelName'

const PAGE_SIZE = 20

interface Props {
  dateRange: string
  marketKey?: string | null
}

function formatFrt(minutes: number | null): string {
  if (minutes == null) return 'Без ответа'
  if (minutes < 60) return `${minutes} мин`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function frtTone(minutes: number | null): string {
  if (minutes == null) return 'text-slate-600 bg-slate-100'
  if (minutes <= 10) return 'text-amber-700 bg-amber-50'
  if (minutes <= 60) return 'text-orange-700 bg-orange-50'
  return 'text-red-700 bg-red-50'
}

export function LateResponsesTable({ dateRange, marketKey }: Props) {
  const [filter, setFilter] = useState<FilterMode>('late')
  const [rows, setRows] = useState<ResponseTimeDetailRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('responseMinutes')
  const [sortAsc, setSortAsc] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [overrideRow, setOverrideRow] = useState<ResponseTimeDetailRow | null>(null)

  useEffect(() => {
    setPage(0)
  }, [dateRange, marketKey, filter])

  const loadRows = useCallback(() => {
    let cancelled = false
    setLoading(true)
    fetchResponseTimeDetails({
      bucket: filter === 'unanswered' ? 'unanswered' : 'late',
      period: dateRange,
      market: marketKey,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      sort: sortKey,
      sortDir: sortAsc ? 'asc' : 'desc',
    })
      .then((r) => {
        if (!cancelled) {
          setRows(r.details)
          setTotalCount(r.pagination.totalCount)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRows([])
          setTotalCount(0)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dateRange, marketKey, filter, page, sortKey, sortAsc])

  useEffect(() => {
    return loadRows()
  }, [loadRows, refreshToken])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageStart = page * PAGE_SIZE
  const pageEnd = Math.min(pageStart + rows.length, totalCount)

  const toggleSort = (key: SortKey) => {
    setPage(0)
    if (sortKey === key) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(key === 'channelName')
    }
  }

  const handleOverrideSaved = () => {
    setRefreshToken((t) => t + 1)
  }

  const SortHeader = ({ label, col }: { label: string; col: SortKey }) => (
    <button
      type="button"
      onClick={() => toggleSort(col)}
      className="inline-flex items-center gap-1 hover:text-slate-800 transition-colors"
    >
      {label}
      <ArrowUpDown className={`w-3.5 h-3.5 ${sortKey === col ? 'text-blue-500' : 'text-slate-300'}`} />
    </button>
  )

  return (
    <>
      <div className="bg-white rounded-xl border border-[#e8edf3]">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <Clock className="w-5 h-5 text-orange-500" />
              Поздние ответы
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Клиентские каналы (без internal) · ручная корректировка FRT доступна в строке
            </p>
          </div>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            <button
              type="button"
              onClick={() => setFilter('late')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === 'late' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              &gt; 10 мин
            </button>
            <button
              type="button"
              onClick={() => setFilter('unanswered')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === 'unanswered' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Без ответа
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Загрузка...
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            {filter === 'late'
              ? 'Нет ответов дольше 10 минут за выбранный период'
              : 'Нет запросов без ответа в 4-часовом окне'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">
                      <SortHeader label="Время ответа" col="responseMinutes" />
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">
                      <SortHeader label="Канал" col="channelName" />
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">
                      Сообщение
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">
                      Агент
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">
                      <SortHeader label="Дата запроса" col="clientMessageTime" />
                    </th>
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex w-fit px-2 py-0.5 rounded text-xs font-semibold tabular-nums ${frtTone(row.responseMinutes)}`}
                          >
                            {formatFrt(row.responseMinutes)}
                          </span>
                          {row.frtOverride?.type === 'manual' && (
                            <span className="text-[10px] text-blue-600 font-medium">вручную</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800 max-w-[160px] truncate">
                        {row.channelName}
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-[240px]">
                        <div className="flex items-start gap-1.5 min-w-0">
                          <MessageSquare className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                          <span className="truncate" title={row.clientMessage}>
                            {row.clientMessage || '—'}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400">{row.clientName}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {row.responseMinutes != null ? row.responderName : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs tabular-nums">
                        {formatWhen(row.clientMessageTime)}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => setOverrideRow(row)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg inline-flex"
                            title="Корректировка FRT"
                          >
                            <PenLine className="w-4 h-4" />
                          </button>
                          <Link
                            to={`/chats/${row.channelId}`}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg inline-flex"
                            title="Открыть чат"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalCount > PAGE_SIZE && (
              <footer className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-600">
                <div>
                  Показано{' '}
                  <span className="font-medium">
                    {pageStart + 1}–{pageEnd}
                  </span>{' '}
                  из <span className="font-medium">{totalCount}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
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
                    type="button"
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
          </>
        )}
      </div>

      <FrtOverrideModal
        row={overrideRow}
        isOpen={overrideRow !== null}
        onClose={() => setOverrideRow(null)}
        onSaved={handleOverrideSaved}
      />
    </>
  )
}
