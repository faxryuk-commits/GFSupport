import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, AlertCircle, ExternalLink, MessageSquare, TrendingUp } from 'lucide-react'
import { Modal } from '@/shared/ui'
import {
  fetchProblemDrill,
  type ProblemDrillResponse,
  type ProblemMessage,
} from '@/shared/api'

interface ProblemDrillModalProps {
  isOpen: boolean
  onClose: () => void
  domain: string | null
  domainLabel: string | null
  subcategory: string | null
  subcategoryLabel: string | null
  period: '7d' | '30d' | '90d'
  source?: 'all' | 'telegram' | 'whatsapp'
}

const SENTIMENT_STYLE: Record<string, string> = {
  positive: 'bg-emerald-100 text-emerald-800',
  neutral: 'bg-slate-100 text-slate-700',
  negative: 'bg-rose-100 text-rose-800',
  frustrated: 'bg-rose-200 text-rose-900',
}

const STATUS_LABEL: Record<string, string> = {
  resolved: 'решено',
  closed: 'закрыт',
  in_progress: 'в работе',
  detected: 'обнаружено',
  waiting: 'ожидание',
  blocked: 'заблокирован',
  no_case: 'без кейса',
}

export function ProblemDrillModal({
  isOpen,
  onClose,
  domain,
  domainLabel,
  subcategory,
  subcategoryLabel,
  period,
  source,
}: ProblemDrillModalProps) {
  const [data, setData] = useState<ProblemDrillResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTheme, setActiveTheme] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !domain) {
      setData(null)
      setActiveTheme(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchProblemDrill({
      domain,
      subcategory,
      period,
      source: source === 'all' ? undefined : source,
    })
      .then((r) => { if (!cancelled) setData(r) })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [isOpen, domain, subcategory, period, source])

  const total = data?.recentMessages.length ?? 0
  const totalAll = data ? data.byStatus.reduce((s, x) => s + x.count, 0) : 0
  const filteredMessages = activeTheme
    ? data?.recentMessages.filter((m) => m.theme === activeTheme) ?? []
    : data?.recentMessages ?? []

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Детализация · ${domainLabel || domain} → ${subcategoryLabel || subcategory || '—'}`}
      size="xl"
    >
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
            <header className="bg-slate-50 border border-slate-200 rounded-md p-3 text-xs text-slate-700 flex flex-wrap gap-3">
              <span>
                Всего обращений: <strong className="text-slate-900">{totalAll}</strong>
              </span>
              <span>·</span>
              <span>Период: {data.period.days} дн</span>
              <span>·</span>
              <span>Источник: {data.source === 'all' ? 'все' : data.source}</span>
            </header>

            {/* Sentiment + Status в одной строке */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <DistributionCard title="По состоянию" items={data.byStatus.map((x) => ({
                key: x.status || 'unknown',
                label: STATUS_LABEL[x.status || 'unknown'] || (x.status || 'unknown'),
                count: x.count,
              }))} />
              <DistributionCard title="По настроению" items={data.bySentiment.map((x) => ({
                key: x.sentiment || 'unknown',
                label: x.sentiment || 'unknown',
                count: x.count,
                colorClass: SENTIMENT_STYLE[x.sentiment || 'unknown'],
              }))} />
            </div>

            {/* Top intents (более узкие, чем темы) */}
            {data.topIntents.length > 0 && (
              <section className="bg-white border border-slate-200 rounded-md p-3">
                <h4 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
                  Топ intents
                </h4>
                <div className="flex flex-wrap gap-2">
                  {data.topIntents.map((i) => (
                    <span
                      key={i.intent || 'null'}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded"
                    >
                      <span className="font-mono">{i.intent || '—'}</span>
                      <span className="text-slate-500">·</span>
                      <span className="font-semibold">{i.count}</span>
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Top themes (свободные строки от LLM) */}
            {data.topThemes.length > 0 && (
              <section className="bg-white border border-slate-200 rounded-md p-3">
                <h4 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
                  Топ тем (ai_theme — формулировки LLM)
                </h4>
                <ul className="space-y-1.5">
                  {data.topThemes.map((t) => (
                    <li key={t.theme || 'null'}>
                      <button
                        onClick={() => setActiveTheme(activeTheme === t.theme ? null : t.theme)}
                        className={`w-full text-left flex items-start gap-3 p-2 rounded hover:bg-slate-50 ${
                          activeTheme === t.theme ? 'bg-blue-50 ring-1 ring-blue-200' : ''
                        }`}
                      >
                        <TrendingUp className="w-3.5 h-3.5 mt-1 text-slate-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-800 truncate">
                            {t.theme || '—'}
                          </div>
                          {t.sampleText && (
                            <div className="text-xs text-slate-500 mt-0.5 truncate italic">
                              «{t.sampleText}»
                            </div>
                          )}
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-slate-700 flex-shrink-0">
                          {t.count}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {activeTheme && (
                  <div className="mt-2 text-xs text-blue-700">
                    Сообщения ниже отфильтрованы по теме «{activeTheme}» ·{' '}
                    <button onClick={() => setActiveTheme(null)} className="underline">
                      сбросить
                    </button>
                  </div>
                )}
              </section>
            )}

            {/* Top channels — кто чаще жалуется */}
            {data.topChannels.length > 0 && (
              <section className="bg-white border border-slate-200 rounded-md p-3">
                <h4 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
                  Топ покупателей с этой проблемой
                </h4>
                <ul className="space-y-1">
                  {data.topChannels.map((c) => (
                    <li
                      key={c.channelId}
                      className="flex items-center gap-2 text-sm py-1 border-b border-slate-100 last:border-0"
                    >
                      <Link
                        to={`/chats/${c.channelId}`}
                        className="flex-1 text-slate-800 hover:text-blue-600 truncate"
                      >
                        {c.channelName || c.channelId}
                      </Link>
                      <span className="text-[10px] text-slate-400">
                        {c.source === 'whatsapp' ? 'WA' : 'TG'}
                      </span>
                      <span className="font-semibold tabular-nums text-slate-700">{c.count}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Recent messages */}
            <section className="bg-white border border-slate-200 rounded-md p-3">
              <h4 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
                Последние сообщения · {filteredMessages.length} из {total}
              </h4>
              {filteredMessages.length === 0 ? (
                <div className="text-sm text-slate-500 text-center py-4">
                  Нет сообщений
                </div>
              ) : (
                <ul className="space-y-2">
                  {filteredMessages.map((m) => (
                    <MessageItem key={m.messageId} m={m} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  )
}

function DistributionCard({
  title,
  items,
}: {
  title: string
  items: Array<{ key: string; label: string; count: number; colorClass?: string }>
}) {
  const total = items.reduce((s, x) => s + x.count, 0) || 1
  return (
    <div className="bg-white border border-slate-200 rounded-md p-3">
      <h4 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
        {title}
      </h4>
      <ul className="space-y-1.5">
        {items.map((it) => {
          const pct = Math.round((it.count / total) * 100)
          return (
            <li key={it.key} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate text-slate-700">{it.label}</span>
              <div className="w-24 h-1.5 bg-slate-100 rounded overflow-hidden">
                <div
                  className={it.colorClass || 'bg-slate-400'}
                  style={{ width: `${pct}%`, height: '100%' }}
                />
              </div>
              <span className="text-xs tabular-nums text-slate-500 w-12 text-right">
                {it.count} · {pct}%
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function MessageItem({ m }: { m: ProblemMessage }) {
  const date = new Date(m.createdAt)
  return (
    <li className="border border-slate-100 rounded-md p-2.5 hover:border-slate-200">
      <header className="flex items-center justify-between gap-2 mb-1 text-xs text-slate-500 flex-wrap">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-3 h-3" />
          <Link to={`/chats/${m.channelId}`} className="hover:text-blue-600 font-medium text-slate-700">
            {m.channelName || m.channelId}
          </Link>
          <span>·</span>
          <span>{date.toLocaleDateString('ru-RU')}</span>
        </div>
        <div className="flex items-center gap-1">
          {m.sentiment && (
            <span
              className={`px-1.5 py-0.5 text-[10px] rounded ${
                SENTIMENT_STYLE[m.sentiment] || 'bg-slate-100 text-slate-600'
              }`}
            >
              {m.sentiment}
            </span>
          )}
          {m.caseStatus && m.caseStatus !== 'no_case' && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-100 text-blue-800">
              {STATUS_LABEL[m.caseStatus] || m.caseStatus}
            </span>
          )}
        </div>
      </header>
      <div className="text-sm text-slate-800 whitespace-pre-wrap break-words leading-relaxed">
        {m.text}
      </div>
      {m.theme && (
        <div className="mt-1 text-[10px] text-slate-400">
          тема: <span className="font-mono">{m.theme}</span>
          {m.intent && <span> · intent: <span className="font-mono">{m.intent}</span></span>}
        </div>
      )}
      <div className="mt-1.5 text-right">
        <Link
          to={`/chats/${m.channelId}`}
          className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
        >
          Открыть чат <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
    </li>
  )
}
