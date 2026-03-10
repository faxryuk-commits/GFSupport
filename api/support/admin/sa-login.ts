import { neon } from '@neondatabase/serverless'
import { checkAuthRateLimit } from '../lib/rate-limit.js'
import { writeAuditLog, getClientIP } from '../lib/audit.js'

export const config = { runtime: 'edge' }

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

function hashPassword(password: string): string {
  let hash = 0
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return `h${Math.abs(hash).toString(36)}${password.length}`
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const sql = getSQL()

  try {
    const ip = getClientIP(req)
    const rateCheck = checkAuthRateLimit(ip)
    if (!rateCheck.allowed) {
      return json({ error: 'Too many attempts. Try again later.' }, 429)
    }

    const { email, password } = await req.json()
    if (!email || !password) {
      return json({ error: 'Email and password are required' }, 400)
    }

    const [sa] = await sql`
      SELECT id, email, name, role, password_hash
      FROM support_super_admins
      WHERE email = ${email} AND is_active = true
      LIMIT 1
    `

    if (!sa) return json({ error: 'Invalid credentials' }, 401)

    const passwordHash = hashPassword(password)
    if (sa.password_hash !== passwordHash) {
      return json({ error: 'Invalid credentials' }, 401)
    }

    await sql`UPDATE support_super_admins SET last_login_at = NOW() WHERE id = ${sa.id}`

    writeAuditLog({
      orgId: 'platform',
      agentId: sa.id,
      action: 'sa.login',
      ip,
      details: { email },
    })

    return json({
      success: true,
      token: sa.id,
      admin: {
        id: sa.id,
        email: sa.email,
        name: sa.name,
        role: sa.role,
      },
    })
  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
