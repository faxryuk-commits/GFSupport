import { AlertTriangle, MessageSquare, ExternalLink, Clock, User, Tag } from 'lucide-react'
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
  commentsCount: number
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

export function CaseCard({ caseItem, onView, onDragStart, isDragging }: CaseCardProps) {
  const priority = CASE_PRIORITY_CONFIG[caseItem.priority]

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
      className={`bg-white rounded-xl p-3 shadow-sm border border-slate-200 hover:shadow-md transition-all cursor-grab active:cursor-grabbing select-none ${
        isDragging ? 'opacity-50 rotate-2 scale-105' : ''
      }`}
    >
      {/* Header: номер тикета + приоритет */}
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-mono text-blue-600 font-semibold">{caseItem.number}</span>
        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${priority.bgColor} ${priority.color}`}>
          {priority.label}
        </span>
      </div>

      {/* Откуда (источник/канал) */}
      {caseItem.channelName && (
        <div className="flex items-center gap-1 mb-1.5 text-xs text-slate-500">
          <MessageSquare className="w-3 h-3" />
          <span className="truncate">{caseItem.channelName}</span>
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

      {/* Время создания и изменения */}
      <div className="flex items-center gap-3 text-[10px] text-slate-400 mb-2">
        <div className="flex items-center gap-1" title="Создан">
          <Clock className="w-3 h-3" />
          {formatRelativeTime(caseItem.createdAt)}
        </div>
        {caseItem.updatedAt && caseItem.updatedAt !== caseItem.createdAt && (
          <div className="flex items-center gap-1" title="Обновлен">
            <span>обн.</span>
            {formatRelativeTime(caseItem.updatedAt)}
          </div>
        )}
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
}
