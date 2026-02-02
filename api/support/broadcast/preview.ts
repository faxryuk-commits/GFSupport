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

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

export default async function handler(req: Request) {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const sql = getSQL()
  const url = new URL(req.url)
  const filter = url.searchParams.get('filter') || 'all'
  const tagsParam = url.searchParams.get('tags')
  const tags = tagsParam ? tagsParam.split(',') : []
  
  try {
    // Get channels count based on filter (без фильтра is_active - может быть не установлен)
    let channels
    if (filter === 'active') {
      channels = await sql`
        SELECT id, name, last_message_at, telegram_chat_id
        FROM support_channels
        WHERE telegram_chat_id IS NOT NULL
          AND last_message_at > NOW() - INTERVAL '30 days'
        ORDER BY last_message_at DESC
      `
    } else if (filter === 'tags' && tags.length > 0) {
      channels = await sql`
        SELECT id, name, tags, telegram_chat_id
        FROM support_channels
        WHERE telegram_chat_id IS NOT NULL
          AND tags && ${tags}
        ORDER BY name
      `
    } else {
      // Все каналы с telegram_chat_id
      channels = await sql`
        SELECT id, name, telegram_chat_id
        FROM support_channels
        WHERE telegram_chat_id IS NOT NULL
        ORDER BY name
      `
    }
    
    // Get all available tags (ignore if table doesn't have tags column)
    let allTags: any[] = []
    try {
      allTags = await sql`
        SELECT DISTINCT unnest(tags) as tag
        FROM support_channels
        WHERE tags IS NOT NULL AND array_length(tags, 1) > 0
        ORDER BY tag
      `
    } catch (e) { /* tags column may not exist */ }
    
    // Get recent broadcasts history with click stats
    let history: any[] = []
    try {
      history = await sql`
        SELECT 
          b.id, b.message_type, b.message_text, b.filter_type, 
          b.channels_count, b.successful_count, b.failed_count,
          b.clicks_count, b.sender_name, b.created_at,
          (SELECT COUNT(*) FROM support_broadcast_clicks c WHERE c.broadcast_id = b.id) as total_clicks,
          (SELECT COUNT(DISTINCT ip_hash) FROM support_broadcast_clicks c WHERE c.broadcast_id = b.id) as unique_clicks
        FROM support_broadcasts b
        ORDER BY b.created_at DESC
        LIMIT 10
      `
    } catch (e) { 
      // Table may not exist, try without click stats
      try {
        history = await sql`
          SELECT id, message_type, message_text, filter_type, 
                 channels_count, successful_count, failed_count,
                 clicks_count, sender_name, created_at
          FROM support_broadcasts
          ORDER BY created_at DESC
          LIMIT 10
        `
      } catch (e2) { /* table may not exist */ }
    }
    
    return json({
      success: true,
      filter,
      count: channels.length,
      channels: channels.map((ch: any) => ({
        id: ch.id,
        name: ch.name
      })),
      availableTags: allTags.map((t: any) => t.tag),
      history: history.map((h: any) => ({
        id: h.id,
        type: h.message_type,
        message: h.message_text?.slice(0, 100) + (h.message_text?.length > 100 ? '...' : ''),
        filter: h.filter_type,
        sent: h.channels_count || 0,
        successful: h.successful_count || 0,
        failed: h.failed_count || 0,
        clicks: parseInt(h.total_clicks || h.clicks_count || '0'),
        uniqueClicks: parseInt(h.unique_clicks || '0'),
        forwards: 0, // TODO: добавить когда будет webhook для forwards
        sender: h.sender_name,
        createdAt: h.created_at
      }))
    })
    
  } catch (error: any) {
    console.error('[Broadcast Preview Error]', error)
    return json({ success: false, error: error.message }, 500)
  }
}
