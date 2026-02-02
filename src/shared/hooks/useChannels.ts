import { useState, useEffect, useCallback } from 'react'
import { fetchChannels, markChannelRead } from '../api/channels'
import type { Channel } from '@/entities/channel'

export function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchChannels()
      setChannels(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const markAsRead = useCallback(async (channelId: string) => {
    await markChannelRead(channelId)
    setChannels(prev => prev.map(c => 
      c.id === channelId ? { ...c, unreadCount: 0 } : c
    ))
  }, [])

  const refresh = useCallback(() => {
    load()
  }, [load])

  // Computed values
  const awaitingCount = channels.filter(c => c.awaitingReply).length
  const unreadCount = channels.reduce((sum, c) => sum + c.unreadCount, 0)

  return {
    channels,
    loading,
    error,
    refresh,
    markAsRead,
    awaitingCount,
    unreadCount
  }
}
