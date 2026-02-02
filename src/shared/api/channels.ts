import { apiGet, apiPost } from '../services/api.service'
import type { Channel } from '@/entities/channel'

export async function fetchChannels(): Promise<Channel[]> {
  return apiGet<{ channels: Channel[] }>('/channels').then(r => r.channels)
}

export async function fetchChannel(id: string): Promise<Channel> {
  return apiGet<{ channel: Channel }>(`/channels/${id}`).then(r => r.channel)
}

export async function markChannelRead(channelId: string): Promise<void> {
  await apiPost(`/channels/${channelId}/read`, {})
}

export async function updateChannelPhoto(channelId: string): Promise<string> {
  return apiPost<{ photoUrl: string }>(`/channels/update-photos`, { channelId })
    .then(r => r.photoUrl)
}
