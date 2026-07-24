import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Search, Plus, Filter, User, AlertTriangle, Loader2, Calendar, Tag, Users, X, ChevronDown, Archive, Briefcase, Clock, CheckCircle, TrendingUp, Zap, Timer, Bell, Inbox, LayoutGrid, ArrowUpDown } from 'lucide-react'
import { Modal, ConfirmDialog, useNotification } from '@/shared/ui'
import { CaseCard, NewCaseForm, CaseDetailModal, type CaseCardData, type CaseDetail } from '@/features/cases/ui'
import { CasesNowSection } from './CasesNowSection'
import { CasesInboxView } from './CasesInboxView'
import { takeNextCase } from '@/shared/api'
import {
  isOnActiveBoard,
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
    resolvedAt: c.resolvedAt ?? null,
    updatedAt: c.updatedAt,
    firstResponseMinutes: c.firstResponseMinutes,
    resolutionTimeMinutes: c.resolutionTimeMinutes,
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
    snoozedUntil: c.snoozedUntil ?? null,
    isSnoozed: c.isSnoozed,
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
    resolvedAt: c.resolvedAt ?? null,
    updatedAt: c.updatedAt,
    firstResponseMinutes: c.firstResponseMinutes,
    resolutionTimeMinutes: c.resolutionTimeMinutes,
    assignee: c.assignedTo && c.assigneeName ? { id: c.assignedTo, name: c.assigneeName } : undefined,
    comments: [],
    tags: c.tags || [],
    linkedChats: c.channelId ? [c.channelId] : [],
    attachments: [],
    history: [],
    snoozedUntil: c.snoozedUntil ?? null,
  }
}

// Бакеты распределения FRT: ключи совпадают с metrics.frt.buckets с бэкенда
const FRT_BUCKET_CONFIG = [
  { key: 'within5', label: '≤ 5 мин', short: '5м', color: 'bg-emerald-500' },
  { key: 'within10', label: '5–10 мин', short: '10м', color: 'bg-green-400' },
  { key: 'within30', label: '10–30 мин', short: '30м', color: 'bg-amber-400' },
  { key: 'within60', label: '30–60 мин', short: '60м', color: 'bg-orange-500' },
  { key: 'over60', label: '> 60 мин', short: '60+', color: 'bg-red-500' },
] as const

/** Человекочитаемые лейблы срезов FRT (типы каналов и источники). */
const FRT_SEG_LABELS: Record<string, string> = {
  client: 'Клиенты',
  client_integration: 'Клиенты+интегр.',
  partner: 'Партнёры',
  internal: 'Внутренние',
  telegram: 'TG',
  whatsapp: 'WA',
}

// Периоды для фильтра по дате
const DATE_FILTERS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: '7 дней' },
  { key: 'month', label: '30 дней' },
  { key: 'quarter', label: '90 дней' },
  { key: 'custom', label: 'Свой период…' },
  { key: 'all', label: 'Всё время' },
] as const

type DateFilterKey = (typeof DATE_FILTERS)[number]['key']

type CaseSortBy = 'priority' | 'created_desc' | 'created_asc' | 'last_activity'

const CASE_SORT_OPTIONS: { value: CaseSortBy; label: string }[] = [
  { value: 'priority', label: 'По приоритету' },
  { value: 'created_desc', label: 'Сначала новые' },
  { value: 'created_asc', label: 'Сначала старые' },
  { value: 'last_activity', label: 'По активности' },
]

