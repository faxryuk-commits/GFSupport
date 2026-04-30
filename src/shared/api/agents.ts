import { apiGet, apiPost, apiPut } from '../services/api.service'
import type { Agent } from '../types'

interface AgentsResponse {
  agents: Agent[]
}

export async function fetchAgents(): Promise<Agent[]> {
  return apiGet<AgentsResponse>('/agents').then(r => r.agents)
}

export async function fetchAgent(id: string): Promise<Agent> {
  return apiGet<{ agent: Agent }>(`/agents/${id}`).then(r => r.agent)
}

export async function updateAgent(id: string, data: {
  name?: string
  username?: string
  email?: string
  role?: string
  password?: string
  phone?: string
  permissions?: string[]
}): Promise<void> {
  await apiPut('/agents', { id, ...data })
}

export async function createAgent(data: {
  name: string
  username?: string
  email?: string
  role?: string
  password?: string
  phone?: string
  permissions?: string[]
}): Promise<{ agentId: string }> {
  return apiPost('/agents', data)
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
  const token = localStorage.getItem('support_agent_token') || ''
  const m = token.match(/^agent_([^_]+)_/)
  const agentId = m?.[1]

  await apiPost('/agents/bind', {
    agentId,
    telegramId: telegramData.id,
    telegramUsername: telegramData.username,
  })
}

// ---------- Shadow agents (отвечают, но не зарегистрированы) -------------

export interface ShadowSender {
  senderId: string
  senderName: string | null
  senderUsername: string | null
  messages: number
  channels: number
  firstSeen: string
  lastSeen: string
  possibleMatches: Array<{
    id: string
    name: string
    username: string | null
    telegramId: string | null
  }>
  canBindBy: string
}

export async function fetchShadowAgents(days = 30): Promise<{
  total: number
  hint: string
  shadowSenders: ShadowSender[]
}> {
  return apiGet(`/agents/unregistered?days=${days}`)
}

export async function restoreShadowAgent(data: {
  senderId: string
  senderName?: string
  senderUsername?: string
  telegramId?: string
  role?: string
}): Promise<{
  success: boolean
  action: 'restored' | 'already_exists'
  agent: { id: string; name: string; username: string | null; telegramId: string | null }
  messagesAttached: number
  message?: string
  error?: string
}> {
  return apiPost('/agents/restore', data)
}
