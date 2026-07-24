import { memo } from 'react'
import { AlertTriangle, MessageSquare, ExternalLink, Clock, User, Tag, Timer, Repeat, Ban, Bell, Zap, CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/shared/ui'
import { formatDuration, formatDateTime } from '@/shared/lib'
import { CASE_PRIORITY_CONFIG, type CasePriority } from '@/entities/case'

export interface CaseCardData {
  id: string
  number: string
  title: string
  description?: string
  company: string
  channelId?: string
  channelName?: string
  priority: CasePriority
  category: string
  tags?: string[]
  createdAt: string
  resolvedAt?: string | null
  updatedAt?: string
  // Показатели жизненного цикла (минуты, приходят с бэкенда — уже tz-безопасны)
  firstResponseMinutes?: number | null
  resolutionTimeMinutes?: number | null
  assignee?: { id: string; name: string }
  reporterName?: string
  commentsCount: number
  isShadow?: boolean
  // Флаги состояния (показываются бейджами, а не колонкой)
  isRecurring?: boolean
  isBlocked?: boolean
  // Динамика кейса
  lastStatusChangeAt?: string | null
  lastActivityAt?: string | null
  // SLA (приходит с бэкенда)
  isOverdue?: boolean
  slaThresholdHours?: number
  ageHours?: number
  // Snooze
  snoozedUntil?: string | null
  isSnoozed?: boolean
}

interface CaseCardProps {
  caseItem: CaseCardData
  onView: () => void
  onDragStart: () => void
  isDragging: boolean
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}


export const CaseCard = memo(function CaseCard({
  const hours = (Date.now() - new Date(createdAt).getTime()) / 3600000
  if (hours < 4) return { label: '', color: '', level: 'ok' }
  if (hours < 24) return { label: `${Math.floor(hours)}ч`, color: 'text-amber-600 bg-amber-50', level: 'warn' }
  const days = Math.floor(hours / 24)
  return { label: `${days}д`, color: 'text-red-600 bg-red-50', level: 'danger' }
}

// Сколько кейс висит в текущем статусе
function getStatusAge(lastStatusChangeAt: string | null | undefined, createdAt: string): { label: string; tone: 'ok' | 'warn' | 'danger' } {
  const base = lastStatusChangeAt || createdAt
  const hours = (Date.now() - new Date(base).getTime()) / 3600000
  if (hours < 1) return { label: '<1ч в статусе', tone: 'ok' }
  if (hours < 4) return { label: `${Math.floor(hours)}ч в статусе`, tone: 'ok' }
  if (hours < 24) return { label: `${Math.floor(hours)}ч в статусе`, tone: 'warn' }
  const days = Math.floor(hours / 24)
  return { label: `${days}д в статусе`, tone: 'danger' }
}

function formatLastActivity(lastActivityAt: string | null | undefined): string | null {
  if (!lastActivityAt) return null
  const diff = Date.now() - new Date(lastActivityAt).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `Посл. действие ${days}д назад`
  if (hours > 0) return `Посл. действие ${hours}ч назад`
  if (minutes > 0) return `Посл. действие ${minutes}м назад`
  return 'Посл. действие только что'
}

const STATUS_AGE_TONE: Record<'ok' | 'warn' | 'danger', string> = {
  ok: 'text-slate-500 bg-slate-100',
  warn: 'text-amber-700 bg-amber-50',
  danger: 'text-red-700 bg-red-50',
}

export const CaseCard = memo(function CaseCard({ caseItem, onView, onDragStart, isDragging, selectable, selected, onToggleSelect }: CaseCardProps) {
  const priority = CASE_PRIORITY_CONFIG[caseItem.priority]
  const aging = getAgingInfo(caseItem.createdAt)
  const statusAge = getStatusAge(caseItem.lastStatusChangeAt, caseItem.createdAt)
  const lastActivityLabel = formatLastActivity(caseItem.lastActivityAt)
  const isOverdue = Boolean(caseItem.isOverdue)

  // Показатели жизненного цикла тикета
  const isResolved = caseItem.resolutionTimeMinutes != null
  const frtPending = caseItem.firstResponseMinutes == null && !isResolved
  const frtLabel = caseItem.firstResponseMinutes != null
    ? formatDuration(caseItem.firstResponseMinutes)
    : (isResolved ? '—' : 'ждёт')

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', caseItem.id)
    onDragStart()
  }

  const handleGoToChat = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  const handleCardClick = (e: React.MouseEvent) => {
    if (selectable) {
      e.preventDefault()
      onToggleSelect?.()
    } else {
      onView()
    }
  }

  return (
    <div
      draggable={!selectable}
      onDragStart={handleDragStart}
      onClick={handleCardClick}
      className={`bg-white rounded-xl p-3 shadow-sm border transition-all ${selectable ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} select-none ${
        isDragging ? 'opacity-50 rotate-2 scale-105' : ''
      } ${selected ? 'border-blue-400 ring-2 ring-blue-200' : isOverdue ? 'border-red-300 ring-1 ring-red-200' : aging.level === 'danger' ? 'border-red-200' : aging.level === 'warn' ? 'border-amber-200' : 'border-[#e8edf3]'} hover:shadow-md`}
    >
      {/* Header: чекбокс (в режиме выбора) + номер тикета + приоритет + aging */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {selectable && (
            <input
              type="checkbox"
              checked={Boolean(selected)}
              onChange={(e) => { e.stopPropagation(); onToggleSelect?.() }}
              onClick={(e) => e.stopPropagation()}
              className="w-4 h-4 mr-1 rounded border-slate-300 text-blue-500 focus:ring-blue-500/30"
            />
          )}
          <span className="text-xs font-mono text-blue-600 font-semibold">{caseItem.number}</span>
          {caseItem.isShadow && (
            <span className="px-1 py-0.5 text-[9px] bg-slate-100 text-slate-500 rounded">чат</span>
          )}
          {caseItem.isBlocked && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-50 text-red-700" title="Кейс заблокирован">
              <Ban className="w-2.5 h-2.5" />
              Блокер
            </span>
          )}
          {caseItem.isRecurring && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-50 text-purple-700" title="Проблема повторяется">
              <Repeat className="w-2.5 h-2.5" />
              Повтор
            </span>
          )}
          {isOverdue && (
            <span
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-red-500 text-white"
              title={caseItem.slaThresholdHours ? `SLA: ${caseItem.slaThresholdHours} ч` : 'SLA нарушено'}
            >
              <AlertTriangle className="w-2.5 h-2.5" />
              SLA
            </span>
          )}
          {caseItem.isSnoozed && caseItem.snoozedUntil && (
            <span
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-100 text-purple-700"
              title={`Отложен до ${new Date(caseItem.snoozedUntil).toLocaleString('ru-RU')}`}
            >
              <Bell className="w-2.5 h-2.5" />
              до {new Date(caseItem.snoozedUntil).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {aging.label && (
            <span className={`flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded ${aging.color}`}>
              <Timer className="w-2.5 h-2.5" />
              {aging.label}
            </span>
          )}
          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${priority.bgColor} ${priority.color}`}>
            {priority.label}
          </span>
        </div>
      </div>

      {/* Откуда (источник/канал) - увеличенный */}
      {caseItem.channelName && (
        <div className="flex items-center gap-1.5 mb-2 text-sm text-slate-600">
          <MessageSquare className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <span className="font-medium truncate">{caseItem.channelName}</span>
        </div>
      )}

      {/* Кто инициировал тикет */}
      {caseItem.reporterName && (
        <div className="flex items-center gap-1.5 mb-2 px-2 py-1 bg-amber-50 rounded-lg">
          <User className="w-3.5 h-3.5 text-amber-600" />
          <span className="text-xs text-amber-700">от: <span className="font-medium">{caseItem.reporterName}</span></span>
        </div>
      )}

      {/* Проблема (title + description) */}
      <h4 className="font-medium text-slate-800 text-sm mb-1 line-clamp-2">{caseItem.title}</h4>
      {caseItem.description && (
        <p className="text-xs text-slate-500 mb-2 line-clamp-2">{caseItem.description}</p>
      )}

      {/* Категория + теги */}
      <div className="flex flex-wrap gap-1 mb-2">
        <span className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded">
          {caseItem.category}
        </span>
        {caseItem.tags?.slice(0, 2).map(tag => (
          <span key={tag} className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-blue-50 text-blue-600 rounded">
            <Tag className="w-2.5 h-2.5" />
            {tag}
          </span>
        ))}
        {(caseItem.tags?.length || 0) > 2 && (
          <span className="px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-500 rounded">
            +{(caseItem.tags?.length || 0) - 2}
          </span>
        )}
      </div>

      {/* Ответственный */}
      <div className="flex items-center gap-2 mb-2">
        {caseItem.assignee ? (
          <div className="flex items-center gap-1.5">
            <Avatar name={caseItem.assignee.name} size="xs" />
            <span className="text-xs text-slate-600 truncate max-w-[100px]">{caseItem.assignee.name}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-slate-400">
            <User className="w-3 h-3" />
            <span className="text-xs">Не назначен</span>
          </div>
        )}
        
        {(caseItem.priority === 'high' || caseItem.priority === 'critical' || caseItem.priority === 'urgent') && (
          <AlertTriangle className="w-3.5 h-3.5 text-orange-500 ml-auto" />
        )}
      </div>

      {/* Динамика: сколько висит в статусе + последнее действие */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${STATUS_AGE_TONE[statusAge.tone]}`} title="Время в текущем статусе">
          {statusAge.label}
        </span>
        {lastActivityLabel && (
          <span className="text-[10px] text-slate-500" title="Последняя запись в истории кейса">
            {lastActivityLabel}
          </span>
        )}
      </div>

      {/* Показатели: создан · первый ответ · решение */}
      <div className="grid grid-cols-3 gap-1 mb-2 text-[10px]">
        <div className="flex flex-col gap-0.5 px-1.5 py-1 bg-slate-50 rounded" title="Когда создан тикет">
          <span className="flex items-center gap-1 text-slate-400"><Clock className="w-2.5 h-2.5" />Создан</span>
          <span className="font-medium text-slate-600 tabular-nums leading-tight">{formatDateTime(caseItem.createdAt)}</span>
        </div>
        <div
          className={`flex flex-col gap-0.5 px-1.5 py-1 rounded ${frtPending ? 'bg-amber-50' : 'bg-slate-50'}`}
          title="Время первого реагирования — от первого сообщения клиента до ответа команды"
        >
          <span className={`flex items-center gap-1 ${frtPending ? 'text-amber-500' : 'text-slate-400'}`}><Zap className="w-2.5 h-2.5" />Ответ</span>
          <span className={`font-medium ${frtPending ? 'text-amber-700' : 'text-slate-600'}`}>{frtLabel}</span>
        </div>
        <div
          className={`flex flex-col gap-0.5 px-1.5 py-1 rounded ${isResolved ? 'bg-emerald-50' : 'bg-slate-50'}`}
          title={caseItem.resolvedAt ? `Решён ${formatDateTime(caseItem.resolvedAt)}` : 'Время решения — от первого сообщения клиента до резолюции'}
        >
          <span className={`flex items-center gap-1 ${isResolved ? 'text-emerald-500' : 'text-slate-400'}`}><CheckCircle2 className="w-2.5 h-2.5" />Решён</span>
          <span className={`font-medium tabular-nums leading-tight ${isResolved ? 'text-emerald-700' : 'text-slate-500'}`}>
            {caseItem.resolvedAt ? formatDateTime(caseItem.resolvedAt) : '—'}
          </span>
        </div>
      </div>

      {/* Footer: действия */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <div className="flex items-center gap-1 text-slate-400">
          <MessageSquare className="w-3.5 h-3.5" />
          <span className="text-xs">{caseItem.commentsCount}</span>
        </div>
        
        {/* Кнопка перейти в чат */}
        {caseItem.channelId && (
          <Link
            to={`/chats?channel=${caseItem.channelId}`}
            onClick={handleGoToChat}
            className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            В чат
          </Link>
        )}
      </div>
    </div>
  )
})
