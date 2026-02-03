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
  const searchQuery = url.searchParams.get('q') || url.searchParams.get('query') || ''
  const categoryFilter = url.searchParams.get('category')
  const maxResults = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50)
  
  try {
    if (!searchQuery || searchQuery.length < 2) {
      return json({ success: false, error: 'Query must be at least 2 characters' }, 400)
    }
    
    const searchPattern = `%${searchQuery}%`
    
    let results
    
    if (categoryFilter) {
      results = await sql`
        SELECT 
          id,
          title,
          LEFT(content, 300) as excerpt,
          url,
          path,
          category,
          keywords,
          (
            CASE WHEN title ILIKE ${searchPattern} THEN 10 ELSE 0 END +
            CASE WHEN content ILIKE ${searchPattern} THEN 5 ELSE 0 END
          ) as relevance
        FROM support_docs
        WHERE 
          category = ${categoryFilter}
          AND (
            title ILIKE ${searchPattern}
            OR content ILIKE ${searchPattern}
            OR ${searchQuery} = ANY(keywords)
          )
        ORDER BY relevance DESC, title
        LIMIT ${maxResults}
      `
    } else {
      results = await sql`
        SELECT 
          id,
          title,
          LEFT(content, 300) as excerpt,
          url,
          path,
          category,
          keywords,
          (
            CASE WHEN title ILIKE ${searchPattern} THEN 10 ELSE 0 END +
            CASE WHEN content ILIKE ${searchPattern} THEN 5 ELSE 0 END
          ) as relevance
        FROM support_docs
        WHERE 
          title ILIKE ${searchPattern}
          OR content ILIKE ${searchPattern}
          OR ${searchQuery} = ANY(keywords)
        ORDER BY relevance DESC, title
        LIMIT ${maxResults}
      `
    }
    
    // Format results
    const docs = results.map((doc: any) => ({
      id: doc.id,
      title: doc.title,
      excerpt: doc.excerpt ? doc.excerpt.replace(/\s+/g, ' ').trim() + '...' : '',
      url: doc.url,
      path: doc.path,
      category: doc.category,
      keywords: doc.keywords || [],
      relevance: doc.relevance || 0,
    }))
    
    return json({
      success: true,
      query: searchQuery,
      count: docs.length,
      results: docs,
    })
    
  } catch (error: any) {
    console.error('[Docs Search Error]', error)
    return json({ success: false, error: error.message }, 500)
  }
}
