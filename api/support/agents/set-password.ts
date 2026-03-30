import { neon } from '@neondatabase/serverless'
import { getRequestOrgId } from '../lib/org.js'
import { hashPassword } from '../lib/password.js'

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

/**
 * POST /api/support/agents/set-password
 * 
 * Устанавливает пароль для сотрудника (для миграции из старой системы)
 * Body: { agentId, password } или { username, password } или { email, password }
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // Только admin может устанавливать пароли
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.includes('admin')) {
    return json({ error: 'Admin access required' }, 401)
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  try {
    const body = await req.json()
    const { agentId, username, email, password } = body

    if (!password || password.length < 4) {
      return json({ error: 'Пароль должен быть минимум 4 символа' }, 400)
    }

    // Находим агента
    let agent = null
    
    if (agentId) {
      const result = await sql`SELECT id, name, username, email FROM support_agents WHERE id = ${agentId} AND org_id = ${orgId}`
      agent = result[0]
    } else if (username) {
      const result = await sql`SELECT id, name, username, email FROM support_agents WHERE (username = ${username} OR LOWER(username) = LOWER(${username})) AND org_id = ${orgId}`
      agent = result[0]
    } else if (email) {
      const result = await sql`SELECT id, name, username, email FROM support_agents WHERE (email = ${email} OR LOWER(email) = LOWER(${email})) AND org_id = ${orgId}`
      agent = result[0]
    }

    if (!agent) {
      return json({ error: 'Сотрудник не найден' }, 404)
    }

    // Хэшируем и сохраняем пароль
    const passwordHash = await hashPassword(password)
    
    await sql`
      UPDATE support_agents 
      SET password_hash = ${passwordHash}
      WHERE id = ${agent.id} AND org_id = ${orgId}
    `

    return json({
      success: true,
      message: `Пароль установлен для ${agent.name}`,
      agent: {
        id: agent.id,
        name: agent.name,
        username: agent.username,
        email: agent.email
      }
    })

  } catch (e: any) {
    console.error('Set password error:', e)
    return json({ error: 'Ошибка: ' + e.message }, 500)
  }
}
