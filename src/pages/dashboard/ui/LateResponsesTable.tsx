import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Loader2, ArrowUpDown, MessageSquare, ExternalLink } from 'lucide-react'
import { fetchResponseTimeDetails, type ResponseTimeDetailRow } from '@/shared/api/analytics'

type FilterMode = 'late' | 'unanswered'
type SortKey = 'responseMinutes' | 'clientMessageTime' | 'channelName'

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
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('responseMinutes')
  const [sortAsc, setSortAsc] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchResponseTimeDetails({
      bucket: filter === 'unanswered' ? 'unanswered' : 'late',
      period: dateRange,
      limit: 100,
    })
      .then((r) => {
        if (!cancelled) setRows(r.details)
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dateRange, marketKey, filter])

  const sorted = useMemo(() => {
    const list = [...rows]
    list.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'responseMinutes') {
        const av = a.responseMinutes ?? 9999
        const bv = b.responseMinutes ?? 9999
        cmp = av - bv
      } else if (sortKey === 'clientMessageTime') {
        cmp = new Date(a.clientMessageTime).getTime() - new Date(b.clientMessageTime).getTime()
      } else {
        cmp = a.channelName.localeCompare(b.channelName, 'ru')
      }
      return sortAsc ? cmp : -cmp
    })
    return list
  }, [rows, sortKey, sortAsc])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(key === 'channelName')
    }
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
    <div className="bg-white rounded-xl border border-[#e8edf3]">
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <Clock className="w-5 h-5 text-orange-500" />
            Поздние ответы
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Клиентские каналы · сортировка по времени первого ответа
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
      ) : sorted.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-500">
          {filter === 'late'
            ? 'Нет ответов дольше 10 минут за выбранный период'
            : 'Нет запросов без ответа в 4-часовом окне'}
        </div>
      ) : (
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
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold tabular-nums ${frtTone(row.responseMinutes)}`}
                    >
                      {formatFrt(row.responseMinutes)}
                    </span>
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
                    <Link
                      to={`/chats/${row.channelId}`}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg inline-flex"
                      title="Открыть чат"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
