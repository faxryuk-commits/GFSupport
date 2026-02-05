import { useEffect, useRef, useCallback } from 'react'

interface Channel {
  id: string
  name: string
  unread: number
}

// Звук уведомления - простой beep
function playNotificationBeep() {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    
    // Resume if suspended (user interaction already happened)
    if (audioContext.state === 'suspended') {
      audioContext.resume()
    }
    
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()
    
    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    
    // Three quick beeps
    const now = audioContext.currentTime
    for (let i = 0; i < 3; i++) {
      const osc = audioContext.createOscillator()
      const gain = audioContext.createGain()
      
      osc.connect(gain)
      gain.connect(audioContext.destination)
      
      osc.frequency.value = 880
      osc.type = 'sine'
      
      const start = now + i * 0.12
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.15, start + 0.02)
      gain.gain.linearRampToValueAtTime(0, start + 0.08)
      
      osc.start(start)
      osc.stop(start + 0.1)
    }
  } catch (e) {
    // Audio not supported
  }
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
      let hasNewMessages = false
      let newMessageChannel: Channel | null = null
      
      channels.forEach((ch: Channel) => {
        const prevUnread = lastChannelUnreadsRef.current.get(ch.id) || 0
        if (ch.unread > prevUnread) {
          hasNewMessages = true
          newMessageChannel = ch
        }
        lastChannelUnreadsRef.current.set(ch.id, ch.unread)
      })
      
      // Show notification and play sound when tab is hidden
      if (hasNewMessages && document.visibilityState === 'hidden') {
        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted' && newMessageChannel) {
          new Notification(`Новое сообщение: ${newMessageChannel.name}`, {
            body: `${newMessageChannel.unread} непрочитанных`,
            icon: '/favicon.ico',
            tag: `channel-${newMessageChannel.id}`,
            requireInteraction: true, // Keep notification until user interacts
          })
        }
        
        // Play sound even when tab is hidden
        playNotificationBeep()
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
      
      worker.onmessage = handleWorkerMessage
      
      // Get API base URL
      const apiBase = window.location.origin
      worker.postMessage({ type: 'start', data: { apiBase } })
      
      return () => {
        worker.postMessage({ type: 'stop' })
        worker.terminate()
      }
    } catch (e) {
      console.log('Web Worker not supported, falling back to regular polling')
    }
  }, [handleWorkerMessage])
  
  return null
}
