import { Search, Plus, Users, Clock, MessageSquare, ChevronDown } from 'lucide-react'

const ROLE_FILTERS = [
  { value: '', label: 'Все роли' },
  { value: 'admin', label: 'Админ' },
  { value: 'manager', label: 'Менеджер' },
  { value: 'agent', label: 'Агент' },
]

const STATUS_FILTERS = [
  { value: '', label: 'Все статусы' },
  { value: 'online', label: 'Онлайн' },
  { value: 'away', label: 'Отошёл' },
  { value: 'offline', label: 'Офлайн' },
]

interface TeamHeaderProps {
  total: number
  onlineCount: number
  avgResponse: string
  totalCases: number
  search: string
  onSearchChange: (v: string) => void
  roleFilter: string
  onRoleChange: (v: string) => void
  statusFilter: string
  onStatusChange: (v: string) => void
  onInvite: () => void
  embedded?: boolean
}

export function TeamHeader({
  total, onlineCount, avgResponse, totalCases,
  search, onSearchChange,
  roleFilter, onRoleChange,
  statusFilter, onStatusChange,
  onInvite, embedded,
}: TeamHeaderProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        {!embedded && (
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-800">Команда</h1>
            <span className="text-sm text-slate-400 font-medium">{total}</span>
          </div>
        )}

        <div className="flex items-center gap-2 flex-1 justify-end">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="Поиск по имени..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-colors"
            />
          </div>

          <FilterSelect
            value={roleFilter}
            onChange={onRoleChange}
            options={ROLE_FILTERS}
          />
          <FilterSelect
            value={statusFilter}
            onChange={onStatusChange}
            options={STATUS_FILTERS}
          />

          <button
            onClick={onInvite}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Пригласить</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-5 text-sm text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="font-medium text-slate-700">{onlineCount}</span> онлайн
        </span>
        <span className="w-px h-4 bg-slate-200" />
        <span className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          <span className="font-medium text-slate-700">{avgResponse}</span> сред. ответ
        </span>
        <span className="w-px h-4 bg-slate-200" />
        <span className="flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5" />
          <span className="font-medium text-slate-700">{totalCases}</span> обращений
        </span>
      </div>
    </div>
  )
}

function FilterSelect({
  value, onChange, options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pl-3 pr-8 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-colors cursor-pointer"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
    </div>
  )
}
