import { apiGet, apiPost, apiDelete } from '@/shared/services/api.service'
import type {
  InsightsMessage,
  InsightsSession,
  InsightsToolCall,
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
  return apiPost<SendChatResponse>(ENDPOINT, { ...req, stream: false })
}

export async function deleteSession(sessionId: string): Promise<void> {
  await apiDelete(`${ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`)
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
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

// ---------- streaming ----------------------------------------------------

export interface StreamHandlers {
  onReady?: (data: { sessionId: string; isNewSession: boolean }) => void
  onToolStart?: (call: { id: string; name: string; args: unknown }) => void
  onToolEnd?: (call: InsightsToolCall) => void
  onToken?: (delta: string) => void
  onDone?: (data: {
    messageId: string
    content: string
    toolCalls: InsightsToolCall[]
    createdAt: string
  }) => void
  onError?: (message: string) => void
}

export async function streamChat(
  req: SendChatRequest,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = localStorage.getItem('support_agent_token') || ''
  const orgId = localStorage.getItem('support_org_id') || ''

  const res = await fetch(`/api/support${ENDPOINT}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token && { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` }),
      ...(orgId && { 'X-Org-Id': orgId }),
    },
    body: JSON.stringify({ ...req, stream: true }),
    signal,
  })

  if (!res.ok || !res.body) {
    let msg = `API Error: ${res.status}`
    try { const j = await res.json(); msg = j.message || j.error || msg } catch {}
    throw new Error(msg)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // События разделены пустой строкой (\n\n).
    let sep
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)

      let event = 'message'
      let dataLines: string[] = []
      for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim()
        else if (line.startsWith('data: ')) dataLines.push(line.slice(6))
      }
      const dataStr = dataLines.join('\n')
      let data: any = null
      try { data = dataStr ? JSON.parse(dataStr) : null } catch {}

      switch (event) {
        case 'ready': handlers.onReady?.(data); break
        case 'tool_start': handlers.onToolStart?.(data); break
        case 'tool_end': handlers.onToolEnd?.(data); break
        case 'token': handlers.onToken?.(data?.delta || ''); break
        case 'done': handlers.onDone?.(data); break
        case 'error': handlers.onError?.(data?.message || 'stream error'); break
      }
    }
  }
}
