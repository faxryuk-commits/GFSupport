import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const sql = getSQL()
    const { messageId, messageIds, channelId } = await req.json()

    // Mark specific message(s) as read
    if (messageId) {
      await sql`
        UPDATE support_messages 
        SET is_read = true, read_at = NOW()
        WHERE id = ${messageId} AND is_read = false
      `
    }

    if (messageIds && Array.isArray(messageIds) && messageIds.length > 0) {
      await sql`
        UPDATE support_messages 
        SET is_read = true, read_at = NOW()
        WHERE id = ANY(${messageIds}) AND is_read = false
      `
    }

    // Mark all messages in channel as read
    if (channelId) {
      await sql`
        UPDATE support_messages 
        SET is_read = true, read_at = NOW()
        WHERE channel_id = ${channelId} AND is_read = false AND is_from_client = true
      `

      // Update channel unread count
      await sql`
        UPDATE support_channels SET unread_count = 0 WHERE id = ${channelId}
      `
    }

    return json({ success: true })

  } catch (e: any) {
    console.error('Mark read error:', e)
    return json({ error: e.message }, 500)
  }
}
