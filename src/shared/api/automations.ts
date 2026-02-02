import { apiGet, apiPost, apiPut, apiDelete } from '../services/api.service'

export interface Automation {
  id: string
  name: string
  description: string
  triggerType: string
  triggerConfig: Record<string, unknown>
  actionType: string
  actionConfig: Record<string, unknown>
  isActive: boolean
  priority: number
  executionsCount: number
  lastExecutedAt: string | null
  createdAt: string
  updatedAt: string | null
}

interface AutomationsResponse {
  automations: Automation[]
  total: number
}

export async function fetchAutomations(): Promise<Automation[]> {
  const response = await apiGet<AutomationsResponse>('/automations')
  return response.automations
}

export async function createAutomation(data: {
  name: string
  description?: string
  triggerType: string
  triggerConfig?: Record<string, unknown>
  actionType: string
  actionConfig?: Record<string, unknown>
  priority?: number
}): Promise<{ success: boolean; automationId: string }> {
  return apiPost('/automations', data)
}

export async function updateAutomation(data: {
  id: string
  name?: string
  description?: string
  triggerConfig?: Record<string, unknown>
  actionConfig?: Record<string, unknown>
  isActive?: boolean
  priority?: number
}): Promise<{ success: boolean }> {
  return apiPut('/automations', data)
}

export async function deleteAutomation(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/automations?id=${id}`)
}

export async function toggleAutomation(id: string, isActive: boolean): Promise<{ success: boolean }> {
  return updateAutomation({ id, isActive })
}
