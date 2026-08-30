import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id' } })
  }

  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)

  // Уведомления строго личные: адресат — из токена, а не из параметра.
  // Без agentId ручка отдавала ВСЮ организацию — «Моё» показывало чужое
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'Unauthorized' }, 401)

  if (req.method === 'GET') {
    const agentId = ctx.agentId
    const unreadOnly = url.searchParams.get('unread') === 'true'
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100)

    try {
      const notifications = unreadOnly
        ? await sql`
            SELECT * FROM support_notifications
            WHERE org_id = ${orgId} AND agent_id = ${agentId} AND is_read = false
            ORDER BY created_at DESC LIMIT ${limit}
          `
        : await sql`
            SELECT * FROM support_notifications
            WHERE org_id = ${orgId} AND agent_id = ${agentId}
            ORDER BY created_at DESC LIMIT ${limit}
          `

      const [unreadCount] = await sql`SELECT COUNT(*)::int as cnt FROM support_notifications WHERE org_id = ${orgId} AND agent_id = ${agentId} AND is_read = false`

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
          link: n.link,
          isRead: n.is_read,
          createdAt: n.created_at,
        })),
        unreadCount: Number(unreadCount?.cnt || 0),
      })
    } catch (e: any) {
      return json({ error: "Internal server error" }, 500)
    }
  }

  if (req.method === 'PUT') {
    const body = await req.json()

    if (body.action === 'read' && body.notificationId) {
      await sql`UPDATE support_notifications SET is_read = true, read_at = NOW()
        WHERE id = ${body.notificationId} AND org_id = ${orgId} AND agent_id = ${ctx.agentId}`
      return json({ success: true })
    }

    if (body.action === 'read_all') {
      await sql`UPDATE support_notifications SET is_read = true, read_at = NOW()
        WHERE agent_id = ${ctx.agentId} AND org_id = ${orgId} AND is_read = false`
      return json({ success: true })
    }

    return json({ error: 'Invalid action' }, 400)
  }

  return json({ error: 'Method not allowed' }, 405)
}
