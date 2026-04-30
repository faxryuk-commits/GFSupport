import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, AlertTriangle, CheckCircle, Clock, Copy, Loader2, RefreshCw,
  Search, Send, Square, XCircle,
} from 'lucide-react'
import { Modal, ConfirmDialog } from '@/shared/ui'
import {
  fetchBroadcastProgress,
  fetchBroadcastRecipients,
  retryBroadcast,
  cloneUndeliveredBroadcast,
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

type RecipientStatus = 'all' | 'delivered' | 'queued' | 'sending' | 'failed' | 'skipped'

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
  const [isLoadingProgress, setIsLoadingProgress] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [isCloning, setIsCloning] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [showCloneConfirm, setShowCloneConfirm] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'recipients'>('overview')
  const [recipientStatus, setRecipientStatus] = useState<RecipientStatus>('all')
  const [recipientSearch, setRecipientSearch] = useState('')
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([])
  const [recipientsTotal, setRecipientsTotal] = useState(0)
  const [isLoadingRecipients, setIsLoadingRecipients] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const broadcastId = broadcast?.id

  const isLive = useMemo(() => {
    const s = progress?.broadcast.status
    return s === 'queued' || s === 'running'
  }, [progress])

  // Polling прогресса.
  useEffect(() => {
    if (!isOpen || !broadcastId) return
    let cancelled = false

    async function loadProgress() {
      try {
        const p = await fetchBroadcastProgress(broadcastId!)
        if (cancelled) return
        setProgress(p)
      } catch {
        // Silent
      } finally {
        if (!cancelled) setIsLoadingProgress(false)
      }
    }

    setIsLoadingProgress(true)
    loadProgress()
    const interval = setInterval(loadProgress, 2500)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isOpen, broadcastId])

  // Загрузка получателей при смене таба, фильтра, поиска.
  useEffect(() => {
    if (!isOpen || !broadcastId || activeTab !== 'recipients') return
    let cancelled = false

    async function load() {
      try {
        setIsLoadingRecipients(true)
        const r = await fetchBroadcastRecipients(
          broadcastId!,
          recipientStatus,
          recipientSearch,
          200,
          0,
        )
        if (cancelled) return
        setRecipients(r.items)
        setRecipientsTotal(r.total)
      } catch {
        // Silent
      } finally {
        if (!cancelled) setIsLoadingRecipients(false)
      }
    }

    const debounce = setTimeout(load, recipientSearch ? 300 : 0)

    // Polling получателей пока live.
    let interval: ReturnType<typeof setInterval> | null = null
    if (isLive) {
      interval = setInterval(load, 4000)
    }

    return () => {
      cancelled = true
      clearTimeout(debounce)
      if (interval) clearInterval(interval)
    }
  }, [isOpen, broadcastId, activeTab, recipientStatus, recipientSearch, isLive])

  const handleRetry = async () => {
    if (!broadcastId) return
    try {
      setIsRetrying(true)
      const result = await retryBroadcast(broadcastId, 'failed')
      if (result.requeued > 0) {
        setToast(`Поднято ${result.requeued} получателей в очередь`)
        onChanged()
      } else {
        setToast('Нечего повторять — нет failed-получателей')
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Ошибка повтора')
    } finally {
      setIsRetrying(false)
      setTimeout(() => setToast(null), 4000)
    }
  }

  const handleClone = async () => {
    if (!broadcastId) return
    try {
      setIsCloning(true)
      const result = await cloneUndeliveredBroadcast({
        sourceId: broadcastId,
        scope: 'undelivered',
        sendNow: true,
      })
      if (result.success) {
        setToast(result.message || `Создан дубль на ${result.recipientsCount} получателей`)
        onChanged()
        setShowCloneConfirm(false)
      } else {
        setToast(result.error === 'no_undelivered_recipients'
          ? 'Все получатели уже получили сообщение — нечего дублировать'
          : (result.error || 'Не удалось создать дубль'))
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Ошибка создания дубля')
    } finally {
      setIsCloning(false)
      setTimeout(() => setToast(null), 5000)
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
  const undelivered = total - delivered // всё что не доставлено
  const progressPct = total > 0 ? Math.round((delivered / total) * 100) : 0
  const canClone = undelivered > 0 && total > 0 && !isLive && status !== 'queued'

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Детали рассылки" size="lg">
        <div className="space-y-5">
          {/* Header status + actions */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full ${statusCfg.tone}`}>
                {isLive && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {statusCfg.label}
              </span>
              {broadcast.senderName && (
                <span className="text-sm text-slate-500">от {broadcast.senderName}</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
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
              {canClone && (
                <button
                  type="button"
                  onClick={() => setShowCloneConfirm(true)}
                  disabled={isCloning}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 rounded-lg hover:bg-purple-100 disabled:opacity-50"
                  title="Отправит копию рассылки только тем, кому ещё не дошло"
                >
                  <Copy className="w-4 h-4" />
                  Дубль для не получивших ({undelivered})
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

          {/* Toast */}
          {toast && (
            <div className="bg-slate-800 text-white text-sm px-3 py-2 rounded-lg">
              {toast}
            </div>
          )}

          {/* Message preview */}
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

          {/* Progress */}
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
            {isLoadingProgress && total === 0 && (
              <p className="text-xs text-slate-400">Загружаю прогресс…</p>
            )}
          </div>

          {/* Tabs */}
          <div className="border-b border-slate-200 flex gap-4">
            <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>
              Обзор
            </TabButton>
            <TabButton active={activeTab === 'recipients'} onClick={() => setActiveTab('recipients')}>
              Получатели{total > 0 ? ` (${total})` : ''}
            </TabButton>
          </div>

          {activeTab === 'overview' ? (
            <OverviewTab
              broadcast={broadcast}
              progress={progress}
              formatDate={formatDate}
            />
          ) : (
            <RecipientsTab
              items={recipients}
              total={recipientsTotal}
              isLoading={isLoadingRecipients}
              status={recipientStatus}
              onStatusChange={setRecipientStatus}
              search={recipientSearch}
              onSearchChange={setRecipientSearch}
              counts={{ total, delivered, queued, failed, skipped }}
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

      <ConfirmDialog
        isOpen={showCloneConfirm}
        onClose={() => setShowCloneConfirm(false)}
        onConfirm={handleClone}
        title={`Создать дубль на ${undelivered} получателей?`}
        message={
          `Будет создана новая рассылка с тем же текстом и вложением, но только для ${undelivered} ` +
          `получателей, которым НЕ доставлено в этой рассылке (failed + queued + skipped). ` +
          `Те, кто уже получил — повторно ничего не получат.`
        }
        confirmText={isCloning ? 'Создаю…' : 'Создать дубль'}
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

function RecipientsTab({
  items, total, isLoading, status, onStatusChange, search, onSearchChange, counts,
}: {
  items: BroadcastRecipient[]
  total: number
  isLoading: boolean
  status: RecipientStatus
  onStatusChange: (s: RecipientStatus) => void
  search: string
  onSearchChange: (s: string) => void
  counts: { total: number; delivered: number; queued: number; failed: number; skipped: number }
}) {
  const FILTERS: Array<{ key: RecipientStatus; label: string; count: number; color: string }> = [
    { key: 'all',       label: 'Все',         count: counts.total,     color: 'bg-slate-200 text-slate-800' },
    { key: 'delivered', label: 'Доставлено',  count: counts.delivered, color: 'bg-green-100 text-green-700' },
    { key: 'queued',    label: 'В очереди',   count: counts.queued,    color: 'bg-amber-100 text-amber-700' },
    { key: 'failed',    label: 'Ошибки',      count: counts.failed,    color: 'bg-red-100 text-red-700' },
    { key: 'skipped',   label: 'Пропущено',   count: counts.skipped,   color: 'bg-slate-100 text-slate-600' },
  ]

  return (
    <div className="space-y-3">
      {/* Filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onStatusChange(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              status === f.key
                ? f.color + ' ring-2 ring-offset-1 ring-blue-300'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f.label} {f.count > 0 && <span className="opacity-70">· {f.count}</span>}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Поиск канала по имени..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>

      {/* List */}
      {isLoading && items.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-slate-500 text-sm">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Загрузка...
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">
          {counts.total === 0
            ? 'У этой рассылки нет данных о получателях (старая рассылка)'
            : search
              ? 'Никого не нашлось по этому запросу'
              : 'В этой категории пусто'}
        </div>
      ) : (
        <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
          {items.map((it) => (
            <RecipientRow key={it.id} item={it} />
          ))}
          {total > items.length && (
            <p className="text-xs text-slate-500 text-center pt-2">
              Показано {items.length} из {total}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function RecipientRow({ item }: { item: BroadcastRecipient }) {
  const cfg = recipientStatusUi(item.status)
  return (
    <div className="flex items-center justify-between gap-3 bg-slate-50 px-3 py-2 rounded-lg">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
        <span className="font-medium text-slate-800 text-sm truncate">
          {item.channelName || item.channelId}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs whitespace-nowrap">
        {item.errorCode && (
          <span className="text-red-600" title={item.errorMessage || ''}>
            {ERROR_LABELS[item.errorCode] || item.errorCode}
          </span>
        )}
        {item.attempts > 0 && item.status !== 'delivered' && (
          <span className="text-slate-400">{item.attempts} поп.</span>
        )}
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.tone}`}>
          {cfg.label}
        </span>
      </div>
    </div>
  )
}

function recipientStatusUi(status: BroadcastRecipient['status']): { label: string; dot: string; tone: string } {
  switch (status) {
    case 'delivered': return { label: 'Доставлено',  dot: 'bg-green-500', tone: 'bg-green-50 text-green-700' }
    case 'sending':   return { label: 'Отправляется', dot: 'bg-amber-500', tone: 'bg-amber-50 text-amber-700' }
    case 'queued':    return { label: 'В очереди',   dot: 'bg-blue-500',  tone: 'bg-blue-50 text-blue-700' }
    case 'failed':    return { label: 'Ошибка',      dot: 'bg-red-500',   tone: 'bg-red-50 text-red-700' }
    case 'skipped':   return { label: 'Пропущено',   dot: 'bg-slate-400', tone: 'bg-slate-100 text-slate-600' }
    default:          return { label: status,        dot: 'bg-slate-300', tone: 'bg-slate-100 text-slate-600' }
  }
}
