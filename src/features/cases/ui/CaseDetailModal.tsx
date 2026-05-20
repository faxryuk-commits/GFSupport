import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2, Send, History, MessageSquare, Link2, ExternalLink, Clock, Timer, Loader2, BellOff, Bell } from 'lucide-react'
import { Modal, Avatar, Badge, EmptyState, Tabs, TabPanel } from '@/shared/ui'
import { CASE_STATUS_CONFIG, CASE_PRIORITY_CONFIG, KANBAN_STATUSES, type CaseStatus, type CasePriority } from '@/entities/case'
import { fetchCaseComments, fetchCaseActivities, fetchMessages, sendMessage, snoozeCase, fetchCustomerContext, type CaseComment, type CaseActivity, type CustomerContext } from '@/shared/api'
import type { Message } from '@/shared/types'

function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return 'Не указано'
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  } catch {
    return dateStr
  }
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (days > 0) return `${days}д назад`
  if (hrs > 0) return `${hrs}ч назад`
  if (mins > 0) return `${mins}м назад`
  return 'только что'
}

// ===== Таймлайн истории кейса =====

const STATUS_LABELS: Record<string, string> = {
  detected: 'Обнаружен',
  in_progress: 'В работе',
  waiting: 'Ожидание',
  blocked: 'Заблокирован',
  recurring: 'Повторяется',
  resolved: 'Решён',
  closed: 'Закрыт',
  cancelled: 'Отменён',
}

function describeActivity(a: CaseActivity): { icon: 'history' | 'clock' | 'chat' | 'system'; text: string } {
  const actor = a.managerName ? a.managerName : 'Система'
  switch (a.type) {
    case 'status_change':
    case 'status_changed': {
      const from = a.fromStatus ? (STATUS_LABELS[a.fromStatus] || a.fromStatus) : null
      const to = a.toStatus ? (STATUS_LABELS[a.toStatus] || a.toStatus) : null
      if (from && to) return { icon: 'history', text: `${actor} перевёл: ${from} → ${to}` }
      if (to) return { icon: 'history', text: `${actor} установил статус: ${to}` }
      return { icon: 'history', text: a.title || 'Смена статуса' }
    }
    case 'assigned':
    case 'assignment':
      return { icon: 'history', text: a.title || `${actor} изменил ответственного` }
    case 'comment':
    case 'comment_added':
      return { icon: 'chat', text: `${actor} оставил комментарий` }
    case 'created':
      return { icon: 'clock', text: a.title || 'Кейс создан' }
    default:
      return { icon: 'system', text: a.title || a.description || a.type }
  }
}

function CaseHistoryTimeline({
  createdAt, activities, loading,
}: { createdAt: string; activities: CaseActivity[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Загрузка истории…
      </div>
    )
  }

  // Сортируем хронологически от старых к новым
  const sorted = [...activities].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const hasCreatedEvent = sorted.some(a => a.type === 'created')

  return (
    <div className="space-y-3">
      {!hasCreatedEvent && (
        <TimelineItem
          icon="clock"
          text="Кейс создан"
          time={createdAt}
        />
      )}
      {sorted.length === 0 ? (
        <div className="text-sm text-slate-400 py-4">Ещё нет записей в истории.</div>
      ) : (
        sorted.map(a => {
          const d = describeActivity(a)
          return (
            <TimelineItem
              key={a.id}
              icon={d.icon}
              text={d.text}
              description={a.description && a.description !== d.text ? a.description : undefined}
              time={a.createdAt}
            />
          )
        })
      )}
    </div>
  )
}

