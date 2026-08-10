import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { formatDateTimeShort } from '@/shared/lib'
import {
  fetchOnboardingBoard, createBrand, updateBrand, deleteBrand,
  setTaskStatus, fetchOnboardingEvents,
  createRefItem, updateRefItem, deleteRefItem,
  type ObBoard, type ObBrand, type ObStatus, type ObEvent,
} from '@/shared/api/onboarding'
import {
  Plug, Plus, Loader2, RefreshCw, X, Archive, ArchiveRestore, Trash2,
  History, Settings2, LayoutGrid, ChevronUp, ChevronDown, Pencil, Check,
} from 'lucide-react'

// Цвета статусов (справочник хранит ключ цвета, не классы)
const STATUS_COLORS: Record<string, { chip: string; dot: string }> = {
  gray: { chip: 'bg-gray-100 text-gray-600 hover:bg-gray-200', dot: 'bg-gray-400' },
  blue: { chip: 'bg-blue-100 text-blue-700 hover:bg-blue-200', dot: 'bg-blue-500' },
  amber: { chip: 'bg-amber-100 text-amber-700 hover:bg-amber-200', dot: 'bg-amber-500' },
  green: { chip: 'bg-green-100 text-green-700 hover:bg-green-200', dot: 'bg-green-500' },
  red: { chip: 'bg-red-100 text-red-700 hover:bg-red-200', dot: 'bg-red-500' },
  slate: { chip: 'bg-slate-100 text-slate-500 hover:bg-slate-200', dot: 'bg-slate-400' },
}
const COLOR_KEYS = Object.keys(STATUS_COLORS)

const METRIC_KINDS: { value: string; label: string }[] = [
  { value: 'todo', label: 'Не начато (очередь)' },
  { value: 'active', label: 'В работе (считается как работа)' },
  { value: 'waiting', label: 'Ожидание (считается как ожидание)' },
  { value: 'done', label: 'Завершено' },
  { value: 'cancelled', label: 'Отменено' },
  { value: 'na', label: 'Не применимо' },
]

