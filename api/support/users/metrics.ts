import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
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

  if (req.method === 'GET') {
    try {
      const userId = url.searchParams.get('userId')
      const telegramId = url.searchParams.get('telegramId')
      const period = url.searchParams.get('period') || '30' // days
      
      // Get employee metrics
      if (userId || telegramId) {
        // Single user metrics
        const user = userId 
          ? (await sql`SELECT * FROM support_users WHERE id = ${userId}`)[0]
          : (await sql`SELECT * FROM support_users WHERE telegram_id = ${parseInt(telegramId || '0')}`)[0]
        
        if (!user) {
          return json({ error: 'User not found' }, 404)
        }
        
        const senderId = user.telegram_id
        
        // Get message stats
        const messageStats = await sql`
          SELECT 
            COUNT(*) as total_messages,
            COUNT(DISTINCT channel_id) as channels_active,
            COUNT(DISTINCT DATE(created_at)) as active_days,
            MIN(created_at) as first_message,
            MAX(created_at) as last_message
          FROM support_messages
          WHERE sender_id = ${senderId}
            AND created_at > NOW() - INTERVAL '${sql.unsafe(period)} days'
        `
        
        // Get response time (time between client message and employee response)
        const responseTimes = await sql`
          WITH message_pairs AS (
            SELECT 
              m1.id as client_msg_id,
              m1.channel_id,
              m1.created_at as client_time,
              MIN(m2.created_at) as response_time
            FROM support_messages m1
            JOIN support_messages m2 ON m1.channel_id = m2.channel_id
              AND m2.created_at > m1.created_at
              AND m2.sender_id = ${senderId}
            WHERE m1.is_from_client = true
              AND m1.created_at > NOW() - INTERVAL '${sql.unsafe(period)} days'
            GROUP BY m1.id, m1.channel_id, m1.created_at
          )
          SELECT 
            AVG(EXTRACT(EPOCH FROM (response_time - client_time)) / 60) as avg_response_min,
            MIN(EXTRACT(EPOCH FROM (response_time - client_time)) / 60) as min_response_min,
            MAX(EXTRACT(EPOCH FROM (response_time - client_time)) / 60) as max_response_min,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (response_time - client_time)) / 60) as median_response_min,
            COUNT(*) as responses_count
          FROM message_pairs
        `
        
        // Get conversation resolution stats
        const resolutionStats = await sql`
          SELECT 
            COUNT(DISTINCT c.id) as conversations_involved,
            COUNT(DISTINCT CASE WHEN c.status = 'resolved' THEN c.id END) as conversations_resolved,
            AVG(CASE 
              WHEN c.status = 'resolved' AND c.resolved_at IS NOT NULL 
              THEN EXTRACT(EPOCH FROM (c.resolved_at - c.started_at)) / 3600 
            END) as avg_resolution_hours
          FROM support_conversations c
          JOIN support_messages m ON c.channel_id = m.channel_id
          WHERE m.sender_id = ${senderId}
            AND c.started_at > NOW() - INTERVAL '${sql.unsafe(period)} days'
        `
        
        // Get sentiment of conversations they handled
        const sentimentStats = await sql`
          SELECT 
            ai_sentiment,
            COUNT(*) as count
          FROM support_messages
          WHERE channel_id IN (
            SELECT DISTINCT channel_id FROM support_messages WHERE sender_id = ${senderId}
          )
          AND is_from_client = true
          AND ai_sentiment IS NOT NULL
          AND created_at > NOW() - INTERVAL '${sql.unsafe(period)} days'
          GROUP BY ai_sentiment
        `
        
        // Daily activity
        const dailyActivity = await sql`
          SELECT 
            DATE(created_at) as date,
            COUNT(*) as messages,
            COUNT(DISTINCT channel_id) as channels
          FROM support_messages
          WHERE sender_id = ${senderId}
            AND created_at > NOW() - INTERVAL '${sql.unsafe(period)} days'
          GROUP BY DATE(created_at)
          ORDER BY date DESC
          LIMIT 30
        `
        
        return json({
          user: {
            id: user.id,
            name: user.name,
            role: user.role,
            telegramUsername: user.telegram_username
          },
          period: `${period} days`,
          messageStats: messageStats[0] || {},
          responseTime: {
            avgMinutes: Math.round((responseTimes[0]?.avg_response_min || 0) * 10) / 10,
            minMinutes: Math.round((responseTimes[0]?.min_response_min || 0) * 10) / 10,
            maxMinutes: Math.round((responseTimes[0]?.max_response_min || 0) * 10) / 10,
            medianMinutes: Math.round((responseTimes[0]?.median_response_min || 0) * 10) / 10,
            totalResponses: parseInt(responseTimes[0]?.responses_count || 0)
          },
          resolutions: {
            conversationsInvolved: parseInt(resolutionStats[0]?.conversations_involved || 0),
            conversationsResolved: parseInt(resolutionStats[0]?.conversations_resolved || 0),
            resolutionRate: resolutionStats[0]?.conversations_involved > 0 
              ? Math.round((resolutionStats[0].conversations_resolved / resolutionStats[0].conversations_involved) * 100)
              : 0,
            avgResolutionHours: Math.round((resolutionStats[0]?.avg_resolution_hours || 0) * 10) / 10
          },
          clientSentiment: Object.fromEntries(sentimentStats.map((s: any) => [s.ai_sentiment, parseInt(s.count)])),
          dailyActivity
        })
      }
      
      // All employees metrics (leaderboard)
      const employees = await sql`
        SELECT * FROM support_users WHERE role = 'employee' AND is_active = true
      `
      
      const employeeMetrics = await Promise.all(employees.map(async (emp: any) => {
        const stats = await sql`
          SELECT 
            COUNT(*) as total_messages,
            COUNT(DISTINCT channel_id) as channels_active
          FROM support_messages
          WHERE sender_id = ${emp.telegram_id}
            AND created_at > NOW() - INTERVAL '${sql.unsafe(period)} days'
        `
        
        const responseTime = await sql`
          WITH pairs AS (
            SELECT 
              m1.created_at as client_time,
              MIN(m2.created_at) as response_time
            FROM support_messages m1
            JOIN support_messages m2 ON m1.channel_id = m2.channel_id
              AND m2.created_at > m1.created_at
              AND m2.sender_id = ${emp.telegram_id}
            WHERE m1.is_from_client = true
              AND m1.created_at > NOW() - INTERVAL '${sql.unsafe(period)} days'
            GROUP BY m1.id, m1.created_at
          )
          SELECT AVG(EXTRACT(EPOCH FROM (response_time - client_time)) / 60) as avg_min
          FROM pairs
        `
        
        return {
          id: emp.id,
          name: emp.name,
          telegramUsername: emp.telegram_username,
          department: emp.department,
          totalMessages: parseInt(stats[0]?.total_messages || 0),
          channelsActive: parseInt(stats[0]?.channels_active || 0),
          avgResponseMinutes: Math.round((responseTime[0]?.avg_min || 0) * 10) / 10
        }
      }))
      
      // Sort by performance (more messages, faster response)
      employeeMetrics.sort((a, b) => {
        const scoreA = a.totalMessages * 10 - a.avgResponseMinutes
        const scoreB = b.totalMessages * 10 - b.avgResponseMinutes
        return scoreB - scoreA
      })
      
      return json({
        period: `${period} days`,
        employees: employeeMetrics,
        summary: {
          totalEmployees: employeeMetrics.length,
          avgResponseTime: Math.round(
            employeeMetrics.reduce((sum, e) => sum + e.avgResponseMinutes, 0) / employeeMetrics.length * 10
          ) / 10 || 0,
          totalMessages: employeeMetrics.reduce((sum, e) => sum + e.totalMessages, 0)
        }
      })
      
    } catch (e: any) {
      console.error('Metrics error:', e)
      return json({ error: 'Failed to get metrics', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
