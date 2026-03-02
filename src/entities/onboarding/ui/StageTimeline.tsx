import { Check } from 'lucide-react'
import type { OnboardingStage } from '../model/types'
import { TaskCheckItem } from './TaskCheckItem'

interface StageTimelineProps {
  stages: OnboardingStage[]
  onCompleteStage: (stageId: string) => void
  onTaskUpdate: (taskId: string, data: object) => void
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  })
}

function getDaysLabel(startedAt: string | null, completedAt: string | null): string {
  if (completedAt && startedAt) {
    const days = Math.ceil(
      (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / (1000 * 60 * 60 * 24),
    )
    return `${days} дн.`
  }
  return ''
}

export function StageTimeline({
  stages,
  onCompleteStage,
  onTaskUpdate,
}: StageTimelineProps) {
  const sortedStages = [...stages].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="relative">
      {sortedStages.map((stage, index) => {
        const isCompleted = stage.status === 'completed'
        const isInProgress = stage.status === 'in_progress'
        const isPending = stage.status === 'pending'

        const allTasksCompleted =
          stage.tasks.length > 0 &&
          stage.tasks.every(t => t.status === 'completed')

        return (
          <div key={stage.id} className="relative flex gap-4 pb-8 last:pb-0">
            <div
              className={`
                flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
                border-2 font-medium text-sm
                ${isCompleted ? 'bg-green-500 border-green-500 text-white' : ''}
                ${isInProgress ? 'bg-blue-500 border-blue-500 text-white' : ''}
                ${isPending ? 'bg-gray-200 border-gray-300 text-gray-600' : ''}
              `}
            >
              {isCompleted ? (
                <Check className="w-4 h-4" strokeWidth={3} />
              ) : (
                stage.sortOrder
              )}
            </div>
            <div
              className={`
                flex-1 pl-2 border-l-2 -ml-4 pl-6
                ${index < sortedStages.length - 1 ? 'border-l-gray-200' : 'border-l-transparent'}
                ${isInProgress ? 'border-l-blue-300' : ''}
                ${isCompleted ? 'border-l-green-300' : ''}
              `}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`font-medium ${
                    isCompleted ? 'text-green-700' : isInProgress ? 'text-blue-700' : 'text-slate-600'
                  }`}
                >
                  {stage.name}
                </span>
                {isCompleted && stage.completedAt && (
                  <span className="text-sm text-slate-500">
                    Готово · {formatDate(stage.completedAt)}
                    {getDaysLabel(stage.startedAt, stage.completedAt) && ` · ${getDaysLabel(stage.startedAt, stage.completedAt)}`}
                  </span>
                )}
                {isPending && (
                  <span className="text-sm text-slate-500">
                    план {stage.plannedDays} дня
                  </span>
                )}
              </div>

              {isInProgress && stage.tasks.length > 0 && (
                <div className="mt-3 space-y-0">
                  {stage.tasks.map(task => (
                    <TaskCheckItem
                      key={task.id}
                      task={task}
                      onToggle={id => onTaskUpdate(id, { status: task.status === 'completed' ? 'pending' : 'completed' })}
                      onStatusChange={(id, status) => onTaskUpdate(id, { status })}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => onCompleteStage(stage.id)}
                    disabled={!allTasksCompleted}
                    className={`
                      mt-3 text-sm font-medium px-3 py-1.5 rounded-lg
                      ${allTasksCompleted
                        ? 'bg-green-600 text-white hover:bg-green-700'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'}
                    `}
                  >
                    Завершить этап
                  </button>
                </div>
              )}

              {isPending && (
                <div className="mt-1 text-sm text-slate-400">Этап не начат</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