function parseStoredSortBy(value: string | null): CaseSortBy {
  if (value && CASE_SORT_OPTIONS.some((o) => o.value === value)) {
    return value as CaseSortBy
  }
  return 'priority'
}

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
  const [resolvedTodayCount, setResolvedTodayCount] = useState(0)

  // Режим просмотра: активные или архив
  const [viewMode, setViewMode] = useState<'active' | 'archive'>('active')
  // Layout активных: inbox (default) или kanban. Сохраняется в localStorage.
  const [activeLayout, setActiveLayout] = useState<'inbox' | 'kanban'>(() => {
    try {
      const saved = localStorage.getItem('cases.activeLayout')
      return saved === 'kanban' ? 'kanban' : 'inbox'
    } catch { return 'inbox' }
  })
  useEffect(() => {
    try { localStorage.setItem('cases.activeLayout', activeLayout) } catch {}
  }, [activeLayout])

  // Take Next
  const [takeNextPending, setTakeNextPending] = useState(false)

  // Базовые фильтры
  const [quickFilter, setQuickFilter] = useState<'all' | 'my' | 'urgent' | 'overdue' | 'unassigned' | 'snoozed'>('all')
  const [snoozedCount, setSnoozedCount] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')

  // Расширенные фильтры
  const [dateFilter, setDateFilter] = useState<DateFilterKey>('all')
  const [customDateFrom, setCustomDateFrom] = useState<string>('')
  const [customDateTo, setCustomDateTo] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [channelFilter, setChannelFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'telegram' | 'whatsapp'>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [sortBy, setSortBy] = useState<CaseSortBy>(() => {
    try {
      return parseStoredSortBy(localStorage.getItem('cases.sortBy'))
    } catch {
      return 'priority'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('cases.sortBy', sortBy)
    } catch {
      /* ignore */
    }
  }, [sortBy])

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

  // Преобразование dateFilter → {dateFrom, dateTo} (ISO)
  const { dateFromIso, dateToIso } = useMemo<{ dateFromIso?: string; dateToIso?: string }>(() => {
    if (dateFilter === 'all') return {}
    const now = new Date()
    if (dateFilter === 'today') {
      const d = new Date(now)
      d.setHours(0, 0, 0, 0)
      return { dateFromIso: d.toISOString() }
    }
    if (dateFilter === 'week') return { dateFromIso: new Date(now.getTime() - 7 * 86400000).toISOString() }
    if (dateFilter === 'month') return { dateFromIso: new Date(now.getTime() - 30 * 86400000).toISOString() }
    if (dateFilter === 'quarter') return { dateFromIso: new Date(now.getTime() - 90 * 86400000).toISOString() }
    if (dateFilter === 'custom') {
      const from = customDateFrom ? new Date(customDateFrom + 'T00:00:00').toISOString() : undefined
      const to = customDateTo ? new Date(customDateTo + 'T23:59:59').toISOString() : undefined
      return { dateFromIso: from, dateToIso: to }
    }
    return {}
  }, [dateFilter, customDateFrom, customDateTo])

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
      dateTo: dateToIso,
      snoozed: (quickFilter === 'snoozed' ? 'only' : 'hide') as 'hide' | 'only',
    }
  }, [quickFilter, currentUser?.id, channelFilter, categoryFilter, sourceFilter, searchDebounced, dateFromIso, dateToIso])

  // Загрузка справочников один раз
  useEffect(() => {
    Promise.all([fetchChannels().catch(() => []), fetchAgents().catch(() => [])])
      .then(([channelsData, agentsData]) => {
        setChannels(channelsData)
        setAgents(agentsData.map((a: Agent) => ({ id: a.id, name: a.name })))
      })
  }, [])

  // Метрика времени решения считается за тот же период что и фильтр.
  const metricsPeriodDays = useMemo(() => {
    if (dateFilter === 'today') return 1
    if (dateFilter === 'week') return 7
    if (dateFilter === 'month') return 30
    if (dateFilter === 'quarter') return 90
    if (dateFilter === 'custom' && customDateFrom) {
      const from = new Date(customDateFrom)
      const to = customDateTo ? new Date(customDateTo) : new Date()
      const days = Math.ceil((to.getTime() - from.getTime()) / 86400000)
      return Math.max(1, Math.min(365, days))
    }
    return 30
  }, [dateFilter, customDateFrom, customDateTo])

  // Загрузка кейсов: один запрос охватывает и активные и архив (status filter не передаём),
  // клиент разделит через isOnActiveBoard. Server-side применяет остальные фильтры.
  const loadCases = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      // Грузим ТОЛЬКО кейсы текущей вкладки (active/archive). Раньше один запрос
      // тянул и активные, и архив вместе с limit=500 и делил на клиенте — при >500
      // кейсов у орга активные «вытеснялись» архивными за лимит (список недосчитывал).
      // Точные счётчики вкладок берём из агрегата statusStats (см. ниже).
      const res = await fetchCases({
        ...serverFilters,
        status: viewMode === 'active' ? 'active' : 'archive',
        limit: 500,
        sortBy,
        metricsPeriodDays,
      })
      setCases(res.cases)
      setMetrics(res.metrics)
      setStatusStats(res.stats || {})
      setOverdueCount(res.overdueCount ?? 0)
      setSnoozedCount(res.snoozedCount ?? 0)
      setResolvedTodayCount(res.resolvedTodayCount ?? 0)
    } catch (err) {
      setError('Ошибка загрузки кейсов. Попробуйте обновить страницу.')
      console.error('Ошибка загрузки кейсов:', err)
    } finally {
      setLoading(false)
    }
  }, [serverFilters, metricsPeriodDays, viewMode, sortBy])

  useEffect(() => {
    loadCases()
  }, [loadCases])

  // Активные / архив — клиентское разделение возвращённой выборки.
  // Решённые СЕГОДНЯ (Ташкент) остаются на активной доске (колонка «Решено»),
  // вчерашние resolved и closed/cancelled — архив (см. isOnActiveBoard).
  const activeCases = useMemo(() =>
    cases.filter(c => isOnActiveBoard(c.status, c.resolvedAt)),
    [cases]
  )

  const archivedCases = useMemo(() =>
    cases.filter(c => !isOnActiveBoard(c.status, c.resolvedAt)),
    [cases]
  )

  // Точные счётчики вкладок — из агрегата statusStats (GROUP BY status по всему оргу),
  // а НЕ из длины загруженной выборки (та обрезается лимитом и обновляется под вкладку).
  // «Активные» = рабочие статусы + решённые сегодня; «Архив» — остальное.
  const workloadCount = useMemo(() =>
    (statusStats.detected || 0) + (statusStats.in_progress || 0) + (statusStats.waiting || 0) +
    (statusStats.blocked || 0) + (statusStats.recurring || 0),
    [statusStats]
  )
  const activeStatusCount = workloadCount + resolvedTodayCount
  const archiveStatusCount = useMemo(() =>
    Math.max(0, (statusStats.resolved || 0) - resolvedTodayCount) +
    (statusStats.closed || 0) + (statusStats.cancelled || 0),
    [statusStats, resolvedTodayCount]
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

  // Take Next: берёт следующий по приоритету, назначает на меня, открывает в превью / модале
  const handleTakeNext = useCallback(async () => {
    if (!currentUser?.id) {
      showNotification({ type: 'alert', title: 'Не авторизован', message: 'Нужен ID агента' })
      return
    }
    setTakeNextPending(true)
    try {
      const res = await takeNextCase(currentUser.id)
      if (!res.case) {
        showNotification({ type: 'alert', title: 'Очередь пуста', message: 'Нет кейсов для разбора. 🎉' })
        return
      }
      // Освежим список и откроем кейс
      await loadCases()
      // Найдём в обновлённом списке (или используем то что вернул API)
      const fullCase = { ...res.case } as Case
      setSelectedCase(fullCase)
      // В режиме inbox оставляем split-view, в kanban — открываем модал
      if (activeLayout === 'kanban') setIsDetailModalOpen(true)
    } catch (e) {
      console.error('Take next error', e)
      showNotification({ type: 'alert', title: 'Ошибка', message: 'Не удалось взять следующий кейс' })
    } finally {
      setTakeNextPending(false)
    }
  }, [currentUser?.id, showNotification, loadCases, activeLayout])

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
            className="mt-2 px-4 py-2 bg-gradient-to-br from-[#3b82f6] to-[#2563eb] text-white shadow-[0_3px_10px_rgba(37,99,235,0.22)] rounded-lg hover:brightness-[1.04] hover:shadow-[0_5px_16px_rgba(37,99,235,0.34)] transition-all"
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
        {/* Компактная панель метрик: счётчики кейсов + время решения в одну строку */}
        <div className="flex flex-wrap items-stretch gap-2 mb-4 flex-shrink-0">
          {/* Счётчики кейсов (кликабельные → фильтр) */}
          <button
            disabled
            className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg"
            title="Кейсы на активной доске: в работе + решённые сегодня (уйдут в архив завтра ночью)"
          >
            <Briefcase className="w-4 h-4 text-blue-600" />
            <span className="text-lg font-bold text-blue-700 leading-none">
              {activeStatusCount}
            </span>
            <span className="text-xs text-slate-600">активных</span>
          </button>

          <button
            onClick={() => setQuickFilter('overdue')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
              quickFilter === 'overdue'
                ? 'bg-red-500 border-red-500 text-white'
                : 'bg-red-50 border-red-100 hover:bg-red-100'
            }`}
            title="Активные кейсы старше SLA-порога по приоритету (4 ч / 24 ч / 72 ч / 168 ч)"
          >
            <Timer className={`w-4 h-4 ${quickFilter === 'overdue' ? 'text-white' : 'text-red-600'}`} />
            <span className={`text-lg font-bold leading-none ${quickFilter === 'overdue' ? 'text-white' : 'text-red-700'}`}>
              {overdueCount}
            </span>
            <span className={`text-xs ${quickFilter === 'overdue' ? 'text-red-50' : 'text-slate-600'}`}>просрочка</span>
          </button>

          <button
            onClick={() => setQuickFilter('unassigned')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
              quickFilter === 'unassigned'
                ? 'bg-amber-500 border-amber-500 text-white'
                : 'bg-amber-50 border-amber-100 hover:bg-amber-100'
            }`}
            title="Активные кейсы без назначенного агента"
          >
            <User className={`w-4 h-4 ${quickFilter === 'unassigned' ? 'text-white' : 'text-amber-600'}`} />
            <span className={`text-lg font-bold leading-none ${quickFilter === 'unassigned' ? 'text-white' : 'text-amber-700'}`}>
              {activeCases.filter(c => !c.assignedTo).length}
            </span>
            <span className={`text-xs ${quickFilter === 'unassigned' ? 'text-amber-50' : 'text-slate-600'}`}>без агента</span>
          </button>

          <button
            disabled
            className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-100 rounded-lg"
            title={`Resolved + closed за ${metrics?.periodDays ?? 30} дн (без shadow auto-resolved)`}
          >
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span className="text-lg font-bold text-green-700 leading-none">{metrics?.resolvedCount ?? 0}</span>
            <span className="text-xs text-slate-600">решено / {metrics?.periodDays ?? 30}д</span>
          </button>

          {/* Разделитель + метрики времени */}
          <div className="w-px bg-slate-200 mx-1" />

          {[
            { key: 'avg', label: 'Среднее', value: metrics?.avgHours, color: 'text-violet-700', tip: 'Среднее время от первого сообщения клиента до закрытия кейса. Может перекошиться одним длинным кейсом.' },
            { key: 'med', label: 'Медиана', value: metrics?.medianHours, color: 'text-blue-700', tip: 'Половина кейсов решается быстрее, половина — медленнее. Устойчиво к выбросам.' },
            { key: 'p95', label: 'P95', value: metrics?.p95Hours, color: 'text-amber-700', tip: '95% кейсов решаются за это время или быстрее. Только 5% хуже — это «верхний предел нормы».' },
            { key: 'max', label: 'Максимум', value: metrics?.maxHours, color: 'text-red-700', tip: 'Самый долгий кейс за период. Если резко отличается от P95 — отдельный аутлайер.' },
          ].map(m => (
            <div
              key={m.key}
              className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg cursor-help"
              title={m.tip}
            >
              <span className="text-[11px] text-slate-500 uppercase tracking-wide">{m.label}</span>
              <span className={`text-base font-bold leading-none ${m.color}`}>{formatHours(m.value ?? null)}</span>
            </div>
          ))}

          {metrics?.shadowCount ? (
            <span
              className="text-[11px] text-slate-400 self-center ml-1"
              title="Auto-resolved в чате за <5 мин — не включены в среднее, иначе искажают вниз"
            >
              ({metrics.shadowCount} auto-resolved)
            </span>
          ) : null}

          {/* FRT: среднее + распределение первого ответа по бакетам */}
          {metrics?.frt && metrics.frt.count > 0 && (
            <>
              <div className="w-px bg-slate-200 mx-1" />
              <div
                className="flex items-center gap-3 px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg cursor-help"
                title={`Первый ответ (FRT) ТОЛЬКО по клиентским каналам: ${metrics.frt.count} тикетов за ${metrics.periodDays} дн (партнёрские и внутренние чаты не смешиваются — см. срезы справа). Крупно — МЕДИАНА (типичный ответ). Среднее ${metrics.frt.avgMinutes ?? '—'} мин перекошено долгими просрочками (см. «60+»).`}
              >
                <span className="flex items-center gap-1 text-[11px] text-slate-500 uppercase tracking-wide">
                  <Zap className="w-3 h-3 text-blue-500" />
                  Ответ клиентам · медиана
                </span>
                <span className="text-base font-bold leading-none text-blue-700">
                  {metrics.frt.medianMinutes != null ? `${metrics.frt.medianMinutes} мин` : '—'}
                </span>
                {metrics.frt.avgMinutes != null && (
                  <span className="text-[10px] text-slate-400 leading-none">
                    сред. {metrics.frt.avgMinutes} мин
                  </span>
                )}
                {/* Стековая полоса распределения */}
                <div className="flex h-2.5 w-36 rounded-full overflow-hidden bg-slate-200">
                  {FRT_BUCKET_CONFIG.map(b => {
                    const bucket = metrics.frt!.buckets[b.key]
                    if (!bucket.count) return null
                    return (
                      <div
                        key={b.key}
                        className={b.color}
                        style={{ width: `${bucket.pct}%` }}
                        title={`${b.label}: ${bucket.pct}% (${bucket.count})`}
                      />
                    )
                  })}
                </div>
                {/* Компактная легенда с процентами */}
                <div className="flex items-center gap-2">
                  {FRT_BUCKET_CONFIG.map(b => {
                    const bucket = metrics.frt!.buckets[b.key]
                    return (
                      <span key={b.key} className="flex items-center gap-1 text-[10px] text-slate-500" title={`${b.label}: ${bucket.count} тикетов`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${b.color}`} />
                        {b.short} <span className="font-semibold text-slate-700">{bucket.pct}%</span>
                      </span>
                    )
                  })}
                </div>
              </div>

              {/* Раздельные срезы FRT (медианы) — типы каналов не смешиваем */}
              {metrics.frt.segments && (
                <div
                  className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-[10px] text-slate-500 cursor-help flex-wrap"
                  title={`Медиана первого ответа по срезам (за ${metrics.periodDays} дн).\n\nПо типу канала:\n${metrics.frt.segments.byType.map(s => `  ${FRT_SEG_LABELS[s.key] || s.key}: медиана ${s.medianMinutes ?? '—'} мин · среднее ${s.avgMinutes ?? '—'} мин · ${s.count} тикетов`).join('\n')}\n\nПо источнику:\n${metrics.frt.segments.bySource.map(s => `  ${FRT_SEG_LABELS[s.key] || s.key}: медиана ${s.medianMinutes ?? '—'} мин · ${s.count}`).join('\n')}\n\nПо рынку:\n${metrics.frt.segments.byMarket.map(s => `  ${s.key}: медиана ${s.medianMinutes ?? '—'} мин · ${s.count}`).join('\n')}`}
                >
                  <span className="uppercase tracking-wide text-slate-400">Срезы</span>
                  {metrics.frt.segments.byType.filter(s => s.key !== 'client' && s.key !== 'client_integration' && s.count > 0).map(s => (
                    <span key={s.key} className="flex items-center gap-1">
                      <span className="text-slate-600">{FRT_SEG_LABELS[s.key] || s.key}</span>
                      <span className="font-semibold text-slate-700">{s.medianMinutes ?? '—'}м</span>
                      <span className="text-slate-400">({s.count})</span>
                    </span>
                  ))}
                  <span className="w-px h-3 bg-slate-200" />
                  {metrics.frt.segments.bySource.filter(s => s.count > 0).map(s => (
                    <span key={s.key} className="flex items-center gap-1">
                      <span className="text-slate-600">{FRT_SEG_LABELS[s.key] || s.key}</span>
                      <span className="font-semibold text-slate-700">{s.medianMinutes ?? '—'}м</span>
                    </span>
                  ))}
                  {metrics.frt.segments.byMarket.length > 1 && (
                    <>
                      <span className="w-px h-3 bg-slate-200" />
                      {metrics.frt.segments.byMarket.slice(0, 3).map(s => (
                        <span key={s.key} className="flex items-center gap-1">
                          <span className="text-slate-600">{s.key}</span>
                          <span className="font-semibold text-slate-700">{s.medianMinutes ?? '—'}м</span>
                        </span>
                      ))}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-[22px] font-extrabold text-slate-900 tracking-tight">Кейсы</h1>
                <PageHint
                  title="Управление кейсами"
                  description="Кейсы — это обращения клиентов, которые AI создаёт автоматически из сообщений в группах."
                  tips={[
                    { title: 'Автоматическое создание', text: 'AI анализирует сообщения и создаёт кейсы при обнаружении проблемы.' },
                    { title: 'Канбан-доска', text: 'Перетаскивайте кейсы между статусами: Обнаружен → В работе → Решён.' },
                    { title: 'Назначение агента', text: 'Каждый кейс можно назначить на ответственного агента.' },
                    { title: 'Архив', text: 'Решённый кейс остаётся на доске до конца дня (колонка «Решено»), а на следующий день автоматически уходит в архив.' },
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
                  {activeStatusCount}
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
                  {archiveStatusCount}
                </span>
              </button>
            </div>

            {/* Layout toggle для активных: Inbox / Канбан */}
            {viewMode === 'active' && (
              <div className="flex bg-slate-100 rounded-lg p-1" title="Способ отображения активных кейсов">
                <button
                  onClick={() => setActiveLayout('inbox')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    activeLayout === 'inbox' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                  title="Inbox-режим: список приоритизирован + превью кейса. Главный режим работы агента."
                >
                  <Inbox className="w-4 h-4" />
                  Inbox
                </button>
                <button
                  onClick={() => setActiveLayout('kanban')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    activeLayout === 'kanban' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                  title="Канбан-доска по статусам — для обзора процесса"
                >
                  <LayoutGrid className="w-4 h-4" />
                  Канбан
                </button>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <ArrowUpDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as CaseSortBy)}
                className="px-3 py-2 bg-white border border-[#e8edf3] rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                aria-label="Сортировка кейсов"
              >
                {CASE_SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Поиск кейсов..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 w-64 bg-white border border-[#e8edf3] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <button
              onClick={() => { setSelectionMode(s => !s); if (selectionMode) setSelectedIds(new Set()) }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectionMode
                  ? 'bg-blue-100 text-blue-700 border border-blue-200'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-[#e8edf3]'
              }`}
              title="Включить режим выбора нескольких кейсов"
            >
              <CheckCircle className="w-4 h-4" />
              {selectionMode ? `Выбрано: ${selectedIds.size}` : 'Выбрать'}
            </button>
            {viewMode === 'active' && (
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-[#3b82f6] to-[#2563eb] text-white shadow-[0_3px_10px_rgba(37,99,235,0.22)] rounded-lg hover:brightness-[1.04] hover:shadow-[0_5px_16px_rgba(37,99,235,0.34)] transition-all"
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
            { key: 'snoozed' as const, label: 'Отложенные', icon: Bell, count: snoozedCount },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setQuickFilter(f.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                quickFilter === f.key
                  ? f.danger ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-[#e8edf3]'
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
                : 'bg-white text-slate-600 hover:bg-slate-50 border border-[#e8edf3]'
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
            {/* Date Filter — пресеты + произвольный диапазон */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Период
              </label>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as DateFilterKey)}
                className="px-3 py-1.5 bg-white border border-[#e8edf3] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                {DATE_FILTERS.map(f => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>

            {dateFilter === 'custom' && (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">От</label>
                  <input
                    type="date"
                    value={customDateFrom}
                    onChange={(e) => setCustomDateFrom(e.target.value)}
                    className="px-3 py-1.5 bg-white border border-[#e8edf3] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">До</label>
                  <input
                    type="date"
                    value={customDateTo}
                    onChange={(e) => setCustomDateTo(e.target.value)}
                    className="px-3 py-1.5 bg-white border border-[#e8edf3] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </>
            )}
            
            {/* Category Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 flex items-center gap-1">
                <Tag className="w-3 h-3" />
                Категория
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-1.5 bg-white border border-[#e8edf3] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
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
                className="px-3 py-1.5 bg-white border border-[#e8edf3] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[200px]"
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
              <div className="inline-flex items-center bg-white border border-[#e8edf3] rounded-lg p-0.5">
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
        ) : viewMode === 'active' && activeLayout === 'inbox' ? (
          <CasesInboxView
            cases={activeCases}
            selectedCaseId={selectedCase?.id || null}
            onSelectCase={(id) => {
              const c = cases.find(x => x.id === id)
              if (c) setSelectedCase(c)
            }}
            onTakeNext={handleTakeNext}
            takeNextPending={takeNextPending}
            renderDetail={() => (
              <CaseDetailModal
                isOpen={true}
                onClose={() => setSelectedCase(null)}
                caseData={selectedCase ? mapCaseToCaseDetail(selectedCase) : null}
                agents={agents}
                currentUserName={currentUser?.name}
                mode="inline"
                onStatusChange={handleStatusChange}
                onAssign={handleAssign}
                onAddComment={handleAddComment}
                onSnoozeChange={(caseId, snoozedUntil) => {
                  setCases(prev => prev.map(c => c.id === caseId ? { ...c, snoozedUntil, isSnoozed: !!snoozedUntil && new Date(snoozedUntil) > new Date() } : c))
                  if (selectedCase?.id === caseId) {
                    setSelectedCase(prev => prev ? { ...prev, snoozedUntil, isSnoozed: !!snoozedUntil && new Date(snoozedUntil) > new Date() } : null)
                  }
                  loadCases()
                }}
                onDelete={() => setIsDeleteDialogOpen(true)}
              />
            )}
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

                  <div className="flex-1 bg-slate-50 border border-[#e8edf3] border-t-0 rounded-b-xl p-2 space-y-2 min-h-[260px]">
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
        currentUserName={currentUser?.name}
        onStatusChange={handleStatusChange}
        onAssign={handleAssign}
        onAddComment={handleAddComment}
        onSnoozeChange={(caseId, snoozedUntil) => {
          setCases(prev => prev.map(c => c.id === caseId ? { ...c, snoozedUntil, isSnoozed: !!snoozedUntil && new Date(snoozedUntil) > new Date() } : c))
          if (selectedCase?.id === caseId) {
            setSelectedCase(prev => prev ? { ...prev, snoozedUntil, isSnoozed: !!snoozedUntil && new Date(snoozedUntil) > new Date() } : null)
          }
          // Освежим counters
          loadCases()
        }}
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
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-white shadow-xl rounded-2xl border border-[#e8edf3] px-4 py-2 flex items-center gap-3">
          <span className="text-sm font-medium text-slate-700">
            Выбрано: <span className="text-blue-600">{selectedIds.size}</span>
          </span>
          <div className="h-6 w-px bg-slate-200" />

          <select
            disabled={bulkPending}
            onChange={(e) => { if (e.target.value) handleBulkStatus(e.target.value as CaseStatus); e.target.value = '' }}
            className="px-3 py-1.5 bg-white border border-[#e8edf3] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
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
            className="px-3 py-1.5 bg-white border border-[#e8edf3] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
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
