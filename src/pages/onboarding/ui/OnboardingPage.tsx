import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { formatDateTimeShort, formatDateShort } from '@/shared/lib'
import { fetchAgents } from '@/shared/api/agents'
import type { Agent } from '@/shared/types'
import {
  fetchOnboardingBoard, fetchOnboardingStats, createBrand, updateBrand, deleteBrand,
  setTaskStatus, setTaskAssignee, setTaskOption, fetchOnboardingEvents,
  fetchBrandCard, addBrandComment, deleteBrandComment,
  addBrandTodo, updateBrandTodo, deleteBrandTodo,
  createRefItem, updateRefItem, deleteRefItem,
  type ObBoard, type ObBrand, type ObStatus, type ObEvent, type ObStats,
  type ObComment, type ObTodo,
} from '@/shared/api/onboarding'
import {
  Plug, Plus, Loader2, RefreshCw, X, Archive, ArchiveRestore, Trash2,
  History, Settings2, LayoutGrid, ChevronUp, ChevronDown, Pencil, Check,
  BarChart3, AlertTriangle, MessageSquare, ListTodo, User, Flame, Clock,
  ArrowRight, Link2,
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

// Пороги «застревания» — сигналы на чипах и в аналитике
const STUCK_WAITING_HOURS = 48
const STUCK_ACTIVE_HOURS = 120

function fmtSeconds(sec: number): string {
  if (!sec || sec <= 0) return ''
  const h = sec / 3600
  if (h < 1) return `${Math.round(sec / 60)} мин`
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} ч`
  return `${(h / 24).toFixed(1)} дн`
}

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3600000
}

export function OnboardingPage() {
  const [board, setBoard] = useState<ObBoard | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'board' | 'stats' | 'history' | 'refs'>('board')
  const [showArchived, setShowArchived] = useState(false)
  const [openBrandId, setOpenBrandId] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const data = await fetchOnboardingBoard(showArchived)
      // Страховка от рассинхрона фронт/API в момент деплоя: недостающие
      // коллекции считаем пустыми, а не роняем доску.
      setBoard({
        ...data,
        statuses: data.statuses || [],
        taskTypes: data.taskTypes || [],
        posSystems: data.posSystems || [],
        posTaskMap: data.posTaskMap || [],
        optionCategories: data.optionCategories || [],
        options: data.options || [],
        brands: data.brands || [],
      })
    } catch (e) {
      console.error('Failed to load onboarding board:', e)
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [showArchived])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetchAgents().then(list => setAgents(list.filter(a => a.isActive !== false))).catch(() => {})
  }, [])

  const openBrand = openBrandId && board ? board.brands.find(b => b.id === openBrandId) || null : null

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
              ['stats', 'Аналитика', BarChart3],
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
          onOpenBrand={b => setOpenBrandId(b.id)}
          onChanged={() => load(true)}
        />
      )}
      {!loading && !error && tab === 'stats' && <StatsTab />}
      {!loading && !error && board && tab === 'history' && <HistoryTab board={board} />}
      {!loading && !error && board && tab === 'refs' && (
        <RefsTab board={board} onChanged={() => load(true)} />
      )}

      {openBrand && board && (
        <BrandDrawer
          brand={openBrand}
          board={board}
          agents={agents}
          onClose={() => setOpenBrandId(null)}
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
  const optionById = useMemo(
    () => Object.fromEntries(board.options.map(o => [o.id, o])),
    [board.options],
  )

  // Сводка: сигналы по доске
  const summary = useMemo(() => {
    let stuck = 0
    let blocked = 0
    for (const b of board.brands) {
      if (b.archivedAt) continue
      if (b.blockers?.trim()) blocked++
      for (const t of b.tasks) {
        const kind = t.statusId ? statusById[t.statusId]?.kind : null
        const h = hoursSince(t.statusSince)
        if ((kind === 'waiting' && h > STUCK_WAITING_HOURS) || (kind === 'active' && h > STUCK_ACTIVE_HOURS)) stuck++
      }
    }
    return { stuck, blocked, brands: board.brands.filter(b => !b.archivedAt).length }
  }, [board, statusById])

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

        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{summary.brands} в онбординге</span>
          {summary.stuck > 0 && (
            <span className="flex items-center gap-1 text-red-600">
              <Flame className="w-3.5 h-3.5" /> застряло: {summary.stuck}
            </span>
          )}
          {summary.blocked > 0 && (
            <span className="flex items-center gap-1 text-amber-600">
              <AlertTriangle className="w-3.5 h-3.5" /> с блокерами: {summary.blocked}
            </span>
          )}
        </div>

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
                <th className="sticky left-0 bg-gray-50 z-10 text-left font-medium text-gray-600 px-3 py-2 min-w-[210px]">
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
                  board={board}
                  taskTypes={taskTypes}
                  statusById={statusById}
                  optionById={optionById}
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

function BrandRow({ brand, board, taskTypes, statusById, optionById, posName, onOpen, onChanged }: {
  brand: ObBrand
  board: ObBoard
  taskTypes: ObBoard['taskTypes']
  statusById: Record<string, ObStatus>
  optionById: Record<string, ObBoard['options'][number]>
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
  const hasBlockers = !!brand.blockers?.trim()

  return (
    <tr className={`border-b border-gray-100 last:border-0 ${brand.archivedAt ? 'opacity-50' : ''} ${hasBlockers ? 'bg-red-50/40' : ''}`}>
      <td className={`sticky left-0 z-10 px-3 py-2 ${hasBlockers ? 'bg-red-50' : 'bg-white'} border-l-2 ${hasBlockers ? 'border-red-400' : 'border-transparent'}`}>
        <button onClick={onOpen} className="text-left group w-full">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-gray-900 group-hover:text-blue-600">{brand.name}</span>
            {hasBlockers && <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
            {brand.commentsCount > 0 && (
              <span className="flex items-center gap-0.5 text-[11px] text-gray-400">
                <MessageSquare className="w-3 h-3" />{brand.commentsCount}
              </span>
            )}
            {brand.openTodosCount > 0 && (
              <span className="flex items-center gap-0.5 text-[11px] text-blue-500">
                <ListTodo className="w-3 h-3" />{brand.openTodosCount}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400 flex items-center gap-1 flex-wrap">
            <span>{posName || 'без POS'}</span>
            {brand.assigneeName && (
              <span className="flex items-center gap-0.5"><User className="w-3 h-3" />{brand.assigneeName}</span>
            )}
          </div>
          {brand.nextStep?.trim() && (
            <div className="text-[11px] text-blue-600 flex items-center gap-1 mt-0.5 truncate max-w-[190px]">
              <ArrowRight className="w-3 h-3 shrink-0" />{brand.nextStep}
            </div>
          )}
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
              taskType={tt}
              board={board}
              status={task.statusId ? statusById[task.statusId] : undefined}
              option={task.optionId ? optionById[task.optionId] : undefined}
              onChanged={onChanged}
            />
          </td>
        )
      })}
    </tr>
  )
}

function StatusChip({ task, taskType, board, status, option, onChanged }: {
  task: ObBrand['tasks'][number]
  taskType: ObBoard['taskTypes'][number]
  board: ObBoard
  status?: ObStatus
  option?: ObBoard['options'][number]
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
  const kind = status?.kind
  const h = hoursSince(task.statusSince)
  const isStuck = (kind === 'waiting' && h > STUCK_WAITING_HOURS) || (kind === 'active' && h > STUCK_ACTIVE_HOURS)

  const timeHint = [
    task.activeSeconds ? `в работе ${fmtSeconds(task.activeSeconds)}` : '',
    task.waitingSeconds ? `ожидание ${fmtSeconds(task.waitingSeconds)}` : '',
  ].filter(Boolean).join(', ')

  const catOptions = taskType.optionCategoryId
    ? board.options.filter(o => o.categoryId === taskType.optionCategoryId && o.isActive)
    : []

  const pickStatus = async (statusId: string) => {
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
        title={[status?.label, option?.label, timeHint, task.assigneeName ? `исп: ${task.assigneeName}` : '']
          .filter(Boolean).join(' · ')}
        className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap transition-colors inline-flex items-center gap-1 ${colors.chip} ${
          isStuck ? 'ring-2 ring-red-400' : ''
        }`}
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : (
          <>
            {isStuck && (kind === 'waiting' ? <Clock className="w-3 h-3 text-red-500" /> : <Flame className="w-3 h-3 text-red-500" />)}
            <span>{status?.label || '—'}</span>
            {option && <span className="opacity-70">· {option.label}</span>}
          </>
        )}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 left-0 w-52 rounded-lg border border-gray-200 bg-white shadow-lg py-1">
          {board.statuses.filter(s => s.isActive).map(s => {
            const c = STATUS_COLORS[s.color] || STATUS_COLORS.gray
            return (
              <button
                key={s.id}
                onClick={() => pickStatus(s.id)}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 ${
                  s.id === task.statusId ? 'font-semibold' : ''
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                {s.label}
              </button>
            )
          })}

          {catOptions.length > 0 && (
            <div className="border-t border-gray-100 mt-1 px-3 py-1.5">
              <div className="text-[10px] uppercase text-gray-400 mb-1">Провайдер</div>
              <select
                value={task.optionId || ''}
                onChange={async e => {
                  await setTaskOption(task.id, e.target.value || null)
                  onChanged()
                }}
                className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 bg-white"
              >
                <option value="">—</option>
                {catOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          )}

          <div className={`px-3 py-1.5 ${catOptions.length === 0 ? 'border-t border-gray-100 mt-1' : ''}`}>
            <div className="text-[10px] uppercase text-gray-400 mb-1">Исполнитель</div>
            <AgentSelect
              value={task.assigneeId}
              onChange={async id => {
                await setTaskAssignee(task.id, id)
                onChanged()
              }}
            />
          </div>

          {(timeHint || isStuck) && (
            <div className="border-t border-gray-100 mt-1 px-3 py-1.5 text-[11px] text-gray-400">
              {isStuck && <span className="text-red-500 font-medium">в статусе {fmtSeconds(h * 3600)} · </span>}
              {timeHint}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Селект сотрудника — список подгружается один раз на страницу через контекст пропсов. */
let cachedAgents: Agent[] | null = null
function AgentSelect({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [agents, setAgents] = useState<Agent[]>(cachedAgents || [])
  useEffect(() => {
    if (cachedAgents) return
    fetchAgents().then(list => {
      cachedAgents = list.filter(a => a.isActive !== false)
      setAgents(cachedAgents)
    }).catch(() => {})
  }, [])
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value || null)}
      className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 bg-white"
    >
      <option value="">—</option>
      {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  )
}

// ─────────────────────────────────────────────── Карточка бренда

function BrandDrawer({ brand, board, agents, onClose, onChanged }: {
  brand: ObBrand
  board: ObBoard
  agents: Agent[]
  onClose: () => void
  onChanged: () => void
}) {
  const [events, setEvents] = useState<ObEvent[] | null>(null)
  const [comments, setComments] = useState<ObComment[] | null>(null)
  const [todos, setTodos] = useState<ObTodo[] | null>(null)
  const [name, setName] = useState(brand.name)
  const [nextStep, setNextStep] = useState(brand.nextStep || '')
  const [dependsOn, setDependsOn] = useState(brand.dependsOn || '')
  const [blockers, setBlockers] = useState(brand.blockers || '')
  const [notes, setNotes] = useState(brand.notes || '')
  const [posId, setPosId] = useState(brand.posId || '')
  const [newComment, setNewComment] = useState('')
  const [newTodo, setNewTodo] = useState('')
  const [newTodoAssignee, setNewTodoAssignee] = useState('')

  const loadCard = useCallback(() => {
    fetchBrandCard(brand.id)
      .then(r => { setComments(r.comments); setTodos(r.todos) })
      .catch(() => { setComments([]); setTodos([]) })
  }, [brand.id])

  useEffect(() => {
    fetchOnboardingEvents(brand.id, 200)
      .then(r => setEvents(r.events))
      .catch(() => setEvents([]))
    loadCard()
  }, [brand.id, loadCard])

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

  const submitComment = async () => {
    const text = newComment.trim()
    if (!text) return
    setNewComment('')
    await addBrandComment(brand.id, text)
    loadCard()
    onChanged()
  }

  const submitTodo = async () => {
    const text = newTodo.trim()
    if (!text) return
    setNewTodo('')
    await addBrandTodo(brand.id, { text, assigneeId: newTodoAssignee || null })
    setNewTodoAssignee('')
    loadCard()
    onChanged()
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 truncate">{brand.name}</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Основные поля */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block col-span-2">
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
              <span className="text-xs text-gray-500 flex items-center gap-1"><User className="w-3 h-3" />Ведёт проект</span>
              <select
                value={brand.assigneeId || ''}
                onChange={e => {
                  const a = agents.find(x => x.id === e.target.value)
                  save({ assigneeId: e.target.value || null, assigneeName: a?.name || null })
                }}
                className="mt-1 w-full px-3 py-1.5 rounded-lg border border-gray-300 text-sm bg-white"
              >
                <option value="">Не назначен</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="block col-span-2">
              <span className="text-xs text-gray-500 flex items-center gap-1"><ArrowRight className="w-3 h-3" />Следующий шаг</span>
              <input
                value={nextStep}
                onChange={e => setNextStep(e.target.value)}
                onBlur={() => { if (nextStep !== (brand.nextStep || '')) save({ nextStep: nextStep || null }) }}
                placeholder="Что делаем дальше"
                className="mt-1 w-full px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500 flex items-center gap-1"><Link2 className="w-3 h-3" />От кого зависим</span>
              <input
                value={dependsOn}
                onChange={e => setDependsOn(e.target.value)}
                onBlur={() => { if (dependsOn !== (brand.dependsOn || '')) save({ dependsOn: dependsOn || null }) }}
                placeholder="Клиент / поставщик / …"
                className="mt-1 w-full px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Блокеры</span>
              <input
                value={blockers}
                onChange={e => setBlockers(e.target.value)}
                onBlur={() => { if (blockers !== (brand.blockers || '')) save({ blockers: blockers || null }) }}
                placeholder="Что мешает"
                className={`mt-1 w-full px-3 py-1.5 rounded-lg border text-sm ${blockers.trim() ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}
              />
            </label>
            <label className="block col-span-2">
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

          {/* Мини-задачи */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
              <ListTodo className="w-4 h-4 text-gray-400" /> Задачи
            </h3>
            <div className="flex items-center gap-2 mb-2">
              <input
                value={newTodo}
                onChange={e => setNewTodo(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitTodo() }}
                placeholder="Новая задача"
                className="flex-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
              />
              <select
                value={newTodoAssignee}
                onChange={e => setNewTodoAssignee(e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm bg-white max-w-[130px]"
              >
                <option value="">Кому…</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button
                onClick={submitTodo}
                disabled={!newTodo.trim()}
                className="p-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-40"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {todos === null ? (
              <div className="text-gray-400 text-sm py-2"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
            ) : todos.length === 0 ? (
              <div className="text-gray-400 text-xs">Задач нет</div>
            ) : (
              <ul className="space-y-1.5">
                {todos.map(t => (
                  <li key={t.id} className="flex items-start gap-2 text-sm group">
                    <input
                      type="checkbox"
                      checked={!!t.doneAt}
                      onChange={async e => { await updateBrandTodo(t.id, { done: e.target.checked }); loadCard(); onChanged() }}
                      className="mt-0.5 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className={t.doneAt ? 'line-through text-gray-400' : 'text-gray-800'}>{t.text}</div>
                      <div className="text-[11px] text-gray-400">
                        {t.assigneeName && <span className="mr-2">→ {t.assigneeName}</span>}
                        {t.createdBy && <span>от {t.createdBy}</span>}
                      </div>
                    </div>
                    <button
                      onClick={async () => { await deleteBrandTodo(t.id); loadCard(); onChanged() }}
                      className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Комментарии */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-gray-400" /> Комментарии
            </h3>
            <div className="flex items-center gap-2 mb-2">
              <input
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitComment() }}
                placeholder="Написать комментарий…"
                className="flex-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
              />
              <button
                onClick={submitComment}
                disabled={!newComment.trim()}
                className="p-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-40"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {comments === null ? (
              <div className="text-gray-400 text-sm py-2"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
            ) : comments.length === 0 ? (
              <div className="text-gray-400 text-xs">Комментариев нет</div>
            ) : (
              <ul className="space-y-2">
                {comments.map(c => (
                  <li key={c.id} className="rounded-lg bg-gray-50 px-3 py-2 group">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium text-gray-700">{c.authorName || 'Без имени'}</span>
                      <span className="flex items-center gap-1">
                        <span className="text-[11px] text-gray-400">{formatDateTimeShort(c.createdAt)}</span>
                        <button
                          onClick={async () => { await deleteBrandComment(c.id); loadCard(); onChanged() }}
                          className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    </div>
                    <div className="text-sm text-gray-800 whitespace-pre-wrap">{c.text}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* История */}
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

// ─────────────────────────────────────────────── Аналитика

function StatsTab() {
  const [stats, setStats] = useState<ObStats | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetchOnboardingStats().then(setStats).catch(() => setError(true))
  }, [])

  if (error) return <div className="text-sm text-red-600 py-8 text-center">Не удалось загрузить аналитику</div>
  if (!stats) {
    return <div className="flex justify-center py-16 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
  }

  const avgAge = stats.brands.length
    ? stats.brands.reduce((s, b) => s + b.ageSeconds, 0) / stats.brands.length
    : 0
  const stuckCount = stats.stuck.filter(s =>
    (s.kind === 'waiting' && s.seconds > STUCK_WAITING_HOURS * 3600) ||
    (s.kind === 'active' && s.seconds > STUCK_ACTIVE_HOURS * 3600)).length

  return (
    <div className="space-y-6">
      {/* Сводка */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Брендов в онбординге', value: String(stats.brands.length) },
          { label: 'Средний возраст онбординга', value: fmtSeconds(avgAge) || '—' },
          { label: 'Застрявших задач', value: String(stuckCount), alert: stuckCount > 0 },
          { label: 'С блокерами', value: String(stats.brands.filter(b => b.hasBlockers).length), alert: stats.brands.some(b => b.hasBlockers) },
        ].map(t => (
          <div key={t.label} className={`rounded-lg border p-3 ${t.alert ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
            <div className={`text-2xl font-semibold ${t.alert ? 'text-red-600' : 'text-gray-900'}`}>{t.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{t.label}</div>
          </div>
        ))}
      </div>

      {/* Сигналы: застрявшие задачи */}
      {stats.stuck.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-red-500" /> Дольше всего в текущем статусе
          </div>
          <div className="divide-y divide-gray-50">
            {stats.stuck.map((s, i) => {
              const isBad = (s.kind === 'waiting' && s.seconds > STUCK_WAITING_HOURS * 3600) ||
                (s.kind === 'active' && s.seconds > STUCK_ACTIVE_HOURS * 3600)
              return (
                <div key={i} className="px-4 py-2 text-sm flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-gray-900">{s.brandName}</span>
                  <span className="text-gray-600">{s.taskLabel}</span>
                  <span className="text-gray-400">{s.statusLabel}</span>
                  {s.assigneeName && <span className="text-xs text-gray-400">→ {s.assigneeName}</span>}
                  <span className={`ml-auto text-xs font-medium ${isBad ? 'text-red-600' : 'text-gray-500'}`}>
                    {fmtSeconds(s.seconds)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* По этапам */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-medium text-gray-700">По этапам</div>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-100">
              <th className="text-left font-medium px-4 py-2">Этап</th>
              <th className="text-right font-medium px-3 py-2">Готово</th>
              <th className="text-right font-medium px-3 py-2">В работе</th>
              <th className="text-right font-medium px-3 py-2">Ожидание</th>
              <th className="text-right font-medium px-3 py-2">Ср. время работы</th>
              <th className="text-right font-medium px-3 py-2">Ср. ожидание</th>
              <th className="text-right font-medium px-3 py-2">Макс.</th>
            </tr>
          </thead>
          <tbody>
            {stats.stages.map(s => (
              <tr key={s.id} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2 text-gray-800">{s.label}</td>
                <td className="px-3 py-2 text-right text-green-600">{s.done || ''}</td>
                <td className="px-3 py-2 text-right text-blue-600">{s.active || ''}</td>
                <td className="px-3 py-2 text-right text-amber-600">{s.waiting || ''}</td>
                <td className="px-3 py-2 text-right text-gray-600">{fmtSeconds(s.avgActiveSeconds) || '—'}</td>
                <td className="px-3 py-2 text-right text-gray-600">{fmtSeconds(s.avgWaitingSeconds) || '—'}</td>
                <td className="px-3 py-2 text-right text-gray-400">
                  {fmtSeconds(Math.max(s.maxActiveSeconds, s.maxWaitingSeconds)) || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* По сотрудникам */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-medium text-gray-700">По сотрудникам</div>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-100">
              <th className="text-left font-medium px-4 py-2">Сотрудник</th>
              <th className="text-right font-medium px-3 py-2">Изменений</th>
              <th className="text-right font-medium px-3 py-2">Закрыто этапов</th>
              <th className="text-right font-medium px-3 py-2">Открытых задач</th>
              <th className="text-right font-medium px-3 py-2">Последняя активность</th>
            </tr>
          </thead>
          <tbody>
            {stats.people.map(p => (
              <tr key={p.name} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2 text-gray-800">{p.name}</td>
                <td className="px-3 py-2 text-right text-gray-600">{p.events || ''}</td>
                <td className="px-3 py-2 text-right text-green-600">{p.completed || ''}</td>
                <td className="px-3 py-2 text-right text-blue-600">{p.openTasks || ''}</td>
                <td className="px-3 py-2 text-right text-gray-400 text-xs">
                  {p.lastActivity ? formatDateTimeShort(p.lastActivity) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* По брендам */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-medium text-gray-700">По брендам</div>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-100">
              <th className="text-left font-medium px-4 py-2">Бренд</th>
              <th className="text-left font-medium px-3 py-2">Ведёт</th>
              <th className="text-left font-medium px-3 py-2">Прогресс</th>
              <th className="text-right font-medium px-3 py-2">В онбординге</th>
              <th className="text-right font-medium px-3 py-2">Старт</th>
            </tr>
          </thead>
          <tbody>
            {stats.brands.map(b => (
              <tr key={b.id} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2 text-gray-800 flex items-center gap-1.5">
                  {b.name}
                  {b.hasBlockers && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                </td>
                <td className="px-3 py-2 text-gray-600 text-xs">{b.assigneeName || '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full bg-green-500" style={{ width: b.total ? `${(b.done / b.total) * 100}%` : '0%' }} />
                    </div>
                    <span className="text-xs text-gray-400">{b.done}/{b.total}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-gray-600">{fmtSeconds(b.ageSeconds)}</td>
                <td className="px-3 py-2 text-right text-gray-400 text-xs">{formatDateShort(b.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
      <CategoriesEditor board={board} onChanged={onChanged} />
      <div className="space-y-6">
        <PosEditor board={board} onChanged={onChanged} />
        <TemplateEditor board={board} onChanged={onChanged} />
      </div>
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
      hint="Категория связывает колонку со справочником провайдеров — в ячейке можно будет выбрать конкретного"
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
            <select
              value={t.optionCategoryId || ''}
              onChange={e => updateRefItem({ kind: 'taskType', id: t.id, categoryId: e.target.value || null }).then(onChanged)}
              className="text-xs border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-500 max-w-[130px]"
              title="Категория провайдеров"
            >
              <option value="">без категории</option>
              {board.optionCategories.filter(c => c.isActive).map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
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
        placeholder="Новый шаг (напр. Телефония)"
        onAdd={label => createRefItem({ kind: 'taskType', label }).then(onChanged)}
      />
    </RefCard>
  )
}

function CategoriesEditor({ board, onChanged }: { board: ObBoard; onChanged: () => void }) {
  const [openCat, setOpenCat] = useState<string | null>(null)

  return (
    <RefCard
      title="Категории и провайдеры"
      hint="Тип оплаты, агрегаторы, курьер-сервисы, СМС, телефония, каналы продаж — списки провайдеров для выбора в ячейках"
    >
      <ul className="space-y-1">
        {board.optionCategories.map(cat => {
          const opts = board.options.filter(o => o.categoryId === cat.id)
          const isOpen = openCat === cat.id
          return (
            <li key={cat.id} className={cat.isActive ? '' : 'opacity-40'}>
              <div className="flex items-center gap-2 py-1">
                <button
                  onClick={() => setOpenCat(isOpen ? null : cat.id)}
                  className="p-0.5 text-gray-400 hover:text-gray-600"
                >
                  {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                <InlineEdit
                  value={cat.label}
                  onSave={label => updateRefItem({ kind: 'category', id: cat.id, label }).then(onChanged)}
                />
                <span className="text-xs text-gray-400">{opts.length}</span>
                <span className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => updateRefItem({ kind: 'category', id: cat.id, isActive: !cat.isActive }).then(onChanged)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    {cat.isActive ? 'скрыть' : 'вернуть'}
                  </button>
                  <button
                    onClick={() => deleteRefItem('category', cat.id).then(onChanged)}
                    className="p-1 text-gray-300 hover:text-red-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
              {isOpen && (
                <div className="ml-7 mb-2 border-l border-gray-100 pl-3">
                  <ul className="space-y-1">
                    {opts.map(o => (
                      <li key={o.id} className={`flex items-center gap-2 ${o.isActive ? '' : 'opacity-40'}`}>
                        <InlineEdit
                          value={o.label}
                          onSave={label => updateRefItem({ kind: 'option', id: o.id, label }).then(onChanged)}
                        />
                        <span className="ml-auto flex items-center gap-1">
                          <button
                            onClick={() => updateRefItem({ kind: 'option', id: o.id, isActive: !o.isActive }).then(onChanged)}
                            className="text-xs text-gray-400 hover:text-gray-600"
                          >
                            {o.isActive ? 'скрыть' : 'вернуть'}
                          </button>
                          <button
                            onClick={() => deleteRefItem('option', o.id).then(onChanged)}
                            className="p-1 text-gray-300 hover:text-red-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <AddRow
                    placeholder="Новый провайдер"
                    onAdd={label => createRefItem({ kind: 'option', categoryId: cat.id, label }).then(onChanged)}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <AddRow
        placeholder="Новая категория"
        onAdd={label => createRefItem({ kind: 'category', label }).then(onChanged)}
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
