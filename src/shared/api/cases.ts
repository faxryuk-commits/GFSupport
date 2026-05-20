import { apiGet, apiPost, apiPut, apiDelete } from '../services/api.service'
import type { Case, CaseStatus } from '../types'

export interface CaseStats {
  [status: string]: number
}

export interface CaseResolutionMetrics {
  periodDays: number
  resolvedCount: number
  shadowCount: number
  avgMinutes: number | null
  maxMinutes: number | null
  medianMinutes: number | null
  p95Minutes: number | null
  avgHours: number | null
  maxHours: number | null
  medianHours: number | null
  p95Hours: number | null
}

export interface CasesResponse {
  cases: Case[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  stats: CaseStats
  metrics: CaseResolutionMetrics
  overdueCount: number
  snoozedCount: number
}

export interface CaseComment {
  id: string
  author: string
  authorId?: string
  text: string
  isInternal: boolean
  time: string
}

export interface CaseActivity {
  id: string
  type: string
  title?: string
  description?: string
  fromStatus?: string | null
  toStatus?: string | null
  managerId?: string | null
  managerName?: string | null
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface CasesFilters {
  status?: CaseStatus | 'active' | 'archive' | string
  statuses?: CaseStatus[]
  priorities?: string[]
  assignedTo?: string
  unassigned?: boolean
  channelId?: string
  category?: string
  search?: string
  source?: 'telegram' | 'whatsapp'
  dateFrom?: string
  dateTo?: string
  overdue?: boolean
  snoozed?: 'hide' | 'only' | 'include'
  sortBy?: 'priority' | 'created_desc' | 'created_asc' | 'last_activity'
  limit?: number
  offset?: number
  metricsPeriodDays?: number
}

export async function fetchCases(filters?: CasesFilters): Promise<CasesResponse> {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.statuses?.length) params.set('status', filters.statuses.join(','))
  if (filters?.priorities?.length) params.set('priority', filters.priorities.join(','))
  if (filters?.assignedTo) params.set('assignedTo', filters.assignedTo)
  if (filters?.unassigned) params.set('unassigned', 'true')
  if (filters?.channelId) params.set('channelId', filters.channelId)
  if (filters?.category) params.set('category', filters.category)
  if (filters?.search) params.set('search', filters.search)
  if (filters?.source) params.set('source', filters.source)
  if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters?.dateTo) params.set('dateTo', filters.dateTo)
  if (filters?.overdue) params.set('overdue', 'true')
  if (filters?.snoozed) params.set('snoozed', filters.snoozed)
  if (filters?.sortBy) params.set('sortBy', filters.sortBy)
  if (filters?.metricsPeriodDays) params.set('metricsPeriodDays', String(filters.metricsPeriodDays))
  params.set('limit', String(filters?.limit ?? 100))
  params.set('offset', String(filters?.offset ?? 0))

  const query = params.toString() ? `?${params}` : ''
  return apiGet<CasesResponse>(`/cases${query}`)
}

export async function fetchCase(id: string): Promise<Case> {
  return apiGet<{ case: Case }>(`/cases/${id}`).then(r => r.case)
}

export async function fetchCaseActivities(id: string): Promise<CaseActivity[]> {
  return apiGet<{ activities: CaseActivity[] }>(`/cases/${id}`)
    .then(r => r.activities || [])
    .catch(() => [])
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

/**
 * Отложить кейс до указанной даты (или снять snooze, передав null).
 * После snoozedUntil кейс сам вернётся в активную выдачу.
 */
export async function snoozeCase(
  id: string,
  snoozedUntil: string | null,
  reason?: string,
  by?: string,
): Promise<{ success: boolean; snoozedUntil: string | null }> {
  return apiPut<{ success: boolean; snoozedUntil: string | null }>(`/cases/${id}`, {
    action: 'snooze',
    snoozedUntil,
    reason,
    by,
  })
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

export interface CustomerContext {
  channel: {
    id: string
    name: string
    source: string
    type: string
    companyId?: string
    telegramChatId?: number
    market?: string
    createdAt: string
  }
  stats: {
    total: number
    active: number
    resolved: number
    cancelled: number
    recurring: number
    shadow: number
    last7d: number
    last30d: number
    avgResolutionMinutes: number | null
    avgResolutionHours: number | null
    lastResolvedAt: string | null
  }
  recentResolved: Array<{
    id: string
    ticketNumber?: number
    title: string
    description?: string
    resolutionNotes?: string | null
    category?: string
    priority: string
    resolvedAt: string
    resolvedInMinutes: number | null
  }>
  activeCases: Array<{
    id: string
    ticketNumber?: number
    title: string
    status: string
    priority: string
    createdAt: string
    ageHours: number | null
  }>
  health: {
    band: 'critical' | 'at_risk' | 'healthy' | 'loyal' | string
    score: number | null
    openCases: number
    churnSignals: number
  } | null
}

export async function fetchCustomerContext(
  channelId: string,
  excludeCaseId?: string,
): Promise<CustomerContext> {
  const params = new URLSearchParams({ channelId })
  if (excludeCaseId) params.set('excludeCaseId', excludeCaseId)
  return apiGet<CustomerContext>(`/cases/customer-context?${params}`)
}

export interface RelatedCase {
  id: string
  ticketNumber?: number
  title: string
  description?: string
  resolutionNotes?: string | null
  category?: string
  priority: string
  resolvedAt: string
  resolvedInMinutes: number | null
  score?: number
  matchedKeywords?: string[]
  channelName?: string
  isRecurring?: boolean
}

export async function fetchRelatedCases(caseId: string, limit = 5): Promise<{
  related: RelatedCase[]
  method?: string
  tokens?: string[]
}> {
  const params = new URLSearchParams({ caseId, limit: String(limit) })
  return apiGet<{ related: RelatedCase[]; method?: string; tokens?: string[] }>(`/cases/related?${params}`)
}

export interface TakeNextResult {
  case: Case | null
  reason?: 'urgent_overdue' | 'mine_overdue' | 'overdue' | 'urgent' | 'mine' | 'unassigned_new' | 'normal' | 'queue_empty'
  updated?: boolean
}

export async function takeNextCase(agentId: string, options?: {
  autoAssign?: boolean
  autoStart?: boolean
}): Promise<TakeNextResult> {
  return apiPost<TakeNextResult>('/cases/next', {
    agentId,
    autoAssign: options?.autoAssign ?? true,
    autoStart: options?.autoStart ?? true,
  })
}
