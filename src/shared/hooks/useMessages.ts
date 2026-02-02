import { useState, useEffect, useCallback } from 'react'
import { fetchMessages, sendMessage, sendMediaMessage } from '../api/messages'
import type { Message } from '@/entities/message'

export function useMessages(channelId: string | null) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!channelId) return
    
    try {
      setLoading(true)
      setError(null)
      const data = await fetchMessages(channelId, { limit: 50 })
      setMessages(data.messages)
      setHasMore(data.hasMore)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [channelId])

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
      const data = await fetchMessages(channelId, { 
        limit: 50, 
        before: oldestMessage.createdAt 
      })
      setMessages(prev => [...data.messages, ...prev])
      setHasMore(data.hasMore)
    } catch (e: any) {
      console.error('Failed to load more:', e)
    } finally {
      setLoadingMore(false)
    }
  }, [channelId, loadingMore, hasMore, messages])

  const send = useCallback(async (text: string, attachments?: File[]) => {
    if (!channelId) return

    if (attachments && attachments.length > 0) {
      // Send with media
      const formData = new FormData()
      formData.append('channelId', channelId)
      formData.append('text', text)
      attachments.forEach(file => formData.append('files', file))
      
      const message = await sendMediaMessage(channelId, formData)
      setMessages(prev => [...prev, message])
    } else {
      // Send text only
      const message = await sendMessage(channelId, text)
      setMessages(prev => [...prev, message])
    }
  }, [channelId])

  const addMessage = useCallback((message: Message) => {
    setMessages(prev => [...prev, message])
  }, [])

  return {
    messages,
    loading,
    loadingMore,
    hasMore,
    error,
    refresh: load,
    loadMore,
    send,
    addMessage
  }
}
