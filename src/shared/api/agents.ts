import { apiGet, apiPost } from '../services/api.service'
import type { Agent } from '@/entities/agent'

interface AgentsResponse {
  agents: Agent[]
}

export async function fetchAgents(): Promise<Agent[]> {
  return apiGet<AgentsResponse>('/agents').then(r => r.agents)
}

export async function fetchAgent(id: string): Promise<Agent> {
  return apiGet<{ agent: Agent }>(`/agents/${id}`).then(r => r.agent)
}

export async function loginAgent(
  username: string, 
  password: string
): Promise<{ token: string; agent: Agent }> {
  return apiPost('/agents/login', { username, password })
}

export async function updateAgentActivity(): Promise<void> {
  await apiPost('/agents/activity', {})
}

export async function bindTelegramAccount(telegramData: {
  id: number
  username?: string
  first_name?: string
}): Promise<void> {
  await apiPost('/agents/bind', telegramData)
}
