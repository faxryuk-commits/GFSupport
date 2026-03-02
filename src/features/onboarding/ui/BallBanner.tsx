import { Zap } from 'lucide-react'

interface BallBannerProps {
  holders: Array<{ name: string; task?: string }>
  days: number
  plannedDays: number
  onRemind: () => void
  onTransfer: () => void
}

export function BallBanner({
  holders,
  days,
  plannedDays,
  onRemind,
  onTransfer,
}: BallBannerProps) {
  const holdersText = holders
    .map((h) => (h.task ? `${h.name} (${h.task})` : h.name))
    .join(' + ')

  const isOverdue = days > plannedDays

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-amber-50 border border-amber-200 px-5 py-3">
      <div className="flex items-start gap-3">
        <Zap className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div>
          <p className="text-sm font-semibold text-gray-800">
            Мяч: {holdersText}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            ждём{' '}
            <span className={isOverdue ? 'font-semibold text-red-600' : ''}>
              {days} {days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}
            </span>
            {' · '}плановый срок: {plannedDays}{' '}
            {plannedDays === 1 ? 'день' : plannedDays < 5 ? 'дня' : 'дней'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onRemind}
          className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Напомнить
        </button>
        <button
          onClick={onTransfer}
          className="rounded-lg border border-gray-300 px-3.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Передать
        </button>
      </div>
    </div>
  )
}
