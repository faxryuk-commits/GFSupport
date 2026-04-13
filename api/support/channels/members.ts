import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
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
  const orgId = await getRequestOrgId(req)
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  try {
    const channelResult = await sql`
      SELECT telegram_chat_id, name, source FROM support_channels WHERE id = ${channelId} AND org_id = ${orgId}
    `

    if (channelResult.length === 0) {
      return json({ error: 'Channel not found' }, 404)
    }

    const chatId = channelResult[0].telegram_chat_id
    const channelName = channelResult[0].name || ''

    const members: Array<{
      id: string
      name: string
      username?: string
      role: 'support' | 'team' | 'client'
      avatarUrl?: string
      isAll?: boolean
    }> = []

    const addedKeys = new Set<string>()

    const addMember = (member: typeof members[0]) => {
      const key = (member.username || member.name).toLowerCase().trim()
      if (!key || addedKeys.has(key)) return false
      addedKeys.add(key)
      members.push(member)
      return true
    }

    // 1. Реальные участники: все кто писал в этой группе
    const senders = await sql`
      SELECT 
        sender_id,
        sender_name,
        sender_username,
        sender_role,
        MAX(created_at) as last_seen
      FROM support_messages
      WHERE channel_id = ${channelId}
        AND org_id = ${orgId}
        AND sender_name IS NOT NULL
        AND sender_name != ''
        AND TRIM(sender_name) != ''
      GROUP BY sender_id, sender_name, sender_username, sender_role
      ORDER BY last_seen DESC
      LIMIT 200
    `

    const agentNames = new Set<string>()
    try {
      const agents = await sql`
        SELECT LOWER(name) as lname, LOWER(username) as lusername
        FROM support_agents WHERE name IS NOT NULL AND org_id = ${orgId}
      `
      for (const a of agents) {
        if (a.lname) agentNames.add(a.lname.trim())
        if (a.lusername) agentNames.add(a.lusername.trim())
      }
    } catch {}

    for (const sender of senders) {
      if (!sender.sender_name?.trim()) continue

      let role: 'support' | 'team' | 'client' = 'client'
      const nameLower = sender.sender_name.toLowerCase().trim()
      const usernameLower = sender.sender_username?.toLowerCase().trim() || ''

      if (
        sender.sender_role === 'support' ||
        sender.sender_role === 'agent' ||
        agentNames.has(nameLower) ||
        (usernameLower && agentNames.has(usernameLower))
      ) {
        role = 'support'
      }

      addMember({
        id: `sender_${sender.sender_id || sender.sender_name.replace(/\s+/g, '_')}`,
        name: sender.sender_name.trim(),
        username: sender.sender_username || undefined,
        role,
      })
    }

    // 2. Telegram API: администраторы чата (могут не писать сообщений, но состоят в группе)
    if (botToken && chatId) {
      try {
        const adminsRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatAdministrators`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId }),
          signal: AbortSignal.timeout(5000),
        })

        const adminsData = await adminsRes.json()

        if (adminsData.ok && adminsData.result) {
          for (const admin of adminsData.result) {
            const user = admin.user
            if (user.is_bot) continue

            const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'User'
            const nameLower = fullName.toLowerCase().trim()
            const usernameLower = user.username?.toLowerCase() || ''

            let role: 'support' | 'team' | 'client' = admin.status === 'creator' ? 'team' : 'team'
            if (agentNames.has(nameLower) || (usernameLower && agentNames.has(usernameLower))) {
              role = 'support'
            }

            addMember({
              id: `tg_${user.id}`,
              name: fullName,
              username: user.username || undefined,
              role,
            })
          }
        }
      } catch {}
    }

    // «@Все» в начало списка
    members.unshift({
      id: 'mention_all',
      name: 'Все',
      username: 'all',
      role: 'team',
      isAll: true,
    })

    return json({
      members,
      total: members.length,
      channelName,
    })
  } catch (e: any) {
    console.error('[Members] error:', e)
    return json({ error: 'Failed to fetch members' }, 500)
  }
}
