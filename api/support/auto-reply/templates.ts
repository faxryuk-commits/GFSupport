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

function generateId(): string {
  return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  const sql = getSQL()

  // GET - List templates
  if (req.method === 'GET') {
    try {
      const templates = await sql`
        SELECT id, intent, template_text, personalization_vars, tone, language, priority, usage_count, is_active, created_at
        FROM support_auto_templates
        ORDER BY intent, priority DESC
      `
      return json({ templates })
    } catch (error: any) {
      return json({ error: error.message }, 500)
    }
  }

  // POST - Create template
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { intent, template_text, tone = 'friendly', language = 'ru', priority = 0, is_active = true } = body

      if (!intent || !template_text) {
        return json({ error: 'intent and template_text required' }, 400)
      }

      const id = generateId()
      
      // Extract personalization vars from template
      const varsMatch = template_text.match(/\{([^}]+)\}/g) || []
      const personalization_vars = varsMatch.map((v: string) => v)

      await sql`
        INSERT INTO support_auto_templates (id, intent, template_text, personalization_vars, tone, language, priority, is_active)
        VALUES (${id}, ${intent}, ${template_text}, ${personalization_vars}, ${tone}, ${language}, ${priority}, ${is_active})
      `

      return json({ success: true, id })
    } catch (error: any) {
      return json({ error: error.message }, 500)
    }
  }

  // PUT - Update template
  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { id, intent, template_text, tone, language, priority, is_active } = body

      if (!id) {
        return json({ error: 'id required' }, 400)
      }

      // Extract personalization vars from template
      const varsMatch = (template_text || '').match(/\{([^}]+)\}/g) || []
      const personalization_vars = varsMatch.map((v: string) => v)

      await sql`
        UPDATE support_auto_templates
        SET 
          intent = COALESCE(${intent}, intent),
          template_text = COALESCE(${template_text}, template_text),
          personalization_vars = ${personalization_vars},
          tone = COALESCE(${tone}, tone),
          language = COALESCE(${language}, language),
          priority = COALESCE(${priority}, priority),
          is_active = COALESCE(${is_active}, is_active)
        WHERE id = ${id}
      `

      return json({ success: true })
    } catch (error: any) {
      return json({ error: error.message }, 500)
    }
  }

  // DELETE - Delete template
  if (req.method === 'DELETE') {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return json({ error: 'id required' }, 400)
    }

    try {
      await sql`DELETE FROM support_auto_templates WHERE id = ${id}`
      return json({ success: true })
    } catch (error: any) {
      return json({ error: error.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
