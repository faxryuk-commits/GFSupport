import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, AlertTriangle, CheckCircle, Clock, Loader2, RefreshCw,
  Send, Square, XCircle,
} from 'lucide-react'
import { Modal, ConfirmDialog } from '@/shared/ui'
import {
  fetchBroadcastProgress,
  fetchBroadcastRecipients,
  retryBroadcast,
  type BroadcastProgress,
  type BroadcastRecipient,
  type ScheduledBroadcast,
} from '@/shared/api'

const ERROR_LABELS: Record<string, string> = {
  user_blocked: 'Пользователь заблокировал бота',
  bot_kicked: 'Бот удалён из чата',
  chat_not_found: 'Чат не найден',
  chat_upgraded: 'Чат обновлён до супергруппы',
  chat_dead: 'Чат деактивирован',
  user_dead: 'Аккаунт удалён',
  bad_request: 'Некорректный запрос',
  rate_limit: 'Лимит Telegram',
  transient: 'Временная ошибка',
  transient_exhausted: 'Не доставлено после ретраев',
  no_token: 'Не настроен Telegram bot token',
  unknown: 'Неизвестная ошибка',
}

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  queued:    { label: 'В очереди',     tone: 'bg-blue-50 text-blue-700' },
  running:   { label: 'Идёт отправка', tone: 'bg-amber-50 text-amber-700' },
  completed: { label: 'Завершено',     tone: 'bg-green-50 text-green-700' },
  partial:   { label: 'Частично',      tone: 'bg-orange-50 text-orange-700' },
  failed:    { label: 'Ошибка',        tone: 'bg-red-50 text-red-700' },
  cancelled: { label: 'Отменено',      tone: 'bg-slate-100 text-slate-600' },
  sent:      { label: 'Отправлено',    tone: 'bg-green-50 text-green-700' },
}

type Props = {
  isOpen: boolean
  broadcast: ScheduledBroadcast | null
  onClose: () => void
  onCancel: (id: string) => void
  onChanged: () => void
  formatDate: (date: string | null) => string
}

