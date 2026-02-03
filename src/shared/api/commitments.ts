import { apiGet, apiPost, apiPut, apiDelete } from '../services/api.service'

export interface Commitment {
  id: string
  channelId: string
  channelName?: string
  caseId?: string
  messageId?: string
  text: string
  dueDate: string
  status: 'pending' | 'completed' | 'overdue' | 'cancelled'
  assignedTo?: string
  assigneeName?: string
  priority: 'low' | 'medium' | 'high'
  completedAt?: string
  notes?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export interface CommitmentsResponse {
  commitments: Commitment[]
  total: number
  overdue: number
  pending: number
  completed: number
}

/**
 * Получить список обязательств
 */
export async function fetchCommitments(options?: {
  channelId?: string
  caseId?: string
  status?: 'pending' | 'completed' | 'overdue' | 'all'
  assignedTo?: string
  limit?: number
  offset?: number
}): Promise<CommitmentsResponse> {
  const params = new URLSearchParams()
  if (options?.channelId) params.append('channelId', options.channelId)
  if (options?.caseId) params.append('caseId', options.caseId)
  if (options?.status) params.append('status', options.status)
  if (options?.assignedTo) params.append('assignedTo', options.assignedTo)
  if (options?.limit) params.append('limit', String(options.limit))
  if (options?.offset) params.append('offset', String(options.offset))
  
  return apiGet(`/commitments?${params}`)
}

/**
 * Создать обязательство
 */
export async function createCommitment(data: {
  channelId: string
  caseId?: string
  messageId?: string
  text: string
  dueDate: string
  assignedTo?: string
  priority?: 'low' | 'medium' | 'high'
}): Promise<{ success: boolean; commitment: Commitment }> {
  return apiPost('/commitments', data)
}

/**
 * Обновить обязательство
 */
export async function updateCommitment(
  id: string,
  data: Partial<{
    text: string
    dueDate: string
    status: 'pending' | 'completed' | 'cancelled'
    assignedTo: string
    priority: 'low' | 'medium' | 'high'
    notes: string
  }>
): Promise<{ success: boolean; commitment: Commitment }> {
  return apiPut(`/commitments?id=${id}`, data)
}

/**
 * Выполнить обязательство
 */
export async function completeCommitment(
  id: string,
  notes?: string
): Promise<{ success: boolean }> {
  return apiPut(`/commitments?id=${id}`, { status: 'completed', notes })
}

/**
 * Удалить/отменить обязательство
 */
export async function cancelCommitment(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/commitments?id=${id}`)
}
