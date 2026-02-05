import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
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
      
      let users
      
      if (role) {
        users = await sql`
          SELECT * FROM support_users 
          WHERE role = ${role} AND is_active = true
          ORDER BY last_seen_at DESC
        `
      } else if (channelId) {
        users = await sql`
          SELECT * FROM support_users 
          WHERE channels ? ${channelId} AND is_active = true
          ORDER BY last_seen_at DESC
        `
      } else if (search) {
        users = await sql`
          SELECT * FROM support_users 
          WHERE (name ILIKE ${'%' + search + '%'} OR telegram_username ILIKE ${'%' + search + '%'})
            AND is_active = true
          ORDER BY last_seen_at DESC
          LIMIT 50
        `
      } else {
        users = await sql`
          SELECT * FROM support_users 
          WHERE is_active = true
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
        const employeeIds = users.filter((u: any) => u.role === 'employee').map((u: any) => u.telegram_id)
        
        if (employeeIds.length > 0) {
          // Get response metrics (simplified query without window functions in aggregate)
          const metrics = await sql`
            SELECT 
              sender_id,
              COUNT(*) as total_messages,
              COUNT(CASE WHEN sender_role != 'client' THEN 1 END) as responses
            FROM support_messages
            WHERE sender_id = ANY(${employeeIds})
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
      return json({ error: 'Failed to fetch users', details: e.message }, 500)
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
        SELECT * FROM support_users WHERE telegram_id = ${telegramId}
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
            channels = ${JSON.stringify(channels)},
            last_seen_at = NOW(),
            updated_at = NOW()
          WHERE telegram_id = ${telegramId}
        `
        
        return json({ success: true, action: 'updated', userId: user.id })
      } else {
        // Create new user
        const userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const channels = channelId ? [{ id: channelId, name: channelName, addedAt: new Date().toISOString() }] : []
        
        await sql`
          INSERT INTO support_users (id, telegram_id, telegram_username, name, photo_url, channels)
          VALUES (${userId}, ${telegramId}, ${telegramUsername}, ${name}, ${photoUrl}, ${JSON.stringify(channels)})
        `
        
        return json({ success: true, action: 'created', userId })
      }
      
    } catch (e: any) {
      console.error('User create error:', e)
      return json({ error: 'Failed to create user', details: e.message }, 500)
    }
  }

  // PUT - Update user role and details
  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { id, telegramId, role, department, position, notes, isActive } = body
      
      const identifier = id || telegramId
      if (!identifier) {
        return json({ error: 'id or telegramId is required' }, 400)
      }
      
      const whereClause = id 
        ? sql`id = ${id}`
        : sql`telegram_id = ${telegramId}`
      
      await sql`
        UPDATE support_users SET
          role = COALESCE(${role}, role),
          department = COALESCE(${department}, department),
          position = COALESCE(${position}, position),
          notes = COALESCE(${notes}, notes),
          is_active = COALESCE(${isActive}, is_active),
          updated_at = NOW()
        WHERE ${whereClause}
      `
      
      return json({ success: true })
      
    } catch (e: any) {
      console.error('User update error:', e)
      return json({ error: 'Failed to update user', details: e.message }, 500)
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
        WHERE id = ${id}
      `
      
      return json({ success: true })
      
    } catch (e: any) {
      return json({ error: 'Failed to delete user', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
