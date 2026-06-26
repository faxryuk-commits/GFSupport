import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, AlertCircle, MessageSquare, ExternalLink } from 'lucide-react'
import { Modal } from '@/shared/ui'
import {
  fetchChurnSignals,
  type ChurnSignalsResponse,
  type ChurnSignalRow,
  type ChurnSeverity,
  type ChurnCategory,
} from '@/shared/api'

interface ChurnDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  channelId: string | null
  channelName: string | null
  period: '7d' | '30d' | '90d'
}

const SEVERITY_STYLES: Record<ChurnSeverity, { chip: string; label: string }> = {
  high: { chip: 'bg-rose-100 text-rose-800 border-rose-200', label: 'высокая' },
  medium: { chip: 'bg-amber-100 text-amber-800 border-amber-200', label: 'средняя' },
  low: { chip: 'bg-slate-100 text-slate-700 border-[#e8edf3]', label: 'низкая' },
}

const CATEGORY_LABELS: Record<ChurnCategory, string> = {
  leaving: 'уход',
  competitor: 'конкурент',
  disappointed: 'разочарован',
  refund: 'возврат',
}

function highlightChurnPhrases(text: string, phrases: string[]): React.ReactNode[] {
  // Простой highlight: подсвечиваем те части текста, которые включают
  // ключевые слова phrases. Для аккуратности — case-insensitive split.
  if (!text || phrases.length === 0) return [text]
  // Самые длинные фразы первыми, чтобы не разбивать на куски.
  const sorted = [...new Set(phrases)].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(
    `(${sorted
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')})`,
    'gi',
  )
  const parts = text.split(pattern)
  return parts.map((part, i) => {
    if (sorted.some((p) => part.toLowerCase() === p.toLowerCase())) {
      return (
        <mark key={i} className="bg-rose-100 text-rose-900 px-0.5 rounded">
          {part}
        </mark>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export function ChurnDetailsModal({
  isOpen,
  onClose,
  channelId,
  channelName,
  period,
}: ChurnDetailsModalProps) {
  const [data, setData] = useState<ChurnSignalsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !channelId) {
      setData(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchChurnSignals({ channelId, period, limit: 50 })
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
  }, [isOpen, channelId, period])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Churn-сигналы · ${channelName || channelId || '—'}`}
      size="lg"
    >
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
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
            <header className="bg-rose-50 border border-rose-200 rounded-md p-3 text-sm">
              <div className="font-semibold text-rose-900">
                Найдено {data.total} сообщений с сигналами оттока
              </div>
              <div className="text-xs text-rose-800 mt-1">
                За период {data.period.label}. Сообщения, где клиент использовал фразы вроде
                «отключаемся», «расторгаем», «uzamiz», «cancel subscription». Каждое снимает
                25 очков с компонента «churn» в Health Score.
              </div>
              {channelId && (
                <Link
                  to={`/chats/${channelId}`}
                  className="inline-flex items-center gap-1 mt-2 text-xs text-blue-700 hover:text-blue-900 underline"
                >
                  Открыть чат целиком
                  <ExternalLink className="w-3 h-3" />
                </Link>
              )}
            </header>

            {data.rows.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                За период churn-сигналов в этом канале не зафиксировано
              </div>
            ) : (
              <ul className="space-y-3">
                {data.rows.map((row) => (
                  <ChurnRow key={row.messageId} row={row} channelId={channelId} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function ChurnRow({ row, channelId }: { row: ChurnSignalRow; channelId: string | null }) {
  const phrases = row.matches.map((m) => m.phrase)
  const sevStyle = SEVERITY_STYLES[row.maxSeverity]
  const date = new Date(row.createdAt)

  return (
    <li className="border border-[#e8edf3] rounded-lg p-3 hover:border-slate-300">
      <header className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <MessageSquare className="w-3.5 h-3.5" />
          <span className="font-medium text-slate-700">{row.senderName || 'Клиент'}</span>
          <span>·</span>
          <span title={date.toLocaleString('ru-RU')}>{date.toLocaleDateString('ru-RU')}</span>
        </div>
        <span
          className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded border ${sevStyle.chip}`}
          title={`Серьёзность сигнала: ${sevStyle.label}`}
        >
          {sevStyle.label}
        </span>
      </header>

      <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap break-words bg-slate-50 rounded p-2 border border-slate-100">
        {highlightChurnPhrases(row.text, phrases)}
      </div>

      <footer className="flex items-center justify-between gap-3 mt-2 flex-wrap">
        <div className="flex flex-wrap gap-1.5">
          {row.matches.length === 0 ? (
            <span
              className="text-[10px] text-slate-500 italic"
              title="SQL-предфильтр счёл слово относящимся к оттоку, но точный паттерн не сработал. Проверьте контекст."
            >
              ключевое слово найдено · точный паттерн не сработал
            </span>
          ) : (
            row.matches.map((m, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded ${SEVERITY_STYLES[m.severity].chip}`}
                title={`Категория: ${CATEGORY_LABELS[m.category]}`}
              >
                {m.phrase}
              </span>
            ))
          )}
        </div>
        {channelId && (
          <Link
            to={`/chats/${channelId}`}
            className="text-xs text-blue-600 hover:text-blue-800 underline"
          >
            Открыть чат →
          </Link>
        )}
      </footer>
    </li>
  )
}
