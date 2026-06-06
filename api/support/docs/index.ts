import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

export default async function handler(req: Request) {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
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
    await sql`ALTER TABLE support_docs ADD COLUMN IF NOT EXISTS org_id VARCHAR(50) DEFAULT 'org_delever'`.catch(() => {})
    await sql`ALTER TABLE support_docs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`.catch(() => {})

    // CREATE — добавить документ
    if (req.method === 'POST') {
      const body = await req.json()
      const { title, content, category } = body
      if (!title) return json({ success: false, error: 'title required' }, 400)
      const kw = body.tags ?? body.keywords ?? []
      const url = body.url || `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const rows = await sql`
        INSERT INTO support_docs (title, content, url, category, keywords, org_id, created_at, updated_at, synced_at)
        VALUES (${title}, ${content || ''}, ${url}, ${category || 'general'}, ${kw}, ${orgId}, NOW(), NOW(), NOW())
        RETURNING id`
      return json({ success: true, id: rows[0]?.id })
    }

    // UPDATE — обновить документ
    if (req.method === 'PUT') {
      if (!id) return json({ success: false, error: 'id required' }, 400)
      const body = await req.json()
      const { title, content, category } = body
      const kw = body.tags ?? body.keywords ?? null
      await sql`
        UPDATE support_docs SET
          title = COALESCE(${title ?? null}, title),
          content = COALESCE(${content ?? null}, content),
          category = COALESCE(${category ?? null}, category),
          keywords = COALESCE(${kw}, keywords),
          updated_at = NOW()
        WHERE id = ${id} AND org_id = ${orgId}`
      return json({ success: true })
    }

    // DELETE — удалить документ
    if (req.method === 'DELETE') {
      if (!id) return json({ success: false, error: 'id required' }, 400)
      await sql`DELETE FROM support_docs WHERE id = ${id} AND org_id = ${orgId}`
      return json({ success: true })
    }

    // Get single document by ID
    if (id) {
      const doc = await sql`
        SELECT * FROM support_docs WHERE id = ${id} AND org_id = ${orgId}
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
        WHERE category = ${category} AND org_id = ${orgId}
        ORDER BY title
      `
    } else {
      docs = await sql`
        SELECT id, title, url, path, category, keywords, synced_at
        FROM support_docs
        WHERE org_id = ${orgId}
        ORDER BY category, title
      `
    }
    
    // Get categories with counts
    const categories = await sql`
      SELECT category, COUNT(*) as count
      FROM support_docs
      WHERE org_id = ${orgId}
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
      WHERE org_id = ${orgId}
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
