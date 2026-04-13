import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  // Auth required for write operations
  if (req.method === 'PUT') {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return json({ error: 'Authorization required' }, 401)
    }
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  // GET - Fetch auto-reply settings
  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT key, value FROM support_settings
        WHERE key LIKE 'auto_reply_%'
          AND org_id = ${orgId}
      `
      const settings: Record<string, string> = {}
      for (const row of rows) {
        settings[row.key] = row.value
      }
      return json({ settings })
    } catch (error: any) {
      return json({ error: error.message }, 500)
    }
  }

  // PUT - Update auto-reply settings
  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      
      // Upsert each setting
      for (const [key, value] of Object.entries(body)) {
        if (key.startsWith('auto_reply_')) {
          await sql`
            INSERT INTO support_settings (key, value, updated_at, org_id)
            VALUES (${key}, ${String(value)}, NOW(), ${orgId})
            ON CONFLICT (key) DO UPDATE
            SET value = ${String(value)}, updated_at = NOW()
          `
        }
      }

      return json({ success: true })
    } catch (error: any) {
      return json({ error: error.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
