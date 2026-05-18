import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Search, Plus, Filter, User, AlertTriangle, Loader2, Calendar, Tag, Users, X, ChevronDown, Archive, Briefcase, Clock, CheckCircle, TrendingUp, Zap, Timer } from 'lucide-react'
import { Modal, ConfirmDialog, useNotification } from '@/shared/ui'
import { CaseCard, NewCaseForm, CaseDetailModal, type CaseCardData, type CaseDetail } from '@/features/cases/ui'
import { CasesNowSection } from './CasesNowSection'
import {
  ACTIVE_STATUSES,
  ARCHIVE_STATUSES,
  UI_ACTIVE_COLUMNS,
  UI_COLUMN_CONFIG,
  getUiColumn,
  uiColumnToDefaultStatus,
  type UiColumn,
  type CaseStatus,
  type Case,
} from '@/entities/case'
import { fetchCases, createCase, updateCaseStatus, assignCase, deleteCase, addCaseComment, fetchCaseComments, fetchChannels, fetchAgents, type CaseComment, type CaseResolutionMetrics } from '@/shared/api'
import { useAuth } from '@/shared/hooks/useAuth'
import type { Channel } from '@/entities/channel'
import type { Agent } from '@/entities/agent'
import { PageHint, EducationalEmptyState } from '@/features/onboarding'

// Маппинг Case в CaseCardData для отображения
function mapCaseToCardData(c: Case): CaseCardData {
  return {
    id: c.id,
    number: c.ticketNumber ? `#${c.ticketNumber}` : `CASE-${c.id.slice(0, 6).toUpperCase()}`,
    title: c.title,
    description: c.description,
    company: c.companyName,
    channelId: c.channelId,
    channelName: c.channelName,
    priority: c.priority,
    category: c.category,
    tags: c.tags,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    assignee: c.assignedTo && c.assigneeName ? { id: c.assignedTo, name: c.assigneeName } : undefined,
    reporterName: c.reporterName,
    commentsCount: c.messagesCount,
    isShadow: c.isShadow,
    isRecurring: Boolean(c.isRecurring) || c.status === 'recurring',
    isBlocked: c.status === 'blocked',
    lastStatusChangeAt: c.lastStatusChangeAt ?? null,
    lastActivityAt: c.lastActivityAt ?? null,
    isOverdue: c.isOverdue,
    slaThresholdHours: c.slaThresholdHours,
    ageHours: c.ageHours,
  }
}

// Формат времени: часы → "Xч" или "Xд Yч"
function formatHours(hours: number | null | undefined): string {
  if (hours == null) return '—'
  if (hours < 1) return '< 1 ч'
  if (hours < 24) return `${Math.round(hours)} ч`
  const days = Math.floor(hours / 24)
  const remHours = Math.round(hours % 24)
  return remHours > 0 ? `${days} д ${remHours} ч` : `${days} д`
}

// Маппинг Case в CaseDetail для модального окна
function mapCaseToCaseDetail(c: Case): CaseDetail {
  return {
    id: c.id,
    number: c.ticketNumber ? `#${c.ticketNumber}` : `CASE-${c.id.slice(0, 6).toUpperCase()}`,
    ticketNumber: c.ticketNumber,
    title: c.title,
    description: c.description,
    company: c.companyName,
    channelId: c.channelId,
    channelName: c.channelName,
    contactName: '',
    contactEmail: '',
    priority: c.priority,
    category: c.category,
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    assignee: c.assignedTo && c.assigneeName ? { id: c.assignedTo, name: c.assigneeName } : undefined,
    comments: [],
    tags: c.tags || [],
    linkedChats: c.channelId ? [c.channelId] : [],
    attachments: [],
    history: [],
  }
}

// Периоды для фильтра по дате
const DATE_FILTERS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'all', label: 'Все время' },
] as const

// Категории кейсов
const CATEGORIES = [
  { key: 'all', label: 'Все категории' },
  { key: 'integration', label: 'Интеграция' },
  { key: 'billing', label: 'Биллинг' },
  { key: 'technical', label: 'Техническая' },
  { key: 'delivery', label: 'Доставка' },
  { key: 'general', label: 'Общее' },
] as const

