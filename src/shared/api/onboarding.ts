import { apiGet, apiPost, apiPut, apiDelete } from '../services/api.service'

export interface ObStatus {
  id: string
  label: string
  /** Семантика для метрик: todo | active | waiting | done | cancelled | na */
  kind: string
  color: string
  sortOrder: number
  isActive: boolean
}

export interface ObTaskType {
  id: string
  label: string
  sortOrder: number
  isActive: boolean
  /** Категория провайдеров для этой колонки (в ячейке можно выбрать опцию) */
  optionCategoryId: string | null
  /** Блок запуска («1 · Компания и филиал» …) — группировка чек-листа */
  groupLabel: string | null
  /** Норматив дней на этап; больше — этап «застрял» (null = общие пороги) */
  targetDays: number | null
  /** Владелец процесса: отвечает за задачу, когда исполнитель не назначен */
  ownerAgentId: string | null
  ownerName: string | null
}

export interface ObPosSystem {
  id: string
  name: string
  isActive: boolean
}

export interface ObOptionCategory {
  id: string
  label: string
  sortOrder: number
  isActive: boolean
}

export interface ObOption {
  id: string
  categoryId: string
  label: string
  sortOrder: number
  isActive: boolean
  /** Регионы поставщика (id рынков через запятую; null — все регионы) */
  markets: string | null
}

export interface ObTask {
  id: string
  taskTypeId: string
  statusId: string | null
  assigneeId: string | null
  assigneeName: string | null
  optionId: string | null
  /** Кого ждём при статусе «Ждем данные»: us | client | provider */
  waitingOn: string | null
  statusSince: string
  activeSeconds: number
  waitingSeconds: number
}

export interface ObBrand {
  id: string
  name: string
  posId: string | null
  channelId: string | null
  ownerName: string | null
  assigneeId: string | null
  assigneeName: string | null
  nextStep: string | null
  /** Тариф из заявки (справочник «Тарифы») */
  tariff: string | null
  /** Дедлайн запуска (yyyy-mm-dd) */
  launchDue: string | null
  /** Регион бренда (id рынка из справочника; null — без региона, виден всегда) */
  marketId: string | null
  /** Тип подключения: delivery | aggregators | kiosk | upsell */
  connectionType: string | null
  /** Апсейл: исходный бренд клиента */
  parentBrandId: string | null
  parentName: string | null
  dependsOn: string | null
  blockers: string | null
  notes: string | null
  /** Участники проекта: назначенные вручную + все, кто действовал в карточке */
  participants: { agentId: string | null; name: string }[]
  commentsCount: number
  openTodosCount: number
  startedAt: string
  archivedAt: string | null
  createdAt: string
  tasks: ObTask[]
}

export interface ObBoard {
  statuses: ObStatus[]
  taskTypes: ObTaskType[]
  posSystems: ObPosSystem[]
  posTaskMap: { posId: string; taskTypeId: string }[]
  optionCategories: ObOptionCategory[]
  options: ObOption[]
  brands: ObBrand[]
}

export interface ObEvent {
  id: string
  brandId: string
  brandName?: string
  taskTypeId: string
  taskLabel: string | null
  optionLabel: string | null
  oldStatusId: string | null
  oldLabel: string | null
  newStatusId: string | null
  newLabel: string | null
  changedBy: string | null
  changedAt: string
}

export interface ObComment {
  id: string
  authorId: string | null
  authorName: string | null
  text: string
  createdAt: string
}

export interface ObTodo {
  id: string
  text: string
  assigneeId: string | null
  assigneeName: string | null
  dueAt: string | null
  doneAt: string | null
  createdBy: string | null
  createdAt: string
}

export interface ObStageStat {
  id: string
  label: string
  done: number
  active: number
  waiting: number
  todo: number
  avgActiveSeconds: number
  maxActiveSeconds: number
  avgWaitingSeconds: number
  maxWaitingSeconds: number
}

export interface ObPersonStat {
  name: string
  events: number
  completed: number
  /** Среднее время закрытия этапа (сек) — рейтинг скорости */
  avgCloseSeconds: number | null
  openTasks: number
  lastActivity: string | null
}

export interface ObBrandStat {
  id: string
  name: string
  assigneeName: string | null
  startedAt: string
  ageSeconds: number
  done: number
  total: number
  hasBlockers: boolean
}

export interface ObStuckTask {
  brandName: string
  taskLabel: string
  statusLabel: string
  kind: string
  assigneeName: string | null
  seconds: number
}

export interface ObStats {
  stages: ObStageStat[]
  people: ObPersonStat[]
  brands: ObBrandStat[]
  stuck: ObStuckTask[]
}

export function fetchOnboardingBoard(archived = false): Promise<ObBoard> {
  return apiGet(`/onboarding?archived=${archived}`, false)
}

export function fetchOnboardingStats(): Promise<ObStats> {
  return apiGet('/onboarding/stats', false)
}

export interface ObLaunch {
  name: string
  launchedAt: string
  startedAt: string | null
  days: number | null
  tariff: string | null
  owner: string | null
}

export interface ObLaunches {
  periods: Array<{ key: string; label: string; from: string | null; brands: ObLaunch[] }>
  inProgress: Array<{ name: string; started_at: string; owner_name: string | null; done: number; total: number }>
  avgDays: number | null
}

/** Сколько брендов запущено и кто именно — по календарным периодам. */
export function fetchOnboardingLaunches(): Promise<ObLaunches> {
  return apiGet('/onboarding/launches', false)
}

