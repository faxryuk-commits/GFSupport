/**
 * Hybrid cache with Upstash Redis (persistent) + in-memory (fast fallback)
 * Uses Redis when UPSTASH_REDIS_REST_URL is configured, otherwise falls back to in-memory
 */

// In-memory cache for Edge Runtime (fast fallback)
const memoryCache = new Map<string, { data: any; expires: number }>()

// Lazy Redis client initialization
let redisClient: any = null
let redisInitialized = false

async function getRedis() {
  if (redisInitialized) return redisClient
  redisInitialized = true
  
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  
  if (!url || !token) {
    console.log('Redis not configured, using in-memory cache')
    return null
  }
  
  try {
    const { Redis } = await import('@upstash/redis')
    redisClient = new Redis({ url, token })
    console.log('Redis cache initialized')
    return redisClient
  } catch (e) {
    console.error('Failed to initialize Redis:', e)
    return null
  }
}

// Cache TTLs in seconds
export const CACHE_TTL = {
  CHANNELS: 10,      // 10 seconds - frequently updated
  MESSAGES: 5,       // 5 seconds - very frequently updated
  STATS: 30,         // 30 seconds - aggregated data
  AGENTS: 60,        // 1 minute - rarely changes
  SETTINGS: 300,     // 5 minutes - very rarely changes
  ANALYTICS: 60,     // 1 minute - computed data
}

const CACHE_PREFIX = 'support:'

export async function getCached<T>(key: string): Promise<T | null> {
  const redis = await getRedis()
  const fullKey = CACHE_PREFIX + key
  
  // Try Redis first
  if (redis) {
    try {
      const data = await redis.get(fullKey)
      if (data) {
        // Also update memory cache for faster subsequent reads
        memoryCache.set(key, { data, expires: Date.now() + 60000 })
        return data as T
      }
    } catch (e) {
      console.error('Redis get error:', e)
    }
  }
  
  // Fallback to memory cache
  const item = memoryCache.get(key)
  if (!item) return null
  
  if (Date.now() > item.expires) {
    memoryCache.delete(key)
    return null
  }
  
  return item.data as T
}

export async function setCache(key: string, data: any, ttlSeconds: number): Promise<void> {
  const redis = await getRedis()
  const fullKey = CACHE_PREFIX + key
  
  // Set in Redis if available
  if (redis) {
    try {
      await redis.set(fullKey, JSON.stringify(data), { ex: ttlSeconds })
    } catch (e) {
      console.error('Redis set error:', e)
    }
  }
  
  // Always set in memory cache for fast reads
  memoryCache.set(key, {
    data,
    expires: Date.now() + ttlSeconds * 1000
  })
  
  // Cleanup old entries periodically (keep memory cache size manageable)
  if (memoryCache.size > 100) {
    const now = Date.now()
    for (const [k, v] of memoryCache.entries()) {
      if (now > v.expires) {
        memoryCache.delete(k)
      }
    }
  }
}

export async function invalidateCache(pattern: string): Promise<void> {
  const redis = await getRedis()
  
  // Invalidate in Redis
  if (redis) {
    try {
      // Get all keys matching pattern
      const keys = await redis.keys(CACHE_PREFIX + '*' + pattern + '*')
      if (keys.length > 0) {
        await redis.del(...keys)
      }
    } catch (e) {
      console.error('Redis invalidate error:', e)
    }
  }
  
  // Invalidate in memory cache
  for (const key of memoryCache.keys()) {
    if (key.includes(pattern)) {
      memoryCache.delete(key)
    }
  }
}

// Helper to get or compute cached value
export async function cachedQuery<T>(
  key: string,
  ttlSeconds: number,
  queryFn: () => Promise<T>
): Promise<T> {
  const cached = await getCached<T>(key)
  if (cached !== null) {
    return cached
  }
  
  const result = await queryFn()
  await setCache(key, result, ttlSeconds)
  return result
}

// Get cache stats (for debugging)
export async function getCacheStats() {
  const redis = await getRedis()
  return {
    redisEnabled: !!redis,
    memoryCacheSize: memoryCache.size,
    memoryCacheKeys: Array.from(memoryCache.keys())
  }
}
