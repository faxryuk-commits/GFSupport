import { Send, MessageCircle, Check } from 'lucide-react'
import type { Channel } from '@/entities/channel'

export type SourceFilter = 'all' | 'telegram' | 'whatsapp'

interface Props {
  channels: Channel[]
  value: SourceFilter
  onChange: (v: SourceFilter) => void
}

/**
 * Баланс нагрузки по платформам: Telegram vs WhatsApp.
 * Сами плашки — кликабельные кнопки-фильтры: клик переключает активную платформу,
 * повторный клик на активную возвращает "Все".
 */
export function ChannelSourceSummary({ channels, value, onChange }: Props) {
  const tg = channels.filter((c) => (c.source || 'telegram') === 'telegram')
  const wa = channels.filter((c) => c.source === 'whatsapp')

  if (tg.length === 0 && wa.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 flex-wrap">
      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Каналы по платформам
        </div>
        <div className="text-[11px] text-slate-400 mt-0.5">
          «Ждут ответа» — клиент написал последним, агент не ответил
        </div>
      </div>

      <PlatformButton
        icon={<Send className="w-4 h-4 text-sky-600" />}
        label="Telegram"
        active={value === 'telegram'}
        activeClasses="bg-sky-100 border-sky-400 ring-2 ring-sky-200"
        idleClasses="bg-sky-50 border-sky-200 hover:bg-sky-100"
        total={tg.length}
        awaiting={tg.filter((c) => c.awaitingReply).length}
        onClick={() => onChange(value === 'telegram' ? 'all' : 'telegram')}
      />

      <PlatformButton
        icon={<MessageCircle className="w-4 h-4 text-emerald-600" />}
        label="WhatsApp"
        active={value === 'whatsapp'}
        activeClasses="bg-emerald-100 border-emerald-400 ring-2 ring-emerald-200"
        idleClasses="bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
        total={wa.length}
        awaiting={wa.filter((c) => c.awaitingReply).length}
        onClick={() => onChange(value === 'whatsapp' ? 'all' : 'whatsapp')}
      />

      {value !== 'all' && (
        <button
          onClick={() => onChange('all')}
          className="ml-auto text-xs text-slate-500 hover:text-slate-700 underline"
        >
          показать все
        </button>
      )}
    </div>
  )
}

function PlatformButton({
  icon,
  label,
  active,
  activeClasses,
  idleClasses,
  total,
  awaiting,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  activeClasses: string
  idleClasses: string
  total: number
  awaiting: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-lg border flex items-center gap-3 transition-all ${
        active ? activeClasses : idleClasses
      }`}
    >
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-sm font-semibold text-slate-800">{label}</span>
        {active && <Check className="w-3.5 h-3.5 text-slate-700" />}
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-slate-700">
          Каналов: <span className="font-bold">{total}</span>
        </span>
        <span
          className={awaiting > 0 ? 'text-amber-700 font-semibold' : 'text-slate-500'}
          title="Количество каналов, где клиент ждёт ответа от агента"
        >
          Ждут ответ: <span className="font-bold">{awaiting}</span>
        </span>
      </div>
    </button>
  )
}
