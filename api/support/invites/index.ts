import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

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

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const sql = getSQL()
  const url = new URL(req.url)

  // Ensure table exists
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS support_invites (
        id VARCHAR(50) PRIMARY KEY,
        token VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255),
        role VARCHAR(20) DEFAULT 'agent',
        created_by VARCHAR(50),
        used_at TIMESTAMP,
        used_by VARCHAR(50),
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
  } catch (e) { /* table exists */ }

  // GET ?token=xxx — проверить валидность токена
  if (req.method === 'GET') {
    const token = url.searchParams.get('token')
    
    if (token) {
      // Проверка конкретного токена
      try {
        const rows = await sql`
          SELECT * FROM support_invites 
          WHERE token = ${token} 
            AND used_at IS NULL 
            AND (expires_at IS NULL OR expires_at > NOW())
        `
        
        if (rows.length === 0) {
          return json({ valid: false, error: 'Приглашение недействительно или уже использовано' }, 404)
        }

        const invite = rows[0]
        return json({
          valid: true,
          invite: {
            id: invite.id,
            email: invite.email,
            role: invite.role,
            expiresAt: invite.expires_at
          }
        })
      } catch (e: any) {
        return json({ error: e.message }, 500)
      }
    }
    
    // Список всех приглашений (для админа)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401)
    }

    try {
      const rows = await sql`
        SELECT i.*, a.name as created_by_name
        FROM support_invites i
        LEFT JOIN support_agents a ON i.created_by = a.id
        ORDER BY i.created_at DESC
        LIMIT 50
      `

      return json({
        invites: rows.map((r: any) => ({
          id: r.id,
          token: r.token,
          email: r.email,
          role: r.role,
          createdBy: r.created_by_name || r.created_by,
          usedAt: r.used_at,
          usedBy: r.used_by,
          expiresAt: r.expires_at,
          createdAt: r.created_at,
          isUsed: !!r.used_at,
          isExpired: r.expires_at && new Date(r.expires_at) < new Date()
        }))
      })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  // POST — создать приглашение
  if (req.method === 'POST') {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401)
    }

    try {
      const body = await req.json()
      const { email, role, expiresInDays } = body

      const inviteId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const token = generateToken()
      
      // По умолчанию 7 дней
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + (expiresInDays || 7))

      // Получаем ID создателя из токена (упрощённо)
      const createdBy = authHeader.replace('Bearer ', '').split('_')[0] || null

      await sql`
        INSERT INTO support_invites (id, token, email, role, created_by, expires_at)
        VALUES (${inviteId}, ${token}, ${email || null}, ${role || 'agent'}, ${createdBy}, ${expiresAt.toISOString()})
      `

      // Формируем ссылку
      const baseUrl = process.env.SITE_URL || 'https://delever.uz'
      const inviteUrl = `${baseUrl}/support/register/${token}`

      return json({
        success: true,
        invite: {
          id: inviteId,
          token,
          url: inviteUrl,
          expiresAt: expiresAt.toISOString()
        }
      })

    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  // DELETE — удалить/отозвать приглашение
  if (req.method === 'DELETE') {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const inviteId = url.searchParams.get('id')
    if (!inviteId) {
      return json({ error: 'Invite ID required' }, 400)
    }

    try {
      await sql`DELETE FROM support_invites WHERE id = ${inviteId}`
      return json({ success: true })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
