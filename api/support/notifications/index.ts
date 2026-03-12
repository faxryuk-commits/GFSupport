import { neon } from '@neondatabase/serverless'
import { getRequestOrgId } from '../lib/org.js'

export const config = { runtime: 'edge', regions: ['iad1'] }

function getSQL() {
  const c = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!c) throw new Error('DB not found')
  return neon(c)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id' } })
  }

  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const agentId = url.searchParams.get('agentId')
    const unreadOnly = url.searchParams.get('unread') === 'true'
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100)

    try {
      let notifications
      if (agentId && unreadOnly) {
        notifications = await sql`
          SELECT * FROM support_notifications
          WHERE org_id = ${orgId} AND agent_id = ${agentId} AND is_read = false
          ORDER BY created_at DESC LIMIT ${limit}
        `
      } else if (agentId) {
        notifications = await sql`
          SELECT * FROM support_notifications
          WHERE org_id = ${orgId} AND agent_id = ${agentId}
          ORDER BY created_at DESC LIMIT ${limit}
        `
      } else {
        notifications = await sql`
          SELECT * FROM support_notifications
          WHERE org_id = ${orgId}
          ORDER BY created_at DESC LIMIT ${limit}
        `
      }

      const [unreadCount] = agentId
        ? await sql`SELECT COUNT(*)::int as cnt FROM support_notifications WHERE org_id = ${orgId} AND agent_id = ${agentId} AND is_read = false`
        : await sql`SELECT COUNT(*)::int as cnt FROM support_notifications WHERE org_id = ${orgId} AND is_read = false`

      return json({
        notifications: notifications.map((n: any) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          priority: n.priority,
          channelId: n.channel_id,
          channelName: n.channel_name,
          senderName: n.sender_name,
          isRead: n.is_read,
          createdAt: n.created_at,
        })),
        unreadCount: Number(unreadCount?.cnt || 0),
      })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  if (req.method === 'PUT') {
    const body = await req.json()

    if (body.action === 'read' && body.notificationId) {
      await sql`UPDATE support_notifications SET is_read = true, read_at = NOW() WHERE id = ${body.notificationId} AND org_id = ${orgId}`
      return json({ success: true })
    }

    if (body.action === 'read_all' && body.agentId) {
      await sql`UPDATE support_notifications SET is_read = true, read_at = NOW() WHERE agent_id = ${body.agentId} AND org_id = ${orgId} AND is_read = false`
      return json({ success: true })
    }

    return json({ error: 'Invalid action' }, 400)
  }

  return json({ error: 'Method not allowed' }, 405)
}
