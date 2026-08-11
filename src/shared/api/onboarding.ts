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
  dependsOn: string | null
  blockers: string | null
  notes: string | null
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

export function createBrand(data: {
  name: string
  posId?: string | null
  ownerName?: string | null
  channelId?: string | null
  notes?: string | null
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
  assigneeId?: string | null
  assigneeName?: string | null
  nextStep?: string | null
  dependsOn?: string | null
  blockers?: string | null
}): Promise<{ success: boolean }> {
  return apiPut('/onboarding', data)
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

export function fetchOnboardingEvents(brandId?: string, limit = 100): Promise<{ events: ObEvent[] }> {
  const params = new URLSearchParams()
  if (brandId) params.append('brandId', brandId)
  params.append('limit', String(limit))
  return apiGet(`/onboarding/tasks?${params}`, false)
}

// Карточка: комментарии и мини-задачи
export function fetchBrandCard(brandId: string): Promise<{ comments: ObComment[]; todos: ObTodo[] }> {
  return apiGet(`/onboarding/card?brandId=${encodeURIComponent(brandId)}`, false)
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
