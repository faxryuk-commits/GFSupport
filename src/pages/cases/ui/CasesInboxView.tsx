import { useMemo, useCallback, useEffect, useRef } from 'react'
import { AlertTriangle, Timer, User, Bell, Repeat, Ban, MessageSquare, ChevronRight, PlayCircle, Loader2, Zap, CheckCircle2 } from 'lucide-react'
import { Avatar } from '@/shared/ui'
import { formatDuration } from '@/shared/lib'
import { CASE_PRIORITY_CONFIG, type Case } from '@/entities/case'

interface InboxRowProps {
  caseItem: Case
  selected: boolean
  onSelect: () => void
}

function formatRel(date: string | undefined | null): string {
  if (!date) return '—'
  const diff = Date.now() - new Date(date).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч`
  const d = Math.floor(h / 24)
  return `${d} д`
}

function InboxRow({ caseItem, selected, onSelect }: InboxRowProps) {
  const priority = CASE_PRIORITY_CONFIG[caseItem.priority]
  const number = caseItem.ticketNumber ? `#${caseItem.ticketNumber}` : `#${caseItem.id.slice(0, 6).toUpperCase()}`
  const isUrgent = caseItem.priority === 'critical' || caseItem.priority === 'urgent'

  // Показатели жизненного цикла (создан уже показан ниже как «N назад»)
  const isResolved = caseItem.resolutionTimeMinutes != null
  const frtPending = caseItem.firstResponseMinutes == null && !isResolved
  const frtLabel = caseItem.firstResponseMinutes != null
    ? formatDuration(caseItem.firstResponseMinutes)
    : (isResolved ? '—' : 'ждёт')

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 border-l-2 border-b border-slate-100 transition-colors ${
        selected
          ? 'bg-blue-50 border-l-blue-500'
          : caseItem.isOverdue
          ? 'bg-red-50/30 border-l-red-300 hover:bg-red-50/60'
          : 'border-l-transparent hover:bg-slate-50'
      }`}
    >
      {/* Line 1: priority dot + number + title + SLA */}
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${priority.bgColor.replace('bg-', 'bg-')}`} title={priority.label} />
        <span className="text-[11px] font-mono text-slate-500 flex-shrink-0">{number}</span>
        <p className={`text-sm flex-1 truncate ${selected ? 'font-medium text-slate-900' : 'text-slate-800'}`}>
          {caseItem.title || 'Без названия'}
        </p>
        {caseItem.isOverdue && (
          <span className="flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-semibold rounded bg-red-500 text-white flex-shrink-0" title={`SLA: ${caseItem.slaThresholdHours}ч`}>
            <AlertTriangle className="w-2.5 h-2.5" />
            SLA
          </span>
        )}
        {isUrgent && !caseItem.isOverdue && (
          <span className="px-1 py-0.5 text-[9px] font-semibold rounded bg-orange-500 text-white flex-shrink-0">
            {priority.label}
          </span>
        )}
      </div>

      {/* Line 2: канал + время создания */}
      <div className="flex items-center gap-2 text-[11px] text-slate-500 mb-1">
        <MessageSquare className="w-3 h-3 flex-shrink-0" />
        <span className="truncate flex-1">{caseItem.channelName || 'Без канала'}</span>
        <span className="flex-shrink-0" title="Создан">{formatRel(caseItem.createdAt)} назад</span>
      </div>

      {/* Line 2b: первый ответ (FRT) + время решения */}
      <div className="flex items-center gap-3 text-[10px] mb-1">
        <span className={`flex items-center gap-0.5 ${frtPending ? 'text-amber-600' : 'text-slate-500'}`} title="Первый ответ — от первого сообщения клиента до ответа команды">
          <Zap className="w-2.5 h-2.5 flex-shrink-0" />{frtLabel}
        </span>
        <span className={`flex items-center gap-0.5 ${isResolved ? 'text-emerald-600' : 'text-slate-400'}`} title="Время решения — от первого сообщения клиента до резолюции">
          <CheckCircle2 className="w-2.5 h-2.5 flex-shrink-0" />{isResolved ? formatDuration(caseItem.resolutionTimeMinutes) : 'в работе'}
        </span>
      </div>

      {/* Line 3: assignee + бейджи */}
      <div className="flex items-center gap-2">
        {caseItem.assignedTo && caseItem.assigneeName ? (
          <div className="flex items-center gap-1">
            <Avatar name={caseItem.assigneeName} size="xs" />
            <span className="text-[11px] text-slate-600 truncate max-w-[100px]">{caseItem.assigneeName}</span>
          </div>
        ) : (
          <span className="text-[11px] text-slate-400 italic">не назначен</span>
        )}

        <div className="flex-1" />

        {/* Бейджи компактно */}
        {caseItem.status === 'blocked' && (
          <span className="flex items-center gap-0.5 text-[9px] text-red-600" title="Заблокирован">
            <Ban className="w-2.5 h-2.5" />
          </span>
        )}
        {(caseItem.isRecurring || caseItem.status === 'recurring') && (
          <span className="flex items-center gap-0.5 text-[9px] text-purple-600" title="Повторяется">
            <Repeat className="w-2.5 h-2.5" />
          </span>
        )}
        {caseItem.isSnoozed && (
          <span className="flex items-center gap-0.5 text-[9px] text-purple-500" title={`Отложен до ${caseItem.snoozedUntil ? new Date(caseItem.snoozedUntil).toLocaleString('ru-RU') : ''}`}>
            <Bell className="w-2.5 h-2.5" />
          </span>
        )}
        {selected && <ChevronRight className="w-3 h-3 text-blue-500" />}
      </div>

      {/* Resolution-SLA бар: % прошедшего времени до дедлайна по приоритету */}
      <ResolutionSlaBar caseItem={caseItem} />
    </button>
  )
}

