import { Send, MessageCircle } from 'lucide-react'
import type { Channel } from '@/entities/channel'

interface Props {
  channels: Channel[]
}

/**
 * Мини-строка с балансом нагрузки по платформам: Telegram и WhatsApp.
 * Считается на клиенте из уже загруженного списка каналов.
 */
export function ChannelSourceSummary({ channels }: Props) {
  const tg = channels.filter((c) => (c.source || 'telegram') === 'telegram')
  const wa = channels.filter((c) => c.source === 'whatsapp')

  if (tg.length === 0 && wa.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4 flex-wrap">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Каналы по платформам
      </div>

      <PlatformStat
        icon={<Send className="w-4 h-4 text-sky-600" />}
        label="Telegram"
        bg="bg-sky-50 border-sky-200"
        total={tg.length}
        awaiting={tg.filter((c) => c.awaitingReply).length}
        unread={tg.reduce((s, c) => s + (c.unreadCount || 0), 0)}
      />

      <PlatformStat
        icon={<MessageCircle className="w-4 h-4 text-emerald-600" />}
        label="WhatsApp"
        bg="bg-emerald-50 border-emerald-200"
        total={wa.length}
        awaiting={wa.filter((c) => c.awaitingReply).length}
        unread={wa.reduce((s, c) => s + (c.unreadCount || 0), 0)}
      />
    </div>
  )
}

function PlatformStat({
  icon,
  label,
  bg,
  total,
  awaiting,
  unread,
}: {
  icon: React.ReactNode
  label: string
  bg: string
  total: number
  awaiting: number
  unread: number
}) {
  return (
    <div className={`px-3 py-2 rounded-lg border ${bg} flex items-center gap-3`}>
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-sm font-semibold text-slate-800">{label}</span>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-slate-700">
          Каналов: <span className="font-bold">{total}</span>
        </span>
        <span className={awaiting > 0 ? 'text-amber-700 font-semibold' : 'text-slate-500'}>
          Ждут ответ: <span className="font-bold">{awaiting}</span>
        </span>
        <span className={unread > 0 ? 'text-red-700 font-semibold' : 'text-slate-500'}>
          Непрочитано: <span className="font-bold">{unread}</span>
        </span>
      </div>
    </div>
  )
}
