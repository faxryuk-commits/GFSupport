import { getRequestOrgId } from '../lib/org.js'
import { checkChannelQuota } from '../lib/quota.js'
import { getSQL, json } from '../lib/db.js'

// Channels API v2.1 - SLA Categories support
export const config = {
  runtime: 'edge',
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)

  // GET - список каналов
  if (req.method === 'GET') {
    try {
      const type = url.searchParams.get('type')
      const companyId = url.searchParams.get('companyId')
      const isActive = url.searchParams.get('active')
      const search = url.searchParams.get('search')
      const source = url.searchParams.get('source')
      const market = url.searchParams.get('market') || '__ALL__'
      const limitParam = parseInt(url.searchParams.get('limit') || '100')
      const offsetParam = parseInt(url.searchParams.get('offset') || '0')

      const isActiveFlag = isActive === null ? 'skip' : isActive

      const [channels, countResult, statsResult, sourceStats] = await Promise.all([
        sql`
          WITH ch_msgs AS (
            SELECT channel_id, COUNT(*)::int AS cnt
            FROM support_messages WHERE org_id = ${orgId} GROUP BY channel_id
          ),
          ch_cases AS (
            SELECT channel_id, COUNT(*)::int AS cnt
            FROM support_cases WHERE org_id = ${orgId} AND status NOT IN ('resolved', 'closed') GROUP BY channel_id
          )
          SELECT c.*, COALESCE(m.cnt, 0) AS messages_count, COALESCE(cs.cnt, 0) AS open_cases_count
          FROM support_channels c
          LEFT JOIN ch_msgs m ON m.channel_id = c.id
          LEFT JOIN ch_cases cs ON cs.channel_id = c.id
          WHERE c.org_id = ${orgId}
            AND (${market} = '__ALL__' OR c.market_id = ${market})
            AND (${search || ''}::text = '' OR c.name ILIKE ${'%' + (search || '') + '%'})
            AND (${source || ''}::text = '' OR COALESCE(c.source, 'telegram') = ${source || ''})
            AND (${type || 'all'}::text = 'all' OR c.type = ${type || 'all'})
            AND (${isActiveFlag}::text = 'skip' OR c.is_active = ${isActive === 'true'})
          ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `,
        sql`SELECT COUNT(*) as total FROM support_channels WHERE org_id = ${orgId} AND (${market} = '__ALL__' OR market_id = ${market})`,
        sql`SELECT type, COUNT(*) as count, SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active_count
            FROM support_channels WHERE org_id = ${orgId} AND (${market} = '__ALL__' OR market_id = ${market}) GROUP BY type`,
        sql`SELECT COALESCE(source, 'telegram') as source, COUNT(*)::int as count
            FROM support_channels WHERE org_id = ${orgId} GROUP BY COALESCE(source, 'telegram')`,
      ])

      const total = parseInt(countResult[0]?.total || '0')

      return json({
        channels: channels.map((c: any) => ({
          id: c.id,
          telegramChatId: c.telegram_chat_id,
          name: c.name || `Канал ${c.telegram_chat_id || c.external_chat_id || c.id}`,
          type: c.type || 'client',
          source: c.source || 'telegram',
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
          marketId: c.market_id || null,
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
        ])),
        sourceCounts: Object.fromEntries(sourceStats.map((s: any) => [s.source, s.count])),
      }, 200, 3)

    } catch (e: any) {
      console.error('Channels fetch error:', e)
      return json({ error: 'Failed to fetch channels' }, 500)
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
        SELECT id FROM support_channels WHERE telegram_chat_id = ${telegramChatId} AND org_id = ${orgId}
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
          WHERE telegram_chat_id = ${telegramChatId} AND org_id = ${orgId}
        `
        return json({
          success: true,
          channelId: existing[0].id,
          message: 'Channel updated',
          isNew: false
        })
      }

      const quota = await checkChannelQuota(orgId)
      if (!quota.allowed) return json({ error: quota.message, quotaExceeded: true }, 403)

      await sql`
        INSERT INTO support_channels (
          id, telegram_chat_id, name, type, company_id, lead_id, settings, org_id
        ) VALUES (
          ${channelId},
          ${telegramChatId},
          ${name},
          ${type || 'client'},
          ${companyId || null},
          ${leadId || null},
          ${JSON.stringify(settings || {})},
          ${orgId}
        )
      `

      return json({
        success: true,
        channelId,
        message: 'Channel connected',
        isNew: true
      })

    } catch (e: any) {
      return json({ error: 'Failed to connect channel' }, 500)
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
        WHERE id = ${id} AND org_id = ${orgId}
      `

      return json({
        success: true,
        channelId: id,
        message: 'Channel updated'
      })

    } catch (e: any) {
      return json({ error: 'Failed to update channel' }, 500)
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
        UPDATE support_channels SET is_active = false WHERE id = ${channelId} AND org_id = ${orgId}
      `

      return json({
        success: true,
        message: 'Channel disconnected'
      })

    } catch (e: any) {
      return json({ error: 'Failed to disconnect channel' }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
