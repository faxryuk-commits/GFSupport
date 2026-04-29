import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listSessions,
  loadSession,
  streamChat,
  deleteSession as apiDeleteSession,
  renameSession as apiRenameSession,
} from '../api/insightsChat'
import type { InsightsMessage, InsightsSession, InsightsToolCall } from './types'

export interface UseInsightsChatState {
  sessions: InsightsSession[]
  activeSessionId: string | null
  messages: InsightsMessage[]
  loadingSessions: boolean
  loadingMessages: boolean
  sending: boolean
  error: string | null
  period: string
  source: 'all' | 'telegram' | 'whatsapp'
}

const DEFAULT_PERIOD = '7d'
const DEFAULT_SOURCE: 'all' = 'all'

function genTempId(prefix: string): string {
  return `tmp_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function useInsightsChat() {
  const [state, setState] = useState<UseInsightsChatState>({
    sessions: [],
    activeSessionId: null,
    messages: [],
    loadingSessions: false,
    loadingMessages: false,
    sending: false,
    error: null,
    period: DEFAULT_PERIOD,
    source: DEFAULT_SOURCE,
  })

  // anti-stale-callback: используем ref на актуальный sessionId.
  const activeRef = useRef<string | null>(null)
  activeRef.current = state.activeSessionId

  const refreshSessions = useCallback(async () => {
    setState((s) => ({ ...s, loadingSessions: true }))
    try {
      const sessions = await listSessions()
      setState((s) => ({ ...s, sessions, loadingSessions: false }))
    } catch (e: any) {
      setState((s) => ({ ...s, loadingSessions: false, error: e?.message || 'Не удалось загрузить сессии' }))
    }
  }, [])

  const openSession = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      setState((s) => ({ ...s, activeSessionId: null, messages: [] }))
      return
    }
    setState((s) => ({ ...s, activeSessionId: sessionId, loadingMessages: true, messages: [] }))
    try {
      const { session, messages } = await loadSession(sessionId)
      setState((s) => ({
        ...s,
        loadingMessages: false,
        messages,
        period: session.periodDefault || s.period,
        source: (session.sourceDefault as any) || s.source,
      }))
    } catch (e: any) {
      setState((s) => ({ ...s, loadingMessages: false, error: e?.message || 'Не удалось открыть сессию' }))
    }
  }, [])

  const startNewSession = useCallback(() => {
    setState((s) => ({ ...s, activeSessionId: null, messages: [], error: null }))
  }, [])

  const send = useCallback(async (text: string) => {
    const message = text.trim()
    if (!message) return
    const userTempId = genTempId('user')
    const assistantTempId = genTempId('assistant')

    setState((s) => ({
      ...s,
      sending: true,
      error: null,
      messages: [
        ...s.messages,
        { id: userTempId, role: 'user', content: message },
        { id: assistantTempId, role: 'assistant', content: '', pending: true, toolCalls: [] },
      ],
    }))

    let liveContent = ''
    const liveToolCalls: InsightsToolCall[] = []
    let createdSessionId: string | null = activeRef.current
    let isNewSession = false

    function patchAssistant(patch: Partial<InsightsMessage>) {
      setState((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === assistantTempId ? { ...m, ...patch } : m,
        ),
      }))
    }

    try {
      await streamChat(
        {
          sessionId: activeRef.current || undefined,
          message,
          period: state.period,
          source: state.source,
        },
        {
          onReady: (d) => {
            createdSessionId = d.sessionId
            isNewSession = d.isNewSession
            setState((s) => ({ ...s, activeSessionId: d.sessionId }))
            activeRef.current = d.sessionId
          },
          onToolStart: (c) => {
            // Показываем pending-карточку tool-вызова сразу.
            liveToolCalls.push({
              id: c.id,
              name: c.name,
              args: c.args,
              result: { _running: true },
              durationMs: 0,
            })
            patchAssistant({ pending: true, toolCalls: [...liveToolCalls] })
          },
          onToolEnd: (c) => {
            const idx = liveToolCalls.findIndex((x) => x.id === c.id)
            if (idx >= 0) liveToolCalls[idx] = c
            else liveToolCalls.push(c)
            patchAssistant({ pending: true, toolCalls: [...liveToolCalls] })
          },
          onToken: (delta) => {
            liveContent += delta
            patchAssistant({ pending: false, content: liveContent })
          },
          onDone: (d) => {
            patchAssistant({
              id: d.messageId,
              pending: false,
              content: d.content || liveContent,
              toolCalls: d.toolCalls && d.toolCalls.length ? d.toolCalls : liveToolCalls,
              createdAt: d.createdAt,
            })
          },
          onError: (msg) => {
            patchAssistant({ pending: false, error: true, content: msg })
          },
        },
      )

      // Обновляем список сессий после успешного ответа.
      setState((s) => {
        const sid = createdSessionId
        if (!sid) return { ...s, sending: false }
        const exists = s.sessions.some((x) => x.id === sid)
        const sessions = exists
          ? s.sessions.map((x) =>
              x.id === sid ? { ...x, updatedAt: new Date().toISOString() } : x,
            )
          : isNewSession
          ? [
              {
                id: sid,
                title: message.slice(0, 60),
                updatedAt: new Date().toISOString(),
              },
              ...s.sessions,
            ]
          : s.sessions
        return { ...s, sending: false, sessions }
      })
    } catch (e: any) {
      patchAssistant({
        pending: false,
        error: true,
        content: e?.message || 'Не удалось получить ответ',
      })
      setState((s) => ({ ...s, sending: false, error: e?.message || 'stream failed' }))
    }
  }, [state.period, state.source])

  const setPeriod = useCallback((period: string) => {
    setState((s) => ({ ...s, period }))
  }, [])

  const setSource = useCallback((source: 'all' | 'telegram' | 'whatsapp') => {
    setState((s) => ({ ...s, source }))
  }, [])

  const removeSession = useCallback(async (sessionId: string) => {
    try {
      await apiDeleteSession(sessionId)
      setState((s) => ({
        ...s,
        sessions: s.sessions.filter((x) => x.id !== sessionId),
        activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
        messages: s.activeSessionId === sessionId ? [] : s.messages,
      }))
    } catch (e: any) {
      setState((s) => ({ ...s, error: e?.message || 'Не удалось удалить сессию' }))
    }
  }, [])

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    try {
      await apiRenameSession(sessionId, title)
      setState((s) => ({
        ...s,
        sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, title } : x)),
      }))
    } catch (e: any) {
      setState((s) => ({ ...s, error: e?.message || 'Не удалось переименовать' }))
    }
  }, [])

  useEffect(() => { refreshSessions() }, [refreshSessions])

  return {
    state,
    refreshSessions,
    openSession,
    startNewSession,
    send,
    setPeriod,
    setSource,
    removeSession,
    renameSession,
  }
}
