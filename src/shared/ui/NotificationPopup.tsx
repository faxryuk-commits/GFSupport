import { useState, useEffect, createContext, useContext, useCallback } from 'react'
import type { ReactNode } from 'react'
import { X, MessageSquare, AlertCircle, Bell, ExternalLink } from 'lucide-react'
import { Avatar } from './Avatar'

export type NotificationType = 'message' | 'ticket' | 'alert'

export interface NotificationData {
  id: string
  type: NotificationType
  title: string
  message: string
  senderName?: string
  senderAvatar?: string
  channelName?: string
  channelId?: string
  ticketNumber?: string
  caseId?: string
  timestamp: Date
  onClick?: () => void
}

interface NotificationContextType {
  notifications: NotificationData[]
  showNotification: (data: Omit<NotificationData, 'id' | 'timestamp'>) => void
  dismissNotification: (id: string) => void
  clearAll: () => void
}

const NotificationContext = createContext<NotificationContextType | null>(null)

export function useNotification() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('useNotification must be used within NotificationProvider')
  return context
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationData[]>([])

  const showNotification = useCallback((data: Omit<NotificationData, 'id' | 'timestamp'>) => {
    const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const notification: NotificationData = {
      ...data,
      id,
      timestamp: new Date()
    }
    
    setNotifications(prev => [...prev, notification])
    
    // Автоматическое скрытие через 8 секунд
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id))
    }, 8000)

    // Браузерное уведомление (если разрешено)
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(data.title, {
        body: data.message,
        icon: '/favicon.ico',
        tag: id,
      })
    }

    // Звук уведомления
    try {
      const audio = new Audio('/notification.mp3')
      audio.volume = 0.3
      audio.play().catch(() => {})
    } catch (e) { /* ignore */ }
  }, [])

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    setNotifications([])
  }, [])

  // Запросить разрешение на браузерные уведомления
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  return (
    <NotificationContext.Provider value={{ notifications, showNotification, dismissNotification, clearAll }}>
      {children}
      <NotificationContainer 
        notifications={notifications} 
        onDismiss={dismissNotification} 
      />
    </NotificationContext.Provider>
  )
}

function NotificationContainer({ 
  notifications, 
  onDismiss 
}: { 
  notifications: NotificationData[]
  onDismiss: (id: string) => void 
}) {
  if (notifications.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[200] space-y-3 max-w-md w-full pointer-events-none">
      {notifications.map(notification => (
        <NotificationItem 
          key={notification.id} 
          notification={notification} 
          onDismiss={() => onDismiss(notification.id)} 
        />
      ))}
    </div>
  )
}

function NotificationItem({ 
  notification, 
  onDismiss 
}: { 
  notification: NotificationData
  onDismiss: () => void 
}) {
  const [isExiting, setIsExiting] = useState(false)

  const handleDismiss = () => {
    setIsExiting(true)
    setTimeout(onDismiss, 200)
  }

  const handleClick = () => {
    notification.onClick?.()
    handleDismiss()
  }

  const getIcon = () => {
    switch (notification.type) {
      case 'message':
        return <MessageSquare className="w-5 h-5 text-blue-500" />
      case 'ticket':
        return <AlertCircle className="w-5 h-5 text-orange-500" />
      case 'alert':
        return <Bell className="w-5 h-5 text-red-500" />
    }
  }

  const getBgColor = () => {
    switch (notification.type) {
      case 'message': return 'bg-gradient-to-r from-blue-50 to-white border-blue-200'
      case 'ticket': return 'bg-gradient-to-r from-orange-50 to-white border-orange-200'
      case 'alert': return 'bg-gradient-to-r from-red-50 to-white border-red-200'
    }
  }

  return (
    <div 
      className={`
        pointer-events-auto
        ${getBgColor()}
        border rounded-xl shadow-xl p-4
        transform transition-all duration-200 ease-out
        ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}
        animate-slide-in-right
        cursor-pointer hover:shadow-2xl
      `}
      onClick={handleClick}
    >
      <div className="flex items-start gap-3">
        {/* Аватар или иконка */}
        {notification.senderAvatar || notification.senderName ? (
          <Avatar 
            src={notification.senderAvatar} 
            name={notification.senderName || 'User'} 
            size="md" 
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
            {getIcon()}
          </div>
        )}

        {/* Контент */}
        <div className="flex-1 min-w-0">
          {/* Заголовок */}
          <div className="flex items-center gap-2 mb-1">
            {notification.type === 'message' && notification.senderName && (
              <span className="font-semibold text-slate-800 truncate">
                {notification.senderName}
              </span>
            )}
            {notification.type === 'ticket' && notification.ticketNumber && (
              <span className="font-semibold text-orange-600">
                #{notification.ticketNumber}
              </span>
            )}
            {notification.channelName && (
              <span className="text-xs text-slate-500 truncate">
                • {notification.channelName}
              </span>
            )}
          </div>

          {/* Заголовок уведомления */}
          <p className="text-sm font-medium text-slate-700 mb-0.5">
            {notification.title}
          </p>

          {/* Превью сообщения */}
          <p className="text-sm text-slate-600 line-clamp-2">
            {notification.message}
          </p>

          {/* Время */}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-slate-400">
              {notification.timestamp.toLocaleTimeString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}
            </span>
            {notification.onClick && (
              <span className="text-xs text-blue-500 flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />
                Открыть
              </span>
            )}
          </div>
        </div>

        {/* Кнопка закрытия */}
        <button 
          onClick={(e) => { e.stopPropagation(); handleDismiss() }}
          className="p-1 hover:bg-slate-200/50 rounded-full transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4 text-slate-400" />
        </button>
      </div>
    </div>
  )
}

// CSS для анимации (добавить в index.css)
// @keyframes slide-in-right {
//   from { opacity: 0; transform: translateX(100%); }
//   to { opacity: 1; transform: translateX(0); }
// }
// .animate-slide-in-right { animation: slide-in-right 0.3s ease-out; }
