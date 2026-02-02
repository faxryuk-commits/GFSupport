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

  try {
    // Overall dialogs stats
    const dialogStats = await sql`
      SELECT 
        COUNT(*) as total_dialogs,
        COUNT(*) FILTER (WHERE was_helpful = true) as helpful_dialogs,
        COUNT(*) FILTER (WHERE was_helpful = false) as not_helpful_dialogs,
        COUNT(*) FILTER (WHERE was_helpful IS NULL) as unrated_dialogs,
        ROUND(AVG(confidence_score)::numeric, 2) as avg_confidence,
        SUM(used_count) as total_uses,
        COUNT(*) FILTER (WHERE requires_human_review = true) as needs_review,
        COUNT(DISTINCT question_category) as categories_count
      FROM support_dialogs
      WHERE is_active = true
    `

    // Feedback stats
    const feedbackStats = await sql`
      SELECT 
        COUNT(*) as total_feedback,
        COUNT(*) FILTER (WHERE rating = 'helpful') as helpful,
        COUNT(*) FILTER (WHERE rating = 'not_helpful') as not_helpful,
        COUNT(*) FILTER (WHERE rating = 'partially') as partially
      FROM support_feedback
    `

    // Daily stats for last 30 days
    const dailyStats = await sql`
      SELECT 
        date,
        total_dialogs,
        new_dialogs,
        auto_responses,
        auto_success_rate,
        avg_confidence,
        feedback_positive,
        feedback_negative,
        feedback_partial
      FROM support_learning_stats
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY date DESC
    `

    // Top performing dialogs
    const topDialogs = await sql`
      SELECT 
        id, question_text, answer_text, answer_by,
        confidence_score, used_count, was_helpful
      FROM support_dialogs
      WHERE is_active = true AND was_helpful = true
      ORDER BY used_count DESC, confidence_score DESC
      LIMIT 10
    `

    // Dialogs needing review
    const needsReview = await sql`
      SELECT 
        id, question_text, answer_text, answer_by,
        confidence_score, was_helpful, created_at
      FROM support_dialogs
      WHERE is_active = true 
        AND (requires_human_review = true OR was_helpful = false)
      ORDER BY created_at DESC
      LIMIT 10
    `

    // Category distribution
    const categoryStats = await sql`
      SELECT 
        COALESCE(question_category, 'uncategorized') as category,
        COUNT(*) as count,
        ROUND(AVG(confidence_score)::numeric, 2) as avg_confidence,
        COUNT(*) FILTER (WHERE was_helpful = true) as helpful
      FROM support_dialogs
      WHERE is_active = true
      GROUP BY question_category
      ORDER BY count DESC
    `

    // Calculate success rate
    const stats = dialogStats[0]
    const total = parseInt(stats.total_dialogs) || 0
    const helpful = parseInt(stats.helpful_dialogs) || 0
    const successRate = total > 0 ? Math.round((helpful / total) * 100) : 0

    return json({
      summary: {
        totalDialogs: total,
        helpfulDialogs: helpful,
        notHelpfulDialogs: parseInt(stats.not_helpful_dialogs) || 0,
        unratedDialogs: parseInt(stats.unrated_dialogs) || 0,
        avgConfidence: parseFloat(stats.avg_confidence) || 0,
        totalUses: parseInt(stats.total_uses) || 0,
        needsReview: parseInt(stats.needs_review) || 0,
        successRate,
        categoriesCount: parseInt(stats.categories_count) || 0
      },
      feedback: feedbackStats[0],
      dailyStats,
      topDialogs: topDialogs.map((d: any) => ({
        id: d.id,
        question: d.question_text?.slice(0, 100) + (d.question_text?.length > 100 ? '...' : ''),
        answer: d.answer_text?.slice(0, 150) + (d.answer_text?.length > 150 ? '...' : ''),
        answeredBy: d.answer_by,
        confidence: d.confidence_score,
        usedCount: d.used_count
      })),
      needsReview: needsReview.map((d: any) => ({
        id: d.id,
        question: d.question_text?.slice(0, 100),
        answer: d.answer_text?.slice(0, 150),
        confidence: d.confidence_score,
        wasHelpful: d.was_helpful,
        createdAt: d.created_at
      })),
      categoryStats
    })

  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
