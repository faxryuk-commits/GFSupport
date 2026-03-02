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

  const sql = getSQL()

  if (req.method === 'GET') {
    try {
      const templates = await sql`
        SELECT
          t.*,
          (SELECT COUNT(*) FROM onboarding_template_stages WHERE template_id = t.id) as stage_count,
          (SELECT COUNT(*) FROM onboarding_connections WHERE template_id = t.id) as usage_count
        FROM onboarding_templates t
        ORDER BY t.created_at DESC
      `

      return json({
        templates: templates.map((t: any) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          totalDays: t.total_days,
          roles: t.roles || [],
          isActive: t.is_active,
          stageCount: parseInt(t.stage_count || '0'),
          usageCount: parseInt(t.usage_count || '0'),
          createdAt: t.created_at,
          updatedAt: t.updated_at,
        })),
      })
    } catch (e: any) {
      console.error('Templates fetch error:', e)
      return json({ error: 'Failed to fetch templates', details: e.message }, 500)
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { name, description, total_days, roles, stages } = body

      if (!name) {
        return json({ error: 'Template name is required' }, 400)
      }

      const tplId = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

      await sql`
        INSERT INTO onboarding_templates (id, name, description, total_days, roles)
        VALUES (${tplId}, ${name}, ${description || null}, ${total_days || 14}, ${JSON.stringify(roles || [])})
      `

      if (stages && Array.isArray(stages)) {
        for (let i = 0; i < stages.length; i++) {
          const s = stages[i]
          const stageId = `stpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${i}`

          await sql`
            INSERT INTO onboarding_template_stages (id, template_id, name, sort_order, planned_days, default_role, items)
            VALUES (
              ${stageId}, ${tplId}, ${s.name}, ${s.sort_order || i + 1},
              ${s.planned_days || 1}, ${s.default_role || null}, ${JSON.stringify(s.items || [])}
            )
          `
        }
      }

      const created = await sql`SELECT * FROM onboarding_templates WHERE id = ${tplId}`
      const createdStages = await sql`
        SELECT * FROM onboarding_template_stages WHERE template_id = ${tplId} ORDER BY sort_order ASC
      `

      return json({
        success: true,
        template: created[0],
        stages: createdStages,
      })
    } catch (e: any) {
      console.error('Template create error:', e)
      return json({ error: 'Failed to create template', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
