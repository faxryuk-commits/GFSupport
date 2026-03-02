import { AlertTriangle } from 'lucide-react'

interface ConnectionStatsProps {
  stats: {
    active: number
    paused: number
    frozen: number
    overdue: number
  }
}

export function ConnectionStats({ stats }: ConnectionStatsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
        Активных: {stats.active}
      </span>

      <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
        На паузе: {stats.paused}
      </span>

      <span className="inline-flex items-center rounded-full bg-gray-200 px-3 py-1 text-sm font-medium text-gray-500">
        Заморожено: {stats.frozen}
      </span>

      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-600">
        <AlertTriangle className="h-3.5 w-3.5" />
        Просрочено: {stats.overdue}
      </span>
    </div>
  )
}