function TimelineItem({
  icon, text, description, time,
}: { icon: 'history' | 'clock' | 'chat' | 'system'; text: string; description?: string; time: string }) {
  const iconMap = {
    history: { el: <History className="w-4 h-4 text-blue-600" />, bg: 'bg-blue-100' },
    clock:   { el: <Clock className="w-4 h-4 text-green-600" />, bg: 'bg-green-100' },
    chat:    { el: <MessageSquare className="w-4 h-4 text-purple-600" />, bg: 'bg-purple-100' },
    system:  { el: <History className="w-4 h-4 text-slate-500" />, bg: 'bg-slate-100' },
  }[icon]

  return (
    <div className="flex items-start gap-3">
      <div className={`w-8 h-8 rounded-full ${iconMap.bg} flex items-center justify-center flex-shrink-0`}>
        {iconMap.el}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-800">{text}</p>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
        <p className="text-xs text-slate-400 mt-0.5">{formatDate(time)} · {formatRelativeTime(time)}</p>
      </div>
    </div>
  )
}

interface Agent {
  id: string
  name: string
}

export interface CaseDetail {
  id: string
  number: string
  ticketNumber?: number
  title: string
  description: string
  company: string
  channelId?: string
  channelName?: string
  contactName: string
  contactEmail: string
  priority: CasePriority
  category: string
  status: CaseStatus
  createdAt: string
  updatedAt?: string
  assignee?: Agent
  comments: CaseComment[]
  tags: string[]
  linkedChats: string[]
  attachments: { name: string; size: string }[]
  history: { id: string; action: string; user: string; time: string }[]
  snoozedUntil?: string | null
}

// ===== Customer 360 баннер =====

const HEALTH_BANDS: Record<string, { label: string; bg: string; color: string; emoji: string }> = {
  critical: { label: 'Критическая зона', bg: 'bg-red-50 border-red-200',     color: 'text-red-700',     emoji: '🔴' },
  at_risk:  { label: 'В зоне риска',     bg: 'bg-amber-50 border-amber-200', color: 'text-amber-700',   emoji: '🟡' },
  healthy:  { label: 'Здоров',            bg: 'bg-green-50 border-green-200', color: 'text-green-700',   emoji: '🟢' },
  loyal:    { label: 'Лояльный',          bg: 'bg-emerald-50 border-emerald-200', color: 'text-emerald-700', emoji: '💚' },
}

function formatMinutesShort(mins: number | null | undefined): string {
  if (mins == null) return '—'
  const hours = mins / 60
  if (hours < 1) return `${Math.round(mins)} мин`
  if (hours < 24) return `${Math.round(hours)} ч`
  return `${Math.round(hours / 24)} д`
}

