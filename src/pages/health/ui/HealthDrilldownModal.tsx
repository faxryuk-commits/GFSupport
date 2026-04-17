import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X, Loader2, Mic, Video, Image as ImageIcon, FileText, MessageSquare,
  ArrowRight, Frown, Meh, Smile, AlertTriangle,
} from 'lucide-react'
import {
  fetchHealthDrilldown,
  type HealthDrillKind,
  type HealthDrillPayload,
  type HealthPeriod,
} from '@/shared/api'

interface Props {
  kind: HealthDrillKind
  value: string
  title: string
  period: HealthPeriod
  onClose: () => void
}

const KIND_LABELS: Record<HealthDrillKind, string> = {
  topic: 'Тема',
  intent: 'Намерение',
  content_type: 'Тип сообщений',
  language: 'Язык',
}

export function HealthDrilldownModal({ kind, value, title, period, onClose }: Props) {
  const navigate = useNavigate()
  const [data, setData] = useState<HealthDrillPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErr(null)
    fetchHealthDrilldown({ kind, value, period, limit: 25 })
      .then((r) => {
        if (alive) setData(r)
      })
      .catch((e) => {
        console.error(e)
        if (alive) setErr('Не удалось загрузить примеры')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [kind, value, period])

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  const goToChannel = (channelId: string) => {
    navigate(`/chats?channel=${channelId}`)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-slate-500 uppercase tracking-wide">{KIND_LABELS[kind]}</div>
            <div className="text-lg font-semibold text-slate-800 truncate">{title}</div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg"
            title="Закрыть"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* channels quick-jump */}
        {data && data.channels.length > 0 && (
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
            <div className="text-xs text-slate-500 mb-2">Топ каналов по этому срезу</div>
            <div className="flex flex-wrap gap-1.5">
              {data.channels.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => goToChannel(ch.id)}
                  className="px-2.5 py-1 bg-white border border-slate-200 hover:border-blue-400 hover:bg-blue-50 text-sm text-slate-700 rounded-md flex items-center gap-1.5 transition-colors"
                >
                  <span className="font-medium truncate max-w-[180px]">{ch.name}</span>
                  <span className="text-xs text-slate-400">×{ch.count}</span>
                  <ArrowRight className="w-3 h-3 text-slate-400" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-10 flex justify-center">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            </div>
          )}
          {err && (
            <div className="p-10 text-center">
              <AlertTriangle className="w-6 h-6 text-red-500 mx-auto mb-2" />
              <p className="text-sm text-slate-600">{err}</p>
            </div>
          )}
          {data && !loading && data.items.length === 0 && (
            <div className="p-10 text-center text-sm text-slate-400">
              Нет примеров за выбранный период
            </div>
          )}
          {data && !loading && data.items.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {data.items.map((it) => (
                <li
                  key={it.id}
                  className="px-5 py-3 hover:bg-slate-50 cursor-pointer"
                  onClick={() => goToChannel(it.channelId)}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex-shrink-0">{contentIcon(it.contentType)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 mb-1">
                        <span className="font-medium text-slate-700">{it.channelName}</span>
                        <span>·</span>
                        <span>{it.senderName}</span>
                        <span>·</span>
                        <span>{formatTime(it.createdAt)}</span>
                        {it.aiUrgency >= 3 && (
                          <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-[10px] font-semibold">
                            СРОЧНО
                          </span>
                        )}
                        {sentimentBadge(it.aiSentiment)}
                        {it.transcriptLanguage && (
                          <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium uppercase">
                            {it.transcriptLanguage}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">
                        {previewText(it)}
                      </div>
                      {it.aiSummary && (
                        <div className="text-xs text-slate-500 mt-1 italic">
                          AI: {it.aiSummary}
                        </div>
                      )}
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-300 flex-shrink-0 mt-1" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function contentIcon(ct: string) {
  const key = (ct || '').toLowerCase()
  const cls = 'w-5 h-5'
  if (key === 'voice' || key === 'audio') return <Mic className={`${cls} text-blue-500`} />
  if (key === 'video' || key === 'video_note' || key === 'animation') return <Video className={`${cls} text-purple-500`} />
  if (key === 'photo' || key === 'image') return <ImageIcon className={`${cls} text-emerald-500`} />
  if (key === 'document' || key === 'file') return <FileText className={`${cls} text-slate-500`} />
  return <MessageSquare className={`${cls} text-slate-400`} />
}

function previewText(it: {
  text: string
  transcript: string
  contentType: string
}): string {
  const key = (it.contentType || '').toLowerCase()
  if (key === 'voice' || key === 'audio' || key === 'video' || key === 'video_note') {
    return it.transcript || it.text || '(медиа-сообщение без расшифровки)'
  }
  if (key === 'photo' || key === 'image') {
    return it.text || '(фото)'
  }
  if (key === 'document' || key === 'file') {
    return it.text || '(документ)'
  }
  return it.text || it.transcript || '(без текста)'
}

function sentimentBadge(s: string | null) {
  if (!s) return null
  const key = s.toLowerCase()
  if (key === 'negative' || key === 'frustrated') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-red-50 text-red-600 rounded text-[10px] font-medium">
        <Frown className="w-3 h-3" />
        негатив
      </span>
    )
  }
  if (key === 'positive') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-[10px] font-medium">
        <Smile className="w-3 h-3" />
        позитив
      </span>
    )
  }
  if (key === 'neutral') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-medium">
        <Meh className="w-3 h-3" />
        нейтр.
      </span>
    )
  }
  return null
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffH = (now.getTime() - d.getTime()) / 3600000
  if (diffH < 1) return `${Math.max(1, Math.round(diffH * 60))} мин назад`
  if (diffH < 24) return `${Math.round(diffH)}ч назад`
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}
