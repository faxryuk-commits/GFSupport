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

// Простое хэширование пароля (для production нужен bcrypt)
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + 'delever_salt_2024')
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const sql = getSQL()

  // Ensure required columns exist
  try {
    await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS email VARCHAR(255)`
    await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`
    await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS position VARCHAR(255)`
    await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS department VARCHAR(255)`
    await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`
  } catch (e) { /* columns exist */ }

  try {
    const body = await req.json()
    const { 
      token, 
      name, 
      email, 
      phone, 
      telegram, 
      position, 
      department, 
      password 
    } = body

    // Валидация
    if (!token) {
      return json({ error: 'Токен приглашения обязателен' }, 400)
    }
    if (!name || name.trim().length < 2) {
      return json({ error: 'Укажите полное имя (минимум 2 символа)' }, 400)
    }
    if (!password || password.length < 6) {
      return json({ error: 'Пароль должен быть минимум 6 символов' }, 400)
    }

    // Проверяем токен приглашения
    const inviteRows = await sql`
      SELECT * FROM support_invites 
      WHERE token = ${token} 
        AND used_at IS NULL 
        AND (expires_at IS NULL OR expires_at > NOW())
    `

    if (inviteRows.length === 0) {
      return json({ error: 'Приглашение недействительно, уже использовано или истекло' }, 400)
    }

    const invite = inviteRows[0]

    // Проверяем что email не занят (если указан)
    if (email) {
      const existingEmail = await sql`SELECT id FROM support_agents WHERE email = ${email}`
      if (existingEmail.length > 0) {
        return json({ error: 'Этот email уже зарегистрирован' }, 400)
      }
    }

    // Проверяем что telegram не занят (если указан)
    if (telegram) {
      const cleanTelegram = telegram.replace('@', '').trim()
      const existingTg = await sql`SELECT id FROM support_agents WHERE username = ${cleanTelegram}`
      if (existingTg.length > 0) {
        return json({ error: 'Этот Telegram уже зарегистрирован' }, 400)
      }
    }

    // Хэшируем пароль
    const passwordHash = await hashPassword(password)

    // Создаём агента
    const agentId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const cleanTelegram = telegram ? telegram.replace('@', '').trim() : null

    await sql`
      INSERT INTO support_agents (
        id, name, username, email, role, status, password_hash,
        phone, position, department, created_at
      ) VALUES (
        ${agentId},
        ${name.trim()},
        ${cleanTelegram},
        ${email || null},
        ${invite.role || 'agent'},
        'offline',
        ${passwordHash},
        ${phone || null},
        ${position || null},
        ${department || null},
        NOW()
      )
    `

    // Помечаем приглашение как использованное
    await sql`
      UPDATE support_invites SET
        used_at = NOW(),
        used_by = ${agentId}
      WHERE id = ${invite.id}
    `

    // Генерируем токен для автовхода
    const sessionToken = `${agentId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

    return json({
      success: true,
      message: 'Регистрация успешна',
      agent: {
        id: agentId,
        name: name.trim(),
        email,
        role: invite.role || 'agent'
      },
      token: sessionToken
    })

  } catch (e: any) {
    console.error('Registration error:', e)
    return json({ error: 'Ошибка регистрации: ' + e.message }, 500)
  }
}
