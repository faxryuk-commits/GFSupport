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
 * Получить ВСЕХ участников канала/группы для @ упоминаний
 * ВАЖНО: Показываем всех кто когда-либо писал в группу!
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
    
    // Для отслеживания уже добавленных (избегаем дубликатов)
    const addedKeys = new Set<string>()
    
    const addMember = (member: typeof members[0]) => {
      // Уникальный ключ: username (если есть) или name
      const key = (member.username || member.name).toLowerCase().trim()
      if (addedKeys.has(key)) return false
      addedKeys.add(key)
      members.push(member)
      return true
    }

    // 1. ГЛАВНОЕ: Получаем ВСЕХ уникальных отправителей из сообщений канала
    // Это основной источник участников группы!
    const senders = await sql`
      SELECT 
        sender_id,
        sender_name,
        sender_username,
        sender_role,
        MAX(created_at) as last_seen
      FROM support_messages
      WHERE channel_id = ${channelId}
        AND sender_name IS NOT NULL
        AND sender_name != ''
        AND LENGTH(sender_name) > 0
      GROUP BY sender_id, sender_name, sender_username, sender_role
      ORDER BY last_seen DESC
      LIMIT 100
    `

    console.log('[Members] Senders from messages:', senders.length)

    for (const sender of senders) {
      if (!sender.sender_name) continue
      
      // Определяем роль
      let role: 'support' | 'team' | 'client' = 'client'
      if (sender.sender_role === 'support' || sender.sender_role === 'agent') {
        role = 'support'
      }

      addMember({
        id: `sender_${sender.sender_id || sender.sender_name.replace(/\s+/g, '_')}`,
        name: sender.sender_name,
        username: sender.sender_username || undefined,
        role
      })
    }

    console.log('[Members] After senders:', members.length)

    // 2. Добавляем зарегистрированных агентов (если их нет в списке отправителей)
    try {
      const agents = await sql`
        SELECT id, name, username, avatar_url, role
        FROM support_agents
        WHERE status != 'inactive' OR status IS NULL
        ORDER BY name
      `
      
      console.log('[Members] Agents from DB:', agents.length)

      for (const agent of agents) {
        if (!agent.name) continue
        
        addMember({
          id: `agent_${agent.id}`,
          name: agent.name,
          username: agent.username || undefined,
          role: 'support',
          avatarUrl: agent.avatar_url || undefined
        })
      }
    } catch (e) {
      console.log('[Members] Could not fetch agents:', e)
    }

    console.log('[Members] After agents:', members.length)

    // 3. Пробуем получить администраторов из Telegram API
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
            if (user.is_bot) continue
            
            const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'User'

            addMember({
              id: `tg_${user.id}`,
              name: fullName,
              username: user.username || undefined,
              role: admin.status === 'creator' ? 'support' : 'team'
            })
          }
        }
      } catch (e) {
        console.log('[Members] Could not fetch Telegram admins:', e)
      }
    }

    console.log('[Members] Final total:', members.length)

    return json({
      members,
      total: members.length
    })

  } catch (e: any) {
    console.error('Members error:', e)
    return json({ error: 'Failed to fetch members', details: e.message }, 500)
  }
}
