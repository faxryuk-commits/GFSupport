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
        input: text.slice(0, 8000), // Max input length
      }),
    })
    
    const data = await res.json()
    return data.data?.[0]?.embedding || null
  } catch (e) {
    console.error('Embedding generation failed:', e)
    return null
  }
}

// Calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  
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

  // Ensure embeddings table exists
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS support_embeddings (
        id VARCHAR(100) PRIMARY KEY,
        source_type VARCHAR(50) NOT NULL,
        source_id VARCHAR(100) NOT NULL,
        content_text TEXT NOT NULL,
        embedding JSONB,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(source_type, source_id)
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS idx_embeddings_source ON support_embeddings(source_type, source_id)`
  } catch (e) { /* table exists */ }

  // POST - Generate and store embedding
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { sourceType, sourceId, text, metadata } = body
      
      if (!sourceType || !sourceId || !text) {
        return json({ error: 'sourceType, sourceId and text are required' }, 400)
      }
      
      // Generate embedding
      const embedding = await generateEmbedding(text)
      if (!embedding) {
        return json({ error: 'Failed to generate embedding' }, 500)
      }
      
      const embeddingId = `emb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      
      // Upsert embedding
      await sql`
        INSERT INTO support_embeddings (id, source_type, source_id, content_text, embedding, metadata)
        VALUES (${embeddingId}, ${sourceType}, ${sourceId}, ${text}, ${JSON.stringify(embedding)}, ${JSON.stringify(metadata || {})})
        ON CONFLICT (source_type, source_id) 
        DO UPDATE SET 
          content_text = ${text},
          embedding = ${JSON.stringify(embedding)},
          metadata = ${JSON.stringify(metadata || {})},
          created_at = NOW()
      `
      
      return json({
        success: true,
        embeddingId,
        dimensions: embedding.length
      })
      
    } catch (e: any) {
      console.error('Embedding creation error:', e)
      return json({ error: 'Failed to create embedding', details: e.message }, 500)
    }
  }

  // GET - Semantic search
  if (req.method === 'GET') {
    try {
      const query = url.searchParams.get('query')
      const sourceType = url.searchParams.get('sourceType')
      const limit = parseInt(url.searchParams.get('limit') || '10')
      const threshold = parseFloat(url.searchParams.get('threshold') || '0.7')
      
      if (!query) {
        return json({ error: 'query parameter is required' }, 400)
      }
      
      // Generate embedding for query
      const queryEmbedding = await generateEmbedding(query)
      if (!queryEmbedding) {
        return json({ error: 'Failed to generate query embedding' }, 500)
      }
      
      // Get all embeddings (filtered by sourceType if provided)
      const embeddings = sourceType 
        ? await sql`SELECT * FROM support_embeddings WHERE source_type = ${sourceType}`
        : await sql`SELECT * FROM support_embeddings`
      
      // Calculate similarities
      const results = embeddings
        .map((row: any) => {
          const embedding = typeof row.embedding === 'string' 
            ? JSON.parse(row.embedding) 
            : row.embedding
          const similarity = cosineSimilarity(queryEmbedding, embedding)
          return {
            id: row.id,
            sourceType: row.source_type,
            sourceId: row.source_id,
            contentText: row.content_text,
            metadata: row.metadata,
            similarity: Math.round(similarity * 1000) / 1000,
            createdAt: row.created_at
          }
        })
        .filter((r: any) => r.similarity >= threshold)
        .sort((a: any, b: any) => b.similarity - a.similarity)
        .slice(0, limit)
      
      return json({
        query,
        results,
        totalEmbeddings: embeddings.length,
        matchesFound: results.length
      })
      
    } catch (e: any) {
      console.error('Semantic search error:', e)
      return json({ error: 'Search failed', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
