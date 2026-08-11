import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { formatDateTimeShort, formatDateShort } from '@/shared/lib'
import { fetchAgents } from '@/shared/api/agents'
import { fetchChannels } from '@/shared/api/channels'
import { sendMessage } from '@/shared/api/messages'
import type { Channel } from '@/shared/types'
import type { Agent } from '@/shared/types'
import {
  fetchOnboardingBoard, fetchOnboardingStats, createBrand, updateBrand, deleteBrand,
  setTaskStatus, setTaskAssignee, setTaskOption, setTaskWaitingOn, addProviderTask, deleteTask, fetchOnboardingEvents,
  fetchBrandCard, addBrandComment, deleteBrandComment,
  addBrandTodo, updateBrandTodo, deleteBrandTodo,
  createRefItem, updateRefItem, deleteRefItem,
  type ObBoard, type ObBrand, type ObStatus, type ObEvent, type ObStats, type ObTaskType,
  type ObComment, type ObTodo, type ObTask,
} from '@/shared/api/onboarding'
import {
  Plug, Plus, Loader2, RefreshCw, X, Archive, ArchiveRestore, Trash2,
  History, Settings2, ChevronUp, ChevronDown, ChevronRight, Pencil, Check,
  BarChart3, AlertTriangle, MessageSquare, ListTodo, Flame, Clock,
  ArrowRight, Target, Table2, Settings, CalendarDays,
} from 'lucide-react'

// ───────────────────────────── константы и утилиты

const STATUS_COLORS: Record<string, { chip: string; dot: string; seg: string }> = {
  gray: { chip: 'bg-gray-100 text-gray-600 hover:bg-gray-200', dot: 'bg-gray-400', seg: 'bg-gray-200' },
  blue: { chip: 'bg-blue-100 text-blue-700 hover:bg-blue-200', dot: 'bg-blue-500', seg: 'bg-blue-500' },
  amber: { chip: 'bg-amber-100 text-amber-700 hover:bg-amber-200', dot: 'bg-amber-500', seg: 'bg-amber-500' },
  green: { chip: 'bg-green-100 text-green-700 hover:bg-green-200', dot: 'bg-green-500', seg: 'bg-green-500' },
  red: { chip: 'bg-red-100 text-red-700 hover:bg-red-200', dot: 'bg-red-500', seg: 'bg-red-400' },
  slate: { chip: 'bg-slate-100 text-slate-500 hover:bg-slate-200', dot: 'bg-slate-400', seg: 'bg-gray-100' },
}
const COLOR_KEYS = Object.keys(STATUS_COLORS)

const KIND_SEG: Record<string, string> = {
  done: 'bg-green-500',
  active: 'bg-blue-500',
  waiting: 'bg-amber-500',
  todo: 'bg-gray-200',
  cancelled: 'bg-gray-200',
}

const METRIC_KINDS: { value: string; label: string }[] = [
  { value: 'todo', label: 'Не начато (очередь)' },
  { value: 'active', label: 'В работе (считается как работа)' },
  { value: 'waiting', label: 'Ожидание (считается как ожидание)' },
  { value: 'done', label: 'Завершено' },
  { value: 'cancelled', label: 'Отменено' },
  { value: 'na', label: 'Не применимо' },
]

const STUCK_WAITING_HOURS = 48
const STUCK_ACTIVE_HOURS = 120

function fmtSeconds(sec: number): string {
  if (!sec || sec <= 0) return ''
  const h = sec / 3600
  if (h < 1) return `${Math.round(sec / 60)} мин`
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} ч`
  return `${(h / 24).toFixed(1)} дн`
}

function fmtShortDur(hours: number): string {
  if (hours >= 24) return `${(hours / 24).toFixed(1)} дн`
  return `${Math.round(hours)} ч`
}

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3600000
}

/** Понятная дата dd/mm/yyyy (рабочая tz — Ташкент). */
function fmtDMY(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d)
  return p.replace(/\./g, '/')
}

// Отделы: нормализация значений support_agents.department и порядок показа —
// «Поддержка и подключения» всегда первыми.
function depLabel(d?: string | null): string {
  const v = (d || '').trim().toLowerCase()
  if (['support', 'поддержка', 'poderjka'].includes(v)) return 'Поддержка и подключения'
  if (v === 'admin') return 'Администрация'
  if (v === 'product') return 'Продукт'
  if (v === 'sales') return 'Продажи'
  if (v === 'it') return 'IT'
  return d?.trim() || 'Прочие'
}
const DEP_ORDER = ['Поддержка и подключения', 'Продажи', 'Продукт', 'Администрация', 'IT', 'Прочие']

function groupAgentsByDep(agents: Agent[]): { label: string; agents: Agent[] }[] {
  const acc: Record<string, Agent[]> = {}
  for (const a of agents) (acc[depLabel(a.department)] = acc[depLabel(a.department)] || []).push(a)
  return Object.entries(acc)
    .sort((x, y) => {
      const xi = DEP_ORDER.indexOf(x[0]); const yi = DEP_ORDER.indexOf(y[0])
      return (xi === -1 ? 99 : xi) - (yi === -1 ? 99 : yi)
    })
    .map(([label, list]) => ({ label, agents: list.sort((a, b) => a.name.localeCompare(b.name)) }))
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function isTaskStuck(kind: string | undefined, hours: number, targetDays?: number | null): boolean {
  if (targetDays != null && (kind === 'waiting' || kind === 'active')) return hours > targetDays * 24
  return (kind === 'waiting' && hours > STUCK_WAITING_HOURS) || (kind === 'active' && hours > STUCK_ACTIVE_HOURS)
}

const WAITING_LABELS: Record<string, string> = { us: 'мы', client: 'клиент', provider: 'поставщик' }

interface StepGroup {
  label: string
  types: ObTaskType[]
}

/**
 * Блоки запуска: шаги собираются в свой блок независимо от порядка в
 * справочнике (иначе перестановка шага дробит группу на куски);
 * блоки упорядочены по первому шагу.
 */
function buildGroups(taskTypes: ObTaskType[]): StepGroup[] {
  const byLabel = new Map<string, StepGroup>()
  for (const t of taskTypes) {
    const label = t.groupLabel || 'Прочее'
    let g = byLabel.get(label)
    if (!g) {
      g = { label, types: [] }
      byLabel.set(label, g)
    }
    g.types.push(t)
  }
  return [...byLabel.values()].sort(
    (a, b) => Math.min(...a.types.map(t => t.sortOrder)) - Math.min(...b.types.map(t => t.sortOrder)),
  )
}

interface InFlightTask {
  task: ObTask
  kind: string
  hours: number
  stuck: boolean
}

function analyzeBrand(brand: ObBrand, statusById: Record<string, ObStatus>, typeById?: Record<string, ObTaskType>) {
  const inFlightTasks: InFlightTask[] = []
  let done = 0
  let countable = 0
  for (const t of brand.tasks) {
    const kind = t.statusId ? statusById[t.statusId]?.kind : undefined
    if (!kind || kind === 'na' || kind === 'cancelled') continue
    countable++
    if (kind === 'done') { done++; continue }
    if (kind === 'active' || kind === 'waiting') {
      const h = hoursSince(t.statusSince)
      inFlightTasks.push({ task: t, kind, hours: h, stuck: isTaskStuck(kind, h, typeById?.[t.taskTypeId]?.targetDays) })
    }
  }
  inFlightTasks.sort((a, b) => b.hours - a.hours)
  const worst = inFlightTasks[0] || null
  const hasBlockers = !!brand.blockers?.trim()
  let shelf: 'attention' | 'progress' | 'queue' | 'finish'
  if (countable > 0 && done === countable) shelf = 'finish'
  else if (hasBlockers || (worst?.stuck ?? false)) shelf = 'attention'
  else if (inFlightTasks.length === 0 && done === 0) shelf = 'queue'
  else shelf = 'progress'
  return { worst, inFlightTasks, inFlight: inFlightTasks.length, done, countable, hasBlockers, shelf }
}

/** Задачи бренда в порядке чек-листа (для пайплайна). */
function orderedTasks(brand: ObBrand, taskTypes: ObTaskType[]): ObTask[] {
  const order = Object.fromEntries(taskTypes.map((t, i) => [t.id, i]))
  return [...brand.tasks].sort((a, b) => (order[a.taskTypeId] ?? 99) - (order[b.taskTypeId] ?? 99))
}

function Pipeline({ tasks, statusById, height = 'h-[4px]' }: {
  tasks: ObTask[]
  statusById: Record<string, ObStatus>
  height?: string
}) {
  const segs = tasks.filter(t => {
    const k = t.statusId ? statusById[t.statusId]?.kind : undefined
    return k && k !== 'na' && k !== 'cancelled'
  })
  if (segs.length === 0) return null
  return (
    <span className="flex gap-[2px] w-full">
      {segs.map(t => {
        const kind = t.statusId ? statusById[t.statusId]?.kind : 'todo'
        const stuck = isTaskStuck(kind, hoursSince(t.statusSince))
        return (
          <span
            key={t.id}
            className={`flex-1 rounded-[2px] ${height} ${KIND_SEG[kind || 'todo'] || 'bg-gray-200'} ${stuck ? 'ring-1 ring-red-300' : ''}`}
          />
        )
      })}
    </span>
  )
}

function AgentAvatar({ name, size = 'w-6 h-6 text-[10px]' }: { name: string | null; size?: string }) {
  if (!name) {
    return (
      <span className={`${size} rounded-full bg-gray-100 text-gray-400 font-medium flex items-center justify-center shrink-0`} title="Не назначен">?</span>
    )
  }
  return (
    <span className={`${size} rounded-full bg-blue-100 text-blue-700 font-medium flex items-center justify-center shrink-0`} title={name}>
      {initials(name)}
    </span>
  )
}

// ── свой confirm вместо window.confirm ─────────────────────────────
let confirmResolver: ((v: boolean) => void) | null = null
let confirmSetter: ((msg: string | null) => void) | null = null

function appConfirm(message: string): Promise<boolean> {
  return new Promise(res => {
    confirmResolver = res
    if (confirmSetter) confirmSetter(message)
    else res(window.confirm(message))
  })
}

function ConfirmHost() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    confirmSetter = setMsg
    return () => { confirmSetter = null }
  }, [])
  if (!msg) return null
  const answer = (v: boolean) => {
    setMsg(null)
    confirmResolver?.(v)
    confirmResolver = null
  }
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={() => answer(false)} />
      <div className="relative bg-white rounded-xl shadow-xl border border-gray-200 p-5 w-[380px] max-w-[90vw]">
        <div className="flex items-start gap-3 mb-4">
          <span className="w-8 h-8 rounded-full bg-red-50 text-red-500 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </span>
          <div className="text-sm text-gray-800 pt-1">{msg}</div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={() => answer(false)} className="px-3.5 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            Отмена
          </button>
          <button onClick={() => answer(true)} className="px-3.5 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700">
            Подтвердить
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Аватар ответственного бренда: клик открывает выбор сотрудника. «?» = не назначен. */
function AssigneeBadge({ brand, agents, onMutateBrand, onChanged, size = 'w-6 h-6 text-[10px]' }: {
  brand: ObBrand
  agents: Agent[]
  onMutateBrand: (brandId: string, patch: Partial<ObBrand>) => void
  onChanged: () => void
  size?: string
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const open = rect !== null

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return
      if (panelRef.current?.contains(e.target as Node)) return
      setRect(null)
    }
    const onScroll = () => setRect(null)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const pick = async (agent: Agent | null) => {
    setRect(null)
    onMutateBrand(brand.id, { assigneeId: agent?.id || null, assigneeName: agent?.name || null })
    await updateBrand({ id: brand.id, assigneeId: agent?.id || null, assigneeName: agent?.name || null })
    onChanged()
  }

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const panelStyle: CSSProperties | undefined = rect ? {
    position: 'fixed',
    zIndex: 60,
    width: 192,
    left: Math.min(Math.max(8, rect.right - 192), vw - 200),
    ...(rect.bottom > vh - 300 ? { bottom: Math.max(8, vh - rect.top + 4) } : { top: rect.bottom + 4 }),
    maxHeight: 280,
    overflowY: 'auto',
  } : undefined

  return (
    <>
      <button
        ref={btnRef}
        onClick={e => { e.stopPropagation(); setRect(open ? null : btnRef.current?.getBoundingClientRect() || null) }}
        title={brand.assigneeName
          ? `Ведёт: ${brand.assigneeName} — нажмите, чтобы сменить`
          : 'Ответственный не назначен — нажмите, чтобы назначить'}
        className="hover:ring-2 hover:ring-blue-300 rounded-full transition-shadow"
      >
        <AgentAvatar name={brand.assigneeName} size={size} />
      </button>
      {open && rect && createPortal(
        <div ref={panelRef} style={panelStyle} className="rounded-lg border border-gray-200 bg-white shadow-lg py-1">
          <div className="px-3 py-1 text-[10px] uppercase text-gray-400">Кто ведёт проект</div>
          <button onClick={() => pick(null)} className="w-full px-3 py-1.5 text-left text-xs text-gray-400 hover:bg-gray-50">
            Не назначен
          </button>
          {groupAgentsByDep(agents).map(g => (
            <div key={g.label}>
              <div className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase text-gray-400">{g.label}</div>
              {g.agents.map(ag => (
                <button
                  key={ag.id}
                  onClick={() => pick(ag)}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 ${
                    ag.id === brand.assigneeId ? 'font-semibold' : ''
                  }`}
                >
                  <AgentAvatar name={ag.name} size="w-5 h-5 text-[9px]" />
                  {ag.name}
                </button>
              ))}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

