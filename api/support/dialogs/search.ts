import { neon } from '@neondatabase/serverless'
import { createEmbedding, sanitizeText } from '../ai/embed'

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

// Semantic similarity search
export async function searchSimilarDialogs(
  questionText: string, 
  options: {
    limit?: number
    minSimilarity?: number
    helpfulOnly?: boolean
    category?: string
    excludeExpired?: boolean
  } = {}
) {
  const {
    limit = 5,
    minSimilarity = 0.70,
    helpfulOnly = true,
    category,
    excludeExpired = true
  } = options

  const sql = getSQL()

  // Create embedding for the question
  const embedding = await createEmbedding(sanitizeText(questionText))
  
  if (!embedding) {
    return { results: [], error: 'Failed to create embedding' }
  }

  try {
    // Search using cosine similarity
    // Note: In pgvector, <=> is cosine distance, so 1 - distance = similarity
    const results = await sql`
      SELECT 
        id,
        question_text,
        answer_text,
        answer_by,
        answer_type,
        question_category,
        was_helpful,
        confidence_score,
        used_count,
        version,
        created_at,
        1 - (question_embedding <=> ${JSON.stringify(embedding)}::vector) as similarity
      FROM support_dialogs
      WHERE 
        is_active = true
        AND question_embedding IS NOT NULL
        ${helpfulOnly ? sql`AND (was_helpful IS NULL OR was_helpful = true)` : sql``}
        ${category ? sql`AND question_category = ${category}` : sql``}
        ${excludeExpired ? sql`AND (expires_at IS NULL OR expires_at > NOW())` : sql``}
      ORDER BY question_embedding <=> ${JSON.stringify(embedding)}::vector
      LIMIT ${limit * 2}
    `

    // Filter by minimum similarity and limit
    const filtered = results
      .filter((r: any) => r.similarity >= minSimilarity)
      .slice(0, limit)
      .map((r: any) => ({
        ...r,
        similarity: Math.round(r.similarity * 100) / 100, // Round to 2 decimals
        similarityPercent: Math.round(r.similarity * 100)
      }))

    return { 
      results: filtered,
      queryEmbeddingCreated: true,
      totalCandidates: results.length,
      filteredCount: filtered.length
    }

  } catch (e: any) {
    console.error('Similarity search error:', e)
    return { results: [], error: e.message }
  }
}

// Check if question can be auto-answered (high confidence match)
export async function canAutoAnswer(questionText: string): Promise<{
  canAuto: boolean
  confidence: number
  answer?: string
  dialogId?: string
  reason: string
}> {
  const { results } = await searchSimilarDialogs(questionText, {
    limit: 1,
    minSimilarity: 0.92, // High threshold for auto-answer
    helpfulOnly: true
  })

  if (results.length === 0) {
    return {
      canAuto: false,
      confidence: 0,
      reason: 'No similar dialogs found'
    }
  }

  const best = results[0]

  // Additional safety checks
  if (best.was_helpful === false) {
    return {
      canAuto: false,
      confidence: best.similarity,
      reason: 'Best match was marked as not helpful'
    }
  }

  if (best.confidence_score < 0.5) {
    return {
      canAuto: false,
      confidence: best.similarity,
      reason: 'Best match has low confidence score'
    }
  }

  if (best.used_count < 2) {
    return {
      canAuto: false,
      confidence: best.similarity,
      answer: best.answer_text,
      dialogId: best.id,
      reason: 'Best match not used enough times - suggest to human'
    }
  }

  return {
    canAuto: true,
    confidence: best.similarity,
    answer: best.answer_text,
    dialogId: best.id,
    reason: 'High confidence match with good history'
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

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // GET - Search by query params
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const question = url.searchParams.get('q') || url.searchParams.get('question')
    const limit = parseInt(url.searchParams.get('limit') || '5')
    const minSimilarity = parseFloat(url.searchParams.get('min') || '0.70')
    const category = url.searchParams.get('category')
    const checkAuto = url.searchParams.get('checkAuto') === 'true'

    if (!question) {
      return json({ error: 'Question parameter (q) required' }, 400)
    }

    try {
      // If checking for auto-answer capability
      if (checkAuto) {
        const autoResult = await canAutoAnswer(question)
        return json(autoResult)
      }

      // Regular similarity search
      const searchResult = await searchSimilarDialogs(question, {
        limit,
        minSimilarity,
        category,
        helpfulOnly: true
      })

      return json(searchResult)

    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  // POST - Search with body (for longer questions)
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { 
        question, 
        limit = 5, 
        minSimilarity = 0.70,
        category,
        helpfulOnly = true,
        checkAuto = false
      } = body

      if (!question) {
        return json({ error: 'Question required' }, 400)
      }

      // If checking for auto-answer capability
      if (checkAuto) {
        const autoResult = await canAutoAnswer(question)
        return json(autoResult)
      }

      // Regular similarity search
      const searchResult = await searchSimilarDialogs(question, {
        limit,
        minSimilarity,
        category,
        helpfulOnly
      })

      return json(searchResult)

    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
