import { apiGet, apiPost, apiPut, apiDelete } from '../services/api.service'

export interface Reminder {
  id: string
  channelId: string
  channelName?: string
  caseId?: string
  text: string
  remindAt: string
  type: 'follow_up' | 'deadline' | 'check_in' | 'custom'
  status: 'pending' | 'sent' | 'snoozed' | 'dismissed'
  assignedTo?: string
  assigneeName?: string
  notifyViaTelegram: boolean
  notifyInApp: boolean
  sentAt?: string
  snoozeUntil?: string
  createdBy?: string
  createdAt: string
}

export interface RemindersResponse {
  reminders: Reminder[]
  total: number
  pending: number
  upcoming: number  // в ближайшие 24 часа
}

/**
 * Получить список напоминаний
 */
export async function fetchReminders(options?: {
  channelId?: string
  caseId?: string
  status?: 'pending' | 'sent' | 'all'
  assignedTo?: string
  upcoming?: boolean  // только ближайшие 24 часа
  limit?: number
}): Promise<RemindersResponse> {
  const params = new URLSearchParams()
  if (options?.channelId) params.append('channelId', options.channelId)
  if (options?.caseId) params.append('caseId', options.caseId)
  if (options?.status) params.append('status', options.status)
  if (options?.assignedTo) params.append('assignedTo', options.assignedTo)
  if (options?.upcoming) params.append('upcoming', 'true')
  if (options?.limit) params.append('limit', String(options.limit))
  
  return apiGet(`/reminders?${params}`)
}

/**
 * Создать напоминание
 */
export async function createReminder(data: {
  channelId: string
  caseId?: string
  text: string
  remindAt: string
  type?: 'follow_up' | 'deadline' | 'check_in' | 'custom'
  assignedTo?: string
  notifyViaTelegram?: boolean
  notifyInApp?: boolean
}): Promise<{ success: boolean; reminder: Reminder }> {
  return apiPost('/reminders', data)
}

/**
 * Отложить напоминание
 */
export async function snoozeReminder(
  id: string,
  snoozeMinutes: number = 30
): Promise<{ success: boolean; snoozeUntil: string }> {
  return apiPut(`/reminders?id=${id}`, { 
    action: 'snooze', 
    snoozeMinutes 
  })
}

/**
 * Отклонить напоминание
 */
export async function dismissReminder(id: string): Promise<{ success: boolean }> {
  return apiPut(`/reminders?id=${id}`, { status: 'dismissed' })
}

/**
 * Удалить напоминание
 */
export async function deleteReminder(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/reminders?id=${id}`)
}

/**
 * Тестовое напоминание (для проверки)
 */
export async function testReminder(
  channelId: string,
  text: string
): Promise<{ success: boolean; sent: boolean }> {
  return apiPost('/reminders/test', { channelId, text })
}
