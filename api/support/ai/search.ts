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

// Generate embedding using OpenAI
async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !text) return null
  
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000),
      }),
    })
    
    const data = await res.json()
    return data.data?.[0]?.embedding || null
  } catch (e) {
    console.error('Embedding generation failed:', e)
    return null
  }
}

// Calculate cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0
  
  let dotProduct = 0
  let normA = 0
  let normB = 0
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
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

  const sql = getSQL()
  const url = new URL(req.url)

  // GET - Semantic search across solutions and historical cases
  if (req.method === 'GET') {
    try {
      const query = url.searchParams.get('query') || url.searchParams.get('q')
      const category = url.searchParams.get('category')
      const limit = parseInt(url.searchParams.get('limit') || '5')
      
      if (!query) {
        return json({ error: 'query parameter is required' }, 400)
      }

      // Generate embedding for query
      const queryEmbedding = await generateEmbedding(query)
      
      // Search in solutions (text-based if no embedding, semantic if available)
      const solutions = await sql`
        SELECT id, category, subcategory, problem_keywords, solution_text, solution_steps, 
               success_score, used_count, is_verified
        FROM support_solutions
        WHERE is_active = true
        ${category ? sql`AND category = ${category}` : sql``}
        ORDER BY success_score DESC, used_count DESC
        LIMIT 50
      `

      // Search in historical cases with resolutions
      const resolvedCases = await sql`
        SELECT id, title, description, category, resolution_notes, root_cause
        FROM support_cases
        WHERE status = 'resolved' AND resolution_notes IS NOT NULL
        ${category ? sql`AND category = ${category}` : sql``}
        ORDER BY resolved_at DESC
        LIMIT 50
      `

      // Get embeddings if available
      const embeddings = await sql`
        SELECT source_type, source_id, embedding
        FROM support_embeddings
        WHERE source_type IN ('solution', 'case')
      `
      
      const embeddingMap = new Map()
      for (const e of embeddings) {
        const embedding = typeof e.embedding === 'string' ? JSON.parse(e.embedding) : e.embedding
        embeddingMap.set(`${e.source_type}:${e.source_id}`, embedding)
      }

      // Score solutions
      const scoredSolutions = solutions.map((s: any) => {
        let score = 0
        
        // Keyword matching
        const keywords = s.problem_keywords || []
        const queryLower = query.toLowerCase()
        for (const kw of keywords) {
          if (queryLower.includes(kw.toLowerCase())) {
            score += 0.2
          }
        }
        
        // Text matching
        const solutionText = `${s.solution_text || ''} ${(s.solution_steps || []).join(' ')}`.toLowerCase()
        if (solutionText.includes(queryLower)) {
          score += 0.3
        }
        
        // Semantic similarity if embedding available
        if (queryEmbedding) {
          const solutionEmbedding = embeddingMap.get(`solution:${s.id}`)
          if (solutionEmbedding) {
            const similarity = cosineSimilarity(queryEmbedding, solutionEmbedding)
            score += similarity * 0.5
          }
        }
        
        // Boost by success score and verified status
        score *= (1 + (s.success_score || 0) / 10)
        if (s.is_verified) score *= 1.2
        
        return {
          type: 'solution',
          id: s.id,
          category: s.category,
          subcategory: s.subcategory,
          text: s.solution_text,
          steps: s.solution_steps,
          successScore: s.success_score,
          isVerified: s.is_verified,
          relevanceScore: Math.round(score * 100) / 100
        }
      })

      // Score historical cases
      const scoredCases = resolvedCases.map((c: any) => {
        let score = 0
        
        const queryLower = query.toLowerCase()
        const caseText = `${c.title || ''} ${c.description || ''} ${c.resolution_notes || ''}`.toLowerCase()
        
        // Text matching
        if (caseText.includes(queryLower)) {
          score += 0.4
        }
        
        // Semantic similarity
        if (queryEmbedding) {
          const caseEmbedding = embeddingMap.get(`case:${c.id}`)
          if (caseEmbedding) {
            const similarity = cosineSimilarity(queryEmbedding, caseEmbedding)
            score += similarity * 0.6
          }
        }
        
        return {
          type: 'historical_case',
          id: c.id,
          title: c.title,
          category: c.category,
          rootCause: c.root_cause,
          resolution: c.resolution_notes,
          relevanceScore: Math.round(score * 100) / 100
        }
      })

      // Combine and sort by relevance
      const allResults = [...scoredSolutions, ...scoredCases]
        .filter((r: any) => r.relevanceScore > 0.1)
        .sort((a: any, b: any) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit)

      // Generate AI summary of top results
      let aiSummary = null
      const apiKey = process.env.OPENAI_API_KEY
      if (apiKey && allResults.length > 0) {
        try {
          const topResults = allResults.slice(0, 3)
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                {
                  role: 'system',
                  content: 'Ты помощник службы поддержки. На основе найденных решений, дай краткую рекомендацию оператору. 2-3 предложения на русском.'
                },
                {
                  role: 'user',
                  content: `Проблема: ${query}\n\nНайденные решения:\n${topResults.map((r: any) => 
                    r.type === 'solution' ? r.text : r.resolution
                  ).join('\n\n')}`
                }
              ],
              temperature: 0.3,
              max_tokens: 200,
            }),
          })
          
          const data = await res.json()
          aiSummary = data.choices?.[0]?.message?.content || null
        } catch (e) {
          console.error('AI summary failed:', e)
        }
      }

      return json({
        query,
        results: allResults,
        aiSummary,
        stats: {
          solutionsSearched: solutions.length,
          casesSearched: resolvedCases.length,
          embeddingsUsed: embeddingMap.size,
          matchesFound: allResults.length
        }
      })
      
    } catch (e: any) {
      console.error('Search error:', e)
      return json({ error: 'Search failed', details: e.message }, 500)
    }
  }

  // POST - Index content for future searches
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { action } = body
      
      if (action === 'index_solutions') {
        // Index all solutions
        const solutions = await sql`
          SELECT id, category, subcategory, problem_keywords, solution_text, solution_steps
          FROM support_solutions WHERE is_active = true
        `
        
        let indexed = 0
        for (const s of solutions) {
          const text = `${s.category} ${s.subcategory || ''} ${(s.problem_keywords || []).join(' ')} ${s.solution_text} ${(s.solution_steps || []).join(' ')}`
          const embedding = await generateEmbedding(text)
          
          if (embedding) {
            const embId = `emb_sol_${s.id}`
            await sql`
              INSERT INTO support_embeddings (id, source_type, source_id, content_text, embedding)
              VALUES (${embId}, 'solution', ${s.id}, ${text}, ${JSON.stringify(embedding)})
              ON CONFLICT (source_type, source_id) DO UPDATE SET
                content_text = ${text},
                embedding = ${JSON.stringify(embedding)},
                created_at = NOW()
            `
            indexed++
          }
        }
        
        return json({ success: true, indexed, total: solutions.length })
      }
      
      if (action === 'index_cases') {
        // Index resolved cases
        const cases = await sql`
          SELECT id, title, description, category, resolution_notes, root_cause
          FROM support_cases
          WHERE status = 'resolved' AND resolution_notes IS NOT NULL
          ORDER BY resolved_at DESC
          LIMIT 100
        `
        
        let indexed = 0
        for (const c of cases) {
          const text = `${c.title} ${c.description || ''} ${c.category || ''} ${c.root_cause || ''} ${c.resolution_notes}`
          const embedding = await generateEmbedding(text)
          
          if (embedding) {
            const embId = `emb_case_${c.id}`
            await sql`
              INSERT INTO support_embeddings (id, source_type, source_id, content_text, embedding)
              VALUES (${embId}, 'case', ${c.id}, ${text}, ${JSON.stringify(embedding)})
              ON CONFLICT (source_type, source_id) DO UPDATE SET
                content_text = ${text},
                embedding = ${JSON.stringify(embedding)},
                created_at = NOW()
            `
            indexed++
          }
        }
        
        return json({ success: true, indexed, total: cases.length })
      }
      
      return json({ error: 'Unknown action' }, 400)
      
    } catch (e: any) {
      console.error('Index error:', e)
      return json({ error: 'Indexing failed', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
