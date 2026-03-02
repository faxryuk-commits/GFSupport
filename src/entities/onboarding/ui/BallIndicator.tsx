interface BallIndicatorProps {
  holder: string
  type: 'us' | 'client' | 'partner'
  days: number
}

const TYPE_COLORS = {
  us: 'text-blue-600 bg-blue-50',
  client: 'text-orange-600 bg-orange-50',
  partner: 'text-purple-600 bg-purple-50',
}

export function BallIndicator({ holder, type, days }: BallIndicatorProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[type]}`}
    >
      Мяч: {holder} · {days} дн.
    </span>
  )
}
