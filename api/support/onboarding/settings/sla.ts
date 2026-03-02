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
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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
      const rules = await sql`
        SELECT * FROM onboarding_sla_rules ORDER BY trigger_type, delay_days
      `

      return json({
        rules: rules.map((r: any) => ({
          id: r.id,
          triggerType: r.trigger_type,
          delayDays: r.delay_days,
          action: r.action,
          recipientType: r.recipient_type,
          isActive: r.is_active,
          createdAt: r.created_at,
        })),
      })
    } catch (e: any) {
      console.error('SLA rules fetch error:', e)
      return json({ error: 'Failed to fetch SLA rules', details: e.message }, 500)
    }
  }

  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { rules } = body

      if (!Array.isArray(rules)) {
        return json({ error: 'rules array is required' }, 400)
      }

      for (const rule of rules) {
        if (!rule.id) continue

        await sql`
          UPDATE onboarding_sla_rules SET
            is_active = COALESCE(${rule.is_active !== undefined ? rule.is_active : null}, is_active),
            delay_days = COALESCE(${rule.delay_days !== undefined ? rule.delay_days : null}, delay_days),
            action = COALESCE(${rule.action || null}, action)
          WHERE id = ${rule.id}
        `
      }

      const updated = await sql`
        SELECT * FROM onboarding_sla_rules ORDER BY trigger_type, delay_days
      `

      return json({
        success: true,
        rules: updated.map((r: any) => ({
          id: r.id,
          triggerType: r.trigger_type,
          delayDays: r.delay_days,
          action: r.action,
          recipientType: r.recipient_type,
          isActive: r.is_active,
          createdAt: r.created_at,
        })),
      })
    } catch (e: any) {
      console.error('SLA rules update error:', e)
      return json({ error: 'Failed to update SLA rules', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
