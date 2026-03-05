import { apiGet, apiPost, apiPut, apiDelete } from '../services/api.service'
import type { Case, CaseStatus } from '@/entities/case'

interface CasesResponse {
  cases: Case[]
  total: number
}

export interface CaseComment {
  id: string
  author: string
  authorId?: string
  text: string
  isInternal: boolean
  time: string
}

export async function fetchCases(filters?: {
  status?: CaseStatus | string
  assignedTo?: string
  channelId?: string
  category?: string
  limit?: number
}): Promise<CasesResponse> {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.assignedTo) params.set('assignedTo', filters.assignedTo)
  if (filters?.channelId) params.set('channelId', filters.channelId)
  if (filters?.category) params.set('category', filters.category)
  params.set('limit', String(filters?.limit || 500))
  
  const query = params.toString() ? `?${params}` : ''
  return apiGet<CasesResponse>(`/cases${query}`)
}

export async function fetchCase(id: string): Promise<Case> {
  return apiGet<{ case: Case }>(`/cases/${id}`).then(r => r.case)
}

export async function createCase(data: {
  title: string
  description?: string
  category?: string
  priority?: string
  channelId?: string
  companyName?: string
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

export async function deleteCase(id: string): Promise<void> {
  await apiDelete(`/cases?id=${id}`)
}

export async function addCaseComment(
  caseId: string,
  text: string,
  isInternal: boolean,
  authorName?: string,
  authorId?: string
): Promise<{ comments: CaseComment[] }> {
  return apiPut<{ comments: CaseComment[] }>(`/cases/${caseId}`, {
    id: caseId,
    action: 'add_comment',
    text,
    isInternal,
    authorName,
    authorId,
  })
}

export async function fetchCaseComments(caseId: string): Promise<CaseComment[]> {
  const res = await apiPut<{ comments: CaseComment[] }>(`/cases/${caseId}`, {
    id: caseId,
    action: 'get_comments',
  })
  return res.comments
}

export async function createCaseFromMessage(
  messageId: string,
  options?: { title?: string; description?: string; priority?: string }
): Promise<Case> {
  return apiPost<{ case: Case }>('/cases/from-message', { messageId, ...options })
    .then(r => r.case)
}
