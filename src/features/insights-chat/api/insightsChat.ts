import { apiGet, apiPost, apiDelete } from '@/shared/services/api.service'
import type {
  InsightsMessage,
  InsightsSession,
  SendChatRequest,
  SendChatResponse,
} from '../model/types'

const ENDPOINT = '/ai/insights-chat'

export async function listSessions(): Promise<InsightsSession[]> {
  const data = await apiGet<{ sessions: InsightsSession[] }>(`${ENDPOINT}?list=1`, false)
  return data.sessions || []
}

export async function loadSession(
  sessionId: string,
): Promise<{ session: InsightsSession; messages: InsightsMessage[] }> {
  const data = await apiGet<{
    session: InsightsSession
    messages: InsightsMessage[]
  }>(`${ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`, false)
  return data
}

export async function sendChat(req: SendChatRequest): Promise<SendChatResponse> {
  return apiPost<SendChatResponse>(ENDPOINT, req)
}

export async function deleteSession(sessionId: string): Promise<void> {
  await apiDelete(`${ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`)
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  // Используем fetch напрямую — apiPatch в общем сервисе не определён.
  const token = localStorage.getItem('support_agent_token') || ''
  const orgId = localStorage.getItem('support_org_id') || ''
  const res = await fetch(`/api/support${ENDPOINT}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` }),
      ...(orgId && { 'X-Org-Id': orgId }),
    },
    body: JSON.stringify({ sessionId, title }),
  })
  if (!res.ok) throw new Error(`API Error: ${res.status}`)
}
