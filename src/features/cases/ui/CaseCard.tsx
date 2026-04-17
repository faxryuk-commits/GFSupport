import { memo } from 'react'
import { AlertTriangle, MessageSquare, ExternalLink, Clock, User, Tag, Timer, Repeat, Ban } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/shared/ui'
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
  updatedAt?: string
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
}

interface CaseCardProps {
  caseItem: CaseCardData
  onView: () => void
  onDragStart: () => void
  isDragging: boolean
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}д назад`
  if (hours > 0) return `${hours}ч назад`
  if (minutes > 0) return `${minutes}м назад`
  return 'только что'
}

function getAgingInfo(createdAt: string): { label: string; color: string; level: 'ok' | 'warn' | 'danger' } {
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

export const CaseCard = memo(function CaseCard({ caseItem, onView, onDragStart, isDragging }: CaseCardProps) {
  const priority = CASE_PRIORITY_CONFIG[caseItem.priority]
  const aging = getAgingInfo(caseItem.createdAt)
  const statusAge = getStatusAge(caseItem.lastStatusChangeAt, caseItem.createdAt)
  const lastActivityLabel = formatLastActivity(caseItem.lastActivityAt)

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', caseItem.id)
    onDragStart()
  }

  const handleGoToChat = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  return (
    <div 
      draggable={true}
      onDragStart={handleDragStart}
      onClick={onView}
      className={`bg-white rounded-xl p-3 shadow-sm border transition-all cursor-grab active:cursor-grabbing select-none ${
        isDragging ? 'opacity-50 rotate-2 scale-105' : ''
      } ${aging.level === 'danger' ? 'border-red-200' : aging.level === 'warn' ? 'border-amber-200' : 'border-slate-200'} hover:shadow-md`}
    >
      {/* Header: номер тикета + приоритет + aging */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
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

      {/* Время создания */}
      <div className="flex items-center gap-3 text-[10px] text-slate-400 mb-2">
        <div className="flex items-center gap-1" title="Создан">
          <Clock className="w-3 h-3" />
          {formatRelativeTime(caseItem.createdAt)}
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
