import { useState, useEffect, useRef } from 'react'
import { Bell, X, AlertTriangle, Zap, FileWarning, Bot, Clock } from 'lucide-react'
import { fetchNotifications, markNotificationRead, markAllNotificationsRead, type AppNotification } from '@/shared/api'

const TYPE_CONFIG: Record<string, { icon: typeof Bell; color: string; label: string }> = {
  escalation: { icon: AlertTriangle, color: 'text-red-600 bg-red-50', label: 'Эскалация' },
  tag: { icon: Zap, color: 'text-amber-600 bg-amber-50', label: 'Тег' },
  critical_case: { icon: FileWarning, color: 'text-red-600 bg-red-50', label: 'Критичный кейс' },
  agent_decision: { icon: Bot, color: 'text-blue-600 bg-blue-50', label: 'AI Агент' },
  sla_breach: { icon: Clock, color: 'text-orange-600 bg-orange-50', label: 'SLA' },
}

export function NotificationBell({ agentId }: { agentId?: string }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  function load() {
    fetchNotifications(agentId)
      .then(r => { setNotifications(r.notifications); setUnreadCount(r.unreadCount) })
      .catch(() => {})
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [agentId])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleRead(id: string) {
    await markNotificationRead(id).catch(() => {})
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  async function handleReadAll() {
    if (!agentId) return
    await markAllNotificationsRead(agentId).catch(() => {})
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
    setUnreadCount(0)
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'сейчас'
    if (mins < 60) return `${mins} мин`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs} ч`
    return `${Math.floor(hrs / 24)} д`
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg hover:bg-slate-100 transition-colors"
      >
        <Bell className={`w-5 h-5 ${unreadCount > 0 ? 'text-blue-600' : 'text-slate-500'}`} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[380px] bg-white rounded-xl shadow-xl border border-slate-200 z-50 max-h-[480px] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Уведомления</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button onClick={handleReadAll} className="text-xs text-blue-600 hover:text-blue-700">
                  Прочитать все
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Нет уведомлений</p>
              </div>
            ) : (
              notifications.map(n => {
                const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.agent_decision
                const Icon = cfg.icon
                return (
                  <button
                    key={n.id}
                    onClick={() => handleRead(n.id)}
                    className={`w-full px-4 py-3 text-left border-b border-slate-50 hover:bg-slate-50 transition-colors ${!n.isRead ? 'bg-blue-50/40' : ''}`}
                  >
                    <div className="flex gap-3">
                      <span className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${cfg.color}`}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={`text-sm truncate ${!n.isRead ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                            {n.title}
                          </p>
                          <span className="text-[10px] text-slate-400 shrink-0 ml-2">{timeAgo(n.createdAt)}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.body}</p>
                        {n.channelName && (
                          <p className="text-[10px] text-slate-400 mt-1">📍 {n.channelName}</p>
                        )}
                      </div>
                      {!n.isRead && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-2" />}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