// ───────────────────────────── страница

export function OnboardingPage() {
  const [board, setBoard] = useState<ObBoard | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'focus' | 'matrix' | 'timeline' | 'stats' | 'history' | 'refs'>('focus')
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const data = await fetchOnboardingBoard(showArchived)
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

  useEffect(() => { load(board !== null) }, [load]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchAgents().then(list => setAgents(list.filter(a => a.isActive !== false))).catch(() => {})
  }, [])

  // Оптимистичные локальные правки — UI отзывается мгновенно, API работает в фоне
  const mutateTask = useCallback((taskId: string, patch: Partial<ObTask>) => {
    setBoard(prev => prev ? {
      ...prev,
      brands: prev.brands.map(b => ({
        ...b,
        tasks: b.tasks.map(t => (t.id === taskId ? { ...t, ...patch } : t)),
      })),
    } : prev)
  }, [])
  const mutateBrand = useCallback((brandId: string, patch: Partial<ObBrand>) => {
    setBoard(prev => prev ? {
      ...prev,
      brands: prev.brands.map(b => (b.id === brandId ? { ...b, ...patch } : b)),
    } : prev)
  }, [])

  const statusById = useMemo(
    () => Object.fromEntries((board?.statuses || []).map(s => [s.id, s])),
    [board?.statuses],
  )
  const selectedBrand = selectedBrandId && board
    ? board.brands.find(b => b.id === selectedBrandId) || null
    : null

  return (
    <div className="p-4 sm:p-6 max-w-full">
      <ConfirmHost />
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
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm bg-white">
            {([
              ['focus', 'Фокус', Target],
              ['matrix', 'Матрица', Table2],
              ['timeline', 'Таймлайн', CalendarDays],
              ['stats', 'Аналитика', BarChart3],
              ['history', 'История', History],
              ['refs', 'Справочники', Settings2],
            ] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => { setTab(key); if (key !== 'focus' && key !== 'matrix') setSelectedBrandId(null) }}
                className={`flex items-center gap-1.5 px-3 py-1.5 ${
                  tab === key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
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
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>
      )}

      {!loading && !error && board && tab === 'focus' && (
        <FocusTab
          board={board}
          agents={agents}
          statusById={statusById}
          selectedBrand={selectedBrand}
          showArchived={showArchived}
          onToggleArchived={setShowArchived}
          onSelect={setSelectedBrandId}
          onMutateTask={mutateTask}
          onMutateBrand={mutateBrand}
          onChanged={() => load(true)}
        />
      )}
      {!loading && !error && board && tab === 'matrix' && (
        <>
          <MatrixTab
            board={board}
            statusById={statusById}
            onSelect={setSelectedBrandId}
            onMutateTask={mutateTask}
            onChanged={() => load(true)}
          />
          {selectedBrand && (
            <div className="fixed inset-0 z-40 flex justify-end">
              <div className="absolute inset-0 bg-black/20" onClick={() => setSelectedBrandId(null)} />
              <div className="relative w-full max-w-xl h-full bg-white shadow-xl overflow-y-auto border-l-2 border-blue-500">
                <BrandPanel
                  brand={selectedBrand}
                  board={board}
                  agents={agents}
                  statusById={statusById}
                  onClose={() => setSelectedBrandId(null)}
                  onMutateTask={mutateTask}
                  onMutateBrand={mutateBrand}
                  onChanged={() => load(true)}
                />
              </div>
            </div>
          )}
        </>
      )}
      {!loading && !error && tab === 'timeline' && board && (
        <TimelineTab board={board} statusById={statusById} onSelect={id => { setSelectedBrandId(id); setTab('focus') }} />
      )}
      {!loading && !error && tab === 'stats' && board && <StatsTab board={board} statusById={statusById} />}
      {!loading && !error && board && tab === 'history' && <HistoryTab board={board} />}
      {!loading && !error && board && tab === 'refs' && (
        <RefsTab board={board} onChanged={() => load(true)} />
      )}
    </div>
  )
}

// ───────────────────────────── Фокус

function FocusTab({ board, agents, statusById, selectedBrand, showArchived, onToggleArchived, onSelect, onMutateTask, onMutateBrand, onChanged }: {
  board: ObBoard
  agents: Agent[]
  statusById: Record<string, ObStatus>
  selectedBrand: ObBrand | null
  showArchived: boolean
  onToggleArchived: (v: boolean) => void
  onSelect: (id: string | null) => void
  onMutateTask: (taskId: string, patch: Partial<ObTask>) => void
  onMutateBrand: (brandId: string, patch: Partial<ObBrand>) => void
  onChanged: () => void
}) {
  const [filter, setFilter] = useState<'all' | 'stuck' | 'mine' | 'archive'>('all')
  useEffect(() => {
    if ((filter === 'archive') !== showArchived) onToggleArchived(filter === 'archive')
  }, [filter, showArchived, onToggleArchived])
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPos, setNewPos] = useState('')
  const myId = localStorage.getItem('support_agent_token') || ''

  const taskTypes = board.taskTypes.filter(t => t.isActive)
  const typeById = useMemo(() => Object.fromEntries(board.taskTypes.map(t => [t.id, t])), [board.taskTypes])
  const optionById = useMemo(() => Object.fromEntries(board.options.map(o => [o.id, o])), [board.options])
  const posById = useMemo(() => Object.fromEntries(board.posSystems.map(p => [p.id, p])), [board.posSystems])

  const analyzed = useMemo(() => board.brands
    .filter(b => (filter === 'archive' ? !!b.archivedAt : !b.archivedAt))
    .map(brand => ({ brand, a: analyzeBrand(brand, statusById, typeById) })), [board.brands, statusById, typeById, filter])

  const stuckTotal = analyzed.reduce((s, x) => s + x.a.inFlightTasks.filter(t => t.stuck).length, 0)

  const filtered = analyzed.filter(({ brand, a }) => {
    if (filter === 'stuck') return a.shelf === 'attention'
    if (filter === 'mine') return brand.assigneeId === myId || brand.tasks.some(t => t.assigneeId === myId)
    return true
  })

  const shelves = filter === 'archive'
    ? { attention: [], progress: [], queue: [], finish: [], archive: filtered }
    : {
        attention: filtered.filter(x => x.a.shelf === 'attention').sort((a, b) => (b.a.worst?.hours || 0) - (a.a.worst?.hours || 0)),
        progress: filtered.filter(x => x.a.shelf === 'progress').sort((a, b) => (b.a.worst?.hours || 0) - (a.a.worst?.hours || 0)),
        queue: filtered.filter(x => x.a.shelf === 'queue'),
        finish: filtered.filter(x => x.a.shelf === 'finish'),
        archive: [] as typeof filtered,
      }

  const handleAdd = async () => {
    if (!newName.trim()) return
    await createBrand({ name: newName.trim(), posId: newPos || null })
    setNewName(''); setNewPos(''); setAdding(false)
    onChanged()
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" /> Бренд
        </button>
      ) : (
        <span className="flex items-center gap-2">
          <input
            autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
            placeholder="Название бренда"
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
          />
          <select value={newPos} onChange={e => setNewPos(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm bg-white">
            <option value="">POS…</option>
            {board.posSystems.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={handleAdd} disabled={!newName.trim()} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">Создать</button>
          <button onClick={() => setAdding(false)} className="p-1.5 text-gray-400"><X className="w-4 h-4" /></button>
        </span>
      )}
      <span className="flex gap-1.5 ml-1">
        {([
          ['all', filter === 'archive' ? 'Все' : `Все ${analyzed.length}`],
          ['stuck', `застряло ${filter === 'archive' ? '' : stuckTotal}`.trim()],
          ['mine', 'мои'],
          ['archive', 'архив'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`text-xs px-2.5 py-1 rounded-full border ${
              filter === key
                ? 'bg-gray-900 text-white border-gray-900'
                : key === 'stuck'
                  ? 'bg-white border-gray-200 text-red-600 hover:bg-gray-50'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </span>
    </div>
  )

  const shelfDefs = [
    { key: 'attention' as const, label: 'Требуют действия', cls: 'text-red-600' },
    { key: 'progress' as const, label: 'В работе', cls: 'text-blue-700' },
    { key: 'queue' as const, label: 'Очередь', cls: 'text-gray-400' },
    { key: 'finish' as const, label: 'Финишная прямая', cls: 'text-green-700' },
    { key: 'archive' as const, label: 'Архив — онбординг завершён', cls: 'text-gray-400' },
  ]

  // ── сплит: выбран бренд
  if (selectedBrand) {
    return (
      <div>
        {toolbar}
        <div className="flex gap-4 items-start">
          <div className="w-60 shrink-0 rounded-lg border border-gray-200 bg-white overflow-hidden">
            {shelfDefs.map(def => {
              const items = shelves[def.key]
              if (items.length === 0) return null
              return (
                <div key={def.key}>
                  <div className={`text-[10px] font-medium uppercase tracking-wide px-3 pt-2.5 pb-1 ${def.cls}`}>
                    {def.label} · {items.length}
                  </div>
                  {items.map(({ brand, a }) => {
                    const active = brand.id === selectedBrand.id
                    const worstType = a.worst ? typeById[a.worst.task.taskTypeId]?.label : null
                    const worstOpt = a.worst?.task.optionId ? optionById[a.worst.task.optionId]?.label : null
                    return (
                      <button
                        key={brand.id}
                        onClick={() => onSelect(brand.id)}
                        className={`block w-full text-left px-3 py-2 border-t border-gray-50 ${active ? 'bg-blue-50 border-l-2 border-l-blue-600' : 'hover:bg-gray-50 border-l-2 border-l-transparent'}`}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="text-[13px] font-medium text-gray-900 truncate">{brand.name}</span>
                          {a.hasBlockers && <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />}
                          {a.worst && (
                            <span className={`ml-auto text-[11px] font-medium ${a.worst.stuck ? 'text-red-600' : 'text-gray-400'}`}>
                              {(a.worst.hours / 24).toFixed(1)}
                            </span>
                          )}
                          {def.key === 'finish' && <span className="ml-auto text-[11px] text-green-700">✓</span>}
                        </span>
                        {a.worst && worstType && (
                          <span className={`block text-[11px] truncate ${a.worst.kind === 'waiting' ? 'text-amber-700' : 'text-gray-400'}`}>
                            {a.worst.kind === 'waiting' ? '⏸' : '●'} {worstType}{worstOpt ? ` · ${worstOpt}` : ''}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
          <div className="flex-1 min-w-0 rounded-lg border border-gray-200 bg-white">
            <BrandPanel
              brand={selectedBrand}
              board={board}
              agents={agents}
              statusById={statusById}
              onClose={() => onSelect(null)}
              onMutateTask={onMutateTask}
              onMutateBrand={onMutateBrand}
              onChanged={onChanged}
            />
          </div>
        </div>
      </div>
    )
  }

  // ── реестр на всю ширину
  return (
    <div>
      {toolbar}
      <div className="space-y-4">
        {shelfDefs.map(def => {
          const items = shelves[def.key]
          if (items.length === 0) return null
          return (
            <div key={def.key}>
              <div className={`text-[11px] font-medium uppercase tracking-wide mb-1.5 ${def.cls}`}>
                {def.label} · {items.length}
              </div>
              <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-50 overflow-hidden">
                {items.map(({ brand, a }) => (
                  <FocusRow
                    key={brand.id}
                    brand={brand}
                    a={a}
                    shelf={def.key}
                    posName={brand.posId ? posById[brand.posId]?.name : undefined}
                    taskTypes={taskTypes}
                    typeById={typeById}
                    optionById={optionById}
                    statusById={statusById}
                    agents={agents}
                    onOpen={() => onSelect(brand.id)}
                    onMutateBrand={onMutateBrand}
                    onChanged={onChanged}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FocusRow({ brand, a, shelf, posName, taskTypes, typeById, optionById, statusById, agents, onOpen, onMutateBrand, onChanged }: {
  brand: ObBrand
  a: ReturnType<typeof analyzeBrand>
  shelf: 'attention' | 'progress' | 'queue' | 'finish' | 'archive'
  posName?: string
  taskTypes: ObTaskType[]
  typeById: Record<string, ObTaskType>
  optionById: Record<string, ObBoard['options'][number]>
  statusById: Record<string, ObStatus>
  agents: Agent[]
  onOpen: () => void
  onMutateBrand: (brandId: string, patch: Partial<ObBrand>) => void
  onChanged: () => void
}) {
  const worst = a.worst
  const worstType = worst ? typeById[worst.task.taskTypeId]?.label : null
  const worstOpt = worst?.task.optionId ? optionById[worst.task.optionId]?.label : null
  const worstStatus = worst?.task.statusId ? statusById[worst.task.statusId] : undefined
  const days = Math.round(hoursSince(brand.startedAt) / 24)

  const finishOnboarding = async () => {
    if (!(await appConfirm(`Завершить онбординг «${brand.name}» и убрать бренд в архив? Бренд останется доступен в фильтре «архив».`))) return
    await updateBrand({ id: brand.id, archived: true })
    onChanged()
  }

  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-gray-50/60 cursor-pointer" onClick={onOpen}>
      <div className="w-40 shrink-0">
        <span className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-gray-900 truncate">{brand.name}</span>
          {a.hasBlockers && <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />}
        </span>
        <span className="text-[11px] text-gray-400">{posName || 'без POS'} · {days} дн · {a.done}/{a.countable}</span>
      </div>
      <span className="w-24 shrink-0">
        <Pipeline tasks={orderedTasks(brand, taskTypes)} statusById={statusById} height="h-[3px]" />
      </span>
      <span className="min-w-0 flex-1 text-[12px] truncate">
        {shelf === 'archive' ? (
          <span className="text-gray-400">завершён {brand.archivedAt ? fmtDMY(brand.archivedAt) : ''} · старт {fmtDMY(brand.startedAt)} · {a.done}/{a.countable} шагов</span>
        ) : shelf === 'finish' ? (
          <span className="text-green-700">все шаги закрыты</span>
        ) : shelf === 'queue' ? (
          <span className="text-gray-400">не начат — {a.countable || brand.tasks.length} шагов впереди</span>
        ) : worst ? (
          <>
            <span className={worst.kind === 'waiting' ? 'text-amber-700' : 'text-gray-600'}>
              {worst.kind === 'waiting' ? '⏸ ' : '● '}
              {worstType}
              {worstOpt && <span className="text-gray-400"> · {worstOpt}</span>}
              {' — '}{worstStatus?.label?.toLowerCase()}
            </span>
            <span className={`ml-1 font-medium ${worst.stuck ? 'text-red-600' : 'text-gray-400'}`}>{fmtShortDur(worst.hours)}</span>
            {a.inFlight > 1 && <span className="text-gray-400"> · +{a.inFlight - 1}</span>}
          </>
        ) : null}
      </span>
      <span className="min-w-0 flex-1 text-[11px] truncate hidden lg:block">
        {a.hasBlockers ? (
          <span className="text-red-600">⚠ {brand.blockers}</span>
        ) : brand.nextStep?.trim() ? (
          <span className="text-gray-500">→ {brand.nextStep}</span>
        ) : shelf === 'attention' && !worst?.task.assigneeId && !brand.assigneeId ? (
          <span className="text-amber-600">исполнитель не назначен</span>
        ) : null}
      </span>
      <span className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
        {brand.commentsCount > 0 && (
          <span className="flex items-center gap-0.5 text-[11px] text-gray-400"><MessageSquare className="w-3 h-3" />{brand.commentsCount}</span>
        )}
        {brand.openTodosCount > 0 && (
          <span className="flex items-center gap-0.5 text-[11px] text-blue-500"><ListTodo className="w-3 h-3" />{brand.openTodosCount}</span>
        )}
        {shelf === 'finish' ? (
          <button onClick={finishOnboarding} className="text-xs px-2.5 py-1 rounded-lg border border-green-300 text-green-700 hover:bg-green-50">
            Завершить
          </button>
        ) : shelf === 'archive' ? (
          <button
            onClick={async () => {
              onMutateBrand(brand.id, { archivedAt: null })
              await updateBrand({ id: brand.id, archived: false })
              onChanged()
            }}
            className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            Вернуть из архива
          </button>
        ) : (
          <button onClick={onOpen} className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            Открыть
          </button>
        )}
        <AssigneeBadge brand={brand} agents={agents} onMutateBrand={onMutateBrand} onChanged={onChanged} />
      </span>
    </div>
  )
}

// Каналы грузим один раз на страницу — для привязки бренда и отправки напоминаний
let cachedChannels: Channel[] | null = null
function useChannels(load: boolean): Channel[] {
  const [list, setList] = useState<Channel[]>(cachedChannels || [])
  useEffect(() => {
    if (!load || cachedChannels) return
    fetchChannels().then(ch => {
      cachedChannels = ch
      setList(ch)
    }).catch(() => {})
  }, [load])
  return list
}

/**
 * «Напомнить…» — меню с явным адресатом. «Сотруднику» создаёт задачу-напоминание;
 * «Клиенту в Telegram» шлёт сообщение в привязанный канал бренда существующим
 * механизмом чатов (никакого нового чата — тот же бот и та же переписка).
 */
function ReminderMenu({ brand, worstLabel, onCreated }: {
  brand: ObBrand
  worstLabel: string | null
  onCreated: () => void
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const open = rect !== null

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return
      if (panelRef.current?.contains(e.target as Node)) return
      setRect(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const reminderText = `Напоминание: ${brand.nextStep?.trim() || worstLabel || 'продвинуть онбординг'}`
  const [clientMode, setClientMode] = useState(false)
  const [clientText, setClientText] = useState('')
  const [sending, setSending] = useState(false)

  const remindAssignee = async () => {
    setRect(null)
    await addBrandTodo(brand.id, { text: reminderText, assigneeId: brand.assigneeId || null })
    onCreated()
  }

  const openClientMode = () => {
    setClientText(`Здравствуйте! Напоминаем: ждём от вас — ${brand.nextStep?.trim() || worstLabel || 'данные для подключения'} 🙏`)
    setClientMode(true)
  }

  const sendToClient = async () => {
    if (!brand.channelId || !clientText.trim() || sending) return
    setSending(true)
    try {
      await sendMessage(brand.channelId, clientText.trim())
      await addBrandComment(brand.id, `📨 Напоминание клиенту в чат: «${clientText.trim().slice(0, 120)}»`).catch(() => {})
      setRect(null)
      setClientMode(false)
      onCreated()
    } finally {
      setSending(false)
    }
  }

  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const panelStyle: CSSProperties | undefined = rect ? {
    position: 'fixed', zIndex: 60, width: 264,
    left: Math.max(8, rect.right - 264),
    ...(rect.bottom > vh - 220 ? { bottom: vh - rect.top + 4 } : { top: rect.bottom + 4 }),
  } : undefined

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setRect(open ? null : btnRef.current?.getBoundingClientRect() || null)}
        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
      >
        Напомнить <ChevronDown className="w-3 h-3" />
      </button>
      {open && rect && createPortal(
        <div ref={panelRef} style={panelStyle} className="rounded-lg border border-gray-200 bg-white shadow-lg py-1">
          <button onClick={remindAssignee} className="w-full px-3 py-2 text-left hover:bg-gray-50">
            <span className="text-xs text-gray-900 block">Сотруднику{brand.assigneeName ? ` — ${brand.assigneeName}` : ''}</span>
            <span className="text-[11px] text-gray-400 block">создаст задачу «{reminderText.slice(0, 40)}…»</span>
          </button>
          {brand.channelId ? (
            clientMode ? (
              <div className="px-3 py-2 border-t border-gray-100">
                <div className="text-[10px] uppercase text-gray-400 mb-1">Сообщение в чат бренда</div>
                <textarea
                  autoFocus
                  value={clientText}
                  onChange={e => setClientText(e.target.value)}
                  rows={3}
                  className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-xs"
                />
                <div className="flex justify-end gap-1.5 mt-1.5">
                  <button onClick={() => setClientMode(false)} className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 text-gray-500">
                    Отмена
                  </button>
                  <button
                    onClick={sendToClient}
                    disabled={!clientText.trim() || sending}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-blue-600 text-white disabled:opacity-50"
                  >
                    {sending ? 'Отправка…' : 'Отправить в чат'}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={openClientMode} className="w-full px-3 py-2 text-left hover:bg-gray-50 border-t border-gray-100">
                <span className="text-xs text-gray-900 block">Клиенту в Telegram-чат</span>
                <span className="text-[11px] text-gray-400 block">отправит через бота в привязанный канал</span>
              </button>
            )
          ) : (
            <div className="w-full px-3 py-2 opacity-50 cursor-not-allowed border-t border-gray-100">
              <span className="text-xs text-gray-900 block">Клиенту в Telegram-чат</span>
              <span className="text-[11px] text-gray-400 block">привяжите канал бренда в ⚙ — и пункт оживёт</span>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

// ───────────────────────────── Панель бренда (сплит + шторка)

function BrandPanel({ brand, board, agents, statusById, onClose, onMutateTask, onMutateBrand, onChanged }: {
  brand: ObBrand
  board: ObBoard
  agents: Agent[]
  statusById: Record<string, ObStatus>
  onClose: () => void
  onMutateTask: (taskId: string, patch: Partial<ObTask>) => void
  onMutateBrand: (brandId: string, patch: Partial<ObBrand>) => void
  onChanged: () => void
}) {
  const [showFields, setShowFields] = useState(false)
  const [cardTab, setCardTab] = useState<'comments' | 'todos' | 'history'>('comments')
  const [events, setEvents] = useState<ObEvent[] | null>(null)
  const [comments, setComments] = useState<ObComment[] | null>(null)
  const [todos, setTodos] = useState<ObTodo[] | null>(null)
  const [nextStep, setNextStep] = useState(brand.nextStep || '')

  useEffect(() => { setNextStep(brand.nextStep || '') }, [brand.id, brand.nextStep])

  const loadCard = useCallback(() => {
    fetchBrandCard(brand.id).then(r => { setComments(r.comments); setTodos(r.todos) }).catch(() => { setComments([]); setTodos([]) })
    fetchOnboardingEvents(brand.id, 200).then(r => setEvents(r.events)).catch(() => setEvents([]))
  }, [brand.id])
  useEffect(() => { loadCard() }, [loadCard])
  // После операций (смена статусов и т.п.) доска перезагружается — подтягиваем
  // свежий журнал, чтобы «История» сразу показывала событие с автором.
  useEffect(() => {
    fetchOnboardingEvents(brand.id, 200).then(r => setEvents(r.events)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand])

  const taskTypes = board.taskTypes.filter(t => t.isActive)
  const typeById = useMemo(() => Object.fromEntries(board.taskTypes.map(t => [t.id, t])), [board.taskTypes])
  const optionById = useMemo(() => Object.fromEntries(board.options.map(o => [o.id, o])), [board.options])
  const groups = useMemo(() => buildGroups(taskTypes), [taskTypes])
  const tasksByType = useMemo(() => {
    const acc: Record<string, ObTask[]> = {}
    for (const t of brand.tasks) (acc[t.taskTypeId] = acc[t.taskTypeId] || []).push(t)
    return acc
  }, [brand.tasks])

  const a = analyzeBrand(brand, statusById, typeById)
  const days = Math.round(hoursSince(brand.startedAt) / 24)
  const stuckCount = a.inFlightTasks.filter(t => t.stuck).length
  const posName = brand.posId ? board.posSystems.find(p => p.id === brand.posId)?.name : null

  // Подсказка следующего действия по боттлнеку, когда поле пустое
  const suggestion = useMemo(() => {
    if (a.worst) {
      const label = typeById[a.worst.task.taskTypeId]?.label || 'этап'
      const opt = a.worst.task.optionId ? optionById[a.worst.task.optionId]?.label : null
      const full = `${label}${opt ? ` · ${opt}` : ''}`
      return a.worst.kind === 'waiting' ? `дожать данные: ${full}` : `завершить: ${full}`
    }
    const firstTodo = orderedTasks(brand, taskTypes).find(t => statusById[t.statusId || '']?.kind === 'todo')
    if (firstTodo) return `начать: ${typeById[firstTodo.taskTypeId]?.label || 'первый шаг'}`
    return null
  }, [a.worst, brand, taskTypes, typeById, optionById, statusById])

  // раскрыты: группы с застрявшими/ожидающими
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    const open = new Set<string>()
    for (const g of buildGroups(board.taskTypes.filter(t => t.isActive))) {
      const hasHot = g.types.some(tt => (tasksByType[tt.id] || []).some(t => {
        const k = t.statusId ? statusById[t.statusId]?.kind : undefined
        return k === 'waiting' || (k === 'active' && isTaskStuck(k, hoursSince(t.statusSince)))
      }))
      if (hasHot) open.add(g.label)
    }
    setExpanded(open)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand.id])

  const save = async (patch: Omit<Parameters<typeof updateBrand>[0], 'id'>) => {
    await updateBrand({ id: brand.id, ...patch })
    onChanged()
  }

  const handleDelete = async () => {
    if (!(await appConfirm(`Удалить бренд «${brand.name}» вместе с историей? Это необратимо.`))) return
    await deleteBrand(brand.id)
    onClose()
    onChanged()
  }

  return (
    <div className="p-4">
      {/* Шапка */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[16px] font-medium text-gray-900">{brand.name}</span>
        {posName && <span className="text-[11px] px-2 py-px rounded-full border border-gray-200 text-gray-500">{posName}</span>}
        <AssigneeBadge brand={brand} agents={agents} onMutateBrand={onMutateBrand} onChanged={onChanged} size="w-5 h-5 text-[9px]" />
        <span className="ml-auto flex items-center gap-1.5">
          {brand.channelId && (
            <Link
              to={`/chats/${brand.channelId}`}
              className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              title="Открыть переписку бренда в Чатах"
            >
              Чат ↗
            </Link>
          )}
          <ReminderMenu
            brand={brand}
            worstLabel={a.worst ? `${typeById[a.worst.task.taskTypeId]?.label || ''}${a.worst.task.optionId && optionById[a.worst.task.optionId] ? ` · ${optionById[a.worst.task.optionId].label}` : ''}` : null}
            onCreated={() => { loadCard(); onChanged() }}
          />
          <button onClick={() => setShowFields(v => !v)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" title="Поля бренда">
            <Settings className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </span>
      </div>

      {/* Ключевые цифры */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 mt-2 mb-2.5">
        <span>старт <b className="font-medium text-gray-900">{fmtDMY(brand.startedAt)}</b></span>
        <span>в онбординге <b className="font-medium text-gray-900">{days} дн</b></span>
        <span>прогресс <b className="font-medium text-gray-900">{a.done}/{a.countable}</b></span>
        {stuckCount > 0 && <span>застряло <b className="font-medium text-red-600">{stuckCount}</b></span>}
        {brand.dependsOn?.trim() && <span>зависим от: <b className="font-medium text-gray-900">{brand.dependsOn}</b></span>}
      </div>

      <div className="mb-2.5">
        <Pipeline tasks={orderedTasks(brand, taskTypes)} statusById={statusById} height="h-[5px]" />
      </div>

      {/* Следующий шаг: если не заполнен — система предлагает по боттлнеку */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 mb-2.5 flex items-center gap-2">
        <span className="text-xs font-medium text-amber-800 shrink-0">Следующий шаг:</span>
        <input
          value={nextStep}
          onChange={e => setNextStep(e.target.value)}
          onBlur={() => { if (nextStep !== (brand.nextStep || '')) save({ nextStep: nextStep || null }) }}
          placeholder="что делаем дальше…"
          className="flex-1 min-w-0 bg-transparent text-xs text-amber-900 placeholder-amber-300 focus:outline-none"
        />
        {!nextStep.trim() && suggestion && (
          <button
            onClick={() => { setNextStep(suggestion); save({ nextStep: suggestion }) }}
            className="text-[11px] text-amber-700 underline decoration-dotted shrink-0 hover:text-amber-900 truncate max-w-[45%]"
            title={`Подставить: ${suggestion}`}
          >
            → {suggestion}
          </button>
        )}
        {a.worst && a.worst.kind === 'waiting' && (
          <span className="text-[11px] text-amber-700 shrink-0">ждём {fmtShortDur(a.worst.hours)}</span>
        )}
      </div>

      {a.hasBlockers && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 mb-2.5 text-xs text-red-700 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />Блокер: {brand.blockers}
        </div>
      )}

      {/* Поля бренда (по кнопке ⚙) */}
      {showFields && (
        <BrandFields brand={brand} board={board} agents={agents} onSave={save} onDelete={handleDelete} />
      )}

      {/* Чек-лист по группам */}
      <div className="rounded-lg border border-gray-200 overflow-hidden mb-3">
        {groups.map(g => {
          const gTasks = g.types.flatMap(tt => tasksByType[tt.id] || [])
          const counted = gTasks.filter(t => {
            const k = t.statusId ? statusById[t.statusId]?.kind : undefined
            return k && k !== 'na' && k !== 'cancelled'
          })
          const gDone = counted.filter(t => statusById[t.statusId!]?.kind === 'done').length
          const gStuck = counted.some(t => {
            const k = statusById[t.statusId!]?.kind
            return isTaskStuck(k, hoursSince(t.statusSince))
          })
          const gWaiting = counted.some(t => statusById[t.statusId!]?.kind === 'waiting')
          const isOpen = expanded.has(g.label)
          const allDone = counted.length > 0 && gDone === counted.length
          return (
            <div key={g.label} className="border-b border-gray-100 last:border-0">
              <button
                onClick={() => setExpanded(prev => {
                  const next = new Set(prev)
                  if (next.has(g.label)) next.delete(g.label)
                  else next.add(g.label)
                  return next
                })}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-left ${gStuck || gWaiting ? 'bg-amber-50/70' : 'bg-gray-50/70'} hover:bg-gray-100/70`}
              >
                {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                <span className={`text-xs ${gStuck ? 'font-medium text-gray-900' : 'text-gray-700'}`}>{g.label}</span>
                <span className="w-14 shrink-0"><Pipeline tasks={gTasks} statusById={statusById} height="h-[3px]" /></span>
                <span className={`ml-auto text-[11px] ${allDone ? 'text-green-700' : gStuck ? 'text-red-600' : 'text-gray-400'}`}>
                  {allDone ? `${gDone}/${counted.length} ✓` : counted.length ? `${gDone}/${counted.length}${gStuck ? ' · застряло' : ''}` : '—'}
                </span>
              </button>
              {isOpen && (
                <div className="py-0.5">
                  {g.types.map(tt => {
                    const list = tasksByType[tt.id] || []
                    const catOptions = tt.optionCategoryId
                      ? board.options.filter(o => o.categoryId === tt.optionCategoryId && o.isActive)
                      : []
                    const usedOptIds = list.map(t => t.optionId).filter(Boolean) as string[]
                    const addable = catOptions.filter(o => !usedOptIds.includes(o.id))
                    return (
                      <div key={tt.id}>
                        {list.map(task => (
                          <div key={task.id} className="flex items-center gap-2 pl-8 pr-3 py-1 hover:bg-gray-50">
                            <span className="text-[12px] text-gray-800 min-w-0 truncate">
                              {tt.label}
                              {task.optionId && optionById[task.optionId] && (
                                <span className="text-gray-400"> · {optionById[task.optionId].label}</span>
                              )}
                            </span>
                            <span className="ml-auto flex items-center gap-2 shrink-0">
                              {task.assigneeName && <span className="text-[11px] text-gray-400">{task.assigneeName}</span>}
                              <StatusChip
                                task={task}
                                taskType={tt}
                                brandId={brand.id}
                                siblingOptionIds={usedOptIds}
                                siblingCount={list.length}
                                board={board}
                                status={task.statusId ? statusById[task.statusId] : undefined}
                                option={undefined}
                                onMutate={onMutateTask}
                                onChanged={onChanged}
                              />
                            </span>
                          </div>
                        ))}
                        {addable.length > 0 && (
                          <div className="pl-8 pr-3 pb-1">
                            <select
                              value=""
                              onChange={async e => {
                                if (!e.target.value) return
                                await addProviderTask(brand.id, tt.id, e.target.value)
                                onChanged()
                              }}
                              className="text-[11px] text-blue-600 bg-transparent border-0 focus:outline-none cursor-pointer"
                            >
                              <option value="">+ добавить {tt.label.toLowerCase()}…</option>
                              {addable.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                            </select>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Вкладки карточки */}
      <div className="flex gap-4 text-[12px] text-gray-500 border-b border-gray-100 mb-2">
        {([
          ['comments', `Комментарии${comments?.length ? ` ${comments.length}` : ''}`],
          ['todos', `Задачи${todos?.filter(t => !t.doneAt).length ? ` ${todos!.filter(t => !t.doneAt).length}` : ''}`],
          ['history', `История${events?.length ? ` ${events.length}` : ''}`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setCardTab(key)}
            className={`pb-1.5 -mb-px ${cardTab === key ? 'text-gray-900 border-b-2 border-blue-600' : 'hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {cardTab === 'comments' && (
        <CommentsBlock
          brandId={brand.id}
          brandName={brand.name}
          comments={comments}
          agents={agents}
          selfName={agents.find(x => x.id === (localStorage.getItem('support_agent_token') || ''))?.name || 'Вы'}
          onChanged={() => { loadCard(); onChanged() }}
        />
      )}
      {cardTab === 'todos' && (
        <TodosBlock
          brandId={brand.id}
          todos={todos}
          agents={agents}
          selfName={agents.find(x => x.id === (localStorage.getItem('support_agent_token') || ''))?.name || 'Вы'}
          onChanged={() => { loadCard(); onChanged() }}
        />
      )}
      {cardTab === 'history' && (
        events === null ? <div className="text-gray-400 text-sm py-3 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
          : events.length === 0 ? <div className="text-gray-400 text-xs">Изменений пока нет</div>
            : (
              <ul className="space-y-1.5">
                {events.map(e => (
                  <li key={e.id} className="text-[11px] text-gray-600 border-l-2 border-gray-200 pl-2.5">
                    <span className="font-medium text-gray-800">{e.taskLabel || '—'}{e.optionLabel ? ` · ${e.optionLabel}` : ''}</span>
                    {': '}<span className="text-gray-400">{e.oldLabel || '∅'}</span>{' → '}{e.newLabel || '∅'}
                    <span className="text-gray-400"> · {formatDateTimeShort(e.changedAt)}{e.changedBy ? ` · ${e.changedBy}` : ''}</span>
                  </li>
                ))}
              </ul>
            )
      )}
    </div>
  )
}

function BrandFields({ brand, board, agents, onSave, onDelete }: {
  brand: ObBrand
  board: ObBoard
  agents: Agent[]
  onSave: (patch: Omit<Parameters<typeof updateBrand>[0], 'id'>) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(brand.name)
  const [depends, setDepends] = useState(brand.dependsOn || '')
  const [blockers, setBlockers] = useState(brand.blockers || '')
  const [notes, setNotes] = useState(brand.notes || '')
  const channels = useChannels(true)

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 mb-2.5 grid grid-cols-2 gap-2.5">
      <label className="block col-span-2">
        <span className="text-[10px] uppercase text-gray-400">Название</span>
        <input value={name} onChange={e => setName(e.target.value)}
          onBlur={() => { if (name.trim() && name !== brand.name) onSave({ name: name.trim() }) }}
          className="mt-0.5 w-full px-2.5 py-1 rounded-lg border border-gray-300 text-sm bg-white" />
      </label>
      <label className="block">
        <span className="text-[10px] uppercase text-gray-400">POS-система</span>
        <select value={brand.posId || ''} onChange={e => onSave({ posId: e.target.value || null })}
          className="mt-0.5 w-full px-2 py-1 rounded-lg border border-gray-300 text-sm bg-white">
          <option value="">Не выбрана</option>
          {board.posSystems.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-[10px] uppercase text-gray-400">Ведёт проект</span>
        <select value={brand.assigneeId || ''} onChange={e => {
          const ag = agents.find(x => x.id === e.target.value)
          onSave({ assigneeId: e.target.value || null, assigneeName: ag?.name || null })
        }} className="mt-0.5 w-full px-2 py-1 rounded-lg border border-gray-300 text-sm bg-white">
          <option value="">Не назначен</option>
          {groupAgentsByDep(agents).map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.agents.map(ag => <option key={ag.id} value={ag.id}>{ag.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="block col-span-2">
        <span className="text-[10px] uppercase text-gray-400">Telegram-канал бренда</span>
        <select
          value={brand.channelId || ''}
          onChange={e => onSave({ channelId: e.target.value || null })}
          className="mt-0.5 w-full px-2 py-1 rounded-lg border border-gray-300 text-sm bg-white"
        >
          <option value="">Не привязан</option>
          {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="text-[10px] text-gray-400">откроет «Чат ↗» и оживит «Напомнить → Клиенту»</span>
      </label>
      <label className="block">
        <span className="text-[10px] uppercase text-gray-400">От кого зависим</span>
        <input value={depends} onChange={e => setDepends(e.target.value)}
          onBlur={() => { if (depends !== (brand.dependsOn || '')) onSave({ dependsOn: depends || null }) }}
          placeholder="клиент / поставщик"
          className="mt-0.5 w-full px-2.5 py-1 rounded-lg border border-gray-300 text-sm bg-white" />
      </label>
      <label className="block">
        <span className="text-[10px] uppercase text-red-400">Блокеры</span>
        <input value={blockers} onChange={e => setBlockers(e.target.value)}
          onBlur={() => { if (blockers !== (brand.blockers || '')) onSave({ blockers: blockers || null }) }}
          placeholder="что мешает"
          className={`mt-0.5 w-full px-2.5 py-1 rounded-lg border text-sm ${blockers.trim() ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-white'}`} />
      </label>
      <label className="block col-span-2">
        <span className="text-[10px] uppercase text-gray-400">Заметки</span>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          onBlur={() => { if (notes !== (brand.notes || '')) onSave({ notes: notes || null }) }}
          rows={2} className="mt-0.5 w-full px-2.5 py-1 rounded-lg border border-gray-300 text-sm bg-white" />
      </label>
      <div className="col-span-2 flex gap-2">
        {brand.archivedAt ? (
          <button onClick={() => onSave({ archived: false })} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-600 hover:bg-white">
            <ArchiveRestore className="w-3.5 h-3.5" /> Вернуть из архива
          </button>
        ) : (
          <button onClick={() => onSave({ archived: true })} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-600 hover:bg-white">
            <Archive className="w-3.5 h-3.5" /> В архив
          </button>
        )}
        <button onClick={onDelete} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-red-200 text-xs text-red-600 hover:bg-red-50">
          <Trash2 className="w-3.5 h-3.5" /> Удалить
        </button>
      </div>
    </div>
  )
}

function CommentsBlock({ brandId, brandName, comments, agents, selfName, onChanged }: {
  brandId: string
  brandName: string
  comments: ObComment[] | null
  agents: Agent[]
  selfName: string
  onChanged: () => void
}) {
  const [text, setText] = useState('')
  // Оптимизм: комментарий появляется мгновенно, сервер догоняет в фоне
  const [pending, setPending] = useState<ObComment[]>([])
  useEffect(() => { setPending([]) }, [comments])

  // @-упоминания: автодополнение по сотрудникам; упомянутый получает задачу-вызов
  const atMatch = /@([^@\n]*)$/.exec(text)
  const mentionQuery = atMatch ? atMatch[1].toLowerCase() : null
  const mentionSuggestions = mentionQuery !== null
    ? agents.filter(a => a.name.toLowerCase().includes(mentionQuery)).slice(0, 6)
    : []

  const insertMention = (name: string) => {
    setText(t => t.replace(/@([^@\n]*)$/, `@${name} `))
  }

  const submit = async () => {
    const t = text.trim()
    if (!t) return
    setText('')
    setPending(p => [{
      id: `tmp_${Date.now()}`, authorId: null, authorName: selfName,
      text: t, createdAt: new Date().toISOString(),
    }, ...p])
    await addBrandComment(brandId, t)
    // вызов упомянутых: каждому — задача со ссылкой на контекст
    const mentioned = agents.filter(a => t.includes(`@${a.name}`))
    for (const m of mentioned) {
      await addBrandTodo(brandId, {
        text: `@${selfName} позвал(а) вас: «${t.replace(`@${m.name}`, '').trim().slice(0, 80)}» (${brandName})`,
        assigneeId: m.id,
      }).catch(() => {})
    }
    onChanged()
  }
  const items = [...pending, ...(comments || [])]
  return (
    <div>
      <div className="relative flex items-center gap-2 mb-2">
        <input value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && mentionSuggestions.length > 0) { e.preventDefault(); insertMention(mentionSuggestions[0].name); return }
            if (e.key === 'Enter') submit()
          }}
          placeholder="Комментарий… (@имя — позвать сотрудника)"
          className="flex-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
        <button onClick={submit} disabled={!text.trim()} className="p-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-40"><Plus className="w-4 h-4" /></button>
        {mentionSuggestions.length > 0 && (
          <div className="absolute left-0 top-full mt-1 z-30 w-64 rounded-lg border border-gray-200 bg-white shadow-lg py-1">
            {mentionSuggestions.map(a => (
              <button
                key={a.id}
                onClick={() => insertMention(a.name)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50"
              >
                <AgentAvatar name={a.name} size="w-5 h-5 text-[9px]" />
                <span className="min-w-0 truncate">{a.name}</span>
                <span className="ml-auto text-[10px] text-gray-400">{depLabel(a.department)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {comments === null && pending.length === 0 ? <div className="text-gray-400 text-sm py-2"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
        : items.length === 0 ? <div className="text-gray-400 text-xs">Комментариев нет</div>
          : (
            <ul className="space-y-2">
              {items.map(c => (
                <li key={c.id} className="rounded-lg bg-gray-50 px-3 py-2 group">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-gray-700">{c.authorName || 'Без имени'}</span>
                    <span className="flex items-center gap-1">
                      <span className="text-[11px] text-gray-400">{formatDateTimeShort(c.createdAt)}</span>
                      <button onClick={async () => { await deleteBrandComment(c.id); onChanged() }}
                        className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
                    </span>
                  </div>
                  <div className="text-sm text-gray-800 whitespace-pre-wrap">{c.text}</div>
                </li>
              ))}
            </ul>
          )}
    </div>
  )
}

function TodosBlock({ brandId, todos, agents, selfName, onChanged }: {
  brandId: string
  todos: ObTodo[] | null
  agents: Agent[]
  selfName: string
  onChanged: () => void
}) {
  const [text, setText] = useState('')
  const [assignee, setAssignee] = useState('')
  const [pending, setPending] = useState<ObTodo[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  useEffect(() => { setPending([]) }, [todos])

  const submit = async () => {
    const t = text.trim()
    if (!t) return
    const agName = assignee ? agents.find(a => a.id === assignee)?.name || null : null
    setText('')
    setPending(p => [{
      id: `tmp_${Date.now()}`, text: t, assigneeId: assignee || null, assigneeName: agName,
      dueAt: null, doneAt: null, createdBy: selfName, createdAt: new Date().toISOString(),
    }, ...p])
    await addBrandTodo(brandId, { text: t, assigneeId: assignee || null })
    setAssignee('')
    onChanged()
  }

  const saveEdit = async (todo: ObTodo) => {
    const t = editText.trim()
    setEditingId(null)
    if (!t || t === todo.text) return
    await updateBrandTodo(todo.id, { text: t })
    onChanged()
  }

  const items = [...pending, ...(todos || [])]
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <input value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Новая задача"
          className="flex-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
        <select value={assignee} onChange={e => setAssignee(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm bg-white max-w-[120px]">
          <option value="">Кому…</option>
          {groupAgentsByDep(agents).map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </optgroup>
          ))}
        </select>
        <button onClick={submit} disabled={!text.trim()} className="p-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-40"><Plus className="w-4 h-4" /></button>
      </div>
      {todos === null && pending.length === 0 ? <div className="text-gray-400 text-sm py-2"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
        : items.length === 0 ? <div className="text-gray-400 text-xs">Задач нет</div>
          : (
            <ul className="space-y-1.5">
              {items.map(t => (
                <li key={t.id} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={!!t.doneAt}
                    onChange={async e => { await updateBrandTodo(t.id, { done: e.target.checked }); onChanged() }}
                    className="mt-0.5 rounded" />
                  <div className="flex-1 min-w-0">
                    {editingId === t.id ? (
                      <input
                        autoFocus
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveEdit(t)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        onBlur={() => saveEdit(t)}
                        className="w-full px-2 py-0.5 rounded border border-blue-300 text-sm"
                      />
                    ) : (
                      <button
                        onClick={() => { if (!t.id.startsWith('tmp_')) { setEditingId(t.id); setEditText(t.text) } }}
                        title="Нажмите, чтобы отредактировать"
                        className={`text-left w-full ${t.doneAt ? 'line-through text-gray-400' : 'text-gray-800 hover:text-blue-700'}`}
                      >
                        {t.text}
                      </button>
                    )}
                    <div className="text-[11px] text-gray-400">
                      {t.assigneeName && <span className="mr-2">→ {t.assigneeName}</span>}
                      {t.createdBy && <span>от {t.createdBy}</span>}
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      if (!(await appConfirm('Удалить задачу?'))) return
                      await deleteBrandTodo(t.id)
                      onChanged()
                    }}
                    className="p-1 text-gray-300 hover:text-red-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
    </div>
  )
}

// ───────────────────────────── Матрица

function MatrixTab({ board, statusById, onSelect, onMutateTask, onChanged }: {
  board: ObBoard
  statusById: Record<string, ObStatus>
  onSelect: (id: string) => void
  onMutateTask: (taskId: string, patch: Partial<ObTask>) => void
  onChanged: () => void
}) {
  const taskTypes = board.taskTypes.filter(t => t.isActive)
  const groups = useMemo(() => buildGroups(taskTypes), [taskTypes])
  const optionById = useMemo(() => Object.fromEntries(board.options.map(o => [o.id, o])), [board.options])
  const posById = useMemo(() => Object.fromEntries(board.posSystems.map(p => [p.id, p])), [board.posSystems])
  const brands = board.brands.filter(b => !b.archivedAt)

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-100/80 border-b border-gray-200">
            <th className="sticky left-0 bg-gray-100 z-10 px-3 py-1.5" />
            {groups.map(g => (
              <th
                key={g.label}
                colSpan={g.types.length}
                className="text-left font-medium text-[10px] uppercase tracking-wide text-gray-500 px-2 py-1.5 border-l border-gray-200 whitespace-nowrap"
              >
                {g.label}
              </th>
            ))}
          </tr>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="sticky left-0 bg-gray-50 z-10 text-left font-medium text-gray-600 px-3 py-2 min-w-[150px] text-xs">Бренд</th>
            {groups.flatMap((g, gi) => g.types.map((t, ti) => (
              <th
                key={t.id}
                className={`text-left font-medium text-gray-500 px-2 py-2 whitespace-nowrap text-[11px] ${ti === 0 && gi > 0 ? 'border-l border-gray-200' : ''}`}
              >
                {t.label}
              </th>
            )))}
          </tr>
        </thead>
        <tbody>
          {brands.map(brand => {
            const tasksByType: Record<string, ObTask[]> = {}
            for (const t of brand.tasks) (tasksByType[t.taskTypeId] = tasksByType[t.taskTypeId] || []).push(t)
            const hasBlockers = !!brand.blockers?.trim()
            return (
              <tr key={brand.id} className={`border-b border-gray-100 last:border-0 ${hasBlockers ? 'bg-red-50/30' : ''}`}>
                <td className={`sticky left-0 z-10 px-3 py-2 ${hasBlockers ? 'bg-red-50' : 'bg-white'}`}>
                  <button onClick={() => onSelect(brand.id)} className="text-left group">
                    <span className="flex items-center gap-1">
                      <span className="text-[13px] font-medium text-gray-900 group-hover:text-blue-600">{brand.name}</span>
                      {hasBlockers && <AlertTriangle className="w-3 h-3 text-red-500" />}
                      <ChevronRight className="w-3 h-3 text-gray-300 group-hover:text-blue-500" />
                    </span>
                    <span className="text-[11px] text-gray-400 block">
                      {(brand.posId ? posById[brand.posId]?.name : null) || 'без POS'}
                      {brand.assigneeName ? ` · ${initials(brand.assigneeName)}` : ''}
                    </span>
                    <span className="text-[11px] text-gray-400 block">
                      {fmtDMY(brand.startedAt)} → {brand.archivedAt ? fmtDMY(brand.archivedAt) : '…'} · {Math.round(hoursSince(brand.startedAt) / 24)} дн
                    </span>
                  </button>
                </td>
                {groups.flatMap((g, gi) => g.types.map((tt, ti) => {
                  const list = tasksByType[tt.id]
                  const borderCls = ti === 0 && gi > 0 ? 'border-l border-gray-100' : ''
                  if (!list || list.length === 0) {
                    return <td key={tt.id} className={`px-2 py-2 text-gray-300 ${borderCls}`}>—</td>
                  }
                  return (
                    <td key={tt.id} className={`px-2 py-2 align-top ${borderCls}`}>
                      <div className="flex flex-col items-start gap-1">
                        {list.map(task => (
                          <StatusChip
                            key={task.id}
                            task={task}
                            taskType={tt}
                            brandId={brand.id}
                            siblingOptionIds={list.map(x => x.optionId).filter(Boolean) as string[]}
                            siblingCount={list.length}
                            board={board}
                            status={task.statusId ? statusById[task.statusId] : undefined}
                            option={task.optionId ? optionById[task.optionId] : undefined}
                            onMutate={onMutateTask}
                            onChanged={onChanged}
                          />
                        ))}
                      </div>
                    </td>
                  )
                }))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ───────────────────────────── Чип статуса (портал-дропдаун)

function StatusChip({ task, taskType, brandId, siblingOptionIds, siblingCount, board, status, option, onMutate, onChanged }: {
  task: ObTask
  taskType: ObTaskType
  brandId: string
  siblingOptionIds: string[]
  siblingCount: number
  board: ObBoard
  status?: ObStatus
  option?: ObBoard['options'][number]
  onMutate: (taskId: string, patch: Partial<ObTask>) => void
  onChanged: () => void
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [section, setSection] = useState<'provider' | 'assignee' | null>(null)
  const [, forceRender] = useState(0)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const open = rect !== null
  const setOpen = (v: boolean) => {
    setRect(v ? btnRef.current?.getBoundingClientRect() || null : null)
    if (!v) setSection(null)
  }

  useEffect(() => {
    if (!open) return
    if (!cachedAgents) {
      fetchAgents().then(list => {
        cachedAgents = list.filter(a => a.isActive !== false)
        forceRender(x => x + 1)
      }).catch(() => {})
    }
    const onDoc = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return
      if (panelRef.current?.contains(e.target as Node)) return
      setRect(null)
    }
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return
      setRect(null)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const colors = STATUS_COLORS[status?.color || 'gray'] || STATUS_COLORS.gray
  const kind = status?.kind
  const h = hoursSince(task.statusSince)
  const isStuck = isTaskStuck(kind, h)
  const quiet = kind === 'done' || kind === 'na' || kind === 'todo' || kind === 'cancelled'

  const timeHint = [
    task.activeSeconds ? `в работе ${fmtSeconds(task.activeSeconds)}` : '',
    task.waitingSeconds ? `ожидание ${fmtSeconds(task.waitingSeconds)}` : '',
  ].filter(Boolean).join(', ')

  const catOptions = taskType.optionCategoryId
    ? board.options.filter(o => o.categoryId === taskType.optionCategoryId && o.isActive)
    : []
  const addableOptions = catOptions.filter(o => !siblingOptionIds.includes(o.id))

  // Оптимистично: чип меняется мгновенно, API — в фоне, затем тихая синхронизация
  const pickStatus = async (statusId: string) => {
    if (statusId === task.statusId) { setOpen(false); return }
    setRect(null)
    onMutate(task.id, { statusId, statusSince: new Date().toISOString() })
    try {
      await setTaskStatus(task.id, statusId)
    } finally {
      onChanged()
    }
  }

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const PANEL_W = 232
  const panelStyle: CSSProperties | undefined = rect ? {
    position: 'fixed',
    zIndex: 60,
    width: PANEL_W,
    left: Math.min(Math.max(8, rect.left), vw - PANEL_W - 8),
    ...(rect.bottom > vh - 360
      ? { bottom: Math.max(8, vh - rect.top + 4) }
      : { top: rect.bottom + 4 }),
    maxHeight: Math.min(400, vh - 16),
    overflowY: 'auto',
  } : undefined

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={e => { e.stopPropagation(); setOpen(!open) }}
        title={[status?.label, option?.label, `статус с ${fmtDMY(task.statusSince)}`, timeHint,
          task.assigneeName ? `исп: ${task.assigneeName}` : '']
          .filter(Boolean).join(' · ')}
        className={quiet
          ? 'px-1.5 py-0.5 rounded text-xs whitespace-nowrap inline-flex items-center gap-1 hover:bg-gray-100'
          : `px-2 py-0.5 rounded-full text-xs whitespace-nowrap transition-colors inline-flex items-center gap-1 ${colors.chip} ${
              isStuck ? 'ring-2 ring-red-400' : ''
            }`}
      >
        {quiet ? (
          kind === 'done' ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-600" />
              <span className="text-green-700">Готово{option ? ` · ${option.label}` : ''}</span>
            </>
          ) : kind === 'na' ? (
            <span className="text-gray-300">—</span>
          ) : kind === 'cancelled' ? (
            <span className="line-through text-gray-400">{status?.label}</span>
          ) : (
            <span className="text-gray-500">
              {status?.label || '—'}{option ? ` · ${option.label}` : ''}
            </span>
          )
        ) : (
          <>
            {isStuck && (kind === 'waiting' ? <Clock className="w-3 h-3 text-red-500" /> : <Flame className="w-3 h-3 text-red-500" />)}
            <span>{status?.label || '—'}</span>
            {kind === 'waiting' && task.waitingOn && WAITING_LABELS[task.waitingOn] && (
              <span className="font-medium">· {WAITING_LABELS[task.waitingOn]}</span>
            )}
            <span className="opacity-70">· {fmtShortDur(h)}</span>
            {option && <span className="opacity-70">· {option.label}</span>}
          </>
        )}
      </button>
      {open && rect && createPortal(
        <div
          ref={panelRef}
          style={panelStyle}
          className="rounded-lg border border-gray-200 bg-white shadow-lg py-1"
        >
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

          {/* Секции свёрнуты в строки — дропдаун компактный, детали по клику */}
          {catOptions.length > 0 && (
            <div className="border-t border-gray-100 mt-1">
              <button
                onClick={() => setSection(section === 'provider' ? null : 'provider')}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50"
              >
                <span className="text-gray-400">Поставщик:</span>
                <span className={option ? 'text-gray-900 font-medium' : 'text-gray-400'}>{option?.label || '—'}</span>
                {siblingCount > 1 && <span className="text-[10px] text-gray-400">+{siblingCount - 1} строкой</span>}
                {section === 'provider'
                  ? <ChevronUp className="w-3 h-3 ml-auto text-gray-400" />
                  : <ChevronRight className="w-3 h-3 ml-auto text-gray-400" />}
              </button>
              {section === 'provider' && (
                <div className="pb-1">
                  <div className="max-h-32 overflow-y-auto">
                    {catOptions.map(o => {
                      const current = o.id === task.optionId
                      const usedByOther = !current && siblingOptionIds.includes(o.id)
                      return (
                        <button
                          key={o.id}
                          disabled={usedByOther}
                          onClick={async () => {
                            const v = current ? null : o.id
                            onMutate(task.id, { optionId: v })
                            try { await setTaskOption(task.id, v) } finally { onChanged() }
                          }}
                          title={usedByOther ? 'Уже добавлен отдельной строкой' : current ? 'Нажмите, чтобы снять' : undefined}
                          className={`flex items-center gap-2 w-full pl-5 pr-3 py-1 text-left text-xs ${
                            usedByOther ? 'text-gray-300' : current ? 'text-blue-700 font-medium hover:bg-blue-50' : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded flex items-center justify-center border ${current ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
                            {current && <Check className="w-2.5 h-2.5 text-white" />}
                          </span>
                          {o.label}
                        </button>
                      )
                    })}
                  </div>
                  {addableOptions.length > 0 && (
                    <div className="border-t border-gray-50 mt-1 pt-1 max-h-20 overflow-y-auto">
                      {addableOptions.map(o => (
                        <button
                          key={o.id}
                          onClick={async () => {
                            await addProviderTask(brandId, taskType.id, o.id)
                            setRect(null)
                            onChanged()
                          }}
                          title="Добавить отдельной строкой со своим статусом"
                          className="flex items-center gap-1.5 w-full pl-5 pr-3 py-1 text-left text-xs text-blue-600 hover:bg-blue-50"
                        >
                          <Plus className="w-3 h-3" />{o.label} — строкой
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {kind === 'waiting' && (
            <div className="border-t border-gray-100 px-3 py-1.5">
              <div className="text-[10px] uppercase text-gray-400 mb-1">Ждём кого</div>
              <div className="flex gap-1">
                {(['us', 'client', 'provider'] as const).map(w => (
                  <button
                    key={w}
                    onClick={async () => {
                      const v = task.waitingOn === w ? null : w
                      onMutate(task.id, { waitingOn: v })
                      try { await setTaskWaitingOn(task.id, v) } finally { onChanged() }
                    }}
                    className={`flex-1 text-[11px] px-1 py-1 rounded-md border ${
                      task.waitingOn === w
                        ? 'bg-amber-100 border-amber-300 text-amber-800 font-medium'
                        : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {WAITING_LABELS[w]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-gray-100">
            <button
              onClick={() => setSection(section === 'assignee' ? null : 'assignee')}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50"
            >
              <span className="text-gray-400">Исполнитель:</span>
              <span className={task.assigneeName ? 'text-gray-900 font-medium' : 'text-gray-400'}>{task.assigneeName || '—'}</span>
              {section === 'assignee'
                ? <ChevronUp className="w-3 h-3 ml-auto text-gray-400" />
                : <ChevronRight className="w-3 h-3 ml-auto text-gray-400" />}
            </button>
            {section === 'assignee' && (
              <div className="pb-1 max-h-44 overflow-y-auto">
                <button
                  onClick={async () => {
                    onMutate(task.id, { assigneeId: null, assigneeName: null })
                    try { await setTaskAssignee(task.id, null) } finally { onChanged() }
                  }}
                  className={`w-full pl-5 pr-3 py-1 text-left text-xs ${!task.assigneeId ? 'text-gray-700 font-medium' : 'text-gray-400 hover:bg-gray-50'}`}
                >
                  Не назначен
                </button>
                {groupAgentsByDep(cachedAgents || []).map(g => (
                  <div key={g.label}>
                    <div className="pl-5 pr-3 pt-1.5 pb-0.5 text-[10px] uppercase text-gray-400">{g.label}</div>
                    {g.agents.map(ag => {
                      const current = ag.id === task.assigneeId
                      return (
                        <button
                          key={ag.id}
                          onClick={async () => {
                            onMutate(task.id, { assigneeId: ag.id, assigneeName: ag.name })
                            try { await setTaskAssignee(task.id, ag.id) } finally { onChanged() }
                          }}
                          className={`flex items-center gap-2 w-full pl-5 pr-3 py-1 text-left text-xs ${
                            current ? 'text-blue-700 font-medium bg-blue-50/60' : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <AgentAvatar name={ag.name} size="w-4 h-4 text-[8px]" />
                          {ag.name}
                          {current && <Check className="w-3 h-3 ml-auto text-blue-600" />}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 mt-1 px-3 py-1.5 text-[11px] text-gray-400">
            <div>Статус с {fmtDMY(task.statusSince)}, {formatDateTimeShort(task.statusSince).split(', ')[1] || ''}</div>
            {isStuck && <div className="text-red-500 font-medium">в статусе {fmtSeconds(h * 3600)}</div>}
            {timeHint && <div>{timeHint}</div>}
          </div>

          {siblingCount > 1 && (
            <button
              onClick={async () => {
                if (!(await appConfirm('Убрать этого поставщика из ячейки? История по нему сохранится в журнале.'))) return
                await deleteTask(task.id)
                setRect(null)
                onChanged()
              }}
              className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left text-xs text-red-500 hover:bg-red-50 border-t border-gray-100"
            >
              <Trash2 className="w-3 h-3" />Убрать поставщика
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

let cachedAgents: Agent[] | null = null

// ───────────────────────────── Аналитика

function Donut({ segments, centerTitle, centerSub }: {
  segments: { value: number; color: string }[]
  centerTitle: string
  centerSub: string
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  const C = 2 * Math.PI * 38
  let offset = 0
  return (
    <svg width="104" height="104" viewBox="0 0 104 104" className="shrink-0">
      <circle cx="52" cy="52" r="38" fill="none" stroke="#E5E7EB" strokeWidth="15" />
      {segments.map((s, i) => {
        const len = (s.value / total) * C
        const el = (
          <circle
            key={i}
            cx="52" cy="52" r="38" fill="none"
            stroke={s.color} strokeWidth="15"
            strokeDasharray={`${len} ${C - len}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 52 52)"
          />
        )
        offset += len
        return el
      })}
      <text x="52" y="49" textAnchor="middle" fontSize="17" fontWeight="500" fill="#111827">{centerTitle}</text>
      <text x="52" y="63" textAnchor="middle" fontSize="9" fill="#9CA3AF">{centerSub}</text>
    </svg>
  )
}

function StatsTab({ board, statusById }: { board: ObBoard; statusById: Record<string, ObStatus> }) {
  const [stats, setStats] = useState<ObStats | null>(null)
  const [events, setEvents] = useState<ObEvent[] | null>(null)

  useEffect(() => {
    fetchOnboardingStats().then(setStats).catch(() => setStats(null))
    fetchOnboardingEvents(undefined, 500).then(r => setEvents(r.events)).catch(() => setEvents([]))
  }, [])

  const brands = board.brands.filter(b => !b.archivedAt)
  const taskTypes = board.taskTypes.filter(t => t.isActive)
  const optionById = useMemo(() => Object.fromEntries(board.options.map(o => [o.id, o])), [board.options])

  // донат статусов
  const statusCounts = useMemo(() => {
    const c = { done: 0, active: 0, waiting: 0, todo: 0 }
    for (const b of brands) for (const t of b.tasks) {
      const k = t.statusId ? statusById[t.statusId]?.kind : undefined
      if (k === 'done') c.done++
      else if (k === 'active') c.active++
      else if (k === 'waiting') c.waiting++
      else if (k === 'todo') c.todo++
    }
    return c
  }, [brands, statusById])
  const totalTasks = statusCounts.done + statusCounts.active + statusCounts.waiting + statusCounts.todo

  // «кто тормозит»: накопленное ожидание по источникам
  const blockSources = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const b of brands) for (const t of b.tasks) {
      if (!t.waitingSeconds) continue
      const opt = t.optionId ? optionById[t.optionId]?.label : null
      const src = t.waitingOn === 'us' ? 'Мы (внутренние)'
        : t.waitingOn === 'client' ? 'Клиенты'
          : t.waitingOn === 'provider' ? (opt || 'Поставщики')
            : opt || (b.dependsOn?.trim() || 'Клиенты')
      acc[src] = (acc[src] || 0) + t.waitingSeconds
    }
    return Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [brands, optionById])
  const blockTotal = blockSources.reduce((s, [, v]) => s + v, 0)
  const PIE_COLORS = ['#DC2626', '#F59E0B', '#8B5CF6', '#0EA5E9', '#64748B']

  // воронка этапов
  const funnel = useMemo(() => taskTypes.map(tt => {
    let applicable = 0
    let done = 0
    for (const b of brands) {
      const list = b.tasks.filter(t => t.taskTypeId === tt.id)
      const real = list.filter(t => {
        const k = t.statusId ? statusById[t.statusId]?.kind : undefined
        return k && k !== 'na' && k !== 'cancelled'
      })
      if (real.length === 0) continue
      applicable++
      if (real.every(t => statusById[t.statusId!]?.kind === 'done')) done++
    }
    return { label: tt.label, pct: applicable ? Math.round((done / applicable) * 100) : 0, applicable }
  }).filter(f => f.applicable > 0), [taskTypes, brands, statusById])
  const worstFunnel = funnel.length ? funnel.reduce((min, f) => (f.pct < min.pct ? f : min), funnel[0]) : null

  // тренд закрытий по дням (14 дней)
  const trend = useMemo(() => {
    if (!events) return null
    const byDay: Record<string, number> = {}
    for (const e of events) {
      const kind = e.newStatusId ? statusById[e.newStatusId]?.kind : undefined
      if (kind !== 'done') continue
      const d = new Date(e.changedAt)
      const key = `${d.getMonth() + 1}-${d.getDate()}`
      byDay[key] = (byDay[key] || 0) + 1
    }
    const days: { label: string; count: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000)
      const key = `${d.getMonth() + 1}-${d.getDate()}`
      days.push({ label: `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`, count: byDay[key] || 0 })
    }
    return days
  }, [events, statusById])

  const avgAge = brands.length
    ? brands.reduce((s, b) => s + hoursSince(b.startedAt), 0) / brands.length / 24
    : 0
  const stuckCount = brands.reduce((s, b) => s + b.tasks.filter(t => {
    const k = t.statusId ? statusById[t.statusId]?.kind : undefined
    return isTaskStuck(k, hoursSince(t.statusSince))
  }).length, 0)
  const readyCount = brands.filter(b => {
    const a = analyzeBrand(b, statusById)
    return a.shelf === 'finish'
  }).length

  const maxTrend = trend ? Math.max(1, ...trend.map(t => t.count)) : 1

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'в онбординге', value: String(brands.length), cls: 'text-gray-900', border: 'border-gray-200' },
          { label: 'застряло задач', value: String(stuckCount), cls: stuckCount ? 'text-red-600' : 'text-gray-900', border: stuckCount ? 'border-red-200' : 'border-gray-200' },
          { label: 'средний возраст', value: `${avgAge.toFixed(1)} дн`, cls: 'text-gray-900', border: 'border-gray-200' },
          { label: 'готовы к завершению', value: String(readyCount), cls: 'text-green-700', border: 'border-gray-200' },
        ].map(t => (
          <div key={t.label} className={`rounded-lg border bg-white p-3 ${t.border}`}>
            <div className={`text-2xl font-medium ${t.cls}`}>{t.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{t.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4 flex items-center gap-4">
          <Donut
            segments={[
              { value: statusCounts.done, color: '#1D9E75' },
              { value: statusCounts.active, color: '#378ADD' },
              { value: statusCounts.waiting, color: '#F59E0B' },
              { value: statusCounts.todo, color: '#E5E7EB' },
            ]}
            centerTitle={String(totalTasks)}
            centerSub="задач"
          />
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 mb-2">Все задачи по статусам</div>
            <div className="text-xs text-gray-600 space-y-1">
              <div><span className="text-green-600">●</span> Готово — {statusCounts.done} ({Math.round(statusCounts.done / (totalTasks || 1) * 100)}%)</div>
              <div><span className="text-blue-600">●</span> В работе — {statusCounts.active}</div>
              <div><span className="text-amber-500">●</span> Ждём данные — {statusCounts.waiting}</div>
              <div><span className="text-gray-400">●</span> Не начато — {statusCounts.todo}</div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 flex items-center gap-4">
          <Donut
            segments={blockSources.map(([, v], i) => ({ value: v, color: PIE_COLORS[i] }))}
            centerTitle={fmtSeconds(blockTotal) || '0'}
            centerSub="ожиданий"
          />
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 mb-2">Кто нас тормозит <span className="text-[10px] text-gray-400 font-normal">время «ждём данные»</span></div>
            <div className="text-xs text-gray-600 space-y-1">
              {blockSources.length === 0 && <div className="text-gray-400">ожиданий нет</div>}
              {blockSources.map(([label, v], i) => (
                <div key={label}>
                  <span style={{ color: PIE_COLORS[i] }}>●</span> {label} — {fmtSeconds(v)} ({Math.round(v / (blockTotal || 1) * 100)}%)
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm font-medium text-gray-900 mb-3">Воронка этапов <span className="text-[10px] text-gray-400 font-normal">% брендов, закрывших этап</span></div>
          <div className="space-y-1.5">
            {funnel.map(f => (
              <div key={f.label} className="flex items-center gap-2">
                <span className="w-40 text-[11px] text-gray-600 truncate shrink-0">{f.label}</span>
                <span className="flex-1 h-3.5 rounded bg-gray-100 overflow-hidden">
                  <span
                    className={`block h-full rounded ${f === worstFunnel && f.pct < 50 ? 'bg-red-400' : 'bg-green-500/80'}`}
                    style={{ width: `${Math.max(2, f.pct)}%` }}
                  />
                </span>
                <span className={`w-12 text-right text-[11px] ${f === worstFunnel && f.pct < 50 ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                  {f.pct}%{f === worstFunnel && f.pct < 50 ? ' ←' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm font-medium text-gray-900 mb-1">Темп: закрыто этапов за день</div>
          {trend === null ? (
            <div className="text-gray-400 text-sm py-6 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
          ) : (
            <>
              <svg width="100%" height="90" viewBox="0 0 280 90" preserveAspectRatio="none">
                <polygon
                  points={`0,86 ${trend.map((t, i) => `${(i / (trend.length - 1)) * 280},${86 - (t.count / maxTrend) * 74}`).join(' ')} 280,86`}
                  fill="#DBEAFE"
                />
                <polyline
                  points={trend.map((t, i) => `${(i / (trend.length - 1)) * 280},${86 - (t.count / maxTrend) * 74}`).join(' ')}
                  fill="none" stroke="#2563EB" strokeWidth="2"
                />
              </svg>
              <div className="flex justify-between text-[10px] text-gray-400">
                <span>{trend[0].label}</span>
                <span>{trend[Math.floor(trend.length / 2)].label}</span>
                <span>сегодня</span>
              </div>
              <div className="text-[11px] text-gray-500 mt-1.5">
                за 14 дней закрыто <b className="font-medium text-gray-900">{trend.reduce((s, t) => s + t.count, 0)}</b> этапов
                {' · '}пик — <b className="font-medium text-gray-900">{maxTrend}</b> в день
              </div>
            </>
          )}
        </div>
      </div>

      {stats && stats.people.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 overflow-x-auto">
          <div className="text-sm font-medium text-gray-900 mb-2">
            Рейтинг сотрудников <span className="text-[10px] text-gray-400 font-normal">· чем быстрее закрываются этапы, тем выше место</span>
          </div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left font-medium py-1.5 pr-3 w-8">#</th>
                <th className="text-left font-medium py-1.5 pr-3">Сотрудник</th>
                <th className="text-right font-medium py-1.5 px-3">Закрыто этапов</th>
                <th className="text-right font-medium py-1.5 px-3">Ср. время закрытия</th>
                <th className="text-right font-medium py-1.5 px-3">Открытых задач</th>
                <th className="text-right font-medium py-1.5 pl-3">Последняя активность</th>
              </tr>
            </thead>
            <tbody>
              {[...stats.people]
                .sort((a, b) => (b.completed - a.completed)
                  || ((a.avgCloseSeconds ?? Infinity) - (b.avgCloseSeconds ?? Infinity)))
                .map((p, i) => (
                <tr key={p.name} className="border-b border-gray-50 last:border-0">
                  <td className={`py-1.5 pr-3 ${i === 0 ? 'text-amber-500 font-medium' : 'text-gray-400'}`}>
                    {i === 0 ? '🏆' : i + 1}
                  </td>
                  <td className="py-1.5 pr-3 text-gray-800">
                    <span className="inline-flex items-center gap-1.5">
                      <AgentAvatar name={p.name} size="w-5 h-5 text-[9px]" />
                      {p.name}
                    </span>
                  </td>
                  <td className="py-1.5 px-3 text-right text-green-700">{p.completed || ''}</td>
                  <td className="py-1.5 px-3 text-right text-gray-700">
                    {p.avgCloseSeconds != null ? fmtSeconds(p.avgCloseSeconds) : '—'}
                  </td>
                  <td className="py-1.5 px-3 text-right text-blue-600">{p.openTasks || ''}</td>
                  <td className="py-1.5 pl-3 text-right text-gray-400 text-xs">
                    {p.lastActivity ? formatDateTimeShort(p.lastActivity) : '—'}
                  </td>
                </tr>
              ))}
              {(() => {
                const unassigned = brands.reduce((s, b) => s + (b.assigneeName ? 0 : b.tasks.filter(t => {
                  const k = t.statusId ? statusById[t.statusId]?.kind : undefined
                  return (k === 'active' || k === 'waiting' || k === 'todo') && !t.assigneeName
                }).length), 0)
                if (!unassigned) return null
                return (
                  <tr>
                    <td className="py-1.5 pr-3" />
                    <td className="py-1.5 pr-3 text-amber-700">без исполнителя</td>
                    <td className="py-1.5 px-3" />
                    <td className="py-1.5 px-3" />
                    <td className="py-1.5 px-3 text-right text-red-600 font-medium">{unassigned}</td>
                    <td className="py-1.5 pl-3 text-right text-xs text-amber-600">назначьте через аватар «?»</td>
                  </tr>
                )
              })()}
            </tbody>
          </table>
        </div>
      )}

      {stats && stats.stages.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm font-medium text-gray-900 mb-3">
            Где теряем время <span className="text-[10px] text-gray-400 font-normal">· ср. время на этап: <span className="text-blue-500">■</span> работа <span className="text-amber-500">■</span> ожидание</span>
          </div>
          <div className="space-y-1.5">
            {[...stats.stages]
              .filter(s => s.avgActiveSeconds + s.avgWaitingSeconds > 0)
              .sort((a, b) => (b.avgActiveSeconds + b.avgWaitingSeconds) - (a.avgActiveSeconds + a.avgWaitingSeconds))
              .slice(0, 8)
              .map(s => {
                const total = s.avgActiveSeconds + s.avgWaitingSeconds
                const max = Math.max(...stats.stages.map(x => x.avgActiveSeconds + x.avgWaitingSeconds), 1)
                return (
                  <div key={s.id} className="flex items-center gap-2">
                    <span className="w-40 text-[11px] text-gray-600 truncate shrink-0">{s.label}</span>
                    <span className="flex-1 h-3.5 rounded bg-gray-100 overflow-hidden flex">
                      <span className="block h-full bg-blue-500/80" style={{ width: `${(s.avgActiveSeconds / max) * 100}%` }} />
                      <span className="block h-full bg-amber-400" style={{ width: `${(s.avgWaitingSeconds / max) * 100}%` }} />
                    </span>
                    <span className="w-14 text-right text-[11px] text-gray-600">{fmtSeconds(total)}</span>
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

// ───────────────────────────── Таймлайн

const dayKeyTz = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso))

/**
 * Гант по фактам: клетка-день окрашена журналом событий.
 * Зелёный — закрывались этапы; синий — активность без закрытий;
 * янтарный — тихая пауза 1–2 дня; красный — простой 3+ дней; штрих — не начат.
 */
function TimelineTab({ board, statusById, onSelect }: {
  board: ObBoard
  statusById: Record<string, ObStatus>
  onSelect: (id: string) => void
}) {
  const [events, setEvents] = useState<ObEvent[] | null>(null)
  useEffect(() => {
    fetchOnboardingEvents(undefined, 1000).then(r => setEvents(r.events)).catch(() => setEvents([]))
  }, [])

  const DAYS = 21
  const days = useMemo(() => {
    const list: { key: string; label: string; isToday: boolean }[] = []
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000)
      list.push({
        key: dayKeyTz(d.toISOString()),
        label: new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit' }).format(d),
        isToday: i === 0,
      })
    }
    return list
  }, [])

  const rows = useMemo(() => {
    if (!events) return null
    const byBrandDay: Record<string, { total: number; done: number; labels: string[] }> = {}
    for (const e of events) {
      const key = `${e.brandId}|${dayKeyTz(e.changedAt)}`
      const cell = (byBrandDay[key] = byBrandDay[key] || { total: 0, done: 0, labels: [] })
      cell.total++
      if (e.newStatusId && statusById[e.newStatusId]?.kind === 'done') cell.done++
      if (cell.labels.length < 6) {
        cell.labels.push(`${e.taskLabel || ''}${e.optionLabel ? ` · ${e.optionLabel}` : ''}: ${e.newLabel || ''}`)
      }
    }

    return board.brands
      .filter(b => !b.archivedAt)
      .map(brand => {
        const startKey = dayKeyTz(brand.startedAt)
        const started = brand.tasks.some(t => {
          const k = t.statusId ? statusById[t.statusId]?.kind : undefined
          return k === 'done' || k === 'active' || k === 'waiting'
        })
        let quietStreak = 0
        let redCount = 0
        const cells = days.map(day => {
          if (day.key < startKey) return { cls: '', title: '' }
          const cell = byBrandDay[`${brand.id}|${day.key}`]
          if (!started && !cell) {
            return { cls: 'bg-[repeating-linear-gradient(90deg,#F3F4F6_0_5px,#fff_5px_10px)]', title: 'не начат' }
          }
          if (cell && cell.done > 0) {
            quietStreak = 0
            return { cls: 'bg-green-500', title: `закрыто этапов: ${cell.done} из ${cell.total} событий\n${cell.labels.join('\n')}` }
          }
          if (cell) {
            quietStreak = 0
            return { cls: 'bg-blue-400', title: `событий: ${cell.total}, без закрытий\n${cell.labels.join('\n')}` }
          }
          quietStreak++
          if (quietStreak >= 3) {
            redCount++
            return { cls: 'bg-red-400', title: `простой ${quietStreak}-й день` }
          }
          return { cls: 'bg-amber-300', title: `пауза (${quietStreak}-й день)` }
        })
        const a = analyzeBrand(brand, statusById)
        return { brand, a, cells, redCount }
      })
      .sort((x, y) => y.redCount - x.redCount || (y.a.worst?.hours || 0) - (x.a.worst?.hours || 0))
  }, [events, board.brands, days, statusById])

  if (rows === null) {
    return <div className="flex justify-center py-16 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
  }

  return (
    <div>
      <div className="text-[11px] text-gray-500 mb-2 flex flex-wrap gap-x-3 gap-y-1">
        <span><span className="text-green-500">■</span> закрывались этапы</span>
        <span><span className="text-blue-400">■</span> активность без закрытий</span>
        <span><span className="text-amber-400">■</span> пауза 1–2 дня</span>
        <span><span className="text-red-400">■</span> простой 3+ дней</span>
        <span className="text-gray-400">▨ не начат · наведите на день — детали · самые «красные» сверху</span>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-3 overflow-x-auto">
        <div className="flex items-center mb-1.5" style={{ minWidth: 720 }}>
          <span className="w-40 shrink-0" />
          {days.map(d => (
            <span key={d.key} className={`flex-1 text-center text-[9px] ${d.isToday ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
              {d.isToday ? 'сегодня' : d.label}
            </span>
          ))}
        </div>
        {rows.map(({ brand, a, cells }) => (
          <div key={brand.id} className="flex items-center mb-1.5" style={{ minWidth: 720 }}>
            <button
              onClick={() => onSelect(brand.id)}
              className="w-40 shrink-0 text-left pr-2 group"
            >
              <span className="text-[12px] font-medium text-gray-900 group-hover:text-blue-600 truncate block">
                {brand.name}
                {a.hasBlockers && <AlertTriangle className="w-3 h-3 text-red-500 inline ml-1 -mt-px" />}
              </span>
              <span className="text-[10px] text-gray-400">
                {fmtDMY(brand.startedAt)} → … · {a.done}/{a.countable}
              </span>
            </button>
            {cells.map((c, i) => (
              <span
                key={i}
                title={c.title ? `${days[i].label}: ${c.title}` : days[i].label}
                className={`flex-1 h-[16px] mr-[2px] rounded-[2px] ${c.cls || ''} ${days[i].isToday ? 'ring-1 ring-blue-300' : ''}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ───────────────────────────── История

function HistoryTab({ board }: { board: ObBoard }) {
  const [events, setEvents] = useState<ObEvent[] | null>(null)

  useEffect(() => {
    fetchOnboardingEvents(undefined, 200)
      .then(r => setEvents(r.events))
      .catch(() => setEvents([]))
  }, [board])

  if (events === null) {
    return <div className="flex justify-center py-16 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
  }
  if (events.length === 0) {
    return <div className="text-gray-400 text-sm py-16 text-center">Изменений пока нет</div>
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
      {events.map(e => (
        <div key={e.id} className="px-4 py-2.5 text-sm flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-gray-900">{e.brandName || e.brandId}</span>
          <span className="text-gray-600">{e.taskLabel || '—'}{e.optionLabel ? ` · ${e.optionLabel}` : ''}</span>
          <span className="text-gray-400">{e.oldLabel || '∅'} → {e.newLabel || '∅'}</span>
          <span className="ml-auto text-xs text-gray-400">
            {formatDateTimeShort(e.changedAt)}{e.changedBy ? ` · ${e.changedBy}` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

// ───────────────────────────── Справочники

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
      <button onClick={() => setEditing(true)} className="group flex items-center gap-1.5 text-sm text-gray-800 text-left">
        {value}
        <Pencil className="w-3 h-3 text-gray-300 group-hover:text-gray-500" />
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1">
      <input
        autoFocus value={draft} onChange={e => setDraft(e.target.value)}
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
        value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
        placeholder={placeholder}
        className="flex-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
      />
      <button onClick={submit} disabled={!value.trim() || busy} className="p-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-40">
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
              <InlineEdit value={s.label} onSave={label => updateRefItem({ kind: 'status', id: s.id, label }).then(onChanged)} />
              <select
                value={s.kind}
                onChange={e => updateRefItem({ kind: 'status', id: s.id, metricKind: e.target.value }).then(onChanged)}
                className="text-xs border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-500"
              >
                {METRIC_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <select
                value={s.color}
                onChange={e => updateRefItem({ kind: 'status', id: s.id, color: e.target.value }).then(onChanged)}
                className="text-xs border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-500"
              >
                {COLOR_KEYS.map(ck => <option key={ck} value={ck}>{ck}</option>)}
              </select>
              <span className="ml-auto flex items-center gap-1">
                <button onClick={() => updateRefItem({ kind: 'status', id: s.id, isActive: !s.isActive }).then(onChanged)} className="text-xs text-gray-400 hover:text-gray-600">
                  {s.isActive ? 'скрыть' : 'вернуть'}
                </button>
                <button onClick={() => deleteRefItem('status', s.id).then(onChanged)} className="p-1 text-gray-300 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      <AddRow placeholder="Новый статус" onAdd={label => createRefItem({ kind: 'status', label }).then(onChanged)} />
    </RefCard>
  )
}

function TaskTypesEditor({ board, onChanged }: { board: ObBoard; onChanged: () => void }) {
  const groupLabels = useMemo(
    () => [...new Set(board.taskTypes.map(t => t.groupLabel).filter(Boolean))] as string[],
    [board.taskTypes],
  )
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
      title="Шаги чек-листа"
      hint="Группа объединяет шаги в блок запуска; категория связывает шаг со справочником поставщиков"
    >
      <datalist id="ob-groups">
        {groupLabels.map(g => <option key={g} value={g} />)}
      </datalist>
      <ul className="space-y-2">
        {board.taskTypes.map((t, i) => (
          <li key={t.id} className={`flex flex-wrap items-center gap-2 ${t.isActive ? '' : 'opacity-40'}`}>
            <span className="flex flex-col">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-300 hover:text-gray-500 disabled:opacity-30">
                <ChevronUp className="w-3 h-3" />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === board.taskTypes.length - 1} className="text-gray-300 hover:text-gray-500 disabled:opacity-30">
                <ChevronDown className="w-3 h-3" />
              </button>
            </span>
            <InlineEdit value={t.label} onSave={label => updateRefItem({ kind: 'taskType', id: t.id, label }).then(onChanged)} />
            <input
              defaultValue={t.groupLabel || ''}
              list="ob-groups"
              placeholder="группа"
              onBlur={e => {
                if (e.target.value !== (t.groupLabel || '')) {
                  updateRefItem({ kind: 'taskType', id: t.id, groupLabel: e.target.value || null }).then(onChanged)
                }
              }}
              className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white text-gray-500 w-36"
            />
            <input
              type="number"
              min={1}
              defaultValue={t.targetDays ?? ''}
              placeholder="дн"
              title="Норматив дней на этап (пусто — общий порог)"
              onBlur={e => {
                const v = e.target.value ? parseInt(e.target.value) : null
                if (v !== (t.targetDays ?? null)) {
                  updateRefItem({ kind: 'taskType', id: t.id, targetDays: v }).then(onChanged)
                }
              }}
              className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white text-gray-500 w-12"
            />
            <select
              value={t.optionCategoryId || ''}
              onChange={e => updateRefItem({ kind: 'taskType', id: t.id, categoryId: e.target.value || null }).then(onChanged)}
              className="text-xs border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-500 max-w-[120px]"
            >
              <option value="">без категории</option>
              {board.optionCategories.filter(c => c.isActive).map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <span className="ml-auto flex items-center gap-1">
              <button onClick={() => updateRefItem({ kind: 'taskType', id: t.id, isActive: !t.isActive }).then(onChanged)} className="text-xs text-gray-400 hover:text-gray-600">
                {t.isActive ? 'скрыть' : 'вернуть'}
              </button>
              <button onClick={() => deleteRefItem('taskType', t.id).then(onChanged)} className="p-1 text-gray-300 hover:text-red-500">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <AddRow placeholder="Новый шаг" onAdd={label => createRefItem({ kind: 'taskType', label }).then(onChanged)} />
    </RefCard>
  )
}

function CategoriesEditor({ board, onChanged }: { board: ObBoard; onChanged: () => void }) {
  const [openCat, setOpenCat] = useState<string | null>(null)

  return (
    <RefCard
      title="Категории и поставщики"
      hint="Тип оплаты, агрегаторы, курьер-сервисы, СМС, телефония, каналы продаж — списки для выбора в ячейках"
    >
      <ul className="space-y-1">
        {board.optionCategories.map(cat => {
          const opts = board.options.filter(o => o.categoryId === cat.id)
          const isOpen = openCat === cat.id
          return (
            <li key={cat.id} className={cat.isActive ? '' : 'opacity-40'}>
              <div className="flex items-center gap-2 py-1">
                <button onClick={() => setOpenCat(isOpen ? null : cat.id)} className="p-0.5 text-gray-400 hover:text-gray-600">
                  {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                <InlineEdit value={cat.label} onSave={label => updateRefItem({ kind: 'category', id: cat.id, label }).then(onChanged)} />
                <span className="text-xs text-gray-400">{opts.length}</span>
                <span className="ml-auto flex items-center gap-1">
                  <button onClick={() => updateRefItem({ kind: 'category', id: cat.id, isActive: !cat.isActive }).then(onChanged)} className="text-xs text-gray-400 hover:text-gray-600">
                    {cat.isActive ? 'скрыть' : 'вернуть'}
                  </button>
                  <button onClick={() => deleteRefItem('category', cat.id).then(onChanged)} className="p-1 text-gray-300 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
              {isOpen && (
                <div className="ml-7 mb-2 border-l border-gray-100 pl-3">
                  <ul className="space-y-1">
                    {opts.map(o => (
                      <li key={o.id} className={`flex items-center gap-2 ${o.isActive ? '' : 'opacity-40'}`}>
                        <InlineEdit value={o.label} onSave={label => updateRefItem({ kind: 'option', id: o.id, label }).then(onChanged)} />
                        <span className="ml-auto flex items-center gap-1">
                          <button onClick={() => updateRefItem({ kind: 'option', id: o.id, isActive: !o.isActive }).then(onChanged)} className="text-xs text-gray-400 hover:text-gray-600">
                            {o.isActive ? 'скрыть' : 'вернуть'}
                          </button>
                          <button onClick={() => deleteRefItem('option', o.id).then(onChanged)} className="p-1 text-gray-300 hover:text-red-500">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <AddRow placeholder="Новый поставщик" onAdd={label => createRefItem({ kind: 'option', categoryId: cat.id, label }).then(onChanged)} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <AddRow placeholder="Новая категория" onAdd={label => createRefItem({ kind: 'category', label }).then(onChanged)} />
    </RefCard>
  )
}

function PosEditor({ board, onChanged }: { board: ObBoard; onChanged: () => void }) {
  return (
    <RefCard title="POS-системы" hint="При создании бренда выбирается POS — она определяет набор шагов из шаблона">
      <ul className="space-y-2">
        {board.posSystems.map(p => (
          <li key={p.id} className={`flex items-center gap-2 ${p.isActive ? '' : 'opacity-40'}`}>
            <InlineEdit value={p.name} onSave={name => updateRefItem({ kind: 'pos', id: p.id, name }).then(onChanged)} />
            <span className="ml-auto flex items-center gap-1">
              <button onClick={() => updateRefItem({ kind: 'pos', id: p.id, isActive: !p.isActive }).then(onChanged)} className="text-xs text-gray-400 hover:text-gray-600">
                {p.isActive ? 'скрыть' : 'вернуть'}
              </button>
              <button onClick={() => deleteRefItem('pos', p.id).then(onChanged)} className="p-1 text-gray-300 hover:text-red-500">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <AddRow placeholder="Новая POS-система" onAdd={name => createRefItem({ kind: 'pos', name }).then(onChanged)} />
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
    <RefCard title="Шаблон: POS → шаги" hint="Какие шаги чек-листа создаются для бренда с данной POS-системой">
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
