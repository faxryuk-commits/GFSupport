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
    const { channelId } = await req.json()
    
    if (!channelId) {
      return json({ error: 'channelId is required' }, 400)
    }

    const sql = getSQL()
    
    // Mark all unread messages as read
    const messagesResult = await sql`
      UPDATE support_messages 
      SET is_read = true, read_at = NOW()
      WHERE channel_id = ${channelId}
        AND is_read = false
      RETURNING id
    `
    
    // Reset channel unread count
    await sql`
      UPDATE support_channels 
      SET unread_count = 0
      WHERE id = ${channelId}
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
