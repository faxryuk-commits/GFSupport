import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listSessions,
  loadSession,
  sendChat,
  deleteSession as apiDeleteSession,
  renameSession as apiRenameSession,
} from '../api/insightsChat'
import type { InsightsMessage, InsightsSession } from './types'

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
        { id: assistantTempId, role: 'assistant', content: '', pending: true },
      ],
    }))

    try {
      const resp = await sendChat({
        sessionId: activeRef.current || undefined,
        message,
        period: state.period,
        source: state.source,
      })
      setState((s) => {
        const isNew = !s.activeSessionId
        return {
          ...s,
          sending: false,
          activeSessionId: resp.sessionId,
          messages: s.messages
            .filter((m) => m.id !== assistantTempId)
            .concat({
              id: resp.assistantMessage.id,
              role: 'assistant',
              content: resp.assistantMessage.content,
              toolCalls: resp.assistantMessage.toolCalls || [],
              createdAt: resp.assistantMessage.createdAt,
            }),
          // Обновим список сессий на лету (опционально перезагрузим).
          sessions: isNew && resp.isNewSession
            ? [
                {
                  id: resp.sessionId,
                  title: message.slice(0, 60),
                  updatedAt: new Date().toISOString(),
                },
                ...s.sessions,
              ]
            : s.sessions.map((sess) =>
                sess.id === resp.sessionId
                  ? { ...sess, updatedAt: new Date().toISOString() }
                  : sess,
              ),
        }
      })
    } catch (e: any) {
      setState((s) => ({
        ...s,
        sending: false,
        error: e?.message || 'Не удалось отправить сообщение',
        messages: s.messages.map((m) =>
          m.id === assistantTempId
            ? { ...m, pending: false, error: true, content: e?.message || 'Ошибка ответа' }
            : m,
        ),
      }))
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
