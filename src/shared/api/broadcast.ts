import { apiGet, apiPost, apiDelete } from '../services/api.service'

export interface ScheduledBroadcast {
  id: string
  messageText: string
  messageType: string
  filterType: string
  selectedChannels: string[]
  scheduledAt: string
  timezone: string
  status: 'pending' | 'sent' | 'cancelled' | 'failed'
  createdBy: string
  createdAt: string
  sentAt: string | null
  broadcastId: string | null
  errorMessage: string | null
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
  const response = await apiGet<BroadcastResponse>(`/broadcast/schedule${queryStr}`)
  return response.scheduled || []
}

export async function createBroadcast(data: {
  messageText: string
  messageType?: string
  filterType?: string
  selectedChannels?: string[]
  scheduledAt: string
  timezone?: string
  createdBy?: string
}): Promise<{ success: boolean; id: string }> {
  return apiPost('/broadcast/schedule', data)
}

export async function cancelBroadcast(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/broadcast/schedule?id=${id}`)
}
