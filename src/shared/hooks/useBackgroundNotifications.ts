import { useEffect, useRef, useCallback } from 'react'
import { playMessageSoundIfEnabled } from '@/shared/lib'

interface Channel {
  id: string
  name: string
  unread: number
}

export function useBackgroundNotifications() {
  const workerRef = useRef<Worker | null>(null)
  const lastUnreadRef = useRef<number>(0)
  const lastChannelUnreadsRef = useRef<Map<string, number>>(new Map())
  
  const handleWorkerMessage = useCallback((e: MessageEvent) => {
    const { type, data } = e.data
    
    if (type === 'channels' && data?.channels) {
      const channels: Channel[] = data.channels
      const totalUnread = channels.reduce((sum: number, ch: Channel) => sum + (ch.unread || 0), 0)
      
      // Check for new messages
      let newMessageChannel: Channel | null = null
      
      for (const ch of channels) {
        const prevUnread = lastChannelUnreadsRef.current.get(ch.id) || 0
        if (ch.unread > prevUnread) {
          newMessageChannel = ch
        }
        lastChannelUnreadsRef.current.set(ch.id, ch.unread)
      }
      
      // Show notification and play sound when tab is hidden
      if (newMessageChannel && document.visibilityState === 'hidden') {
        const channel = newMessageChannel as Channel
        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`Новое сообщение: ${channel.name}`, {
            body: `${channel.unread} непрочитанных`,
            icon: '/favicon.ico',
            tag: `channel-${channel.id}`,
            requireInteraction: true, // Keep notification until user interacts
          })
        }
        
        // Play sound even when tab is hidden
        playMessageSoundIfEnabled()
      }
      
      lastUnreadRef.current = totalUnread
    }
  }, [])
  
  useEffect(() => {
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
    
    // Start Web Worker for background polling
    try {
      const worker = new Worker('/notification-worker.js')
      workerRef.current = worker
      
      worker.onmessage = (e: MessageEvent) => {
        const { type } = e.data
        
        // Handle auth error - token might be expired
        if (type === 'authError') {
          console.log('[Notifications] Auth error in worker, token may be expired')
          return
        }
        
        handleWorkerMessage(e)
      }
      
      // Get API base URL and auth token
      const apiBase = window.location.origin
      const token = localStorage.getItem('support_agent_token') || ''
      
      if (token) {
        worker.postMessage({ type: 'start', data: { apiBase, token } })
      }
      
      // Listen for storage changes (login/logout in other tabs)
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === 'support_agent_token') {
          const newToken = e.newValue || ''
          worker.postMessage({ type: 'updateToken', data: { token: newToken } })
          
          // Restart polling if token appeared
          if (newToken && !e.oldValue) {
            worker.postMessage({ type: 'start', data: { apiBase, token: newToken } })
          } else if (!newToken) {
            worker.postMessage({ type: 'stop' })
          }
        }
      }
      window.addEventListener('storage', handleStorageChange)
      
      return () => {
        window.removeEventListener('storage', handleStorageChange)
        worker.postMessage({ type: 'stop' })
        worker.terminate()
      }
    } catch (e) {
      console.log('Web Worker not supported, falling back to regular polling')
    }
  }, [handleWorkerMessage])
  
  return null
}
