const API_BASE = '/api/support'

interface CacheItem {
  data: unknown
  timestamp: number
}

const cache = new Map<string, CacheItem>()
const CACHE_TTL = 5000 // 5 seconds

function getToken(): string {
  return localStorage.getItem('support_agent_token') || ''
}

function getHeaders(): HeadersInit {
  const token = getToken()
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` })
  }
}

export async function apiGet<T>(endpoint: string, useCache = true): Promise<T> {
  const cacheKey = endpoint
  
  if (useCache) {
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data as T
    }
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: getHeaders()
  })
  
  if (!res.ok) {
    throw new Error(`API Error: ${res.status}`)
  }
  
  const data = await res.json()
  cache.set(cacheKey, { data, timestamp: Date.now() })
  return data
}

export async function apiPost<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body)
  })
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `API Error: ${res.status}`)
  }
  
  return res.json()
}

export async function apiPut<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(body)
  })
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `API Error: ${res.status}`)
  }
  
  return res.json()
}

export async function apiDelete<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'DELETE',
    headers: getHeaders()
  })
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `API Error: ${res.status}`)
  }
  
  return res.json()
}

export async function apiUpload<T>(endpoint: string, formData: FormData): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      ...(token && { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` })
    },
    body: formData
  })
  
  if (!res.ok) {
    throw new Error(`Upload Error: ${res.status}`)
  }
  
  return res.json()
}

export function clearCache() {
  cache.clear()
}

export function invalidateCache(pattern: string) {
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key)
    }
  }
}
