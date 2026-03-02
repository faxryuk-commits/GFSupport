type StatusType =
  | 'active'
  | 'paused'
  | 'frozen'
  | 'cancelled'
  | 'launched'
  | 'overdue'
  | 'attention'
  | 'ok'

interface StatusBadgeProps {
  status: StatusType
  size?: 'sm' | 'md'
}

const LABELS: Record<StatusType, string> = {
  overdue: 'просрочено',
  attention: 'внимание',
  ok: 'ок',
  active: 'активно',
  paused: 'на паузе',
  frozen: 'заморожено',
  cancelled: 'отменено',
  launched: 'запущено',
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const colors: Record<StatusType, string> = {
    overdue: 'bg-red-100 text-red-700',
    cancelled: 'bg-red-100 text-red-700',
    attention: 'bg-amber-100 text-amber-700',
    paused: 'bg-blue-100 text-blue-700',
    ok: 'bg-green-100 text-green-700',
    active: 'bg-green-100 text-green-700',
    frozen: 'bg-gray-100 text-gray-600',
    launched: 'bg-emerald-100 text-emerald-700',
  }
  const sizes = { sm: 'text-xs px-1.5 py-0.5', md: 'text-xs px-2 py-1' }

  return (
    <span
      className={`inline-flex font-medium rounded-full ${colors[status]} ${sizes[size]}`}
    >
      {LABELS[status]}
    </span>
  )
}
