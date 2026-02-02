import { apiGet, apiPost, apiPut, apiDelete, invalidateCache } from '../services/api.service'

export interface User {
  id: string
  telegramId?: number
  telegramUsername?: string
  name: string
  photoUrl?: string
  role: 'client' | 'employee' | 'partner'
  department?: string
  position?: string
  notes?: string
  channels: { id: string; name: string; addedAt: string }[]
  metrics?: Record<string, unknown>
  calculatedMetrics?: {
    total_messages: number
    responses: number
    avg_response_time_min: number
  } | null
  firstSeenAt?: string
  lastSeenAt?: string
}

export interface UsersResponse {
  users: User[]
  stats: {
    total: number
    byRole: Record<string, number>
  }
}

export interface CreateUserData {
  telegramId: number
  telegramUsername?: string
  name: string
  photoUrl?: string
  channelId?: string
  channelName?: string
}

export interface UpdateUserData {
  id?: string
  telegramId?: number
  role?: 'client' | 'employee' | 'partner'
  department?: string
  position?: string
  notes?: string
  isActive?: boolean
}

// Fetch all users with optional filters
export async function fetchUsers(params?: {
  role?: string
  channelId?: string
  search?: string
  metrics?: boolean
}): Promise<UsersResponse> {
  const searchParams = new URLSearchParams()
  if (params?.role) searchParams.set('role', params.role)
  if (params?.channelId) searchParams.set('channelId', params.channelId)
  if (params?.search) searchParams.set('search', params.search)
  if (params?.metrics) searchParams.set('metrics', 'true')
  
  const query = searchParams.toString()
  return apiGet<UsersResponse>(`/users${query ? `?${query}` : ''}`, false)
}

// Create a new user
export async function createUser(data: CreateUserData): Promise<{ success: boolean; action: string; userId: string }> {
  const result = await apiPost<{ success: boolean; action: string; userId: string }>('/users', data)
  invalidateCache('/users')
  return result
}

// Update user
export async function updateUser(data: UpdateUserData): Promise<{ success: boolean }> {
  const result = await apiPut<{ success: boolean }>('/users', data)
  invalidateCache('/users')
  return result
}

// Delete user (soft delete)
export async function deleteUser(id: string): Promise<{ success: boolean }> {
  const result = await apiDelete<{ success: boolean }>(`/users?id=${id}`)
  invalidateCache('/users')
  return result
}
