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
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const sql = getSQL()
  const url = new URL(req.url)
  const broadcastId = url.searchParams.get('id')
  
  try {
    if (broadcastId) {
      // Статистика конкретной рассылки
      const broadcast = await sql`
        SELECT * FROM support_broadcasts WHERE id = ${broadcastId}
      `
      
      if (broadcast.length === 0) {
        return json({ success: false, error: 'Broadcast not found' }, 404)
      }
      
      // Получаем детальную статистику кликов
      const clickStats = await sql`
        SELECT 
          COUNT(*) as total_clicks,
          COUNT(DISTINCT ip_hash) as unique_clicks,
          COUNT(DISTINCT target_url) as unique_links
        FROM support_broadcast_clicks
        WHERE broadcast_id = ${broadcastId}
      `.catch(() => [{ total_clicks: 0, unique_clicks: 0, unique_links: 0 }])
      
      // Получаем количество forwards из сообщений
      const forwardStats = await sql`
        SELECT 
          COALESCE(SUM(forward_count), 0) as total_forwards
        FROM support_messages
        WHERE broadcast_id = ${broadcastId}
      `.catch(() => [{ total_forwards: 0 }])
      
      const b = broadcast[0]
      return json({
        success: true,
        broadcast: {
          id: b.id,
          type: b.message_type,
          message: b.message_text,
          filter: b.filter_type,
          sender: b.sender_name,
          createdAt: b.created_at,
          stats: {
            sent: b.channels_count || 0,
            successful: b.successful_count || 0,
            failed: b.failed_count || 0,
            views: b.views_count || 0,
            clicks: parseInt(clickStats[0]?.total_clicks || '0'),
            uniqueClicks: parseInt(clickStats[0]?.unique_clicks || '0'),
            forwards: parseInt(forwardStats[0]?.total_forwards || '0'),
          }
        }
      })
      
    } else {
      // Общая статистика всех рассылок
      const stats = await sql`
        SELECT 
          COUNT(*) as total_broadcasts,
          COALESCE(SUM(COALESCE(channels_count, 0)), 0) as total_sent,
          COALESCE(SUM(COALESCE(successful_count, 0)), 0) as total_successful,
          COALESCE(SUM(COALESCE(failed_count, 0)), 0) as total_failed,
          COALESCE(SUM(COALESCE(clicks_count, 0)), 0) as total_clicks
        FROM support_broadcasts
      `
      
      // Последние 10 рассылок с детальной статистикой
      const recent = await sql`
        SELECT 
          b.*,
          (SELECT COUNT(*) FROM support_broadcast_clicks c WHERE c.broadcast_id = b.id) as clicks,
          (SELECT COUNT(DISTINCT ip_hash) FROM support_broadcast_clicks c WHERE c.broadcast_id = b.id) as unique_clicks
        FROM support_broadcasts b
        ORDER BY b.created_at DESC
        LIMIT 10
      `
      
      return json({
        success: true,
        summary: {
          totalBroadcasts: parseInt(stats[0]?.total_broadcasts || '0'),
          totalSent: parseInt(stats[0]?.total_sent || '0'),
          totalSuccessful: parseInt(stats[0]?.total_successful || '0'),
          totalFailed: parseInt(stats[0]?.total_failed || '0'),
          totalClicks: parseInt(stats[0]?.total_clicks || '0'),
        },
        recent: recent.map((b: any) => ({
          id: b.id,
          type: b.message_type,
          message: b.message_text?.slice(0, 100) + (b.message_text?.length > 100 ? '...' : ''),
          filter: b.filter_type,
          sender: b.sender_name,
          createdAt: b.created_at,
          sent: b.channels_count,
          successful: b.successful_count,
          failed: b.failed_count,
          clicks: parseInt(b.clicks || '0'),
          uniqueClicks: parseInt(b.unique_clicks || '0'),
        }))
      })
    }
    
  } catch (error: any) {
    console.error('[Broadcast Stats Error]', error)
    return json({ success: false, error: error.message }, 500)
  }
}