export function createBrand(data: {
  name: string
  posId?: string | null
  ownerName?: string | null
  channelId?: string | null
  notes?: string | null
  marketId?: string | null
}): Promise<{ success: boolean; id: string }> {
  return apiPost('/onboarding', data)
}

export function updateBrand(data: {
  id: string
  name?: string
  posId?: string | null
  ownerName?: string | null
  channelId?: string | null
  notes?: string | null
  archived?: boolean
  tariff?: string | null
  launchDue?: string | null
  assigneeId?: string | null
  assigneeName?: string | null
  nextStep?: string | null
  dependsOn?: string | null
  blockers?: string | null
  marketId?: string | null
  connectionType?: string | null
  parentBrandId?: string | null
}): Promise<{ success: boolean }> {
  return apiPut('/onboarding', data)
}

/** Заявка от продаж: тапы превращаются в проект с ТЗ. */
export function createIntake(data: {
  name: string
  posId?: string | null
  tariff?: string | null
  launchDue?: string | null
  assigneeId?: string | null
  notes?: string | null
  marketId?: string | null
  connectionType?: string | null
  parentBrandId?: string | null
  selections: Record<string, string[]>
}): Promise<{ success: boolean; id: string }> {
  return apiPost('/onboarding/intake', data)
}

export function deleteBrand(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/onboarding?id=${encodeURIComponent(id)}`)
}

export function setTaskStatus(taskId: string, statusId: string): Promise<{ success: boolean }> {
  return apiPut('/onboarding/tasks', { taskId, statusId })
}

export function setTaskAssignee(taskId: string, assigneeId: string | null): Promise<{ success: boolean }> {
  return apiPut('/onboarding/tasks', { taskId, assigneeId })
}

export function setTaskOption(taskId: string, optionId: string | null): Promise<{ success: boolean }> {
  return apiPut('/onboarding/tasks', { taskId, optionId })
}

export function setTaskWaitingOn(taskId: string, waitingOn: string | null): Promise<{ success: boolean }> {
  return apiPut('/onboarding/tasks', { taskId, waitingOn })
}

/** Добавить в ячейку под-задачу поставщика (свой статус/таймер/исполнитель). */
export function addProviderTask(brandId: string, taskTypeId: string, optionId: string | null): Promise<{ success: boolean; id: string }> {
  return apiPost('/onboarding/tasks', { brandId, taskTypeId, optionId })
}

export function deleteTask(taskId: string): Promise<{ success: boolean }> {
  return apiDelete(`/onboarding/tasks?taskId=${encodeURIComponent(taskId)}`)
}

export interface ObEventsQuery {
  brandId?: string
  limit?: number
  offset?: number
  /** yyyy-mm-dd (рабочая tz) */
  from?: string
  to?: string
  /** kind нового статуса: done | active | waiting | todo | cancelled */
  kind?: string
  actor?: string
}

export function fetchOnboardingEvents(opts: ObEventsQuery = {}): Promise<{ events: ObEvent[]; hasMore: boolean }> {
  const params = new URLSearchParams()
  if (opts.brandId) params.append('brandId', opts.brandId)
  params.append('limit', String(opts.limit ?? 100))
  if (opts.offset) params.append('offset', String(opts.offset))
  if (opts.from) params.append('from', opts.from)
  if (opts.to) params.append('to', opts.to)
  if (opts.kind) params.append('kind', opts.kind)
  if (opts.actor) params.append('actor', opts.actor)
  return apiGet(`/onboarding/tasks?${params}`, false)
}

// Карточка: комментарии и мини-задачи
export function fetchBrandCard(brandId: string): Promise<{ comments: ObComment[]; todos: ObTodo[] }> {
  return apiGet(`/onboarding/card?brandId=${encodeURIComponent(brandId)}`, false)
}

export function addBrandParticipant(brandId: string, agentId: string): Promise<{ success: boolean }> {
  return apiPost('/onboarding/card', { brandId, participant: { agentId } })
}

export function addBrandComment(brandId: string, comment: string): Promise<{ success: boolean; id: string }> {
  return apiPost('/onboarding/card', { brandId, comment })
}

export function deleteBrandComment(commentId: string): Promise<{ success: boolean }> {
  return apiDelete(`/onboarding/card?commentId=${encodeURIComponent(commentId)}`)
}

export function addBrandTodo(brandId: string, todo: {
  text: string
  assigneeId?: string | null
  dueAt?: string | null
}): Promise<{ success: boolean; id: string }> {
  return apiPost('/onboarding/card', { brandId, todo })
}

export function updateBrandTodo(todoId: string, patch: {
  done?: boolean
  text?: string
  assigneeId?: string | null
  dueAt?: string | null
}): Promise<{ success: boolean }> {
  return apiPut('/onboarding/card', { todoId, ...patch })
}

export function deleteBrandTodo(todoId: string): Promise<{ success: boolean }> {
  return apiDelete(`/onboarding/card?todoId=${encodeURIComponent(todoId)}`)
}

// Справочники
export function createRefItem(data: Record<string, unknown>): Promise<{ success: boolean; id: string }> {
  return apiPost('/onboarding/refs', data)
}

export function updateRefItem(data: Record<string, unknown>): Promise<{ success: boolean }> {
  return apiPut('/onboarding/refs', data)
}

export function deleteRefItem(kind: string, id: string): Promise<{ success: boolean; softDeleted?: boolean }> {
  return apiDelete(`/onboarding/refs?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`)
}
