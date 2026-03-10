const counters = new Map<string, { count: number; resetAt: number }>()

interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterMs?: number
}

/**
 * In-memory rate limiter for Edge Functions.
 * Note: Each Vercel Edge instance has its own memory, so this is per-instance.
 * For strict enforcement, use Redis/Upstash. This provides basic protection.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now()
  const entry = counters.get(key)

  if (!entry || now > entry.resetAt) {
    counters.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: maxRequests - 1 }
  }

  entry.count++

  if (entry.count > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: entry.resetAt - now,
    }
  }

  return { allowed: true, remaining: maxRequests - entry.count }
}

/**
 * Rate limit by org — prevents a single org from overwhelming the system.
 * 200 requests per 60 seconds per org.
 */
export function checkOrgRateLimit(orgId: string): RateLimitResult {
  return checkRateLimit(`org:${orgId}`, 200, 60_000)
}

/**
 * Rate limit by IP — prevents brute force on public endpoints.
 * 30 requests per 60 seconds per IP.
 */
export function checkIPRateLimit(ip: string): RateLimitResult {
  return checkRateLimit(`ip:${ip}`, 30, 60_000)
}

/**
 * Strict rate limit for auth endpoints.
 * 5 attempts per 5 minutes per IP.
 */
export function checkAuthRateLimit(ip: string): RateLimitResult {
  return checkRateLimit(`auth:${ip}`, 5, 300_000)
}

// Cleanup stale entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of counters) {
    if (now > entry.resetAt) counters.delete(key)
  }
}, 60_000)
