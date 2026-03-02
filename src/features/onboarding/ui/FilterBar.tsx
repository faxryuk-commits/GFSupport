interface FilterValues {
  status: string
  stage: string
  assignedTo: string
  ball: string
}

interface FilterBarProps {
  filters: FilterValues
  onChange: (filters: FilterValues) => void
  agents: Array<{ id: string; name: string }>
}

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'active', label: 'Активные' },
  { value: 'paused', label: 'На паузе' },
  { value: 'frozen', label: 'Заморожено' },
  { value: 'cancelled', label: 'Просрочено' },
]

const STAGE_OPTIONS = [
  { value: '', label: 'Все этапы' },
  { value: 'contract', label: 'Договор' },
  { value: 'channels', label: 'Каналы' },
  { value: 'logistics', label: 'Логистика' },
  { value: 'cashdesk', label: 'Касса' },
  { value: 'payments', label: 'Платежи' },
  { value: 'test', label: 'Тест' },
]

const BALL_OPTIONS = [
  { value: '', label: 'Все' },
  { value: 'us', label: 'Мы' },
  { value: 'client', label: 'Клиент' },
  { value: 'partner', label: 'Партнёр' },
]

const selectClass =
  'rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400'

export function FilterBar({ filters, onChange, agents }: FilterBarProps) {
  const set = (key: keyof FilterValues, value: string) =>
    onChange({ ...filters, [key]: value })

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        className={selectClass}
        value={filters.status}
        onChange={(e) => set('status', e.target.value)}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        className={selectClass}
        value={filters.stage}
        onChange={(e) => set('stage', e.target.value)}
      >
        {STAGE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        className={selectClass}
        value={filters.assignedTo}
        onChange={(e) => set('assignedTo', e.target.value)}
      >
        <option value="">Все ответственные</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>

      <select
        className={selectClass}
        value={filters.ball}
        onChange={(e) => set('ball', e.target.value)}
      >
        {BALL_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}
