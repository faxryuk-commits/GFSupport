import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2, Clock, AlertTriangle, CalendarDays, Bell, ChevronRight,
} from 'lucide-react'
import { useToast, LoadingSpinner, EmptyState } from '@/shared/ui'
import type { MyTask } from '@/entities/onboarding'
import { fetchMyTasks, updateTask } from '@/shared/api/onboarding'

type FilterKey = 'all' | 'overdue' | 'today' | 'upcoming'

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'overdue', label: 'Просроченные' },
  { key: 'today', label: 'Сегодня' },
  { key: 'upcoming', label: 'Предстоящие' },
]

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3 flex-1 min-w-[140px]">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function UrgencyHeader({ urgency }: { urgency: string }) {
  const config: Record<string, { label: string; icon: React.ElementType; color: string }> = {
    overdue: { label: 'Просроченные', icon: AlertTriangle, color: 'text-red-600' },
    today: { label: 'На сегодня', icon: CalendarDays, color: 'text-amber-600' },
    upcoming: { label: 'Предстоящие', icon: Clock, color: 'text-blue-600' },
  }
  const c = config[urgency] ?? config.upcoming
  const Icon = c.icon
  return (
    <div className={`flex items-center gap-2 mt-6 mb-3 ${c.color}`}>
      <Icon className="w-5 h-5" />
      <h2 className="text-lg font-semibold">{c.label}</h2>
    </div>
  )
}

function TaskCard({ task, onComplete, onClick }: {
  task: MyTask
  onComplete: () => void
  onClick: () => void
}) {
  return (
    <div
      className="flex items-center gap-4 rounded-xl border border-slate-200 p-4 hover:bg-slate-50 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-900">{task.name}</p>
        <div className="flex items-center gap-2 mt-1 text-sm text-slate-500 flex-wrap">
          <span>{task.connectionName}</span>
          <ChevronRight className="w-3 h-3" />
          <span>{task.stageName}</span>
        </div>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span className="text-xs text-slate-500">
            Ожидание: {task.daysWaiting} дн.
          </span>
          {task.isOverdue && (
            <span className="text-xs text-red-600 font-medium">
              Просрочено на {task.overdueBy} дн.
            </span>
          )}
          {task.note && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {task.note}
            </span>
          )}
        </div>
        {task.managerName && (
          <p className="text-xs text-slate-400 mt-1">{task.managerName}</p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {task.status === 'waiting_client' && (
          <button
            onClick={e => { e.stopPropagation() }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            <Bell className="w-3.5 h-3.5" />
            Напомнить клиента
          </button>
        )}
        <button
          onClick={e => { e.stopPropagation(); onComplete() }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-green-300 text-green-700 hover:bg-green-50"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Готово
        </button>
      </div>
    </div>
  )
}

export function MyTasksPage() {
  const navigate = useNavigate()
  const toast = useToast()

  const [tasks, setTasks] = useState<MyTask[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKey>('all')

  const loadTasks = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchMyTasks()
      setTasks(data)
    } catch {
      toast.error('Ошибка', 'Не удалось загрузить задачи')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { loadTasks() }, [loadTasks])

  useEffect(() => {
    const id = setInterval(loadTasks, 60_000)
    return () => clearInterval(id)
  }, [loadTasks])

  const filtered = useMemo(() => {
    if (filter === 'all') return tasks
    return tasks.filter(t => t.urgency === filter)
  }, [tasks, filter])

  const stats = useMemo(() => ({
    active: tasks.length,
    overdue: tasks.filter(t => t.urgency === 'overdue').length,
    today: tasks.filter(t => t.urgency === 'today').length,
    upcoming: tasks.filter(t => t.urgency === 'upcoming').length,
  }), [tasks])

  const grouped = useMemo(() => {
    const order: MyTask['urgency'][] = ['overdue', 'today', 'upcoming']
    const groups: { urgency: string; items: MyTask[] }[] = []
    for (const u of order) {
      const items = filtered.filter(t => t.urgency === u)
      if (items.length > 0) groups.push({ urgency: u, items })
    }
    return groups
  }, [filtered])

  const handleComplete = useCallback(async (taskId: string) => {
    try {
      await updateTask(taskId, { status: 'completed' })
      toast.success('Задача завершена')
      loadTasks()
    } catch {
      toast.error('Ошибка', 'Не удалось обновить задачу')
    }
  }, [loadTasks, toast])

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <h1 className="text-2xl font-bold text-slate-800">Мои задачи</h1>
        <div className="flex bg-slate-100 rounded-lg p-1">
          {FILTER_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                filter === t.key
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3 mb-6 flex-shrink-0">
        <StatCard label="Активных" value={stats.active} color="text-slate-800" />
        <StatCard label="Просрочено" value={stats.overdue} color="text-red-600" />
        <StatCard label="На сегодня" value={stats.today} color="text-amber-600" />
        <StatCard label="Предстоящие" value={stats.upcoming} color="text-blue-600" />
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && tasks.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <LoadingSpinner size="lg" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Нет задач"
            description="Все задачи выполнены или ещё не назначены"
          />
        ) : (
          grouped.map(g => (
            <div key={g.urgency}>
              <UrgencyHeader urgency={g.urgency} />
              <div className="space-y-2">
                {g.items.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onComplete={() => handleComplete(task.id)}
                    onClick={() => navigate(`/onboarding/${task.connectionId}`)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
