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
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const token = authHeader.replace('Bearer ', '')
  const sql = getSQL()
  const url = new URL(req.url)

  if (req.method === 'GET') {
    try {
      const connectionId = url.searchParams.get('connection_id')
      if (!connectionId) {
        return json({ error: 'connection_id query param is required' }, 400)
      }

      const comments = await sql`
        SELECT
          cm.*,
          ag.name as agent_name
        FROM onboarding_comments cm
        LEFT JOIN support_agents ag ON cm.agent_id = ag.id
        WHERE cm.connection_id = ${connectionId}
        ORDER BY cm.created_at DESC
        LIMIT 50
      `

      return json({
        comments: comments.map((c: any) => ({
          id: c.id,
          connectionId: c.connection_id,
          agentId: c.agent_id,
          agentName: c.agent_name,
          text: c.text,
          isSystem: c.is_system,
          createdAt: c.created_at,
        })),
      })
    } catch (e: any) {
      console.error('Comments fetch error:', e)
      return json({ error: 'Failed to fetch comments', details: e.message }, 500)
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { connection_id, text } = body

      if (!connection_id || !text?.trim()) {
        return json({ error: 'connection_id and text are required' }, 400)
      }

      const agentResult = await sql`
        SELECT id, name FROM support_agents WHERE token = ${token} LIMIT 1
      `
      const agentId = agentResult.length ? agentResult[0].id : null
      const agentName = agentResult.length ? agentResult[0].name : null

      const cmtId = `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

      await sql`
        INSERT INTO onboarding_comments (id, connection_id, agent_id, text, is_system)
        VALUES (${cmtId}, ${connection_id}, ${agentId}, ${text.trim()}, false)
      `

      return json({
        success: true,
        comment: {
          id: cmtId,
          connectionId: connection_id,
          agentId,
          agentName,
          text: text.trim(),
          isSystem: false,
          createdAt: new Date().toISOString(),
        },
      })
    } catch (e: any) {
      console.error('Comment create error:', e)
      return json({ error: 'Failed to create comment', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
