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

// Get avatar URL from Telegram
async function getTelegramAvatarUrl(telegramId: string): Promise<string | null> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken || !telegramId) return null
  
  try {
    // Get user profile photos
    const photosRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${telegramId}&limit=1`
    )
    const photosData = await photosRes.json()
    
    if (photosData.ok && photosData.result?.photos?.length > 0) {
      const photo = photosData.result.photos[0]
      if (photo && photo.length > 0) {
        const smallestPhoto = photo[0]
        
        const fileRes = await fetch(
          `https://api.telegram.org/bot${botToken}/getFile?file_id=${smallestPhoto.file_id}`
        )
        const fileData = await fileRes.json()
        
        if (fileData.ok && fileData.result?.file_path) {
          // Return proxy URL that won't expire
          return `/api/support/media/user-photo?userId=${telegramId}`
        }
      }
    }
    return null
  } catch {
    return null
  }
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

    // Find agent by username, name, or email - return all fields for frontend
    const agents = await sql`
      SELECT id, name, username, email, role, status, password_hash,
             telegram_id, avatar_url, phone, position, department, created_at
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
    
    // Get avatar URL - from DB or fetch from Telegram
    let avatarUrl = agent.avatar_url
    if (!avatarUrl && agent.telegram_id) {
      avatarUrl = await getTelegramAvatarUrl(agent.telegram_id)
      // Save to DB for future use
      if (avatarUrl) {
        await sql`UPDATE support_agents SET avatar_url = ${avatarUrl} WHERE id = ${agent.id}`.catch(() => {})
      }
    }

    return json({
      success: true,
      token,
      agent: {
        id: agent.id,
        name: agent.name,
        username: agent.username,
        email: agent.email,
        role: agent.role,
        status: 'online', // Just set to online since we updated it
        telegramId: agent.telegram_id,
        avatarUrl: avatarUrl,
        phone: agent.phone,
        position: agent.position,
        department: agent.department,
        createdAt: agent.created_at
      }
    })
  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