export function CasesPage() {
  const { showNotification } = useNotification()
  const { agent: currentUser } = useAuth()
  const [cases, setCases] = useState<Case[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<CaseResolutionMetrics | null>(null)
  const [statusStats, setStatusStats] = useState<Record<string, number>>({})
  const [overdueCount, setOverdueCount] = useState(0)

  // Режим просмотра: активные или архив
  const [viewMode, setViewMode] = useState<'active' | 'archive'>('active')

  // Базовые фильтры
  const [quickFilter, setQuickFilter] = useState<'all' | 'my' | 'urgent' | 'overdue' | 'unassigned'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')

  // Расширенные фильтры
  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month' | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [channelFilter, setChannelFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'telegram' | 'whatsapp'>('all')
  const [showFilters, setShowFilters] = useState(false)

  const [selectedCase, setSelectedCase] = useState<Case | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [draggedCase, setDraggedCase] = useState<string | null>(null)
  const [_updatingStatus, setUpdatingStatus] = useState<string | null>(null)

  // Массовые действия: режим выбора + множество выбранных id
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkPending, setBulkPending] = useState(false)
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false)

  const toggleSelectCase = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setSelectionMode(false)
  }, [])

  // Debounce поиска (350мс)
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchQuery.trim()), 350)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Преобразование dateFilter → dateFrom (ISO)
  const dateFromIso = useMemo<string | undefined>(() => {
    if (dateFilter === 'all') return undefined
    const now = new Date()
    if (dateFilter === 'today') {
      const d = new Date(now)
      d.setHours(0, 0, 0, 0)
      return d.toISOString()
    }
    if (dateFilter === 'week') return new Date(now.getTime() - 7 * 86400000).toISOString()
    if (dateFilter === 'month') return new Date(now.getTime() - 30 * 86400000).toISOString()
    return undefined
  }, [dateFilter])

  // Серверные параметры фильтрации (зависят от UI-фильтров)
  const serverFilters = useMemo(() => {
    const priorities = quickFilter === 'urgent' ? ['high', 'urgent', 'critical'] : undefined
    return {
      // viewMode сам по себе не отправляем — запрос делаем для активных и архивных раздельно
      assignedTo: quickFilter === 'my' && currentUser?.id ? currentUser.id : undefined,
      unassigned: quickFilter === 'unassigned',
      overdue: quickFilter === 'overdue',
      priorities,
      channelId: channelFilter === 'all' ? undefined : channelFilter,
      category: categoryFilter === 'all' ? undefined : categoryFilter,
      source: sourceFilter === 'all' ? undefined : sourceFilter,
      search: searchDebounced || undefined,
      dateFrom: dateFromIso,
    }
  }, [quickFilter, currentUser?.id, channelFilter, categoryFilter, sourceFilter, searchDebounced, dateFromIso])

  // Загрузка справочников один раз
  useEffect(() => {
    Promise.all([fetchChannels().catch(() => []), fetchAgents().catch(() => [])])
      .then(([channelsData, agentsData]) => {
        setChannels(channelsData)
        setAgents(agentsData.map((a: Agent) => ({ id: a.id, name: a.name })))
      })
  }, [])

  // Загрузка кейсов: один запрос охватывает и активные и архив (status filter не передаём),
  // клиент разделит по ACTIVE_STATUSES/ARCHIVE_STATUSES. Server-side применяет остальные фильтры.
  const loadCases = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetchCases({
        ...serverFilters,
        limit: 500,
        sortBy: 'priority',
        metricsPeriodDays: 30,
      })
      setCases(res.cases)
      setMetrics(res.metrics)
      setStatusStats(res.stats || {})
      setOverdueCount(res.overdueCount ?? 0)
    } catch (err) {
      setError('Ошибка загрузки кейсов. Попробуйте обновить страницу.')
      console.error('Ошибка загрузки кейсов:', err)
    } finally {
      setLoading(false)
    }
  }, [serverFilters])

  useEffect(() => {
    loadCases()
  }, [loadCases])

  // Активные / архив — клиентское разделение возвращённой выборки
  const activeCases = useMemo(() =>
    cases.filter(c => ACTIVE_STATUSES.includes(c.status as any) || c.status === 'recurring'),
    [cases]
  )

  const archivedCases = useMemo(() =>
    cases.filter(c => ARCHIVE_STATUSES.includes(c.status as any)),
    [cases]
  )

  // На сервере уже отфильтровано — поэтому это просто разделение по viewMode
  const filteredCases = useMemo(() => {
    return viewMode === 'active' ? activeCases : archivedCases
  }, [viewMode, activeCases, archivedCases])

  // Количество активных расширенных фильтров (для UI-бейджа)
  const activeFiltersCount = useMemo(() => {
    let count = 0
    if (dateFilter !== 'all') count++
    if (categoryFilter !== 'all') count++
    if (channelFilter !== 'all') count++
    if (sourceFilter !== 'all') count++
    return count
  }, [dateFilter, categoryFilter, channelFilter, sourceFilter])

  // Сброс фильтров
  const resetFilters = () => {
    setDateFilter('all')
    setCategoryFilter('all')
    setChannelFilter('all')
    setSourceFilter('all')
  }

  // Фильтрация по UI-колонке (группирует несколько DB-статусов в одну колонку)
  const getCasesByUiColumn = (col: UiColumn): CaseCardData[] => {
    return filteredCases
      .filter(c => getUiColumn(c.status) === col)
      .map(mapCaseToCardData)
  }

  // Уникальные категории из кейсов
  const uniqueCategories = useMemo(() => {
    const cats = new Set(cases.map(c => c.category).filter(Boolean))
    return Array.from(cats)
  }, [cases])

  const handleDragStart = (caseId: string) => setDraggedCase(caseId)
  const handleDragOver = (e: React.DragEvent) => e.preventDefault()
  
  const handleDrop = async (col: UiColumn) => {
    if (!draggedCase) return

    const caseId = draggedCase
    setDraggedCase(null)

    const current = cases.find(c => c.id === caseId)
    if (!current) return
    // Если уже в этой UI-колонке — ничего не меняем (не теряем blocked/recurring)
    if (getUiColumn(current.status) === col) return

    const status = uiColumnToDefaultStatus(col)

    // Оптимистичное обновление UI
    const previousCases = [...cases]
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, status } : c))

    try {
      setUpdatingStatus(caseId)
      await updateCaseStatus(caseId, status)
    } catch (err) {
      // Откат при ошибке
      setCases(previousCases)
      console.error('Ошибка обновления статуса:', err)
    } finally {
      setUpdatingStatus(null)
    }
  }

  const handleViewCase = (caseId: string) => {
    const caseItem = cases.find(c => c.id === caseId)
    if (caseItem) {
      setSelectedCase(caseItem)
      setIsDetailModalOpen(true)
    }
  }

  const handleStatusChange = async (caseId: string, newStatus: CaseStatus) => {
    // Оптимистичное обновление UI
    const previousCases = [...cases]
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, status: newStatus } : c))
    if (selectedCase?.id === caseId) {
      setSelectedCase(prev => prev ? { ...prev, status: newStatus } : null)
    }
    
    try {
      await updateCaseStatus(caseId, newStatus)
    } catch (err) {
      // Откат при ошибке
      setCases(previousCases)
      if (selectedCase?.id === caseId) {
        const originalCase = previousCases.find(c => c.id === caseId)
        if (originalCase) {
          setSelectedCase(originalCase)
        }
      }
      console.error('Ошибка обновления статуса:', err)
    }
  }

  const handleAssign = async (caseId: string, agent: { id: string; name: string } | null) => {
    // Оптимистичное обновление UI
    const previousCases = [...cases]
    setCases(prev => prev.map(c => c.id === caseId ? { 
      ...c, 
      assignedTo: agent?.id || '', 
      assigneeName: agent?.name || '' 
    } : c))
    
    try {
      await assignCase(caseId, agent?.id || '')
    } catch (err) {
      // Откат при ошибке
      setCases(previousCases)
      console.error('Ошибка назначения агента:', err)
    }
  }

  const handleAddComment = async (caseId: string, text: string, isInternal: boolean) => {
    try {
      await addCaseComment(caseId, text, isInternal, currentUser?.name, currentUser?.id)
      showNotification({ type: 'ticket', title: 'Комментарий добавлен', message: text.slice(0, 50) })
    } catch (err) {
      console.error('Ошибка добавления комментария:', err)
    }
  }

  const handleDeleteCase = async () => {
    if (!selectedCase) return
    const caseId = selectedCase.id
    setCases(prev => prev.filter(c => c.id !== caseId))
    setIsDeleteDialogOpen(false)
    setIsDetailModalOpen(false)
    setSelectedCase(null)
    try {
      await deleteCase(caseId)
      showNotification({ type: 'alert', title: 'Кейс удалён', message: `Кейс ${selectedCase.ticketNumber ? '#' + selectedCase.ticketNumber : caseId.slice(0, 8)} удалён` })
    } catch (err) {
      console.error('Ошибка удаления кейса:', err)
      loadCases()
    }
  }

  // Массовые операции — оптимистичное обновление + последовательные API-вызовы
  const runBulk = async (fn: (id: string) => Promise<unknown>, successTitle: string) => {
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds)
    setBulkPending(true)
    try {
      await Promise.allSettled(ids.map(fn))
      showNotification({ type: 'ticket', title: successTitle, message: `Кейсов: ${ids.length}` })
      await loadCases()
    } catch (err) {
      console.error('Bulk action error:', err)
    } finally {
      setBulkPending(false)
      clearSelection()
    }
  }

  const handleBulkStatus = (status: CaseStatus) =>
    runBulk((id) => updateCaseStatus(id, status), `Статус → ${status}`)

  const handleBulkAssign = (agentId: string) =>
    runBulk((id) => assignCase(id, agentId), agentId ? 'Назначены агенту' : 'Сняты с назначения')

  const handleBulkDelete = () =>
    runBulk((id) => deleteCase(id), 'Кейсы удалены')

  const handleCreateCase = async (data: { title: string; description?: string; category?: string; priority?: string; company?: string }) => {
    try {
      const newCase = await createCase({
        title: data.title,
        description: data.description,
        category: data.category,
        priority: data.priority,
        companyName: data.company,
      })
      setCases(prev => [...prev, newCase])
      setIsCreateModalOpen(false)
      
      // Показываем уведомление о создании тикета
      showNotification({
        type: 'ticket',
        title: 'Тикет создан',
        message: data.title,
        ticketNumber: newCase.ticketNumber?.toString() || newCase.id.slice(0, 8),
        caseId: newCase.id,
        onClick: () => {
          setSelectedCase(newCase)
          setIsDetailModalOpen(true)
        }
      })
    } catch (err) {
      console.error('Ошибка создания кейса:', err)
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-slate-500">Загрузка кейсов...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-8 h-8 text-red-500" />
          <p className="text-slate-700 font-medium">Ошибка загрузки</p>
          <p className="text-slate-500 text-sm">{error}</p>
          <button
            onClick={loadCases}
            className="mt-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="h-full flex flex-col p-6 overflow-y-auto">
        {/* Stats Summary: 4 счётчика + 1 крупный блок метрик времени решения */}
        <div className="grid grid-cols-12 gap-3 mb-4 flex-shrink-0">
          {[
            {
              label: 'Всего активных',
              value: (statusStats.detected || 0) + (statusStats.in_progress || 0) + (statusStats.waiting || 0) + (statusStats.blocked || 0) + (statusStats.recurring || 0),
              icon: Briefcase, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100',
            },
            {
              label: 'Просрочены SLA',
              value: overdueCount,
              icon: Timer, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-100',
              onClick: () => setQuickFilter('overdue'),
            },
            {
              label: 'Без назначения',
              value: activeCases.filter(c => !c.assignedTo).length,
              icon: User, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100',
              onClick: () => setQuickFilter('unassigned'),
            },
            {
              label: `Решено за ${metrics?.periodDays ?? 30} дн`,
              value: metrics?.resolvedCount ?? 0,
              icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-100',
            },
          ].map((s, i) => (
            <button
              key={i}
              onClick={s.onClick}
              disabled={!s.onClick}
              className={`${s.bg} border ${s.border} rounded-xl px-4 py-3 flex items-center gap-3 col-span-3 text-left ${s.onClick ? 'hover:shadow-sm hover:scale-[1.01] transition-all' : ''}`}
            >
              <div className={`w-9 h-9 rounded-lg ${s.bg} flex items-center justify-center`}>
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
              <div>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-slate-500">{s.label}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Время решения: avg / max / median / p95 за период (исключая shadow-кейсы) */}
        <div className="grid grid-cols-12 gap-3 mb-4 flex-shrink-0">
          <div className="col-span-12 bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-100 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-violet-600" />
                <h3 className="text-sm font-semibold text-slate-700">
                  Время решения за {metrics?.periodDays ?? 30} дн
                </h3>
                {metrics?.shadowCount ? (
                  <span className="text-[11px] text-slate-500" title="Кейсы, авто-решённые в чате (<5 мин). В метрики не включены.">
                    исключено {metrics.shadowCount} auto-resolved
                  </span>
                ) : null}
              </div>
              <span className="text-xs text-slate-500">
                база: {metrics?.resolvedCount ?? 0} кейсов
              </span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-white/70 rounded-lg px-3 py-2 border border-white">
                <p className="text-[11px] text-slate-500 uppercase tracking-wide">Среднее</p>
                <p className="text-xl font-bold text-violet-700">{formatHours(metrics?.avgHours ?? null)}</p>
              </div>
              <div className="bg-white/70 rounded-lg px-3 py-2 border border-white">
                <p className="text-[11px] text-slate-500 uppercase tracking-wide">Максимум</p>
                <p className="text-xl font-bold text-red-600">{formatHours(metrics?.maxHours ?? null)}</p>
              </div>
              <div className="bg-white/70 rounded-lg px-3 py-2 border border-white">
                <p className="text-[11px] text-slate-500 uppercase tracking-wide">Медиана</p>
                <p className="text-xl font-bold text-blue-600">{formatHours(metrics?.medianHours ?? null)}</p>
              </div>
              <div className="bg-white/70 rounded-lg px-3 py-2 border border-white">
                <p className="text-[11px] text-slate-500 uppercase tracking-wide">P95</p>
                <p className="text-xl font-bold text-amber-600">{formatHours(metrics?.p95Hours ?? null)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-800">Кейсы</h1>
                <PageHint
                  title="Управление кейсами"
                  description="Кейсы — это обращения клиентов, которые AI создаёт автоматически из сообщений в группах."
                  tips={[
                    { title: 'Автоматическое создание', text: 'AI анализирует сообщения и создаёт кейсы при обнаружении проблемы.' },
                    { title: 'Канбан-доска', text: 'Перетаскивайте кейсы между статусами: Обнаружен → В работе → Решён.' },
                    { title: 'Назначение агента', text: 'Каждый кейс можно назначить на ответственного агента.' },
                    { title: 'Архив', text: 'Решённые кейсы автоматически попадают в архив.' },
                  ]}
                />
              </div>
              <p className="text-slate-500 mt-0.5">Управление обращениями</p>
            </div>
            
            {/* Переключатель Активные / Архив */}
            <div className="flex bg-slate-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode('active')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'active' 
                    ? 'bg-white text-slate-800 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Briefcase className="w-4 h-4" />
                Активные
                <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                  viewMode === 'active' ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-500'
                }`}>
                  {activeCases.length}
                </span>
              </button>
              <button
                onClick={() => setViewMode('archive')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'archive' 
                    ? 'bg-white text-slate-800 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Archive className="w-4 h-4" />
                Архив
                <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                  viewMode === 'archive' ? 'bg-slate-600 text-white' : 'bg-slate-200 text-slate-500'
                }`}>
                  {archivedCases.length}
                </span>
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Поиск кейсов..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 w-64 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <button
              onClick={() => { setSelectionMode(s => !s); if (selectionMode) setSelectedIds(new Set()) }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectionMode
                  ? 'bg-blue-100 text-blue-700 border border-blue-200'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
              title="Включить режим выбора нескольких кейсов"
            >
              <CheckCircle className="w-4 h-4" />
              {selectionMode ? `Выбрано: ${selectedIds.size}` : 'Выбрать'}
            </button>
            {viewMode === 'active' && (
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Новый кейс
              </button>
            )}
          </div>
        </div>

        {/* Quick Filters */}
        <div className="flex items-center gap-2 mb-4 flex-shrink-0 flex-wrap">
          {[
            { key: 'all' as const, label: 'Все', icon: Filter, count: filteredCases.length },
            { key: 'my' as const, label: 'Мои', icon: User, count: filteredCases.filter(c => currentUser?.id && c.assignedTo === currentUser.id).length },
            { key: 'urgent' as const, label: 'Срочные', icon: AlertTriangle, count: filteredCases.filter(c => c.priority === 'high' || c.priority === 'critical' || c.priority === 'urgent').length },
            { key: 'overdue' as const, label: 'Просрочка', icon: Timer, count: overdueCount, danger: true },
            { key: 'unassigned' as const, label: 'Без агента', icon: User, count: filteredCases.filter(c => !c.assignedTo).length },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setQuickFilter(f.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                quickFilter === f.key
                  ? f.danger ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              <f.icon className="w-4 h-4" />
              {f.label}
              <span className={`px-1.5 py-0.5 rounded text-xs ${quickFilter === f.key ? 'bg-white/20' : f.danger && f.count > 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100'}`}>
                {f.count}
              </span>
            </button>
          ))}
          
          <div className="h-6 w-px bg-slate-200 mx-2" />
          
          {/* Toggle advanced filters */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
              showFilters || activeFiltersCount > 0 
                ? 'bg-blue-50 text-blue-600 border border-blue-200' 
                : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            <Filter className="w-4 h-4" />
            Фильтры
            {activeFiltersCount > 0 && (
              <span className="px-1.5 py-0.5 bg-blue-500 text-white text-xs rounded-full">
                {activeFiltersCount}
              </span>
            )}
            <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          
          {activeFiltersCount > 0 && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-700"
            >
              <X className="w-3 h-3" />
              Сбросить
            </button>
          )}
        </div>

        {/* Advanced Filters Panel */}
        {showFilters && (
          <div className="flex flex-wrap gap-3 mb-4 p-4 bg-slate-50 rounded-lg flex-shrink-0">
            {/* Date Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Период
              </label>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                {DATE_FILTERS.map(f => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>
            
            {/* Category Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 flex items-center gap-1">
                <Tag className="w-3 h-3" />
                Категория
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="all">Все категории</option>
                {uniqueCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            
            {/* Channel/Group Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 flex items-center gap-1">
                <Users className="w-3 h-3" />
                Группа
              </label>
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[200px]"
              >
                <option value="all">Все группы</option>
                {channels.map(ch => (
                  <option key={ch.id} value={ch.id}>{ch.name || `Группа ${ch.id.slice(0, 6)}`}</option>
                ))}
              </select>
            </div>

            {/* Source Filter (Telegram / WhatsApp) */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Платформа</label>
              <div className="inline-flex items-center bg-white border border-slate-200 rounded-lg p-0.5">
                {(['all', 'telegram', 'whatsapp'] as const).map((s) => {
                  const active = sourceFilter === s
                  const label = s === 'all' ? 'Все' : s === 'telegram' ? 'TG' : 'WA'
                  return (
                    <button
                      key={s}
                      onClick={() => setSourceFilter(s)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                        active
                          ? s === 'whatsapp'
                            ? 'bg-emerald-500 text-white'
                            : s === 'telegram'
                              ? 'bg-sky-500 text-white'
                              : 'bg-blue-500 text-white'
                          : 'text-slate-600 hover:text-slate-800'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Что происходит сейчас */}
        {viewMode === 'active' && cases.length > 0 && (
          <CasesNowSection cases={cases} onSelectCase={handleViewCase} />
        )}

        {/* Kanban Board / Archive View */}
        {cases.length === 0 && !loading ? (
          <EducationalEmptyState
            icon={<Briefcase className="w-16 h-16" />}
            title="Кейсов пока нет"
            description="Кейсы создаются автоматически, когда AI обнаруживает проблему клиента в чате. Вы также можете создать кейс вручную."
            steps={[
              { icon: '🤖', text: 'Подключите бота в группу с клиентом' },
              { icon: '💬', text: 'Клиент напишет о проблеме в группу' },
              { icon: '📋', text: 'AI создаст кейс автоматически' },
            ]}
            action={{
              label: 'Создать кейс вручную',
              onClick: () => setIsCreateModalOpen(true),
            }}
          />
        ) : viewMode === 'active' ? (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {UI_ACTIVE_COLUMNS.map(col => {
              const config = UI_COLUMN_CONFIG[col]
              const colCases = getCasesByUiColumn(col)

              return (
                <div
                  key={col}
                  className="flex-shrink-0 w-80 flex flex-col"
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(col)}
                >
                  <div className={`px-3 py-2.5 rounded-t-xl ${config.bgColor}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-white/70" />
                        <span className={`font-semibold text-sm ${config.color}`}>
                          {config.label}
                        </span>
                        <span className={`text-[11px] ${config.color} opacity-70`}>{config.hint}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-white/25 text-white">
                        {colCases.length}
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 bg-slate-50 border border-slate-200 border-t-0 rounded-b-xl p-2 space-y-2 min-h-[260px]">
                    {colCases.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-slate-300 text-sm py-8">
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-2">
                          <Plus className="w-5 h-5" />
                        </div>
                        Перетащите сюда
                      </div>
                    ) : (
                      colCases.map(caseItem => (
                        <CaseCard
                          key={caseItem.id}
                          caseItem={caseItem}
                          onView={() => handleViewCase(caseItem.id)}
                          onDragStart={() => handleDragStart(caseItem.id)}
                          isDragging={draggedCase === caseItem.id}
                          selectable={selectionMode}
                          selected={selectedIds.has(caseItem.id)}
                          onToggleSelect={() => toggleSelectCase(caseItem.id)}
                        />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="pb-4">
            {(() => {
              const doneCases = getCasesByUiColumn('done')
              if (doneCases.length === 0) {
                return (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-sm">
                    <Archive className="w-10 h-10 mb-2 text-slate-300" />
                    Закрытых кейсов за выбранный период нет
                  </div>
                )
              }
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {doneCases.map(caseItem => (
                    <CaseCard
                      key={caseItem.id}
                      caseItem={caseItem}
                      onView={() => handleViewCase(caseItem.id)}
                      onDragStart={() => {}}
                      isDragging={false}
                      selectable={selectionMode}
                      selected={selectedIds.has(caseItem.id)}
                      onToggleSelect={() => toggleSelectCase(caseItem.id)}
                    />
                  ))}
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* Create Case Modal */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Новый кейс" size="lg">
        <NewCaseForm onClose={() => setIsCreateModalOpen(false)} onSubmit={handleCreateCase} />
      </Modal>

      {/* Case Detail Modal */}
      <CaseDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        caseData={selectedCase ? mapCaseToCaseDetail(selectedCase) : null}
        agents={agents}
        onStatusChange={handleStatusChange}
        onAssign={handleAssign}
        onAddComment={handleAddComment}
        onDelete={() => setIsDeleteDialogOpen(true)}
      />

      {/* Delete Dialog */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteCase}
        title="Удалить кейс"
        message={`Вы уверены, что хотите удалить кейс ${selectedCase?.ticketNumber ? `#${selectedCase.ticketNumber}` : selectedCase?.id}?`}
        confirmText="Удалить"
        variant="danger"
      />

      {/* Bulk Action Bar — снизу страницы при выборе кейсов */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-white shadow-xl rounded-2xl border border-slate-200 px-4 py-2 flex items-center gap-3">
          <span className="text-sm font-medium text-slate-700">
            Выбрано: <span className="text-blue-600">{selectedIds.size}</span>
          </span>
          <div className="h-6 w-px bg-slate-200" />

          <select
            disabled={bulkPending}
            onChange={(e) => { if (e.target.value) handleBulkStatus(e.target.value as CaseStatus); e.target.value = '' }}
            className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="">Сменить статус…</option>
            <option value="detected">Обнаружен</option>
            <option value="in_progress">В работе</option>
            <option value="waiting">Ожидание</option>
            <option value="blocked">Блокер</option>
            <option value="resolved">Решён</option>
            <option value="closed">Закрыт</option>
            <option value="cancelled">Отменён</option>
          </select>

          <select
            disabled={bulkPending}
            onChange={(e) => { if (e.target.value !== undefined) handleBulkAssign(e.target.value); e.target.value = '' }}
            className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="">Назначить…</option>
            <option value="">— Снять назначение —</option>
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <button
            onClick={() => setIsBulkDeleteDialogOpen(true)}
            disabled={bulkPending}
            className="px-3 py-1.5 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            Удалить
          </button>

          <div className="h-6 w-px bg-slate-200" />

          <button
            onClick={clearSelection}
            className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
          >
            Отмена
          </button>

          {bulkPending && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
        </div>
      )}

      {/* Bulk Delete Dialog */}
      <ConfirmDialog
        isOpen={isBulkDeleteDialogOpen}
        onClose={() => setIsBulkDeleteDialogOpen(false)}
        onConfirm={() => { setIsBulkDeleteDialogOpen(false); handleBulkDelete() }}
        title="Удалить выбранные кейсы"
        message={`Удалить ${selectedIds.size} кейс(ов)? Действие нельзя отменить.`}
        confirmText="Удалить все"
        variant="danger"
      />
    </>
  )
}
