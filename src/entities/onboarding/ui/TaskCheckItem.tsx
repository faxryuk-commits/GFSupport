import { Check, Circle } from 'lucide-react'
import type { OnboardingTask, TaskStatus } from '../model/types'
import { Avatar } from '@/shared/ui/Avatar'

interface TaskCheckItemProps {
  task: OnboardingTask
  onToggle: (taskId: string) => void
  onStatusChange: (taskId: string, status: TaskStatus) => void
}

const NOTE_LABELS: Record<string, string> = {
  'ждём данные': 'ждём данные',
  'ждём доступы': 'ждём доступы',
  'в работе': 'в работе',
  'на проверке': 'на проверке',
}

function getStatusLabel(note: string | null): string | null {
  if (!note) return null
  const lower = note.toLowerCase()
  return NOTE_LABELS[lower] ?? note
}

export function TaskCheckItem({
  task,
  onToggle,
}: TaskCheckItemProps) {
  const isCompleted = task.status === 'completed'
  const statusLabel = getStatusLabel(task.note)

  const handleCircleClick = () => {
    onToggle(task.id)
  }

  return (
    <div className="flex items-center gap-3 py-2 group">
      <button
        type="button"
        onClick={handleCircleClick}
        className="flex-shrink-0 p-0.5 rounded-full hover:bg-slate-100 transition-colors"
        aria-label={isCompleted ? 'Отметить невыполненным' : 'Отметить выполненным'}
      >
        {isCompleted ? (
          <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white">
            <Check className="w-3 h-3" strokeWidth={3} />
          </div>
        ) : (
          <Circle className="w-5 h-5 text-slate-300" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${isCompleted ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
          {task.name}
        </span>
        {statusLabel && !isCompleted && (
          <span className="ml-2 inline-flex text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
            {statusLabel}
          </span>
        )}
      </div>
      {task.assignedAgentName && (
        <Avatar name={task.assignedAgentName} size="xs" className="flex-shrink-0" />
      )}
    </div>
  )
}
