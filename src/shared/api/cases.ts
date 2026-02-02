import { apiGet, apiPost, apiPut } from '../services/api.service'
import type { Case, CaseStatus } from '@/entities/case'

interface CasesResponse {
  cases: Case[]
  total: number
}

export async function fetchCases(filters?: {
  status?: CaseStatus
  assignedTo?: string
  channelId?: string
}): Promise<CasesResponse> {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.assignedTo) params.set('assignedTo', filters.assignedTo)
  if (filters?.channelId) params.set('channelId', filters.channelId)
  
  const query = params.toString() ? `?${params}` : ''
  return apiGet<CasesResponse>(`/cases${query}`)
}

export async function fetchCase(id: string): Promise<Case> {
  return apiGet<{ case: Case }>(`/cases/${id}`).then(r => r.case)
}

export async function createCase(data: {
  channelId: string
  title: string
  description?: string
  category?: string
  priority?: string
}): Promise<Case> {
  return apiPost<{ case: Case }>('/cases', data).then(r => r.case)
}

export async function updateCase(id: string, data: Partial<Case>): Promise<Case> {
  return apiPut<{ case: Case }>(`/cases/${id}`, data).then(r => r.case)
}

export async function updateCaseStatus(
  id: string, 
  status: CaseStatus
): Promise<Case> {
  return updateCase(id, { status })
}

export async function assignCase(
  id: string, 
  agentId: string
): Promise<Case> {
  return updateCase(id, { assignedTo: agentId })
}

export async function createCaseFromMessage(messageId: string): Promise<Case> {
  return apiPost<{ case: Case }>('/cases/from-message', { messageId })
    .then(r => r.case)
}
