import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

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

// Update learning stats for today
async function updateDailyStats(sql: any, rating: string) {
  const today = new Date().toISOString().split('T')[0]
  
  try {
    // Upsert today's stats
    await sql`
      INSERT INTO support_learning_stats (date, feedback_positive, feedback_negative, feedback_partial)
      VALUES (${today}, 
        ${rating === 'helpful' ? 1 : 0},
        ${rating === 'not_helpful' ? 1 : 0},
        ${rating === 'partially' ? 1 : 0}
      )
      ON CONFLICT (date) DO UPDATE SET
        feedback_positive = support_learning_stats.feedback_positive + ${rating === 'helpful' ? 1 : 0},
        feedback_negative = support_learning_stats.feedback_negative + ${rating === 'not_helpful' ? 1 : 0},
        feedback_partial = support_learning_stats.feedback_partial + ${rating === 'partially' ? 1 : 0},
        updated_at = NOW()
    `
  } catch (e) {
    console.error('Failed to update daily stats:', e)
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const sql = getSQL()
  const url = new URL(req.url)

  // GET - Get feedback stats or list
  if (req.method === 'GET') {
    const dialogId = url.searchParams.get('dialogId')
    const stats = url.searchParams.get('stats') === 'true'

    try {
      if (stats) {
        // Get overall feedback statistics
        const feedbackStats = await sql`
          SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE rating = 'helpful') as helpful,
            COUNT(*) FILTER (WHERE rating = 'not_helpful') as not_helpful,
            COUNT(*) FILTER (WHERE rating = 'partially') as partially
          FROM support_feedback
        `
        
        // Get daily stats for last 30 days
        const dailyStats = await sql`
          SELECT date, feedback_positive, feedback_negative, feedback_partial
          FROM support_learning_stats
          WHERE date >= CURRENT_DATE - INTERVAL '30 days'
          ORDER BY date DESC
        `

        return json({
          overall: feedbackStats[0],
          daily: dailyStats
        })
      }

      if (dialogId) {
        // Get feedback for specific dialog
        const feedback = await sql`
          SELECT * FROM support_feedback
          WHERE dialog_id = ${dialogId}
          ORDER BY created_at DESC
        `
        return json({ feedback })
      }

      // Get recent feedback
      const recent = await sql`
        SELECT f.*, d.question_text, d.answer_text
        FROM support_feedback f
        LEFT JOIN support_dialogs d ON f.dialog_id = d.id
        ORDER BY f.created_at DESC
        LIMIT 50
      `
      return json({ feedback: recent })

    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  // POST - Submit feedback (can be called without auth for clients)
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { dialogId, channelId, messageId, rating, comment } = body

      if (!rating || !['helpful', 'not_helpful', 'partially'].includes(rating)) {
        return json({ error: 'Valid rating required (helpful, not_helpful, partially)' }, 400)
      }

      const feedbackId = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

      // Save feedback
      await sql`
        INSERT INTO support_feedback (id, dialog_id, channel_id, message_id, rating, comment)
        VALUES (${feedbackId}, ${dialogId || null}, ${channelId || null}, ${messageId || null}, ${rating}, ${comment || null})
      `

      // Update dialog confidence based on feedback
      if (dialogId) {
        if (rating === 'helpful') {
          await sql`
            UPDATE support_dialogs 
            SET 
              was_helpful = true,
              confidence_score = LEAST(1.0, confidence_score + 0.05),
              used_count = used_count + 1,
              last_used_at = NOW(),
              updated_at = NOW()
            WHERE id = ${dialogId}
          `
        } else if (rating === 'not_helpful') {
          await sql`
            UPDATE support_dialogs 
            SET 
              was_helpful = false,
              confidence_score = GREATEST(0, confidence_score - 0.15),
              requires_human_review = true,
              updated_at = NOW()
            WHERE id = ${dialogId}
          `
        } else if (rating === 'partially') {
          await sql`
            UPDATE support_dialogs 
            SET 
              confidence_score = GREATEST(0, confidence_score - 0.05),
              requires_human_review = true,
              updated_at = NOW()
            WHERE id = ${dialogId}
          `
        }
      }

      // Update daily stats
      await updateDailyStats(sql, rating)

      return json({
        success: true,
        feedbackId,
        message: 'Спасибо за обратную связь!'
      })

    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
