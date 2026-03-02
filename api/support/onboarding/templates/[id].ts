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
        'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const url = new URL(req.url)
  const pathParts = url.pathname.split('/')
  const templateId = pathParts[pathParts.length - 1]

  if (!templateId || templateId === 'templates') {
    return json({ error: 'Template ID required' }, 400)
  }

  const sql = getSQL()

  if (req.method === 'GET') {
    try {
      const tplResult = await sql`SELECT * FROM onboarding_templates WHERE id = ${templateId}`
      if (!tplResult.length) {
        return json({ error: 'Template not found' }, 404)
      }

      const stages = await sql`
        SELECT * FROM onboarding_template_stages
        WHERE template_id = ${templateId}
        ORDER BY sort_order ASC
      `

      return json({
        template: {
          id: tplResult[0].id,
          name: tplResult[0].name,
          description: tplResult[0].description,
          totalDays: tplResult[0].total_days,
          roles: tplResult[0].roles || [],
          isActive: tplResult[0].is_active,
          createdAt: tplResult[0].created_at,
          updatedAt: tplResult[0].updated_at,
        },
        stages: stages.map((s: any) => ({
          id: s.id,
          name: s.name,
          sortOrder: s.sort_order,
          plannedDays: s.planned_days,
          defaultRole: s.default_role,
          items: s.items || [],
        })),
      })
    } catch (e: any) {
      console.error('Template fetch error:', e)
      return json({ error: 'Failed to fetch template', details: e.message }, 500)
    }
  }

  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { name, description, total_days, roles, stages } = body

      const exists = await sql`SELECT id FROM onboarding_templates WHERE id = ${templateId}`
      if (!exists.length) {
        return json({ error: 'Template not found' }, 404)
      }

      await sql`
        UPDATE onboarding_templates SET
          name = COALESCE(${name || null}, name),
          description = COALESCE(${description !== undefined ? description : null}, description),
          total_days = COALESCE(${total_days || null}, total_days),
          roles = COALESCE(${roles ? JSON.stringify(roles) : null}, roles),
          updated_at = NOW()
        WHERE id = ${templateId}
      `

      if (stages && Array.isArray(stages)) {
        await sql`DELETE FROM onboarding_template_stages WHERE template_id = ${templateId}`

        for (let i = 0; i < stages.length; i++) {
          const s = stages[i]
          const stageId = s.id || `stpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${i}`

          await sql`
            INSERT INTO onboarding_template_stages (id, template_id, name, sort_order, planned_days, default_role, items)
            VALUES (
              ${stageId}, ${templateId}, ${s.name}, ${s.sort_order || i + 1},
              ${s.planned_days || 1}, ${s.default_role || null}, ${JSON.stringify(s.items || [])}
            )
          `
        }
      }

      const updated = await sql`SELECT * FROM onboarding_templates WHERE id = ${templateId}`
      const updatedStages = await sql`
        SELECT * FROM onboarding_template_stages WHERE template_id = ${templateId} ORDER BY sort_order ASC
      `

      return json({ success: true, template: updated[0], stages: updatedStages })
    } catch (e: any) {
      console.error('Template update error:', e)
      return json({ error: 'Failed to update template', details: e.message }, 500)
    }
  }

  if (req.method === 'DELETE') {
    try {
      const usage = await sql`
        SELECT COUNT(*) as count FROM onboarding_connections WHERE template_id = ${templateId}
      `
      if (parseInt(usage[0]?.count || '0') > 0) {
        return json({ error: 'Cannot delete template that is used by connections' }, 409)
      }

      const result = await sql`DELETE FROM onboarding_templates WHERE id = ${templateId} RETURNING id`
      if (!result.length) {
        return json({ error: 'Template not found' }, 404)
      }

      return json({ success: true, message: 'Template deleted' })
    } catch (e: any) {
      console.error('Template delete error:', e)
      return json({ error: 'Failed to delete template', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
