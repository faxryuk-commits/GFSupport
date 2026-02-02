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

// Простое хэширование пароля
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + 'delever_salt_2024')
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

  try {
    const body = await req.json()
    const { agentId, username, email, password } = body

    if (!password || password.length < 4) {
      return json({ error: 'Пароль должен быть минимум 4 символа' }, 400)
    }

    // Находим агента
    let agent = null
    
    if (agentId) {
      const result = await sql`SELECT id, name, username, email FROM support_agents WHERE id = ${agentId}`
      agent = result[0]
    } else if (username) {
      const result = await sql`SELECT id, name, username, email FROM support_agents WHERE username = ${username} OR LOWER(username) = LOWER(${username})`
      agent = result[0]
    } else if (email) {
      const result = await sql`SELECT id, name, username, email FROM support_agents WHERE email = ${email} OR LOWER(email) = LOWER(${email})`
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
      WHERE id = ${agent.id}
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
