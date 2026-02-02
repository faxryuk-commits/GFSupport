import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
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

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  try {
    const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
    if (!connectionString) {
      return json({ error: 'No database connection string' }, 500)
    }
    
    const sql = neon(connectionString)
    
    // Count channels
    const channelCount = await sql`SELECT COUNT(*) as count FROM support_channels WHERE is_active = true`
    
    // Count messages  
    const messageCount = await sql`SELECT COUNT(*) as count FROM support_messages`
    
    // Count messages last 7 days
    const recentCount = await sql`SELECT COUNT(*) as count FROM support_messages WHERE created_at > NOW() - INTERVAL '7 days'`
    
    // Recent messages
    const recentMessages = await sql`
      SELECT id, channel_id, sender_name, 
             SUBSTRING(text_content, 1, 50) as preview, 
             created_at 
      FROM support_messages 
      ORDER BY created_at DESC 
      LIMIT 10
    `
    
    // Recent channels
    const channels = await sql`
      SELECT id, name, telegram_chat_id, last_message_at, unread_count
      FROM support_channels
      WHERE is_active = true
      ORDER BY last_message_at DESC NULLS LAST
      LIMIT 10
    `
    
    return json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      stats: {
        totalChannels: parseInt(channelCount[0]?.count) || 0,
        totalMessages: parseInt(messageCount[0]?.count) || 0,
        messagesLast7Days: parseInt(recentCount[0]?.count) || 0
      },
      recentChannels: channels,
      recentMessages
    })
    
  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
