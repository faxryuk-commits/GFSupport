import { AlertTriangle, MessageSquare } from 'lucide-react'
import { Avatar } from '@/shared/ui'
import { CASE_PRIORITY_CONFIG, type CasePriority } from '@/entities/case'

export interface CaseCardData {
  id: string
  number: string
  title: string
  company: string
  priority: CasePriority
  category: string
  time: string
  assignee?: { id: string; name: string }
  commentsCount: number
}

interface CaseCardProps {
  caseItem: CaseCardData
  onView: () => void
  onDragStart: () => void
  isDragging: boolean
}

export function CaseCard({ caseItem, onView, onDragStart, isDragging }: CaseCardProps) {
  const priority = CASE_PRIORITY_CONFIG[caseItem.priority]

  return (
    <div 
      draggable
      onDragStart={onDragStart}
      onClick={onView}
      className={`bg-white rounded-xl p-3 shadow-sm border border-slate-200 hover:shadow-md transition-all cursor-pointer ${
        isDragging ? 'opacity-50 rotate-2' : ''
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-mono text-slate-400">{caseItem.number}</span>
        {caseItem.assignee && (
          <Avatar name={caseItem.assignee.name} size="xs" />
        )}
      </div>
      <h4 className="font-medium text-slate-800 text-sm mb-2 line-clamp-2">{caseItem.title}</h4>
      <div className="flex items-center gap-2 mb-3">
        <Avatar name={caseItem.company} size="xs" />
        <span className="text-xs text-slate-500 truncate">{caseItem.company}</span>
        {(caseItem.priority === 'high' || caseItem.priority === 'critical') && (
          <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
        )}
        <span className="text-xs text-slate-400 ml-auto">{caseItem.time}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${priority.bgColor} ${priority.color}`}>
          {priority.label}
        </span>
        <span className="px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded">
          {caseItem.category}
        </span>
        {caseItem.commentsCount > 0 && (
          <div className="flex items-center gap-1 ml-auto text-slate-400">
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="text-xs">{caseItem.commentsCount}</span>
          </div>
        )}
      </div>
    </div>
  )
}
