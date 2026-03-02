import { apiGet, apiPost, apiPut, apiDelete } from '@/shared/services/api.service'
import type {
  OnboardingConnection,
  OnboardingAnalytics,
  OnboardingComment,
  OnboardingTemplate,
  MyTask,
  NotificationRule,
  SLARule,
  CreateConnectionData
} from '@/entities/onboarding'

interface ConnectionsResponse {
  connections?: OnboardingConnection[]
  total?: number
}

export async function fetchConnections(filters?: {
  status?: string
  stage?: string
  assignedTo?: string
  ball?: string
  search?: string
  limit?: number
}): Promise<ConnectionsResponse> {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.stage) params.set('stage', filters.stage)
  if (filters?.assignedTo) params.set('assignedTo', filters.assignedTo)
  if (filters?.ball) params.set('ball', filters.ball)
  if (filters?.search) params.set('search', filters.search)
  if (filters?.limit) params.set('limit', String(filters.limit))

  const query = params.toString() ? `?${params}` : ''
  return apiGet<ConnectionsResponse>(`/onboarding${query}`)
}

export async function fetchConnection(id: string): Promise<OnboardingConnection> {
  return apiGet<{ connection?: OnboardingConnection }>(`/onboarding/${id}`).then(
    (r) => r.connection as OnboardingConnection
  )
}

export async function createConnection(
  data: CreateConnectionData
): Promise<OnboardingConnection> {
  return apiPost<{ connection?: OnboardingConnection }>('/onboarding', data).then(
    (r) => r.connection as OnboardingConnection
  )
}

export async function updateConnection(
  id: string,
  data: Partial<OnboardingConnection>
): Promise<OnboardingConnection> {
  return apiPut<{ connection?: OnboardingConnection }>(
    `/onboarding/${id}`,
    data
  ).then((r) => r.connection as OnboardingConnection)
}

export async function deleteConnection(id: string): Promise<void> {
  await apiDelete(`/onboarding/${id}`)
}

export async function completeStage(id: string): Promise<unknown> {
  return apiPut(`/onboarding/stages/${id}`, { status: 'completed' })
}

export async function revertStage(id: string): Promise<unknown> {
  return apiPut(`/onboarding/stages/${id}`, { status: 'in_progress' })
}

export async function updateTask(
  id: string,
  data: { status?: string; note?: string; assigned_agent_id?: string }
): Promise<unknown> {
  return apiPut(`/onboarding/tasks/${id}`, data)
}

export async function fetchMyTasks(): Promise<MyTask[]> {
  return apiGet<{ tasks?: MyTask[] }>('/onboarding/tasks/my').then(
    (r) => r.tasks ?? []
  )
}

export async function fetchTemplates(): Promise<OnboardingTemplate[]> {
  return apiGet<{ templates?: OnboardingTemplate[] }>('/onboarding/templates').then(
    (r) => r.templates ?? []
  )
}

export async function fetchTemplate(id: string): Promise<OnboardingTemplate> {
  return apiGet<{ template?: OnboardingTemplate }>(
    `/onboarding/templates/${id}`
  ).then((r) => r.template as OnboardingTemplate)
}

export async function createTemplate(
  data: Partial<OnboardingTemplate>
): Promise<OnboardingTemplate> {
  return apiPost<{ template?: OnboardingTemplate }>(
    '/onboarding/templates',
    data
  ).then((r) => r.template as OnboardingTemplate)
}

export async function updateTemplate(
  id: string,
  data: Partial<OnboardingTemplate>
): Promise<OnboardingTemplate> {
  return apiPut<{ template?: OnboardingTemplate }>(
    `/onboarding/templates/${id}`,
    data
  ).then((r) => r.template as OnboardingTemplate)
}

export async function deleteTemplate(id: string): Promise<void> {
  await apiDelete(`/onboarding/templates/${id}`)
}

export async function fetchComments(
  connectionId: string
): Promise<OnboardingComment[]> {
  return apiGet<{ comments?: OnboardingComment[] }>(
    `/onboarding/comments?connectionId=${connectionId}`
  ).then((r) => r.comments ?? [])
}

export async function addComment(
  connectionId: string,
  text: string
): Promise<OnboardingComment> {
  return apiPost<{ comment?: OnboardingComment }>('/onboarding/comments', {
    connectionId,
    text
  }).then((r) => r.comment as OnboardingComment)
}

export async function fetchOnboardingAnalytics(period?: {
  from?: string
  to?: string
}): Promise<OnboardingAnalytics> {
  const params = new URLSearchParams()
  if (period?.from) params.set('from', period.from)
  if (period?.to) params.set('to', period.to)
  const query = params.toString() ? `?${params}` : ''
  return apiGet<OnboardingAnalytics>(`/onboarding/analytics${query}`)
}

export async function fetchNotificationRules(): Promise<NotificationRule[]> {
  return apiGet<{ rules?: NotificationRule[] }>(
    '/onboarding/settings/notifications'
  ).then((r) => r.rules ?? [])
}

export async function updateNotificationRules(
  rules: NotificationRule[]
): Promise<NotificationRule[]> {
  return apiPut<{ rules?: NotificationRule[] }>(
    '/onboarding/settings/notifications',
    { rules }
  ).then((r) => r.rules ?? [])
}

export async function fetchSLARules(): Promise<SLARule[]> {
  return apiGet<{ rules?: SLARule[] }>('/onboarding/settings/sla').then(
    (r) => r.rules ?? []
  )
}

export async function updateSLARules(rules: SLARule[]): Promise<SLARule[]> {
  return apiPut<{ rules?: SLARule[] }>('/onboarding/settings/sla', {
    rules
  }).then((r) => r.rules ?? [])
}
