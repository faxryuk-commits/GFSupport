import { apiGet, apiPost, apiPut, apiDelete } from '../services/api.service'
import type { Channel } from '@/entities/channel'

export interface ChannelsResponse {
  channels: Channel[]
  total: number
  stats: {
    [key: string]: { total: number; active: number }
  }
}

export async function fetchChannels(options?: { limit?: number }): Promise<Channel[]> {
  const limit = options?.limit || 200
  return apiGet<ChannelsResponse>(`/channels?limit=${limit}`).then(r => r.channels)
}

export async function fetchChannelsWithStats(options?: { limit?: number }): Promise<ChannelsResponse> {
  const limit = options?.limit || 200
  return apiGet<ChannelsResponse>(`/channels?limit=${limit}`)
}

export async function fetchChannel(id: string): Promise<Channel> {
  return apiGet<{ channel: Channel }>(`/channels/${id}`).then(r => r.channel)
}

export async function markChannelRead(channelId: string): Promise<void> {
  await apiPost('/channels/mark-read', { channelId })
}

export async function updateChannel(channelId: string, data: {
  name?: string
  type?: 'client' | 'partner' | 'internal'
  slaCategory?: 'client' | 'client_integration' | 'partner' | 'internal'
  isActive?: boolean
}): Promise<void> {
  await apiPut('/channels', { id: channelId, ...data })
}

export async function disconnectChannel(channelId: string): Promise<void> {
  await apiDelete(`/channels?id=${channelId}`)
}

export async function updateChannelPhoto(channelId: string): Promise<string> {
  return apiPost<{ photoUrl: string }>(`/channels/update-photos`, { channelId })
    .then(r => r.photoUrl)
}
