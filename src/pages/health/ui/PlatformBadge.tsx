import { Send, MessageCircle } from 'lucide-react'
import type { HealthSource } from '@/shared/api'

interface PlatformBadgeProps {
  source?: 'telegram' | 'whatsapp' | HealthSource
  size?: 'xs' | 'sm'
  withLabel?: boolean
}

/**
 * Компактный значок платформы канала: TG или WA.
 * Используется в списках каналов, кейсов и сообщений на странице "Где болит".
 */
export function PlatformBadge({ source, size = 'xs', withLabel = false }: PlatformBadgeProps) {
  if (!source || source === 'all') return null

  const isWhatsapp = source === 'whatsapp'
  const Icon = isWhatsapp ? MessageCircle : Send
  const bg = isWhatsapp ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-sky-50 text-sky-700 border-sky-200'
  const label = isWhatsapp ? 'WA' : 'TG'

  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-3 h-3'
  const padding = size === 'sm' ? 'px-1.5 py-0.5 gap-1' : 'px-1 py-0.5 gap-0.5'
  const fontSize = size === 'sm' ? 'text-[11px]' : 'text-[10px]'

  return (
    <span
      className={`inline-flex items-center ${padding} border rounded ${bg} font-semibold ${fontSize}`}
      title={isWhatsapp ? 'WhatsApp' : 'Telegram'}
    >
      <Icon className={iconSize} />
      {withLabel && <span>{label}</span>}
    </span>
  )
}
