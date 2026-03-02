interface ProgressDotsProps {
  completed: number
  total: number
  size?: 'sm' | 'md'
}

export function ProgressDots({ completed, total, size = 'md' }: ProgressDotsProps) {
  const dotSize = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2'
  const dots = Array.from({ length: total }, (_, i) => i < completed)

  return (
    <div className="flex items-center gap-1">
      {dots.map((filled, i) => (
        <div
          key={i}
          className={`rounded-full ${dotSize} ${filled ? 'bg-green-500' : 'bg-gray-300'}`}
        />
      ))}
    </div>
  )
}
