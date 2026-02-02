import { useState } from 'react'
import { Plus } from 'lucide-react'
import { CaseCard, type Case, type CaseStatus, CASE_STATUS_CONFIG, KANBAN_STATUSES } from '@/entities/case'

interface CasesKanbanProps {
  cases: Case[]
  onCaseClick: (caseItem: Case) => void
  onStatusChange: (caseId: string, newStatus: CaseStatus) => void
  onCreateCase?: () => void
}

export function CasesKanban({ 
  cases, 
  onCaseClick, 
  onStatusChange,
  onCreateCase 
}: CasesKanbanProps) {
  const [draggedCase, setDraggedCase] = useState<Case | null>(null)

  const getCasesByStatus = (status: CaseStatus) => {
    return cases.filter(c => c.status === status)
  }

  const handleDragStart = (caseItem: Case) => {
    setDraggedCase(caseItem)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (status: CaseStatus) => {
    if (draggedCase && draggedCase.status !== status) {
      onStatusChange(draggedCase.id, status)
    }
    setDraggedCase(null)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Кейсы</h2>
        {onCreateCase && (
          <button
            onClick={onCreateCase}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Создать
          </button>
        )}
      </div>

      {/* Kanban board */}
      <div className="flex-1 flex gap-4 overflow-x-auto pb-4">
        {KANBAN_STATUSES.map(status => {
          const config = CASE_STATUS_CONFIG[status]
          const statusCases = getCasesByStatus(status)
          
          return (
            <div
              key={status}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(status)}
              className="flex-shrink-0 w-72 flex flex-col bg-slate-50 rounded-xl"
            >
              {/* Column header */}
              <div className="p-3 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${config.bgColor}`} />
                    <h3 className="font-medium text-slate-700">{config.label}</h3>
                  </div>
                  <span className="px-2 py-0.5 text-xs bg-slate-200 text-slate-600 rounded-full">
                    {statusCases.length}
                  </span>
                </div>
              </div>

              {/* Cards */}
              <div className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[200px]">
                {statusCases.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-sm">
                    Нет кейсов
                  </div>
                ) : (
                  statusCases.map(caseItem => (
                    <CaseCard
                      key={caseItem.id}
                      caseItem={caseItem}
                      onClick={() => onCaseClick(caseItem)}
                      onDragStart={() => handleDragStart(caseItem)}
                      isDragging={draggedCase?.id === caseItem.id}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
