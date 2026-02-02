import { Clock, MessageSquare, User } from 'lucide-react'
import type { Case } from '../model'
import { CASE_STATUS_CONFIG, CASE_PRIORITY_CONFIG } from '../model'

interface CaseCardProps {
  caseItem: Case
  onClick?: () => void
  onDragStart?: () => void
  isDragging?: boolean
}

export function CaseCard({ caseItem, onClick, onDragStart, isDragging }: CaseCardProps) {
  const priorityConfig = CASE_PRIORITY_CONFIG[caseItem.priority]
  const age = getCaseAge(caseItem.createdAt)
  
  return (
    <div
      onClick={onClick}
      onDragStart={onDragStart}
      draggable={!!onDragStart}
      className={`bg-white rounded-lg p-3 shadow-sm border border-slate-200 cursor-pointer 
        hover:shadow-md hover:border-slate-300 transition-all
        ${isDragging ? 'opacity-50 rotate-2' : ''}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-mono text-slate-400">
          #{caseItem.ticketNumber || caseItem.id.slice(0, 6)}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${priorityConfig.bgColor} ${priorityConfig.color}`}>
          {priorityConfig.label}
        </span>
      </div>

      {/* Title */}
      <h4 className="font-medium text-slate-800 text-sm line-clamp-2 mb-2">
        {caseItem.title}
      </h4>

      {/* Category */}
      {caseItem.category && (
        <span className="inline-block text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded mb-2">
          {caseItem.category}
        </span>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-2">
          {/* Assignee */}
          {caseItem.assigneeName && (
            <div className="flex items-center gap-1">
              <User className="w-3 h-3" />
              <span className="truncate max-w-[80px]">{caseItem.assigneeName}</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Messages count */}
          <div className="flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />
            {caseItem.messagesCount}
          </div>
          
          {/* Age */}
          <div className={`flex items-center gap-1 ${age.isOld ? 'text-red-500' : ''}`}>
            <Clock className="w-3 h-3" />
            {age.text}
          </div>
        </div>
      </div>
    </div>
  )
}

function getCaseAge(createdAt: string): { text: string; isOld: boolean } {
  const diff = Date.now() - new Date(createdAt).getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)
  
  const isOld = hours > 24 // Старше суток
  
  if (days > 0) {
    return { text: `${days}д`, isOld }
  }
  if (hours > 0) {
    return { text: `${hours}ч`, isOld }
  }
  const minutes = Math.floor(diff / (1000 * 60))
  return { text: `${minutes}м`, isOld: false }
}
