import { apiGet, apiPut } from '../services/api.service'

export interface AppNotification {
  id: string
  type: 'escalation' | 'tag' | 'critical_case' | 'agent_decision' | 'sla_breach'
  title: string
  body: string
  priority: string
  channelId?: string
  channelName?: string
  senderName?: string
  isRead: boolean
  createdAt: string
}

export function fetchNotifications(agentId?: string, unread?: boolean) {
  const params = new URLSearchParams()
  if (agentId) params.set('agentId', agentId)
  if (unread) params.set('unread', 'true')
  return apiGet<{ notifications: AppNotification[]; unreadCount: number }>(`/notifications?${params}`)
}

export function markNotificationRead(notificationId: string) {
  return apiPut('/notifications', { action: 'read', notificationId })
}

export function markAllNotificationsRead(agentId: string) {
  return apiPut('/notifications', { action: 'read_all', agentId })
}
