import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const { channelId } = await req.json()
    
    if (!channelId) {
      return json({ error: 'channelId is required' }, 400)
    }

    const sql = getSQL()
    const orgId = await getRequestOrgId(req)
    
    // Mark all unread messages as read
    const messagesResult = await sql`
      UPDATE support_messages 
      SET is_read = true, read_at = NOW()
      WHERE channel_id = ${channelId}
        AND is_read = false
        AND channel_id IN (SELECT id FROM support_channels WHERE org_id = ${orgId})
      RETURNING id
    `
    
    // Reset channel unread count
    await sql`
      UPDATE support_channels 
      SET unread_count = 0
      WHERE id = ${channelId} AND org_id = ${orgId}
    `

    console.log(`[Mark Read] Marked ${messagesResult.length} messages as read in channel ${channelId}`)

    return json({
      success: true,
      channelId,
      markedCount: messagesResult.length
    })

  } catch (error) {
    console.error('Mark read error:', error)
    return json({ 
      error: 'Failed to mark channel read', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, 500)
  }
}