function Customer360Banner({
  ctx, expanded, onToggle,
}: { ctx: CustomerContext; expanded: boolean; onToggle: () => void }) {
  const navigate = useNavigate()
  const health = ctx.health && HEALTH_BANDS[ctx.health.band]
  const hasRiskSignals = ctx.stats.recurring > 0 || ctx.stats.active > 1 || (ctx.health?.band === 'critical' || ctx.health?.band === 'at_risk')

  return (
    <div
      className={`mb-4 rounded-lg border ${
        hasRiskSignals ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-slate-50/40'
      }`}
    >
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-white/40 rounded-lg"
      >
        <Avatar name={ctx.channel.name} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-slate-800 text-sm truncate">{ctx.channel.name}</p>
          <p className="text-xs text-slate-500">
            {ctx.stats.total} кейс{ctx.stats.total === 1 ? '' : ctx.stats.total < 5 ? 'а' : 'ов'} всего •{' '}
            {ctx.stats.active > 0 ? <span className="text-orange-600 font-medium">{ctx.stats.active} активн.</span> : 'все закрыты'}
            {ctx.stats.recurring > 0 && <span className="text-purple-600 font-medium"> • повторяется {ctx.stats.recurring}×</span>}
            {ctx.stats.last7d > 0 && <span className="text-slate-500"> • {ctx.stats.last7d} за 7д</span>}
          </p>
        </div>

        {health && (
          <span className={`px-2 py-1 text-xs font-medium rounded-md border ${health.bg} ${health.color} flex-shrink-0`} title={`Customer Health Score: ${ctx.health?.score ?? '—'}`}>
            {health.emoji} {health.label}
          </span>
        )}

        {ctx.stats.avgResolutionHours != null && (
          <span className="text-xs text-slate-500 flex-shrink-0" title="Среднее время решения по этому клиенту">
            ⏱ {ctx.stats.avgResolutionHours < 24 ? `${ctx.stats.avgResolutionHours}ч` : `${Math.round(ctx.stats.avgResolutionHours / 24)}д`} в среднем
          </span>
        )}

        <ChevronDownIcon expanded={expanded} />
      </button>

      {expanded && (
        <div className="border-t border-slate-200 px-3 py-2 space-y-3 bg-white/60">
          {/* Активные другие кейсы клиента */}
          {ctx.activeCases.length > 0 && (
            <div>
              <p className="text-[11px] text-slate-500 uppercase tracking-wide mb-1">
                Ещё активных кейсов у этого клиента ({ctx.activeCases.length})
              </p>
              <div className="space-y-1">
                {ctx.activeCases.map(ac => (
                  <div key={ac.id} className="text-xs flex items-center gap-2 px-2 py-1 bg-slate-50 rounded">
                    <span className="font-mono text-blue-600">#{ac.ticketNumber || ac.id.slice(0, 6)}</span>
                    <span className="text-slate-700 truncate flex-1">{ac.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-500">
                      {ac.priority}
                    </span>
                    <span className="text-[10px] text-slate-400">{ac.ageHours != null ? formatMinutesShort(ac.ageHours * 60) : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Последние решённые — как раньше решали */}
          {ctx.recentResolved.length > 0 && (
            <div>
              <p className="text-[11px] text-slate-500 uppercase tracking-wide mb-1">
                Как решали раньше у этого клиента
              </p>
              <div className="space-y-1">
                {ctx.recentResolved.map(rr => (
                  <div key={rr.id} className="text-xs px-2 py-1.5 bg-green-50/60 border border-green-100 rounded">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-green-700">#{rr.ticketNumber || rr.id.slice(0, 6)}</span>
                      <span className="text-slate-700 truncate flex-1">{rr.title}</span>
                      <span className="text-[10px] text-slate-500">
                        решили за {formatMinutesShort(rr.resolvedInMinutes)}
                      </span>
                    </div>
                    {rr.resolutionNotes && (
                      <p className="text-[11px] text-slate-600 mt-0.5 italic line-clamp-2">→ {rr.resolutionNotes}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Метрики */}
          <div className="grid grid-cols-4 gap-2 text-center pt-1">
            <Stat label="Всего" value={ctx.stats.total} />
            <Stat label="Решено" value={ctx.stats.resolved} />
            <Stat label="Активных" value={ctx.stats.active} color={ctx.stats.active > 0 ? 'text-orange-600' : undefined} />
            <Stat label="Повторов" value={ctx.stats.recurring} color={ctx.stats.recurring > 0 ? 'text-purple-600' : undefined} />
          </div>

          <button
            onClick={() => navigate(`/chats?channel=${ctx.channel.id}`)}
            className="text-xs text-blue-600 hover:underline"
          >
            Открыть все сообщения клиента в чате →
          </button>
        </div>
      )}
    </div>
  )
}

function ChevronDownIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
      fill="none" stroke="currentColor" viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-white border border-slate-100 rounded px-2 py-1">
      <p className={`text-base font-bold ${color || 'text-slate-700'}`}>{value}</p>
      <p className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</p>
    </div>
  )
}

interface CaseDetailModalProps {
  isOpen: boolean
  onClose: () => void
  caseData: CaseDetail | null
  agents: Agent[]
  currentUserName?: string
  onStatusChange: (caseId: string, status: CaseStatus) => void
  onAssign: (caseId: string, agent: Agent | null) => void
  onAddComment: (caseId: string, text: string, isInternal: boolean) => void
  onSnoozeChange?: (caseId: string, snoozedUntil: string | null) => void
  onDelete: () => void
}

export function CaseDetailModal({
  isOpen, onClose, caseData, agents, currentUserName, onStatusChange, onAssign, onAddComment, onSnoozeChange, onDelete,
}: CaseDetailModalProps) {
  const navigate = useNavigate()
  const [detailTab, setDetailTab] = useState('chat')
  const [newComment, setNewComment] = useState('')
  const [isInternalComment, setIsInternalComment] = useState(false)
  const [comments, setComments] = useState<CaseComment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [activities, setActivities] = useState<CaseActivity[]>([])
  const [loadingActivities, setLoadingActivities] = useState(false)

  // Inline-чат: сообщения канала
  const [chatMessages, setChatMessages] = useState<Message[]>([])
  const [loadingChat, setLoadingChat] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)

  // Snooze UI
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false)
  const [snoozePending, setSnoozePending] = useState(false)

  // Customer 360 context
  const [customerCtx, setCustomerCtx] = useState<CustomerContext | null>(null)
  const [customer360Expanded, setCustomer360Expanded] = useState(false)

  useEffect(() => {
    if (!isOpen || !caseData?.channelId) {
      setCustomerCtx(null)
      return
    }
    fetchCustomerContext(caseData.channelId, caseData.id)
      .then(setCustomerCtx)
      .catch(() => setCustomerCtx(null))
  }, [isOpen, caseData?.channelId, caseData?.id])

  const applySnooze = async (until: Date | null, reason?: string) => {
    if (!caseData) return
    setSnoozePending(true)
    setSnoozeMenuOpen(false)
    try {
      await snoozeCase(caseData.id, until ? until.toISOString() : null, reason, currentUserName)
      onSnoozeChange?.(caseData.id, until ? until.toISOString() : null)
    } catch (e) {
      console.error('Snooze error', e)
    } finally {
      setSnoozePending(false)
    }
  }

  const snoozePresets = (() => {
    const now = new Date()
    const inHours = (h: number) => { const d = new Date(now); d.setHours(d.getHours() + h, 0, 0, 0); return d }
    const tomorrowMorning = () => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d }
    const nextMonday = () => { const d = new Date(now); const day = d.getDay() || 7; d.setDate(d.getDate() + (8 - day)); d.setHours(9, 0, 0, 0); return d }
    const nextWeek = () => { const d = new Date(now); d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); return d }
    return [
      { label: 'на 1 час',    until: inHours(1) },
      { label: 'на 4 часа',   until: inHours(4) },
      { label: 'завтра 09:00', until: tomorrowMorning() },
      { label: 'в понедельник 09:00', until: nextMonday() },
      { label: 'через неделю', until: nextWeek() },
    ]
  })()

  const loadComments = useCallback(async () => {
    if (!caseData?.id) return
    setLoadingComments(true)
    try {
      const data = await fetchCaseComments(caseData.id)
      setComments(data)
    } catch {
      setComments([])
    } finally {
      setLoadingComments(false)
    }
  }, [caseData?.id])

  const loadActivities = useCallback(async () => {
    if (!caseData?.id) return
    setLoadingActivities(true)
    try {
      const data = await fetchCaseActivities(caseData.id)
      setActivities(data)
    } catch {
      setActivities([])
    } finally {
      setLoadingActivities(false)
    }
  }, [caseData?.id])

  const loadChat = useCallback(async () => {
    if (!caseData?.channelId) {
      setChatMessages([])
      return
    }
    setLoadingChat(true)
    setChatError(null)
    try {
      const res = await fetchMessages(caseData.channelId, 80)
      // API возвращает по убыванию created_at — переворачиваем в хронологический порядок
      const ordered = [...(res.messages || [])].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
      setChatMessages(ordered)
      // Скроллим к низу после рендера
      requestAnimationFrame(() => {
        chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight })
      })
    } catch (e: any) {
      setChatError(e?.message || 'Не удалось загрузить переписку')
      setChatMessages([])
    } finally {
      setLoadingChat(false)
    }
  }, [caseData?.channelId])

  useEffect(() => {
    if (isOpen && caseData?.id) {
      loadComments()
      loadActivities()
      loadChat()
    }
  }, [isOpen, caseData?.id, loadComments, loadActivities, loadChat])

  // Перезагружаем чат при возврате на вкладку
  useEffect(() => {
    if (isOpen && detailTab === 'chat' && caseData?.channelId) {
      loadChat()
    }
  }, [detailTab, isOpen, caseData?.channelId, loadChat])

  const handleSendReply = async () => {
    if (!replyText.trim() || !caseData?.channelId) return
    const text = replyText.trim()
    setSending(true)
    try {
      const sent = await sendMessage(caseData.channelId, text)
      setChatMessages(prev => [...prev, sent])
      setReplyText('')
      requestAnimationFrame(() => {
        chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' })
      })
    } catch (e: any) {
      setChatError(e?.message || 'Не удалось отправить сообщение')
    } finally {
      setSending(false)
    }
  }

  if (!caseData) return null

  const handleAddComment = async () => {
    if (!newComment.trim()) return
    onAddComment(caseData.id, newComment, isInternalComment)
    setComments(prev => [...prev, {
      id: `temp_${Date.now()}`,
      author: 'Вы',
      text: newComment,
      isInternal: isInternalComment,
      time: new Date().toISOString(),
    }])
    setNewComment('')
  }

  const handleOpenChat = () => {
    if (caseData.channelId) {
      onClose()
      navigate(`/chats?channel=${caseData.channelId}`)
    }
  }

  const displayNumber = caseData.ticketNumber ? `#${caseData.ticketNumber}` : caseData.number

  const agingHours = (Date.now() - new Date(caseData.createdAt).getTime()) / 3600000
  const agingText = agingHours < 1 ? 'Менее часа' : agingHours < 24 ? `${Math.floor(agingHours)} ч` : `${Math.floor(agingHours / 24)} д ${Math.floor(agingHours % 24)} ч`
  const agingColor = agingHours < 4 ? 'text-green-600' : agingHours < 24 ? 'text-amber-600' : 'text-red-600'

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Тикет ${displayNumber}`} size="xl">
      <div className="flex gap-6 -mx-6 -mb-6">
        <div className="flex-1 pl-6 pb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-800">{caseData.title}</h3>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${CASE_PRIORITY_CONFIG[caseData.priority].bgColor} ${CASE_PRIORITY_CONFIG[caseData.priority].color}`}>
                  {CASE_PRIORITY_CONFIG[caseData.priority].label}
                </span>
                <span className="px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded">
                  {caseData.category}
                </span>
                <span className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-slate-50 ${agingColor}`}>
                  <Timer className="w-3 h-3" />
                  {agingText}
                </span>
                {caseData.tags.map(tag => (
                  <Badge key={tag} size="sm">{tag}</Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 relative">
              <select
                value={caseData.status}
                onChange={(e) => onStatusChange(caseData.id, e.target.value as CaseStatus)}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                {KANBAN_STATUSES.map(s => (
                  <option key={s} value={s}>{CASE_STATUS_CONFIG[s].label}</option>
                ))}
              </select>

              {/* Snooze */}
              {caseData.snoozedUntil && new Date(caseData.snoozedUntil) > new Date() ? (
                <button
                  onClick={() => applySnooze(null)}
                  disabled={snoozePending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100"
                  title={`Отложен до ${new Date(caseData.snoozedUntil).toLocaleString('ru-RU')}. Нажмите чтобы снять.`}
                >
                  <Bell className="w-4 h-4" />
                  до {new Date(caseData.snoozedUntil).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </button>
              ) : (
                <button
                  onClick={() => setSnoozeMenuOpen(v => !v)}
                  disabled={snoozePending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50"
                  title="Отложить кейс на потом"
                >
                  <BellOff className="w-4 h-4" />
                  Отложить
                </button>
              )}

              {snoozeMenuOpen && (
                <div className="absolute top-full right-0 mt-1 w-56 bg-white shadow-lg border border-slate-200 rounded-lg z-50 py-1">
                  {snoozePresets.map(p => (
                    <button
                      key={p.label}
                      onClick={() => applySnooze(p.until)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 flex items-center justify-between"
                    >
                      <span>Отложить {p.label}</span>
                      <span className="text-xs text-slate-400">
                        {p.until.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </button>
                  ))}
                  <div className="border-t border-slate-100 my-1" />
                  <label className="px-3 py-2 text-xs text-slate-500 block">Своя дата:</label>
                  <input
                    type="datetime-local"
                    onChange={(e) => {
                      if (!e.target.value) return
                      const d = new Date(e.target.value)
                      if (!isNaN(d.getTime()) && d > new Date()) applySnooze(d)
                    }}
                    className="mx-3 mb-2 px-2 py-1 text-sm border border-slate-200 rounded w-[calc(100%-1.5rem)]"
                  />
                </div>
              )}

              <button onClick={onDelete} className="p-2 text-red-500 hover:bg-red-50 rounded-lg">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Customer 360 — компактная сводка по клиенту, раскрывается по клику */}
          {customerCtx && (
            <Customer360Banner
              ctx={customerCtx}
              expanded={customer360Expanded}
              onToggle={() => setCustomer360Expanded(v => !v)}
            />
          )}

          <Tabs
            tabs={[
              { id: 'chat', label: 'Чат с клиентом', badge: chatMessages.length || undefined },
              { id: 'details', label: 'Детали' },
              { id: 'comments', label: 'Комментарии', badge: comments.length },
              { id: 'history', label: 'История' },
            ]}
            activeTab={detailTab}
            onChange={setDetailTab}
            variant="underline"
            className="mb-4"
          />

          <TabPanel tabId="chat" activeTab={detailTab}>
            {!caseData.channelId ? (
              <EmptyState
                title="Канал не привязан"
                description="К этому кейсу не привязан чат — переписку посмотреть нельзя."
                size="sm"
              />
            ) : (
              <div className="flex flex-col" style={{ height: 420 }}>
                <div
                  ref={chatScrollRef}
                  className="flex-1 overflow-y-auto border border-slate-200 rounded-lg bg-slate-50 p-3 space-y-2"
                >
                  {loadingChat ? (
                    <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Загрузка переписки…
                    </div>
                  ) : chatError ? (
                    <div className="text-sm text-red-600 py-4 text-center">{chatError}</div>
                  ) : chatMessages.length === 0 ? (
                    <div className="text-sm text-slate-400 py-8 text-center">
                      В этом канале пока нет сообщений.
                    </div>
                  ) : (
                    chatMessages.map((m) => {
                      const isTeam = m.isFromTeam || m.senderRole === 'support' || m.senderRole === 'team'
                      return (
                        <div
                          key={m.id}
                          className={`flex ${isTeam ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                              isTeam
                                ? 'bg-blue-500 text-white rounded-br-sm'
                                : 'bg-white text-slate-800 border border-slate-200 rounded-bl-sm'
                            }`}
                          >
                            {!isTeam && (
                              <p className={`text-[11px] font-medium mb-0.5 ${isTeam ? 'text-blue-100' : 'text-slate-500'}`}>
                                {m.senderName || 'Клиент'}
                              </p>
                            )}
                            <p className="whitespace-pre-wrap break-words">{m.text || m.textContent || ''}</p>
                            {m.mediaUrl && (
                              <p className={`text-[11px] mt-1 italic ${isTeam ? 'text-blue-100' : 'text-slate-400'}`}>
                                📎 {m.mediaType || 'media'}
                              </p>
                            )}
                            <p className={`text-[10px] mt-0.5 text-right ${isTeam ? 'text-blue-100' : 'text-slate-400'}`}>
                              {formatRelativeTime(m.createdAt)}
                            </p>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                <div className="mt-3 flex gap-2">
                  <textarea
                    rows={2}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        handleSendReply()
                      }
                    }}
                    placeholder="Ответить клиенту (Ctrl/⌘ + Enter)"
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm"
                  />
                  <button
                    onClick={handleSendReply}
                    disabled={!replyText.trim() || sending}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Отправить
                  </button>
                </div>
              </div>
            )}
          </TabPanel>

          <TabPanel tabId="details" activeTab={detailTab}>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-500">Описание</label>
                <p className="mt-1 text-slate-800">{caseData.description || 'Нет описания'}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-500">Создан</label>
                  <p className="mt-1 text-slate-800">{formatDate(caseData.createdAt)}</p>
                </div>
                {caseData.updatedAt && caseData.updatedAt !== caseData.createdAt && (
                  <div>
                    <label className="text-sm font-medium text-slate-500">Обновлён</label>
                    <p className="mt-1 text-slate-800">{formatDate(caseData.updatedAt)}</p>
                  </div>
                )}
                <div>
                  <label className="text-sm font-medium text-slate-500">Назначен</label>
                  <div className="mt-1 flex items-center gap-2">
                    {caseData.assignee ? (
                      <>
                        <Avatar name={caseData.assignee.name} size="sm" />
                        <span className="text-slate-800">{caseData.assignee.name}</span>
                      </>
                    ) : (
                      <span className="text-slate-400">Не назначен</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </TabPanel>

          <TabPanel tabId="comments" activeTab={detailTab}>
            <div className="space-y-4">
              {loadingComments ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                </div>
              ) : comments.length === 0 ? (
                <EmptyState title="Нет комментариев" description="Добавьте комментарий" size="sm" />
              ) : (
                comments.map(comment => (
                  <div key={comment.id} className={`flex gap-3 ${comment.isInternal ? 'bg-amber-50 -mx-2 px-2 py-2 rounded-lg' : ''}`}>
                    <Avatar name={comment.author} size="sm" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">{comment.author}</span>
                        <span className="text-xs text-slate-400">{formatRelativeTime(comment.time)}</span>
                        {comment.isInternal && <Badge variant="warning" size="sm">Внутренний</Badge>}
                      </div>
                      <p className="text-sm text-slate-600 mt-1">{comment.text}</p>
                    </div>
                  </div>
                ))
              )}
              
              <div className="border-t border-slate-200 pt-4 mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isInternalComment}
                      onChange={(e) => setIsInternalComment(e.target.checked)}
                      className="w-4 h-4 text-amber-500 rounded"
                    />
                    Внутренняя заметка
                  </label>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Добавить комментарий..."
                    className="flex-1 px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                  />
                  <button
                    onClick={handleAddComment}
                    disabled={!newComment.trim()}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </TabPanel>

          <TabPanel tabId="history" activeTab={detailTab}>
            <CaseHistoryTimeline
              createdAt={caseData.createdAt}
              activities={activities}
              loading={loadingActivities}
            />
          </TabPanel>
        </div>

        {/* Sidebar */}
        <div className="w-64 bg-slate-50 p-4 border-l border-slate-200">
          <h4 className="font-medium text-slate-700 mb-3">Канал / Клиент</h4>
          <div className="flex items-center gap-3 mb-4">
            <Avatar name={caseData.channelName || caseData.company} size="md" />
            <div>
              <p className="font-medium text-slate-800 text-sm">{caseData.channelName || caseData.company}</p>
              {caseData.contactName && <p className="text-xs text-slate-500">{caseData.contactName}</p>}
            </div>
          </div>

          <h4 className="font-medium text-slate-700 mb-3">Назначен</h4>
          <select
            value={caseData.assignee?.id || ''}
            onChange={(e) => {
              const agent = agents.find(a => a.id === e.target.value)
              onAssign(caseData.id, agent || null)
            }}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 mb-4"
          >
            <option value="">Не назначен</option>
            {agents.map(agent => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>

          <h4 className="font-medium text-slate-700 mb-3">Связанные чаты</h4>
          {!caseData.channelId && caseData.linkedChats.length === 0 ? (
            <p className="text-sm text-slate-400 mb-4">Нет связанных чатов</p>
          ) : (
            <div className="space-y-2 mb-4">
              {caseData.channelId && (
                <button onClick={handleOpenChat} className="flex items-center gap-2 text-sm text-blue-500 hover:underline">
                  <Link2 className="w-4 h-4" />
                  {caseData.channelName || 'Открыть чат'}
                </button>
              )}
            </div>
          )}

          {caseData.channelId && (
            <button onClick={handleOpenChat} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600">
              <ExternalLink className="w-4 h-4" />
              Открыть чат
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
