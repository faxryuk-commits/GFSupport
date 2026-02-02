import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchChannels, markChannelRead } from '../api/channels'
import { useCache, type CachedChannel } from '../store'
import type { Channel } from '@/entities/channel'

const STALE_TIME = 2 * 60 * 1000 // 2 minutes

export function useChannels() {
  const cache = useCache()
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lastFetchRef = useRef<number>(0)

  const fromCache = useCallback((cached: CachedChannel[]): Channel[] => {
    return cached.map(c => ({
      id: c.id,
      telegramChatId: 0,
      name: c.name,
      type: c.type as Channel['type'],
      companyName: '',
      isActive: true,
      messagesCount: 0,
      unreadCount: c.unreadCount,
      lastMessageAt: c.lastMessageTime || null,
      lastMessageText: c.lastMessage || null,
      lastSenderName: null,
      awaitingReply: false,
      lastClientMessageAt: null,
      photoUrl: c.avatar
    }))
  }, [])

  const toCache = useCallback((channels: Channel[]): CachedChannel[] => {
    return channels.map(c => ({
      id: c.id,
      name: c.name,
      avatar: c.photoUrl,
      type: c.type,
      status: c.isActive ? 'active' : 'inactive',
      unreadCount: c.unreadCount,
      lastMessage: c.lastMessageText || undefined,
      lastMessageTime: c.lastMessageAt || undefined,
      updatedAt: Date.now()
    }))
  }, [])

  const load = useCallback(async (force = false) => {
    const cachedChannels = cache.getChannels()
    const now = Date.now()
    
    if (!force && cachedChannels.length > 0 && now - lastFetchRef.current < STALE_TIME) {
      setChannels(fromCache(cachedChannels))
      setLoading(false)
      return
    }

    if (cachedChannels.length > 0) {
      setChannels(fromCache(cachedChannels))
      setLoading(false)
    }

    try {
      if (!cache.state.isOnline) {
        if (cachedChannels.length === 0) setError('Нет подключения к сети')
        return
      }

      setError(null)
      const data = await fetchChannels()
      setChannels(data)
      cache.setChannels(toCache(data))
      lastFetchRef.current = now
    } catch {
      if (cachedChannels.length === 0) setError('Ошибка загрузки каналов')
    } finally {
      setLoading(false)
    }
  }, [cache, fromCache, toCache])

  useEffect(() => {
    load()
  }, [load])

  const markAsRead = useCallback(async (channelId: string) => {
    setChannels(prev => prev.map(c => c.id === channelId ? { ...c, unreadCount: 0 } : c))
    
    const channel = cache.getChannel(channelId)
    if (channel) cache.updateChannel({ ...channel, unreadCount: 0 })

    try {
      await markChannelRead(channelId)
    } catch {
      load(true)
    }
  }, [cache, load])

  const refresh = useCallback(() => load(true), [load])

  const awaitingCount = channels.filter(c => c.awaitingReply).length
  const unreadCount = channels.reduce((sum, c) => sum + c.unreadCount, 0)

  return {
    channels,
    loading,
    error,
    refresh,
    markAsRead,
    awaitingCount,
    unreadCount,
    isOffline: !cache.state.isOnline
  }
}