function fmtSeconds(sec: number): string {
  if (!sec || sec <= 0) return ''
  const h = sec / 3600
  if (h < 1) return `${Math.round(sec / 60)} мин`
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} ч`
  return `${(h / 24).toFixed(1)} дн`
}

export function OnboardingPage() {
  const [board, setBoard] = useState<ObBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'board' | 'history' | 'refs'>('board')
  const [showArchived, setShowArchived] = useState(false)
  const [openBrand, setOpenBrand] = useState<ObBrand | null>(null)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const data = await fetchOnboardingBoard(showArchived)
      setBoard(data)
    } catch (e) {
      console.error('Failed to load onboarding board:', e)
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [showArchived])

  useEffect(() => { load() }, [load])

  // Держим открытую карточку в актуальном состоянии после перезагрузки доски
  useEffect(() => {
    if (openBrand && board) {
      const fresh = board.brands.find(b => b.id === openBrand.id)
      if (fresh) setOpenBrand(fresh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board])

  return (
    <div className="p-4 sm:p-6 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Plug className="w-6 h-6 text-blue-600" />
          <h1 className="text-xl font-semibold text-gray-900">Подключения</h1>
          {refreshing && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
            title="Обновить"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {([
              ['board', 'Доска', LayoutGrid],
              ['history', 'История', History],
              ['refs', 'Справочники', Settings2],
            ] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 ${
                  tab === key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}
      {!loading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && board && tab === 'board' && (
        <BoardTab
          board={board}
          showArchived={showArchived}
          onToggleArchived={() => setShowArchived(v => !v)}
          onOpenBrand={setOpenBrand}
          onChanged={() => load(true)}
        />
      )}
      {!loading && !error && board && tab === 'history' && <HistoryTab board={board} />}
      {!loading && !error && board && tab === 'refs' && (
        <RefsTab board={board} onChanged={() => load(true)} />
      )}

      {openBrand && board && (
        <BrandDrawer
          brand={openBrand}
          board={board}
          onClose={() => setOpenBrand(null)}
          onChanged={() => load(true)}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────── Доска (матрица)

function BoardTab({ board, showArchived, onToggleArchived, onOpenBrand, onChanged }: {
  board: ObBoard
  showArchived: boolean
  onToggleArchived: () => void
  onOpenBrand: (b: ObBrand) => void
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPos, setNewPos] = useState('')
  const [saving, setSaving] = useState(false)

  const taskTypes = board.taskTypes.filter(t => t.isActive)
  const statusById = useMemo(
    () => Object.fromEntries(board.statuses.map(s => [s.id, s])),
    [board.statuses],
  )
  const posById = useMemo(
    () => Object.fromEntries(board.posSystems.map(p => [p.id, p])),
    [board.posSystems],
  )

  const handleAdd = async () => {
    if (!newName.trim() || saving) return
    setSaving(true)
    try {
      await createBrand({ name: newName.trim(), posId: newPos || null })
      setNewName('')
      setNewPos('')
      setAdding(false)
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {!adding ? (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> Бренд
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
              placeholder="Название бренда"
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={newPos}
              onChange={e => setNewPos(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm bg-white"
            >
              <option value="">POS-система…</option>
              {board.posSystems.filter(p => p.isActive).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || saving}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Создать'}
            </button>
            <button onClick={() => setAdding(false)} className="p-1.5 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <label className="flex items-center gap-1.5 text-sm text-gray-500 ml-auto cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={onToggleArchived} className="rounded" />
          Показать архив
        </label>
      </div>

      {board.brands.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-16 text-center text-gray-400 text-sm">
          Пока нет брендов — добавьте первый
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="sticky left-0 bg-gray-50 z-10 text-left font-medium text-gray-600 px-3 py-2 min-w-[180px]">
                  Бренд
                </th>
                <th className="text-left font-medium text-gray-600 px-2 py-2">Прогресс</th>
                {taskTypes.map(t => (
                  <th key={t.id} className="text-left font-medium text-gray-600 px-2 py-2 whitespace-nowrap">
                    {t.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.brands.map(brand => (
                <BrandRow
                  key={brand.id}
                  brand={brand}
                  taskTypes={taskTypes}
                  statusById={statusById}
                  statuses={board.statuses.filter(s => s.isActive)}
                  posName={brand.posId ? posById[brand.posId]?.name : undefined}
                  onOpen={() => onOpenBrand(brand)}
                  onChanged={onChanged}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function BrandRow({ brand, taskTypes, statusById, statuses, posName, onOpen, onChanged }: {
  brand: ObBrand
  taskTypes: ObBoard['taskTypes']
  statusById: Record<string, ObStatus>
  statuses: ObStatus[]
  posName?: string
  onOpen: () => void
  onChanged: () => void
}) {
  const taskByType = useMemo(
    () => Object.fromEntries(brand.tasks.map(t => [t.taskTypeId, t])),
    [brand.tasks],
  )
  const countable = brand.tasks.filter(t => {
    const k = t.statusId ? statusById[t.statusId]?.kind : null
    return k && k !== 'na' && k !== 'cancelled'
  })
  const done = countable.filter(t => statusById[t.statusId!]?.kind === 'done').length

  return (
    <tr className={`border-b border-gray-100 last:border-0 ${brand.archivedAt ? 'opacity-50' : ''}`}>
      <td className="sticky left-0 bg-white z-10 px-3 py-2">
        <button onClick={onOpen} className="text-left group">
          <div className="font-medium text-gray-900 group-hover:text-blue-600">{brand.name}</div>
          <div className="text-xs text-gray-400">
            {posName || 'без POS'}{brand.ownerName ? ` · ${brand.ownerName}` : ''}
          </div>
        </button>
      </td>
      <td className="px-2 py-2 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <div className="w-14 h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500"
              style={{ width: countable.length ? `${(done / countable.length) * 100}%` : '0%' }}
            />
          </div>
          <span className="text-xs text-gray-400">{done}/{countable.length}</span>
        </div>
      </td>
      {taskTypes.map(tt => {
        const task = taskByType[tt.id]
        if (!task) return <td key={tt.id} className="px-2 py-2 text-gray-300">—</td>
        return (
          <td key={tt.id} className="px-2 py-2">
            <StatusChip
              task={task}
              status={task.statusId ? statusById[task.statusId] : undefined}
              statuses={statuses}
              onChanged={onChanged}
            />
          </td>
        )
      })}
    </tr>
  )
}

function StatusChip({ task, status, statuses, onChanged }: {
  task: ObBrand['tasks'][number]
  status?: ObStatus
  statuses: ObStatus[]
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const colors = STATUS_COLORS[status?.color || 'gray'] || STATUS_COLORS.gray
  const timeHint = [
    task.activeSeconds ? `в работе ${fmtSeconds(task.activeSeconds)}` : '',
    task.waitingSeconds ? `ожидание ${fmtSeconds(task.waitingSeconds)}` : '',
  ].filter(Boolean).join(', ')

  const pick = async (statusId: string) => {
    if (saving || statusId === task.statusId) { setOpen(false); return }
    setSaving(true)
    try {
      await setTaskStatus(task.id, statusId)
      onChanged()
    } finally {
      setSaving(false)
      setOpen(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        title={timeHint ? `${status?.label || '—'} · ${timeHint}` : status?.label}
        className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap transition-colors ${colors.chip}`}
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : (status?.label || '—')}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 left-0 w-44 rounded-lg border border-gray-200 bg-white shadow-lg py-1">
          {statuses.map(s => {
            const c = STATUS_COLORS[s.color] || STATUS_COLORS.gray
            return (
              <button
                key={s.id}
                onClick={() => pick(s.id)}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 ${
                  s.id === task.statusId ? 'font-semibold' : ''
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                {s.label}
              </button>
            )
          })}
          {timeHint && (
            <div className="border-t border-gray-100 mt-1 px-3 py-1.5 text-[11px] text-gray-400">
              {timeHint}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────── Карточка бренда

function BrandDrawer({ brand, board, onClose, onChanged }: {
  brand: ObBrand
  board: ObBoard
  onClose: () => void
  onChanged: () => void
}) {
  const [events, setEvents] = useState<ObEvent[] | null>(null)
  const [name, setName] = useState(brand.name)
  const [owner, setOwner] = useState(brand.ownerName || '')
  const [notes, setNotes] = useState(brand.notes || '')
  const [posId, setPosId] = useState(brand.posId || '')

  useEffect(() => {
    fetchOnboardingEvents(brand.id, 200)
      .then(r => setEvents(r.events))
      .catch(() => setEvents([]))
  }, [brand.id])

  const save = async (patch: Omit<Parameters<typeof updateBrand>[0], 'id'>) => {
    await updateBrand({ id: brand.id, ...patch })
    onChanged()
  }

  const handleDelete = async () => {
    if (!window.confirm(`Удалить бренд «${brand.name}» вместе с историей? Это необратимо.`)) return
    await deleteBrand(brand.id)
    onClose()
    onChanged()
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 truncate">{brand.name}</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs text-gray-500">Название</span>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                onBlur={() => { if (name.trim() && name !== brand.name) save({ name: name.trim() }) }}
                className="mt-1 w-full px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">POS-система</span>
              <select
                value={posId}
                onChange={e => { setPosId(e.target.value); save({ posId: e.target.value || null }) }}
                className="mt-1 w-full px-3 py-1.5 rounded-lg border border-gray-300 text-sm bg-white"
              >
                <option value="">Не выбрана</option>
                {board.posSystems.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Ответственный</span>
              <input
                value={owner}
                onChange={e => setOwner(e.target.value)}
                onBlur={() => { if (owner !== (brand.ownerName || '')) save({ ownerName: owner || null }) }}
                placeholder="Имя сотрудника"
                className="mt-1 w-full px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Заметки</span>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                onBlur={() => { if (notes !== (brand.notes || '')) save({ notes: notes || null }) }}
                rows={2}
                className="mt-1 w-full px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
              />
            </label>
          </div>

          <div className="flex gap-2">
            {brand.archivedAt ? (
              <button
                onClick={() => save({ archived: false })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
              >
                <ArchiveRestore className="w-4 h-4" /> Вернуть из архива
              </button>
            ) : (
              <button
                onClick={() => save({ archived: true })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
              >
                <Archive className="w-4 h-4" /> В архив
              </button>
            )}
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" /> Удалить
            </button>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
              <History className="w-4 h-4 text-gray-400" /> История изменений
            </h3>
            {events === null ? (
              <div className="text-gray-400 text-sm py-4 text-center">
                <Loader2 className="w-4 h-4 animate-spin inline" />
              </div>
            ) : events.length === 0 ? (
              <div className="text-gray-400 text-sm">Изменений пока нет</div>
            ) : (
              <ul className="space-y-2">
                {events.map(e => (
                  <li key={e.id} className="text-xs text-gray-600 border-l-2 border-gray-200 pl-2.5">
                    <div>
                      <span className="font-medium text-gray-800">{e.taskLabel || '—'}</span>
                      {': '}
                      <span className="text-gray-400">{e.oldLabel || '∅'}</span>
                      {' → '}
                      <span>{e.newLabel || '∅'}</span>
                    </div>
                    <div className="text-gray-400">
                      {formatDateTimeShort(e.changedAt)}{e.changedBy ? ` · ${e.changedBy}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────── История

function HistoryTab({ board }: { board: ObBoard }) {
  const [events, setEvents] = useState<ObEvent[] | null>(null)

  useEffect(() => {
    fetchOnboardingEvents(undefined, 200)
      .then(r => setEvents(r.events))
      .catch(() => setEvents([]))
  }, [board])

  if (events === null) {
    return (
      <div className="flex justify-center py-16 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }
  if (events.length === 0) {
    return <div className="text-gray-400 text-sm py-16 text-center">Изменений пока нет</div>
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
      {events.map(e => (
        <div key={e.id} className="px-4 py-2.5 text-sm flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-gray-900">{e.brandName || e.brandId}</span>
          <span className="text-gray-600">{e.taskLabel || '—'}</span>
          <span className="text-gray-400">{e.oldLabel || '∅'} → {e.newLabel || '∅'}</span>
          <span className="ml-auto text-xs text-gray-400">
            {formatDateTimeShort(e.changedAt)}{e.changedBy ? ` · ${e.changedBy}` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────── Справочники

function RefsTab({ board, onChanged }: { board: ObBoard; onChanged: () => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <StatusesEditor board={board} onChanged={onChanged} />
      <TaskTypesEditor board={board} onChanged={onChanged} />
      <PosEditor board={board} onChanged={onChanged} />
      <TemplateEditor board={board} onChanged={onChanged} />
    </div>
  )
}

function RefCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="font-medium text-gray-900">{title}</h3>
      {hint && <p className="text-xs text-gray-400 mt-0.5 mb-3">{hint}</p>}
      {children}
    </div>
  )
}

function InlineEdit({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="group flex items-center gap-1.5 text-sm text-gray-800 text-left"
      >
        {value}
        <Pencil className="w-3 h-3 text-gray-300 group-hover:text-gray-500" />
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1">
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && draft.trim()) { onSave(draft.trim()); setEditing(false) }
          if (e.key === 'Escape') setEditing(false)
        }}
        className="px-2 py-0.5 rounded border border-gray-300 text-sm w-40"
      />
      <button
        onClick={() => { if (draft.trim()) { onSave(draft.trim()); setEditing(false) } }}
        className="p-1 text-green-600 hover:bg-green-50 rounded"
      >
        <Check className="w-3.5 h-3.5" />
      </button>
    </span>
  )
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => Promise<void> }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!value.trim() || busy) return
    setBusy(true)
    try {
      await onAdd(value.trim())
      setValue('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex items-center gap-2 mt-3">
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
        placeholder={placeholder}
        className="flex-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
      />
      <button
        onClick={submit}
        disabled={!value.trim() || busy}
        className="p-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-40"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
      </button>
    </div>
  )
}

function StatusesEditor({ board, onChanged }: { board: ObBoard; onChanged: () => void }) {
  return (
    <RefCard
      title="Статусы"
      hint="«Тип для метрик» определяет, как статус учитывается во времени работы — переименования на метрики не влияют"
    >
      <ul className="space-y-2">
        {board.statuses.map(s => {
          const c = STATUS_COLORS[s.color] || STATUS_COLORS.gray
          return (
            <li key={s.id} className={`flex flex-wrap items-center gap-2 ${s.isActive ? '' : 'opacity-40'}`}>
              <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
              <InlineEdit
                value={s.label}
                onSave={label => updateRefItem({ kind: 'status', id: s.id, label }).then(onChanged)}
              />
              <select
                value={s.kind}
                onChange={e => updateRefItem({ kind: 'status', id: s.id, metricKind: e.target.value }).then(onChanged)}
                className="text-xs border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-500"
                title="Тип для метрик"
              >
                {METRIC_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <select
                value={s.color}
                onChange={e => updateRefItem({ kind: 'status', id: s.id, color: e.target.value }).then(onChanged)}
                className="text-xs border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-500"
                title="Цвет"
              >
                {COLOR_KEYS.map(ck => <option key={ck} value={ck}>{ck}</option>)}
              </select>
              <span className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => updateRefItem({ kind: 'status', id: s.id, isActive: !s.isActive }).then(onChanged)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  {s.isActive ? 'скрыть' : 'вернуть'}
                </button>
                <button
                  onClick={() => deleteRefItem('status', s.id).then(onChanged)}
                  className="p-1 text-gray-300 hover:text-red-500"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      <AddRow
        placeholder="Новый статус"
        onAdd={label => createRefItem({ kind: 'status', label }).then(onChanged)}
      />
    </RefCard>
  )
}

function TaskTypesEditor({ board, onChanged }: { board: ObBoard; onChanged: () => void }) {
  const move = async (idx: number, dir: -1 | 1) => {
    const list = board.taskTypes
    const a = list[idx]
    const b = list[idx + dir]
    if (!a || !b) return
    await Promise.all([
      updateRefItem({ kind: 'taskType', id: a.id, sortOrder: b.sortOrder }),
      updateRefItem({ kind: 'taskType', id: b.id, sortOrder: a.sortOrder }),
    ])
    onChanged()
  }

  return (
    <RefCard
      title="Шаги чек-листа (колонки)"
      hint="У существующих брендов новый шаг появится после назначения его POS-системе в шаблоне"
    >
      <ul className="space-y-2">
        {board.taskTypes.map((t, i) => (
          <li key={t.id} className={`flex items-center gap-2 ${t.isActive ? '' : 'opacity-40'}`}>
            <span className="flex flex-col">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-300 hover:text-gray-500 disabled:opacity-30">
                <ChevronUp className="w-3 h-3" />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === board.taskTypes.length - 1} className="text-gray-300 hover:text-gray-500 disabled:opacity-30">
                <ChevronDown className="w-3 h-3" />
              </button>
            </span>
            <InlineEdit
              value={t.label}
              onSave={label => updateRefItem({ kind: 'taskType', id: t.id, label }).then(onChanged)}
            />
            <span className="ml-auto flex items-center gap-1">
              <button
                onClick={() => updateRefItem({ kind: 'taskType', id: t.id, isActive: !t.isActive }).then(onChanged)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                {t.isActive ? 'скрыть' : 'вернуть'}
              </button>
              <button
                onClick={() => deleteRefItem('taskType', t.id).then(onChanged)}
                className="p-1 text-gray-300 hover:text-red-500"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <AddRow
        placeholder="Новый шаг (напр. Wolt)"
        onAdd={label => createRefItem({ kind: 'taskType', label }).then(onChanged)}
      />
    </RefCard>
  )
}

function PosEditor({ board, onChanged }: { board: ObBoard; onChanged: () => void }) {
  return (
    <RefCard title="POS-системы" hint="При создании бренда выбирается POS — она определяет набор шагов из шаблона">
      <ul className="space-y-2">
        {board.posSystems.map(p => (
          <li key={p.id} className={`flex items-center gap-2 ${p.isActive ? '' : 'opacity-40'}`}>
            <InlineEdit
              value={p.name}
              onSave={name => updateRefItem({ kind: 'pos', id: p.id, name }).then(onChanged)}
            />
            <span className="ml-auto flex items-center gap-1">
              <button
                onClick={() => updateRefItem({ kind: 'pos', id: p.id, isActive: !p.isActive }).then(onChanged)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                {p.isActive ? 'скрыть' : 'вернуть'}
              </button>
              <button
                onClick={() => deleteRefItem('pos', p.id).then(onChanged)}
                className="p-1 text-gray-300 hover:text-red-500"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <AddRow
        placeholder="Новая POS-система"
        onAdd={name => createRefItem({ kind: 'pos', name }).then(onChanged)}
      />
    </RefCard>
  )
}

function TemplateEditor({ board, onChanged }: { board: ObBoard; onChanged: () => void }) {
  const enabled = useMemo(() => {
    const set = new Set<string>()
    for (const m of board.posTaskMap) set.add(`${m.posId}|${m.taskTypeId}`)
    return set
  }, [board.posTaskMap])

  const pos = board.posSystems.filter(p => p.isActive)
  const types = board.taskTypes.filter(t => t.isActive)

  return (
    <RefCard
      title="Шаблон: POS → шаги"
      hint="Какие шаги чек-листа создаются для бренда с данной POS-системой"
    >
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="text-left font-medium text-gray-500 pr-3 py-1">Шаг</th>
              {pos.map(p => (
                <th key={p.id} className="font-medium text-gray-500 px-2 py-1 whitespace-nowrap">{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.map(t => (
              <tr key={t.id} className="border-t border-gray-50">
                <td className="pr-3 py-1 text-gray-700 whitespace-nowrap">{t.label}</td>
                {pos.map(p => (
                  <td key={p.id} className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={enabled.has(`${p.id}|${t.id}`)}
                      onChange={e =>
                        updateRefItem({
                          kind: 'posTaskMap',
                          posId: p.id,
                          taskTypeId: t.id,
                          enabled: e.target.checked,
                        }).then(onChanged)
                      }
                      className="rounded"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RefCard>
  )
}
