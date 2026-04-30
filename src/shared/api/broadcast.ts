import { apiGet, apiPost, apiDelete } from '../services/api.service'

export interface ScheduledBroadcast {
  id: string
  messageText: string
  messageType: string
  notificationType: string
  filterType: string
  selectedChannels: string[]
  scheduledAt: string
  timezone: string
  // Совместимость со старым UI:
  status: 'pending' | 'sending' | 'processing' | 'sent' | 'cancelled' | 'failed'
  // Расширенный статус новой state machine:
  rawStatus?: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'sent'
  senderType: 'ai' | 'agent'
  senderId?: string
  senderName?: string
  mediaUrl?: string
  mediaType?: string
  createdBy: string
  createdAt: string
  sentAt: string | null
  startedAt?: string | null
  completedAt?: string | null
  broadcastId: string | null
  errorMessage: string | null
  recipientsCount: number
  deliveredCount: number
  failedCount: number
  queuedCount: number
  viewedCount: number
  reactionCount: number
}

interface BroadcastResponse {
  success: boolean
  scheduled: ScheduledBroadcast[]
}

export async function fetchBroadcasts(params?: {
  status?: 'pending' | 'sent' | 'all'
  from?: string
  to?: string
}): Promise<ScheduledBroadcast[]> {
  const query = new URLSearchParams()
  if (params?.status) query.set('status', params.status)
  if (params?.from) query.set('from', params.from)
  if (params?.to) query.set('to', params.to)

  const queryStr = query.toString() ? `?${query}` : ''
  const response = await apiGet<BroadcastResponse>(`/broadcast/schedule${queryStr}`, false)
  return response.scheduled || []
}

export interface CreateBroadcastData {
  messageText: string
  messageType?: string
  notificationType?: string
  filterType?: string
  selectedChannels?: string[]
  scheduledAt?: string
  sendNow?: boolean
  timezone?: string
  senderType?: 'ai' | 'agent'
  senderId?: string
  senderName?: string
  mediaUrl?: string
  mediaType?: string
  createdBy?: string
}

export async function createBroadcast(data: CreateBroadcastData): Promise<{
  success: boolean
  id: string
  recipientsCount?: number
  scheduledAt?: string
  sendNow?: boolean
}> {
  return apiPost('/broadcast/schedule', data)
}

export async function cancelBroadcast(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/broadcast/schedule?id=${id}`)
}

export async function stopAllBroadcasts(): Promise<{ success: boolean; cancelled: number }> {
  return apiDelete('/broadcast/schedule?stopAll=true')
}

// ---------- Прогресс / получатели / повтор ---------------------------------

export interface BroadcastProgress {
  broadcast: {
    id: string
    status: string
    recipientsCount: number
    deliveredCount: number
    failedCount: number
    queuedCount: number
    startedAt: string | null
    completedAt: string | null
    lastWorkerAt: string | null
    scheduledAt: string
    errorMessage: string | null
  }
  totals: {
    queued: number
    sending: number
    delivered: number
    failed: number
    skipped: number
    total: number
  }
  errors: Array<{ code: string; count: number }>
}

export async function fetchBroadcastProgress(id: string): Promise<BroadcastProgress> {
  const r = await apiGet<{ success: boolean } & BroadcastProgress>(
    `/broadcast/progress?id=${encodeURIComponent(id)}`,
    false,
  )
  return { broadcast: r.broadcast, totals: r.totals, errors: r.errors || [] }
}

export interface BroadcastRecipient {
  id: string
  channelId: string
  channelName: string | null
  status: 'queued' | 'sending' | 'delivered' | 'failed' | 'skipped'
  attempts: number
  errorCode: string | null
  errorMessage: string | null
  lastAttemptAt: string | null
  deliveredAt: string | null
  telegramMessageId: number | null
}

export async function fetchBroadcastRecipients(
  id: string,
  status?: 'queued' | 'sending' | 'delivered' | 'failed' | 'skipped' | 'all',
  search?: string,
  limit = 100,
  offset = 0,
): Promise<{ items: BroadcastRecipient[]; total: number }> {
  const params = new URLSearchParams({ id, limit: String(limit), offset: String(offset) })
  if (status) params.set('status', status)
  if (search && search.trim()) params.set('search', search.trim())
  const r = await apiGet<{ success: boolean; items: BroadcastRecipient[]; total: number }>(
    `/broadcast/recipients?${params}`,
    false,
  )
  return { items: r.items || [], total: r.total || 0 }
}

export async function retryBroadcast(
  id: string,
  scope: 'failed' | 'all' = 'failed',
): Promise<{ success: boolean; requeued: number }> {
  return apiPost('/broadcast/retry', { id, scope })
}

export async function cloneUndeliveredBroadcast(data: {
  sourceId: string
  scope?: 'undelivered' | 'failed' | 'skipped' | 'queued'
  overrideText?: string
  sendNow?: boolean
  scheduledAt?: string
  createdBy?: string
}): Promise<{
  success: boolean
  id?: string
  recipientsCount?: number
  message?: string
  error?: string
}> {
  return apiPost('/broadcast/clone-undelivered', data)
}
