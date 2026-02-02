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
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

// Same hash function as in agents/index.ts
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
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const sql = getSQL()

  try {
    // Ensure email column exists
    try {
      await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS email VARCHAR(255)`
    } catch (e) { /* column may already exist */ }

    const { username, password } = await req.json()

    if (!username || !password) {
      return json({ error: 'Username and password are required' }, 400)
    }

    // Find agent by username, name, or email
    const agents = await sql`
      SELECT id, name, username, email, role, status, password_hash 
      FROM support_agents 
      WHERE username = ${username} 
         OR name = ${username}
         OR email = ${username}
         OR LOWER(username) = LOWER(${username})
         OR LOWER(email) = LOWER(${username})
      LIMIT 1
    `

    if (agents.length === 0) {
      return json({ error: 'Пользователь не найден. Используйте username или имя из профиля.' }, 401)
    }

    const agent = agents[0]
    const passwordHash = hashPassword(password)

    if (agent.password_hash !== passwordHash) {
      return json({ error: 'Invalid password' }, 401)
    }

    // Update status to online
    await sql`UPDATE support_agents SET status = 'online' WHERE id = ${agent.id}`

    // Generate simple token
    const token = `agent_${agent.id}_${Date.now().toString(36)}`

    return json({
      success: true,
      token,
      agent: {
        id: agent.id,
        name: agent.name,
        username: agent.username,
        role: agent.role
      }
    })
  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
