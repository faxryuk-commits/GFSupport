import { apiGet, apiPost, apiPut, apiDelete } from '../services/api.service'
import type { Channel } from '../types'

export interface ChannelsResponse {
  channels: Channel[]
  total: number
  /** Есть ещё страницы (при limit/offset) */
  hasMore?: boolean
  limit?: number
  offset?: number
  stats: {
    [key: string]: { total: number; active: number }
  }
}

/**
 * Загружает все каналы организации одним запросом (limit=1000).
 * Если каналов больше 1000, догружает следующие страницы.
 */
export async function fetchChannels(): Promise<Channel[]> {
  const PAGE = 1000
  const first = await apiGet<ChannelsResponse>(`/channels?limit=${PAGE}`, false)
  if (!first.hasMore) return first.channels

  const all = [...first.channels]
  let offset = PAGE
  while (all.length < (first.total || Infinity)) {
    const r = await apiGet<ChannelsResponse>(`/channels?limit=${PAGE}&offset=${offset}`, false)
    all.push(...r.channels)
    if (!r.hasMore || r.channels.length === 0) break
    offset += PAGE
  }
  return all
}

export async function fetchChannelsWithStats(): Promise<ChannelsResponse> {
  const PAGE = 1000
  const first = await apiGet<ChannelsResponse>(`/channels?limit=${PAGE}`, false)
  if (!first.hasMore) return first

  const channels = [...first.channels]
  let offset = PAGE
  while (channels.length < (first.total || Infinity)) {
    const r = await apiGet<ChannelsResponse>(`/channels?limit=${PAGE}&offset=${offset}`, false)
    channels.push(...r.channels)
    if (!r.hasMore || r.channels.length === 0) break
    offset += PAGE
  }
  return { ...first, channels, hasMore: false }
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
