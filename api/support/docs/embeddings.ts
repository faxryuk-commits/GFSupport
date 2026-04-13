import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
  maxDuration: 120,
  regions: ['iad1'],
}

const TOGETHER_EMBED_API = 'https://api.together.xyz/v1/embeddings'
const EMBED_MODEL = 'intfloat/multilingual-e5-large-instruct'

async function getTogetherKey(orgId: string): Promise<string | null> {
  const sql = getSQL()
  try {
    const [s] = await sql`SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = 'together_api_key' LIMIT 1`
    if (s?.value) return s.value
  } catch {}
  return process.env.TOGETHER_API_KEY || null
}

async function generateEmbedding(text: string, apiKey: string): Promise<{ embedding: number[] | null; error?: string }> {
  try {
    const res = await fetch(TOGETHER_EMBED_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 500) }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { embedding: null, error: `API ${res.status}: ${errText.slice(0, 100)}` }
    }
    const data = await res.json() as any
    const emb = data.data?.[0]?.embedding
    return { embedding: emb || null, error: emb ? undefined : 'No embedding in response' }
  } catch (e: any) { return { embedding: null, error: e.message } }
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id' } })
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const apiKey = await getTogetherKey(orgId)
  if (!apiKey) return json({ error: 'Together API key not configured' }, 400)

  try { await sql`ALTER TABLE support_docs ADD COLUMN IF NOT EXISTS embedding REAL[]` } catch {}

  const url = new URL(req.url)

  if (req.method === 'GET' && url.searchParams.get('action') === 'generate') {
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const batch = Math.min(parseInt(url.searchParams.get('batch') || '10'), 15)

    const docs = await sql`
      SELECT id, title, LEFT(content, 350) as content, category
      FROM support_docs WHERE org_id = ${orgId} AND (embedding IS NULL OR array_length(embedding, 1) IS NULL)
      ORDER BY id LIMIT ${batch} OFFSET ${offset}
    `

    if (docs.length === 0) {
      const [cnt] = await sql`SELECT COUNT(*) as total FROM support_docs WHERE org_id = ${orgId} AND embedding IS NOT NULL AND array_length(embedding, 1) > 0`
      return json({ success: true, generated: 0, totalWithEmbeddings: Number(cnt?.total || 0), done: true })
    }

    let generated = 0
    const errors: string[] = []

    for (const doc of docs) {
      const text = `${doc.category}: ${doc.title}\n${doc.content}`
      const result = await generateEmbedding(text, apiKey)
      if (result.embedding) {
        const embStr = `{${result.embedding.join(',')}}`
        await sql`UPDATE support_docs SET embedding = ${embStr}::real[] WHERE id = ${doc.id}`
        generated++
      } else {
        errors.push(`Doc ${doc.id}: ${result.error || 'unknown'}`)
      }
    }

    const [cnt] = await sql`SELECT COUNT(*) as total FROM support_docs WHERE org_id = ${orgId} AND embedding IS NOT NULL AND array_length(embedding, 1) > 0`
    const [all] = await sql`SELECT COUNT(*) as total FROM support_docs WHERE org_id = ${orgId}`

    return json({
      success: true,
      generated,
      totalWithEmbeddings: Number(cnt?.total || 0),
      totalDocs: Number(all?.total || 0),
      done: generated === 0,
      errors: errors.length > 0 ? errors : undefined,
    })
  }

  if (req.method === 'POST') {
    const body = await req.json()
    const query = body.query as string
    if (!query) return json({ error: 'query required' }, 400)

    const qResult = await generateEmbedding(query, apiKey)
    if (!qResult.embedding) return json({ error: `Failed to generate query embedding: ${qResult.error}` }, 500)
    const queryEmbedding = qResult.embedding

    const embStr = `{${queryEmbedding.join(',')}}`
    const results = await sql`
      SELECT id, title, url, category, LEFT(content, 300) as excerpt,
        1 - (
          (SELECT SUM(a * b) FROM unnest(embedding, ${embStr}::real[]) AS t(a, b)) /
          NULLIF(
            SQRT((SELECT SUM(a * a) FROM unnest(embedding) AS t(a))) *
            SQRT((SELECT SUM(b * b) FROM unnest(${embStr}::real[]) AS t(b))),
            0
          )
        ) as distance
      FROM support_docs
      WHERE org_id = ${orgId} AND embedding IS NOT NULL AND array_length(embedding, 1) > 0
      ORDER BY distance ASC
      LIMIT 5
    `

    return json({
      results: results.map((r: any) => ({
        title: r.title,
        url: r.url,
        category: r.category,
        excerpt: r.excerpt,
        similarity: r.distance ? (1 - r.distance).toFixed(3) : null,
      })),
    })
  }

  return json({ error: 'Use GET?action=generate or POST with query' }, 400)
}