export function BroadcastDetailsModal({ isOpen, broadcast, onClose, onCancel, onChanged, formatDate }: Props) {
  const [progress, setProgress] = useState<BroadcastProgress | null>(null)
  const [failedItems, setFailedItems] = useState<BroadcastRecipient[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'failed'>('overview')

  const broadcastId = broadcast?.id

  const isLive = useMemo(() => {
    const s = progress?.broadcast.status
    return s === 'queued' || s === 'running'
  }, [progress])

  useEffect(() => {
    if (!isOpen || !broadcastId) return
    let cancelled = false

    async function load() {
      try {
        const [p, r] = await Promise.all([
          fetchBroadcastProgress(broadcastId!),
          fetchBroadcastRecipients(broadcastId!, 'failed', 50, 0),
        ])
        if (cancelled) return
        setProgress(p)
        setFailedItems(r.items)
      } catch (e) {
        // Silent: модалка остаётся с предыдущими данными
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    setIsLoading(true)
    load()
    const interval = setInterval(load, 2500)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isOpen, broadcastId])

  const handleRetry = async () => {
    if (!broadcastId) return
    try {
      setIsRetrying(true)
      const result = await retryBroadcast(broadcastId, 'failed')
      if (result.requeued > 0) {
        onChanged()
      }
    } finally {
      setIsRetrying(false)
    }
  }

  if (!broadcast) return null

  const totals = progress?.totals
  const status = progress?.broadcast.status || broadcast.rawStatus || broadcast.status
  const statusCfg = STATUS_LABELS[status] || { label: status, tone: 'bg-slate-100 text-slate-600' }
  const total = totals?.total ?? broadcast.recipientsCount ?? 0
  const delivered = totals?.delivered ?? broadcast.deliveredCount ?? 0
  const failed = totals?.failed ?? broadcast.failedCount ?? 0
  const queued = (totals?.queued ?? 0) + (totals?.sending ?? 0)
  const skipped = totals?.skipped ?? 0
  const progressPct = total > 0 ? Math.round((delivered / total) * 100) : 0

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Детали рассылки" size="lg">
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full ${statusCfg.tone}`}>
                {isLive && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {statusCfg.label}
              </span>
              {broadcast.senderName && (
                <span className="text-sm text-slate-500">от {broadcast.senderName}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {failed > 0 && status !== 'queued' && status !== 'running' && (
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={isRetrying}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
                  Повторить ошибки ({failed})
                </button>
              )}
              {(status === 'queued' || status === 'running') && (
                <button
                  type="button"
                  onClick={() => setShowCancel(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100"
                >
                  <Square className="w-4 h-4" />
                  Остановить
                </button>
              )}
            </div>
          </div>

          {/* Message */}
          <div>
            <p className="text-sm text-slate-500 mb-1">Сообщение</p>
            <p className="text-slate-800 whitespace-pre-wrap bg-slate-50 p-3 rounded-lg max-h-40 overflow-y-auto text-sm">
              {broadcast.messageText}
            </p>
          </div>

          {broadcast.mediaUrl && (
            <div>
              <p className="text-sm text-slate-500 mb-1">Вложение</p>
              <a href={broadcast.mediaUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-sm break-all">
                {broadcast.mediaUrl}
              </a>
            </div>
          )}

          {/* Progress bar */}
          <div className="bg-slate-50 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700">Прогресс</span>
              <span className="text-slate-600">
                {delivered} / {total} доставлено
                {progress && ` · ${progressPct}%`}
              </span>
            </div>
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden flex">
              {total > 0 && (
                <>
                  <div className="bg-green-500" style={{ width: `${(delivered / total) * 100}%` }} />
                  <div className="bg-red-400" style={{ width: `${(failed / total) * 100}%` }} />
                  <div className="bg-amber-300" style={{ width: `${(queued / total) * 100}%` }} />
                </>
              )}
            </div>
            <div className="grid grid-cols-4 gap-3 text-center pt-1">
              <Stat label="Получателей" value={total} color="text-slate-800" icon={Send} />
              <Stat label="Доставлено" value={delivered} color="text-green-600" icon={CheckCircle} />
              <Stat label="Ошибок" value={failed} color="text-red-600" icon={XCircle} />
              <Stat label="В очереди" value={queued} color="text-amber-600" icon={Clock} />
            </div>
            {skipped > 0 && (
              <p className="text-xs text-slate-500">Пропущено: {skipped} (отменено до отправки)</p>
            )}
          </div>

          {/* Tabs */}
          <div className="border-b border-slate-200 flex gap-4">
            <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>
              Обзор
            </TabButton>
            <TabButton active={activeTab === 'failed'} onClick={() => setActiveTab('failed')}>
              Не доставлено{failed > 0 ? ` (${failed})` : ''}
            </TabButton>
          </div>

          {activeTab === 'overview' ? (
            <OverviewTab
              broadcast={broadcast}
              progress={progress}
              formatDate={formatDate}
            />
          ) : (
            <FailedTab
              items={failedItems}
              isLoading={isLoading && failedItems.length === 0}
              total={failed}
            />
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={showCancel}
        onClose={() => setShowCancel(false)}
        onConfirm={() => {
          setShowCancel(false)
          if (broadcast) onCancel(broadcast.id)
        }}
        title="Остановить рассылку"
        message="Рассылка будет остановлена. Уже доставленные сообщения останутся."
        confirmText="Остановить"
        variant="danger"
      />
    </>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pb-2 px-1 text-sm font-medium transition-colors border-b-2 -mb-px ${
        active ? 'text-blue-600 border-blue-500' : 'text-slate-500 border-transparent hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  )
}

function Stat({ label, value, color, icon: Icon }: {
  label: string; value: number; color: string; icon: typeof Send
}) {
  return (
    <div className="flex flex-col items-center">
      <Icon className={`w-4 h-4 ${color} mb-1`} />
      <span className={`text-xl font-semibold ${color}`}>{value}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  )
}

function OverviewTab({ broadcast, progress, formatDate }: {
  broadcast: ScheduledBroadcast
  progress: BroadcastProgress | null
  formatDate: (date: string | null) => string
}) {
  return (
    <div className="space-y-4 text-sm">
      {progress && progress.errors.length > 0 && (
        <div>
          <p className="text-sm text-slate-500 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Причины ошибок
          </p>
          <div className="space-y-1.5">
            {progress.errors.map((err) => (
              <div key={err.code} className="flex items-center justify-between bg-red-50 px-3 py-2 rounded-lg">
                <span className="text-red-700">{ERROR_LABELS[err.code] || err.code}</span>
                <span className="font-semibold text-red-700">{err.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Аудитория" value={broadcast.filterType} />
        <Field label="Тип" value={broadcast.notificationType || 'announcement'} />
        <Field label="Создано" value={formatDate(broadcast.createdAt)} />
        <Field label="Запланировано" value={formatDate(broadcast.scheduledAt)} />
        {broadcast.startedAt && <Field label="Старт отправки" value={formatDate(broadcast.startedAt)} />}
        {broadcast.completedAt && <Field label="Завершено" value={formatDate(broadcast.completedAt)} />}
      </div>

      {broadcast.errorMessage && (
        <div className="bg-red-50 p-3 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5" />
          <p className="text-sm text-red-700">{broadcast.errorMessage}</p>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-medium text-slate-800 capitalize">{value}</p>
    </div>
  )
}

function FailedTab({ items, isLoading, total }: { items: BroadcastRecipient[]; isLoading: boolean; total: number }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Загрузка...
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500 text-sm">
        Все сообщения доставлены — нет ошибок.
      </div>
    )
  }
  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
      {items.map((it) => (
        <div key={it.id} className="flex items-start justify-between gap-3 bg-slate-50 p-2.5 rounded-lg">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-slate-800 text-sm truncate">{it.channelName || it.channelId}</p>
            <p className="text-xs text-red-600">
              {ERROR_LABELS[it.errorCode || ''] || it.errorMessage || it.errorCode || 'unknown'}
            </p>
          </div>
          <span className="text-xs text-slate-400 whitespace-nowrap">{it.attempts} попыток</span>
        </div>
      ))}
      {total > items.length && (
        <p className="text-xs text-slate-500 text-center pt-2">
          Показано {items.length} из {total}
        </p>
      )}
    </div>
  )
}
