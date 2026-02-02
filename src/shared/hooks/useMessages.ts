import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchMessages, sendMessage, sendMediaMessage } from '../api/messages'
import { useCache, type CachedMessage } from '../store'
import type { Message } from '@/entities/message'

const STALE_TIME = 30 * 1000 // 30 seconds

export function useMessages(channelId: string | null) {
  const cache = useCache()
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lastFetchRef = useRef<Record<string, number>>({})

  const fromCache = useCallback((cached: CachedMessage[]): Message[] => {
    return cached.map(m => ({
      id: m.id,
      channelId: m.channelId,
      telegramMessageId: 0,
      senderId: parseInt(m.senderId) || undefined,
      senderName: m.senderName,
      senderPhotoUrl: m.senderAvatar,
      senderRole: m.isClient ? 'client' : 'support' as const,
      isFromTeam: !m.isClient,
      text: m.text,
      isRead: true,
      createdAt: new Date(m.timestamp).toISOString()
    }))
  }, [])

  const toCache = useCallback((messages: Message[], chId: string): CachedMessage[] => {
    return messages.map(m => ({
      id: m.id,
      channelId: chId,
      senderId: m.senderId?.toString() || '',
      senderName: m.senderName,
      senderAvatar: m.senderPhotoUrl || undefined,
      text: m.text,
      time: new Date(m.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      timestamp: new Date(m.createdAt).getTime(),
      isClient: m.senderRole === 'client',
      status: m.isRead ? 'read' : 'delivered'
    }))
  }, [])

  const load = useCallback(async (force = false) => {
    if (!channelId) return
    
    const now = Date.now()
    const lastFetch = lastFetchRef.current[channelId] || 0
    const cachedMessages = cache.getMessages(channelId)
    
    if (!force && cachedMessages.length > 0 && now - lastFetch < STALE_TIME) {
      setMessages(fromCache(cachedMessages))
      setLoading(false)
      return
    }

    if (cachedMessages.length > 0) {
      setMessages(fromCache(cachedMessages))
    } else {
      setLoading(true)
    }

    try {
      if (!cache.state.isOnline) {
        if (cachedMessages.length === 0) setError('Нет подключения к сети')
        setLoading(false)
        return
      }

      setError(null)
      const data = await fetchMessages(channelId, { limit: 50 })
      setMessages(data.messages)
      setHasMore(data.hasMore)
      cache.setMessages(channelId, toCache(data.messages, channelId))
      lastFetchRef.current[channelId] = now
    } catch {
      if (cachedMessages.length === 0) setError('Ошибка загрузки сообщений')
    } finally {
      setLoading(false)
    }
  }, [channelId, cache, fromCache, toCache])

  useEffect(() => {
    if (channelId) {
      load()
    } else {
      setMessages([])
    }
  }, [channelId, load])

  const loadMore = useCallback(async () => {
    if (!channelId || loadingMore || !hasMore || messages.length === 0) return
    
    const oldestMessage = messages[0]
    
    try {
      setLoadingMore(true)
      const data = await fetchMessages(channelId, { limit: 50, before: oldestMessage.createdAt })
      const newMessages = [...data.messages, ...messages]
      setMessages(newMessages)
      setHasMore(data.hasMore)
      cache.setMessages(channelId, toCache(newMessages, channelId))
    } catch {
      console.error('Failed to load more messages')
    } finally {
      setLoadingMore(false)
    }
  }, [channelId, loadingMore, hasMore, messages, cache, toCache])

  const send = useCallback(async (text: string, attachments?: File[]) => {
    if (!channelId) return

    const optimisticMessage: Message = {
      id: `temp-${Date.now()}`,
      channelId,
      telegramMessageId: 0,
      senderName: 'Вы',
      senderRole: 'support',
      isFromTeam: true,
      text,
      isRead: false,
      createdAt: new Date().toISOString()
    }

    setMessages(prev => [...prev, optimisticMessage])

    try {
      let message: Message
      
      if (attachments && attachments.length > 0) {
        const formData = new FormData()
        formData.append('channelId', channelId)
        formData.append('text', text)
        attachments.forEach(file => formData.append('files', file))
        message = await sendMediaMessage(channelId, formData)
      } else {
        message = await sendMessage(channelId, text)
      }

      setMessages(prev => {
        const updated = prev.filter(m => m.id !== optimisticMessage.id)
        return [...updated, message]
      })

      cache.addMessage(channelId, toCache([message], channelId)[0])
    } catch {
      setMessages(prev => prev.filter(m => m.id !== optimisticMessage.id))
      throw new Error('Не удалось отправить сообщение')
    }
  }, [channelId, cache, toCache])

  const addMessage = useCallback((message: Message) => {
    setMessages(prev => [...prev, message])
    if (channelId) {
      cache.addMessage(channelId, toCache([message], channelId)[0])
    }
  }, [channelId, cache, toCache])

  return {
    messages,
    loading,
    loadingMore,
    hasMore,
    error,
    refresh: () => load(true),
    loadMore,
    send,
    addMessage,
    isOffline: !cache.state.isOnline
  }
}
