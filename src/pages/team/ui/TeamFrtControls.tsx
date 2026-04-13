import { ChevronDown } from 'lucide-react'

const SOURCE_FILTERS: { value: 'all' | 'telegram' | 'whatsapp'; label: string }[] = [
  { value: 'all', label: 'Все каналы' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'whatsapp', label: 'WhatsApp' },
]

interface TeamFrtControlsProps {
  frtFrom: string
  frtTo: string
  frtSource: 'all' | 'telegram' | 'whatsapp'
  onFrtFromChange: (v: string) => void
  onFrtToChange: (v: string) => void
  onFrtSourceChange: (v: 'all' | 'telegram' | 'whatsapp') => void
  error: string | null
}

export function TeamFrtControls({
  frtFrom,
  frtTo,
  frtSource,
  onFrtFromChange,
  onFrtToChange,
  onFrtSourceChange,
  error,
}: TeamFrtControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="text-slate-500">Период FRT:</span>
      <input
        type="date"
        value={frtFrom}
        onChange={e => onFrtFromChange(e.target.value)}
        className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
      />
      <span className="text-slate-400">—</span>
      <input
        type="date"
        value={frtTo}
        onChange={e => onFrtToChange(e.target.value)}
        className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
      />
      <div className="relative">
        <select
          value={frtSource}
          onChange={e => onFrtSourceChange(e.target.value as 'all' | 'telegram' | 'whatsapp')}
          className="appearance-none pl-3 pr-8 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 cursor-pointer"
        >
          {SOURCE_FILTERS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
      </div>
      {error && (
        <span className="text-xs text-amber-600">{error}</span>
      )}
    </div>
  )
}
