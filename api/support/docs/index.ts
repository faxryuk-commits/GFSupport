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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const sql = getSQL()
  const url = new URL(req.url)
  const category = url.searchParams.get('category')
  const id = url.searchParams.get('id')
  
  try {
    // Ensure table exists
    await sql`
      CREATE TABLE IF NOT EXISTS support_docs (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        url TEXT UNIQUE NOT NULL,
        path TEXT,
        category TEXT,
        keywords TEXT[],
        content_hash TEXT,
        synced_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    
    // Get single document by ID
    if (id) {
      const doc = await sql`
        SELECT * FROM support_docs WHERE id = ${id}
      `
      
      if (doc.length === 0) {
        return json({ success: false, error: 'Document not found' }, 404)
      }
      
      return json({ success: true, doc: doc[0] })
    }
    
    // Get documents by category or all
    let docs
    if (category) {
      docs = await sql`
        SELECT id, title, url, path, category, keywords, synced_at
        FROM support_docs
        WHERE category = ${category}
        ORDER BY title
      `
    } else {
      docs = await sql`
        SELECT id, title, url, path, category, keywords, synced_at
        FROM support_docs
        ORDER BY category, title
      `
    }
    
    // Get categories with counts
    const categories = await sql`
      SELECT category, COUNT(*) as count
      FROM support_docs
      GROUP BY category
      ORDER BY category
    `
    
    // Get stats
    const stats = await sql`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT category) as category_count,
        MAX(synced_at) as last_sync,
        MIN(synced_at) as first_sync
      FROM support_docs
    `
    
    return json({
      success: true,
      stats: {
        total: Number(stats[0]?.total || 0),
        categories: Number(stats[0]?.category_count || 0),
        lastSync: stats[0]?.last_sync,
        firstSync: stats[0]?.first_sync,
      },
      categories: categories.map((c: any) => ({
        name: c.category,
        count: Number(c.count),
      })),
      docs: docs.map((d: any) => ({
        id: d.id,
        title: d.title,
        url: d.url,
        path: d.path,
        category: d.category,
        keywords: d.keywords || [],
        syncedAt: d.synced_at,
      })),
    })
    
  } catch (error: any) {
    console.error('[Docs List Error]', error)
    return json({ success: false, error: error.message }, 500)
  }
}
