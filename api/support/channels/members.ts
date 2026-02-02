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

/**
 * GET /api/support/channels/members?channelId=xxx
 * 
 * Получить участников канала/группы для @ упоминаний
 * Собирает из:
 * 1. Telegram API getChatAdministrators (если доступно)
 * 2. Уникальных отправителей сообщений в канале
 * 3. Зарегистрированных агентов
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const url = new URL(req.url)
  const channelId = url.searchParams.get('channelId')

  if (!channelId) {
    return json({ error: 'channelId is required' }, 400)
  }

  const sql = getSQL()
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  try {
    // Get channel info
    const channelResult = await sql`
      SELECT telegram_chat_id, type FROM support_channels WHERE id = ${channelId}
    `
    
    if (channelResult.length === 0) {
      return json({ error: 'Channel not found' }, 404)
    }

    const chatId = channelResult[0].telegram_chat_id
    const members: Array<{
      id: string
      name: string
      username?: string
      role?: 'support' | 'team' | 'client'
      avatarUrl?: string
    }> = []

    // 1. Get registered agents (support team)
    const agents = await sql`
      SELECT id, name, username, avatar_url, role
      FROM support_agents
      WHERE is_active = true
      ORDER BY name
    `
    
    for (const agent of agents) {
      members.push({
        id: `agent_${agent.id}`,
        name: agent.name,
        username: agent.username || undefined,
        role: agent.role === 'admin' ? 'support' : 'team',
        avatarUrl: agent.avatar_url || undefined
      })
    }

    // 2. Get unique senders from channel messages (last 100 messages)
    const senders = await sql`
      SELECT DISTINCT ON (sender_username, sender_name)
        sender_id, sender_name, sender_username, sender_role
      FROM support_messages
      WHERE channel_id = ${channelId}
        AND sender_name IS NOT NULL
        AND sender_name != ''
      ORDER BY sender_username, sender_name, created_at DESC
      LIMIT 50
    `

    for (const sender of senders) {
      // Skip if already added as agent
      const exists = members.some(m => 
        (sender.sender_username && m.username === sender.sender_username) ||
        m.name === sender.sender_name
      )
      
      if (!exists && sender.sender_name) {
        members.push({
          id: `sender_${sender.sender_id || sender.sender_name}`,
          name: sender.sender_name,
          username: sender.sender_username || undefined,
          role: sender.sender_role as 'support' | 'team' | 'client' || 'client'
        })
      }
    }

    // 3. Try to get chat administrators from Telegram (for groups)
    if (botToken && chatId) {
      try {
        const adminsRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatAdministrators`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId })
        })
        
        const adminsData = await adminsRes.json()
        
        if (adminsData.ok && adminsData.result) {
          for (const admin of adminsData.result) {
            const user = admin.user
            if (!user.is_bot) {
              const exists = members.some(m =>
                (user.username && m.username === user.username) ||
                m.name === [user.first_name, user.last_name].filter(Boolean).join(' ')
              )
              
              if (!exists) {
                members.push({
                  id: `tg_${user.id}`,
                  name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'User',
                  username: user.username || undefined,
                  role: admin.status === 'creator' ? 'support' : 'team'
                })
              }
            }
          }
        }
      } catch (e) {
        console.log('[Members] Could not fetch Telegram admins:', e)
      }
    }

    return json({
      members,
      total: members.length
    })

  } catch (e: any) {
    console.error('Members error:', e)
    return json({ error: 'Failed to fetch members', details: e.message }, 500)
  }
}
