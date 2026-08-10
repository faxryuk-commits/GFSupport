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
}

export interface ObPosSystem {
  id: string
  name: string
  isActive: boolean
}

export interface ObTask {
  id: string
  taskTypeId: string
  statusId: string | null
  assigneeName: string | null
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
  notes: string | null
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
  brands: ObBrand[]
}

export interface ObEvent {
  id: string
  brandId: string
  brandName?: string
  taskTypeId: string
  taskLabel: string | null
  oldStatusId: string | null
  oldLabel: string | null
  newStatusId: string | null
  newLabel: string | null
  changedBy: string | null
  changedAt: string
}

export function fetchOnboardingBoard(archived = false): Promise<ObBoard> {
  return apiGet(`/onboarding?archived=${archived}`, false)
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
}): Promise<{ success: boolean }> {
  return apiPut('/onboarding', data)
}

export function deleteBrand(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/onboarding?id=${encodeURIComponent(id)}`)
}

export function setTaskStatus(taskId: string, statusId: string): Promise<{ success: boolean }> {
  return apiPut('/onboarding/tasks', { taskId, statusId })
}

export function setTaskAssignee(taskId: string, assigneeName: string | null): Promise<{ success: boolean }> {
  return apiPut('/onboarding/tasks', { taskId, assigneeName })
}

export function fetchOnboardingEvents(brandId?: string, limit = 100): Promise<{ events: ObEvent[] }> {
  const params = new URLSearchParams()
  if (brandId) params.append('brandId', brandId)
  params.append('limit', String(limit))
  return apiGet(`/onboarding/tasks?${params}`, false)
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
