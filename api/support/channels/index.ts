import { neon } from '@neondatabase/serverless'

// Channels API v2.1 - SLA Categories support
export const config = {
  runtime: 'edge',
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

function json(data: any, status = 200, cacheSeconds = 0) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  }
  if (cacheSeconds > 0) {
    headers['Cache-Control'] = `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`
  }
  return new Response(JSON.stringify(data), { status, headers })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const url = new URL(req.url)

  // GET - список каналов
  if (req.method === 'GET') {
    try {
      const type = url.searchParams.get('type')
      const companyId = url.searchParams.get('companyId')
      const isActive = url.searchParams.get('active')
      const search = url.searchParams.get('search')
      const limitParam = parseInt(url.searchParams.get('limit') || '100')
      const offsetParam = parseInt(url.searchParams.get('offset') || '0')

      // Простой запрос без динамических условий
      let channels
      
      if (search) {
        channels = await sql`
          SELECT 
            c.*,
            (SELECT COUNT(*) FROM support_messages WHERE channel_id = c.id) as messages_count,
            (SELECT COUNT(*) FROM support_cases WHERE channel_id = c.id AND status NOT IN ('resolved', 'closed')) as open_cases_count
          FROM support_channels c
          WHERE c.name ILIKE ${'%' + search + '%'}
          ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      } else if (type && type !== 'all') {
        channels = await sql`
          SELECT 
            c.*,
            (SELECT COUNT(*) FROM support_messages WHERE channel_id = c.id) as messages_count,
            (SELECT COUNT(*) FROM support_cases WHERE channel_id = c.id AND status NOT IN ('resolved', 'closed')) as open_cases_count
          FROM support_channels c
          WHERE c.type = ${type}
          ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      } else if (isActive === 'true') {
        channels = await sql`
          SELECT 
            c.*,
            (SELECT COUNT(*) FROM support_messages WHERE channel_id = c.id) as messages_count,
            (SELECT COUNT(*) FROM support_cases WHERE channel_id = c.id AND status NOT IN ('resolved', 'closed')) as open_cases_count
          FROM support_channels c
          WHERE c.is_active = true
          ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      } else if (isActive === 'false') {
        channels = await sql`
          SELECT 
            c.*,
            (SELECT COUNT(*) FROM support_messages WHERE channel_id = c.id) as messages_count,
            (SELECT COUNT(*) FROM support_cases WHERE channel_id = c.id AND status NOT IN ('resolved', 'closed')) as open_cases_count
          FROM support_channels c
          WHERE c.is_active = false
          ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      } else {
        channels = await sql`
          SELECT 
            c.*,
            (SELECT COUNT(*) FROM support_messages WHERE channel_id = c.id) as messages_count,
            (SELECT COUNT(*) FROM support_cases WHERE channel_id = c.id AND status NOT IN ('resolved', 'closed')) as open_cases_count
          FROM support_channels c
          ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      }

      // Общее количество
      const countResult = await sql`SELECT COUNT(*) as total FROM support_channels`
      const total = parseInt(countResult[0]?.total || '0')

      // Статистика по типам
      const statsResult = await sql`
        SELECT type, COUNT(*) as count, SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active_count
        FROM support_channels 
        GROUP BY type
      `

      return json({
        channels: channels.map((c: any) => ({
          id: c.id,
          telegramChatId: c.telegram_chat_id,
          name: c.name || `Канал ${c.telegram_chat_id}`,
          type: c.type || 'client',
          slaCategory: c.sla_category || 'client',
          companyId: c.company_id,
          companyName: c.name || 'Компания',
          leadId: c.lead_id,
          isActive: c.is_active !== false,
          membersCount: c.members_count || 0,
          settings: c.settings || {},
          messagesCount: parseInt(c.messages_count || 0),
          openCasesCount: parseInt(c.open_cases_count || 0),
          unreadCount: parseInt(c.unread_count || 0),
          awaitingReply: c.awaiting_reply || false,
          lastSenderName: c.last_sender_name || null,
          lastMessageText: c.last_message_preview || null,
          lastMessagePreview: c.last_message_preview || null,
          lastClientMessageAt: c.last_client_message_at,
          lastTeamMessageAt: c.last_team_message_at,
          isForum: c.is_forum || false,
          photoUrl: c.photo_url || null,
          createdAt: c.created_at,
          lastMessageAt: c.last_message_at,
          updatedAt: c.updated_at,
        })),
        total,
        limit: limitParam,
        offset: offsetParam,
        hasMore: offsetParam + limitParam < total,
        stats: Object.fromEntries(statsResult.map((s: any) => [
          s.type, 
          { total: parseInt(s.count), active: parseInt(s.active_count) }
        ]))
      }, 200, 5)

    } catch (e: any) {
      console.error('Channels fetch error:', e)
      return json({ error: 'Failed to fetch channels', details: e.message }, 500)
    }
  }

  // POST - добавить/подключить канал
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { telegramChatId, name, type, companyId, leadId, settings } = body

      if (!telegramChatId || !name) {
        return json({ error: 'telegramChatId and name are required' }, 400)
      }

      const channelId = `ch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

      const existing = await sql`
        SELECT id FROM support_channels WHERE telegram_chat_id = ${telegramChatId}
      `

      if (existing && existing.length > 0) {
        await sql`
          UPDATE support_channels SET
            name = ${name},
            type = ${type || 'client'},
            company_id = ${companyId || null},
            lead_id = ${leadId || null},
            settings = ${JSON.stringify(settings || {})},
            is_active = true,
            updated_at = NOW()
          WHERE telegram_chat_id = ${telegramChatId}
        `
        return json({
          success: true,
          channelId: existing[0].id,
          message: 'Channel updated',
          isNew: false
        })
      }

      await sql`
        INSERT INTO support_channels (
          id, telegram_chat_id, name, type, company_id, lead_id, settings
        ) VALUES (
          ${channelId},
          ${telegramChatId},
          ${name},
          ${type || 'client'},
          ${companyId || null},
          ${leadId || null},
          ${JSON.stringify(settings || {})}
        )
      `

      return json({
        success: true,
        channelId,
        message: 'Channel connected',
        isNew: true
      })

    } catch (e: any) {
      return json({ error: 'Failed to connect channel', details: e.message }, 500)
    }
  }

  // PUT - обновить канал
  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { id, name, type, slaCategory, companyId, leadId, isActive, settings } = body

      if (!id) {
        return json({ error: 'Channel ID required' }, 400)
      }

      await sql`
        UPDATE support_channels SET
          name = COALESCE(${name}, name),
          type = COALESCE(${type}, type),
          sla_category = COALESCE(${slaCategory}, sla_category),
          is_active = COALESCE(${isActive}, is_active),
          updated_at = NOW()
        WHERE id = ${id}
      `

      return json({
        success: true,
        channelId: id,
        message: 'Channel updated'
      })

    } catch (e: any) {
      return json({ error: 'Failed to update channel', details: e.message }, 500)
    }
  }

  // DELETE - отключить канал
  if (req.method === 'DELETE') {
    try {
      const channelId = url.searchParams.get('id')
      
      if (!channelId) {
        return json({ error: 'Channel ID required' }, 400)
      }

      await sql`
        UPDATE support_channels SET is_active = false WHERE id = ${channelId}
      `

      return json({
        success: true,
        message: 'Channel disconnected'
      })

    } catch (e: any) {
      return json({ error: 'Failed to disconnect channel', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
