import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)

  // Ensure users table exists with all needed columns
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS support_users (
        id VARCHAR(100) PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        telegram_username VARCHAR(255),
        name VARCHAR(255) NOT NULL,
        photo_url TEXT,
        role VARCHAR(50) DEFAULT 'client',
        department VARCHAR(100),
        position VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        notes TEXT,
        channels JSONB DEFAULT '[]',
        metrics JSONB DEFAULT '{}',
        first_seen_at TIMESTAMP DEFAULT NOW(),
        last_seen_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS idx_users_telegram ON support_users(telegram_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_users_role ON support_users(role)`
  } catch (e) { /* table exists */ }

  // GET - List users with filters
  if (req.method === 'GET') {
    try {
      const role = url.searchParams.get('role')
      const channelId = url.searchParams.get('channelId')
      const search = url.searchParams.get('search')
      const withMetrics = url.searchParams.get('metrics') === 'true'
      const market = url.searchParams.get('market') || null
      
      let users
      
      if (role) {
        users = await sql`
          SELECT * FROM support_users 
          WHERE role = ${role} AND is_active = true
            AND org_id = ${orgId}
            AND (${market}::text IS NULL OR market_id = ${market})
          ORDER BY last_seen_at DESC
        `
      } else if (channelId) {
        users = await sql`
          SELECT * FROM support_users 
          WHERE is_active = true AND org_id = ${orgId} AND (
            channels @> ${JSON.stringify([channelId])}::jsonb
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(channels, '[]'::jsonb)) elem
              WHERE (
                (jsonb_typeof(elem) = 'object' AND elem->>'id' = ${channelId})
                OR
                (jsonb_typeof(elem) = 'string' AND elem::text = to_jsonb(${channelId})::text)
              )
            )
          )
          ORDER BY last_seen_at DESC
        `
      } else if (search) {
        users = await sql`
          SELECT * FROM support_users 
          WHERE (name ILIKE ${'%' + search + '%'} OR telegram_username ILIKE ${'%' + search + '%'})
            AND is_active = true
            AND org_id = ${orgId}
            AND (${market}::text IS NULL OR market_id = ${market})
          ORDER BY last_seen_at DESC
          LIMIT 50
        `
      } else {
        users = await sql`
          SELECT * FROM support_users 
          WHERE is_active = true
            AND org_id = ${orgId}
            AND (${market}::text IS NULL OR market_id = ${market})
          ORDER BY 
            CASE role 
              WHEN 'employee' THEN 1 
              WHEN 'partner' THEN 2 
              ELSE 3 
            END,
            last_seen_at DESC
          LIMIT 200
        `
      }

      // Calculate metrics for employees if requested
      if (withMetrics) {
        const employeeIds = users
          .filter((u: any) => u.role === 'employee')
          .map((u: any) => (u.telegram_id != null ? String(u.telegram_id) : null))
          .filter(Boolean) as string[]
        
        if (employeeIds.length > 0) {
          // Get response metrics (simplified query without window functions in aggregate)
          const metrics = await sql`
            SELECT 
              sender_id::text as sender_id,
              COUNT(*) as total_messages,
              COUNT(CASE WHEN sender_role != 'client' THEN 1 END) as responses
            FROM support_messages
            WHERE sender_id::text = ANY(${employeeIds})
              AND org_id = ${orgId}
              AND created_at > NOW() - INTERVAL '30 days'
            GROUP BY sender_id
          `
          
          const metricsMap = new Map(metrics.map((m: any) => [m.sender_id?.toString(), {
            ...m,
            avg_response_time_min: null // TODO: calculate separately if needed
          }]))
          
          users = users.map((u: any) => ({
            ...u,
            calculatedMetrics: metricsMap.get(u.telegram_id?.toString()) || null
          }))
        }
      }

      // Get stats by role
      const stats = await sql`
        SELECT 
          role,
          COUNT(*) as count
        FROM support_users
        WHERE is_active = true
          AND org_id = ${orgId}
        GROUP BY role
      `

      return json({
        users: users.map((u: any) => ({
          id: u.id,
          telegramId: u.telegram_id,
          telegramUsername: u.telegram_username,
          name: u.name,
          // Use proxy URL for photos to handle expired Telegram URLs
          photoUrl: u.telegram_id 
            ? `/api/support/media/user-avatar?telegramId=${u.telegram_id}` 
            : null,
          role: u.role,
          department: u.department,
          position: u.position,
          notes: u.notes,
          channels: u.channels || [],
          metrics: u.metrics || {},
          calculatedMetrics: u.calculatedMetrics || null,
          firstSeenAt: u.first_seen_at,
          lastSeenAt: u.last_seen_at
        })),
        stats: {
          total: users.length,
          byRole: Object.fromEntries(stats.map((s: any) => [s.role, parseInt(s.count)]))
        }
      })
      
    } catch (e: any) {
      console.error('Users fetch error:', e)
      return json({ error: 'Failed to fetch users' }, 500)
    }
  }

  // POST - Create or update user (upsert by telegram_id)
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { telegramId, telegramUsername, name, photoUrl, channelId, channelName } = body
      
      if (!telegramId || !name) {
        return json({ error: 'telegramId and name are required' }, 400)
      }
      
      // Check if user exists
      const existing = await sql`
        SELECT * FROM support_users WHERE telegram_id = ${telegramId} AND org_id = ${orgId}
      `
      
      if (existing.length > 0) {
        // Update existing user
        const user = existing[0]
        const channels = user.channels || []
        
        // Add channel if not already in list
        if (channelId && !channels.some((c: any) => c.id === channelId)) {
          channels.push({ id: channelId, name: channelName, addedAt: new Date().toISOString() })
        }
        
        await sql`
          UPDATE support_users SET
            telegram_username = COALESCE(${telegramUsername}, telegram_username),
            name = COALESCE(${name}, name),
            photo_url = COALESCE(${photoUrl}, photo_url),
            channels = ${JSON.stringify(channels)}::jsonb,
            last_seen_at = NOW(),
            updated_at = NOW()
          WHERE telegram_id = ${telegramId} AND org_id = ${orgId}
        `
        
        return json({ success: true, action: 'updated', userId: user.id })
      } else {
        // Create new user
        const userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const channels = channelId ? [{ id: channelId, name: channelName, addedAt: new Date().toISOString() }] : []
        
        await sql`
          INSERT INTO support_users (id, telegram_id, telegram_username, name, photo_url, channels, org_id)
          VALUES (${userId}, ${telegramId}, ${telegramUsername}, ${name}, ${photoUrl}, ${JSON.stringify(channels)}::jsonb, ${orgId})
        `
        
        return json({ success: true, action: 'created', userId })
      }
      
    } catch (e: any) {
      console.error('User create error:', e)
      return json({ error: 'Failed to create user' }, 500)
    }
  }

  // PUT - Update user role and details
  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { id, telegramId, role, department, position, notes, isActive } = body
      
      if (!id && !telegramId) {
        return json({ error: 'id or telegramId is required' }, 400)
      }
      
      if (id) {
        await sql`
          UPDATE support_users SET
            role = COALESCE(${role ?? null}, role),
            department = COALESCE(${department ?? null}, department),
            position = COALESCE(${position ?? null}, position),
            notes = COALESCE(${notes ?? null}, notes),
            is_active = COALESCE(${isActive ?? null}, is_active),
            updated_at = NOW()
          WHERE id = ${id} AND org_id = ${orgId}
        `
      } else {
        await sql`
          UPDATE support_users SET
            role = COALESCE(${role ?? null}, role),
            department = COALESCE(${department ?? null}, department),
            position = COALESCE(${position ?? null}, position),
            notes = COALESCE(${notes ?? null}, notes),
            is_active = COALESCE(${isActive ?? null}, is_active),
            updated_at = NOW()
          WHERE telegram_id = ${telegramId} AND org_id = ${orgId}
        `
      }
      
      return json({ success: true })
      
    } catch (e: any) {
      console.error('User update error:', e)
      return json({ error: 'Failed to update user' }, 500)
    }
  }

  // DELETE - Soft delete user
  if (req.method === 'DELETE') {
    try {
      const id = url.searchParams.get('id')
      if (!id) {
        return json({ error: 'id is required' }, 400)
      }
      
      await sql`
        UPDATE support_users SET is_active = false, updated_at = NOW()
        WHERE id = ${id} AND org_id = ${orgId}
      `
      
      return json({ success: true })
      
    } catch (e: any) {
      return json({ error: 'Failed to delete user' }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
