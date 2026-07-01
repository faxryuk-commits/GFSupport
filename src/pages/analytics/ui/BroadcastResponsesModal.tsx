import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Loader2,
  AlertCircle,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
} from 'lucide-react'
import { Modal } from '@/shared/ui'
import {
  fetchBroadcastResponses,
  type BroadcastResponsesResponse,
  type ReplySentiment,
} from '@/shared/api'

interface BroadcastResponsesModalProps {
  isOpen: boolean
  onClose: () => void
  broadcastId: string | null
}

const SENTIMENT_STYLE: Record<string, string> = {
  positive: 'bg-emerald-100 text-emerald-800',
  neutral: 'bg-slate-100 text-slate-700',
  negative: 'bg-rose-100 text-rose-800',
  frustrated: 'bg-rose-200 text-rose-900',
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—'
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return 'только что'
  if (diffMin < 60) return `${diffMin} мин назад`
  const hrs = Math.round(diffMin / 60)
  if (hrs < 24) return `${hrs} ч назад`
  return `${Math.round(hrs / 24)} дн назад`
}

function fmtMinutesDuration(min: number | null): string {
  if (min === null) return '—'
  if (min < 60) return `${min} мин`
  const hrs = Math.round(min / 60)
  if (hrs < 24) return `${hrs} ч`
  return `${Math.round(hrs / 24)} дн`
}

export function BroadcastResponsesModal({
  isOpen,
  onClose,
  broadcastId,
}: BroadcastResponsesModalProps) {
  const [data, setData] = useState<BroadcastResponsesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'replied' | 'silent'>('all')

  useEffect(() => {
    if (!isOpen || !broadcastId) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchBroadcastResponses(broadcastId)
      .then((r) => { if (!cancelled) setData(r) })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [isOpen, broadcastId])

  const filtered =
    data?.recipients.filter((r) => {
      if (filter === 'replied') return r.replied
      if (filter === 'silent') return r.status === 'delivered' && !r.replied
      return true
    }) ?? []

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Ответы на outreach" size="lg">
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-900">{error}</div>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Сводка */}
            <section className="bg-slate-50 border border-[#e8edf3] rounded-md p-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <SummaryStat
                  label="Доставлено"
                  value={`${data.summary.delivered} / ${data.summary.total}`}
                  icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                />
                <SummaryStat
                  label="Ответили"
                  value={`${data.summary.responded}`}
                  icon={<MessageSquare className="w-4 h-4 text-blue-500" />}
                />
                <SummaryStat
                  label="Response Rate"
                  value={`${data.summary.responseRate}%`}
                  icon={<MessageSquare className="w-4 h-4 text-violet-500" />}
                />
                <SummaryStat
                  label="Окно"
                  value={`${Math.round(data.summary.windowHours / 24)} дн`}
                  icon={<Clock className="w-4 h-4 text-slate-400" />}
                />
              </div>
              {/* Sentiment ответов */}
              {data.summary.responded > 0 && (
                <div className="mt-3 pt-3 border-t border-[#e8edf3] flex flex-wrap gap-2 text-xs">
                  <span className="text-slate-500 font-medium">Sentiment ответов:</span>
                  {(['positive', 'neutral', 'negative', 'frustrated', 'unscored'] as const).map(
                    (k) =>
                      data.summary.sentimentBreakdown[k] > 0 ? (
                        <span
                          key={k}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${
                            k === 'unscored'
                              ? 'bg-slate-100 text-slate-600'
                              : SENTIMENT_STYLE[k] || ''
                          }`}
                        >
                          {k === 'unscored' ? 'не оценено' : k}
                          <span className="font-semibold">
                            {data.summary.sentimentBreakdown[k]}
                          </span>
                        </span>
                      ) : null,
                  )}
                </div>
              )}
            </section>

            {/* Текст самой кампании */}
            <details className="bg-white border border-[#e8edf3] rounded-md">
              <summary className="cursor-pointer px-3 py-2 text-xs text-slate-600 font-medium hover:bg-slate-50">
                Текст рассылки
              </summary>
              <div className="px-3 pb-3 text-sm text-slate-700 whitespace-pre-wrap">
                {data.campaign.messageText}
              </div>
            </details>

            {/* Фильтры */}
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1 rounded-md border ${
                  filter === 'all'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                Все ({data.summary.total})
              </button>
              <button
                onClick={() => setFilter('replied')}
                className={`px-3 py-1 rounded-md border ${
                  filter === 'replied'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                Ответили ({data.summary.responded})
              </button>
              <button
                onClick={() => setFilter('silent')}
                className={`px-3 py-1 rounded-md border ${
                  filter === 'silent'
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                Молчат ({data.summary.delivered - data.summary.responded})
              </button>
            </div>

            {/* Список получателей */}
            <ul className="space-y-2">
              {filtered.length === 0 && (
                <li className="text-center py-6 text-slate-500 text-sm">
                  Нет получателей в этой выборке
                </li>
              )}
              {filtered.map((r) => (
                <li key={r.channelId} className="border border-[#e8edf3] rounded-md p-3">
                  <header className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                    <Link
                      to={`/chats/${r.channelId}`}
                      className="text-sm font-medium text-slate-800 hover:text-blue-600"
                    >
                      {r.channelName || r.channelId}
                    </Link>
                    <div className="flex items-center gap-2 text-xs">
                      {r.status === 'delivered' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" />
                          доставлено
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-700">
                          <XCircle className="w-3 h-3" />
                          {r.status}
                        </span>
                      )}
                      {r.replied ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded">
                          ответил{r.replyCount > 1 && `, ${r.replyCount} сообщ.`}
                        </span>
                      ) : r.status === 'delivered' ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-rose-100 text-rose-800 rounded">
                          молчит
                        </span>
                      ) : null}
                    </div>
                  </header>

                  {r.replied && r.firstReplyText && (
                    <>
                      <div className="mt-2 text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                        <Clock className="w-3 h-3" />
                        <span>через {fmtMinutesDuration(r.replyMinutesAfter)}</span>
                        <span>·</span>
                        <span>{fmtRelative(r.firstReplyAt)}</span>
                        {r.firstReplySentiment && (
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded ${
                              SENTIMENT_STYLE[r.firstReplySentiment] ||
                              'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {r.firstReplySentiment}
                          </span>
                        )}
                      </div>
                      <blockquote className="mt-1.5 bg-slate-50 border-l-2 border-blue-300 pl-3 py-1 text-sm text-slate-700 whitespace-pre-wrap break-words">
                        {r.firstReplyText}
                      </blockquote>
                    </>
                  )}

                  {!r.replied && r.status === 'delivered' && r.deliveredAt && (
                    <div className="mt-1 text-xs text-slate-500">
                      Доставлено {fmtRelative(r.deliveredAt)}, ответа пока нет
                    </div>
                  )}

                  <div className="mt-1.5 text-right">
                    <Link
                      to={`/chats/${r.channelId}`}
                      className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
                    >
                      Открыть чат <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  )
}

function SummaryStat({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-0.5">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-bold text-slate-900 tabular-nums">{value}</div>
    </div>
  )
}