// Полоса времени до дедлайна решения. Ширина = % прошедшего; цвет: решён/в норме —
// зелёный, >55% прошло — янтарь, просрочен — красный.
function ResolutionSlaBar({ caseItem }: { caseItem: Case }) {
  const thr = caseItem.slaThresholdHours
  if (!thr || !caseItem.createdAt) return null
  const resolved = caseItem.status === 'resolved' || caseItem.status === 'closed'
  const elapsedH = (Date.now() - new Date(caseItem.createdAt).getTime()) / 3600000
  let pct = Math.min(100, Math.max(0, Math.round((elapsedH / thr) * 100)))
  let color = '#16a34a'
  if (resolved) { pct = 100; color = '#16a34a' }
  else if (caseItem.isOverdue || pct >= 100) { pct = 100; color = '#dc2626' }
  else if (pct >= 55) color = '#d97706'
  return (
    <div className="mt-1.5 h-1 rounded-full bg-slate-100 overflow-hidden" title={`${pct}% времени до дедлайна (${thr}ч)`}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

interface CasesInboxViewProps {
  cases: Case[]
  selectedCaseId: string | null
  onSelectCase: (caseId: string) => void
  onTakeNext: () => void
  takeNextPending: boolean
  renderDetail: () => React.ReactNode
}

export function CasesInboxView({
  cases, selectedCaseId, onSelectCase, onTakeNext, takeNextPending, renderDetail,
}: CasesInboxViewProps) {

  // Группируем кейсы по приоритету очереди для визуальной структуры.
  // resolved (решённые сегодня — их присылает active-пресет) — отдельной группой внизу,
  // чтобы не мешались в рабочей очереди.
  const grouped = useMemo(() => {
    const overdueUrgent: Case[] = []
    const overdue: Case[] = []
    const urgent: Case[] = []
    const newUnassigned: Case[] = []
    const other: Case[] = []
    const resolvedToday: Case[] = []

    for (const c of cases) {
      if (c.status === 'resolved') { resolvedToday.push(c); continue }
      const isUrgent = c.priority === 'critical' || c.priority === 'urgent'
      if (c.isOverdue && isUrgent) overdueUrgent.push(c)
      else if (c.isOverdue) overdue.push(c)
      else if (isUrgent) urgent.push(c)
      else if (!c.assignedTo) newUnassigned.push(c)
      else other.push(c)
    }

    return [
      { key: 'overdue_urgent', label: '🔥 Срочные + просрочены', cases: overdueUrgent },
      { key: 'overdue',        label: '⏰ Просрочены',            cases: overdue },
      { key: 'urgent',         label: '⚡ Срочные',                cases: urgent },
      { key: 'new',            label: '🆕 Новые без агента',      cases: newUnassigned },
      { key: 'other',          label: 'В работе',                  cases: other },
      { key: 'resolved_today', label: '✅ Решено сегодня',        cases: resolvedToday },
    ].filter(g => g.cases.length > 0)
  }, [cases])

  // Авто-скролл к выбранному кейсу
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!selectedCaseId || !listRef.current) return
    const el = listRef.current.querySelector(`[data-case-id="${selectedCaseId}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedCaseId])

  // Keyboard navigation: j/k или стрелки для перехода между кейсами
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    const flat = grouped.flatMap(g => g.cases)
    if (flat.length === 0) return
    const idx = flat.findIndex(c => c.id === selectedCaseId)
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = flat[Math.min(idx + 1, flat.length - 1)]
      if (next) onSelectCase(next.id)
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = flat[Math.max(idx - 1, 0)]
      if (prev) onSelectCase(prev.id)
    }
  }, [grouped, selectedCaseId, onSelectCase])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="flex gap-4 flex-1 min-h-0">
      {/* Левая панель: список */}
      <div className="w-[340px] flex-shrink-0 bg-white border border-[#e8edf3] rounded-xl flex flex-col overflow-hidden">
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {grouped.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">
              Активных кейсов нет 🎉
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.key}>
                <div className="px-3 py-1.5 bg-slate-50 border-b border-[#e8edf3] sticky top-0 z-10">
                  <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
                    {group.label} <span className="text-slate-400 font-normal">({group.cases.length})</span>
                  </span>
                </div>
                {group.cases.map(c => (
                  <div key={c.id} data-case-id={c.id}>
                    <InboxRow
                      caseItem={c}
                      selected={c.id === selectedCaseId}
                      onSelect={() => onSelectCase(c.id)}
                    />
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Footer: Take Next */}
        <div className="border-t border-[#e8edf3] p-2 bg-slate-50">
          <button
            onClick={onTakeNext}
            disabled={takeNextPending}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-br from-[#3b82f6] to-[#2563eb] text-white shadow-[0_3px_10px_rgba(37,99,235,0.22)] rounded-lg hover:brightness-[1.04] hover:shadow-[0_5px_16px_rgba(37,99,235,0.34)] disabled:opacity-50 text-sm font-medium"
            title="Взять следующий приоритетный кейс из очереди (j/k для навигации списком)"
          >
            {takeNextPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            Взять следующий
          </button>
          <p className="text-[10px] text-slate-400 text-center mt-1">
            j/k или ↑↓ — навигация по списку
          </p>
        </div>
      </div>

      {/* Правая панель: превью кейса */}
      <div className="flex-1 bg-white border border-[#e8edf3] rounded-xl overflow-hidden flex flex-col min-w-0">
        {selectedCaseId ? (
          <div className="flex-1 overflow-y-auto">{renderDetail()}</div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div className="text-slate-400">
              <User className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p className="text-sm">Выберите кейс из списка слева</p>
              <p className="text-xs mt-1">или нажмите <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">Взять следующий</kbd></p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
