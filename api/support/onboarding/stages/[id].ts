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
        'Access-Control-Allow-Methods': 'PUT, OPTIONS',
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
  const stageId = pathParts[pathParts.length - 1]

  if (!stageId || stageId === 'stages') {
    return json({ error: 'Stage ID required' }, 400)
  }

  const sql = getSQL()

  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { status } = body

      const stageResult = await sql`SELECT * FROM onboarding_stages WHERE id = ${stageId}`
      if (!stageResult.length) {
        return json({ error: 'Stage not found' }, 404)
      }

      const stage = stageResult[0]
      const connId = stage.connection_id
      const oldStatus = stage.status

      if (status === 'completed' && oldStatus !== 'completed') {
        await sql`
          UPDATE onboarding_stages
          SET status = 'completed', completed_at = NOW()
          WHERE id = ${stageId}
        `

        const nextStage = await sql`
          SELECT * FROM onboarding_stages
          WHERE connection_id = ${connId} AND sort_order > ${stage.sort_order}
          ORDER BY sort_order ASC
          LIMIT 1
        `

        if (nextStage.length) {
          await sql`
            UPDATE onboarding_stages
            SET status = 'in_progress', started_at = NOW()
            WHERE id = ${nextStage[0].id}
          `
          await sql`
            UPDATE onboarding_connections
            SET current_stage_id = ${nextStage[0].id}, updated_at = NOW()
            WHERE id = ${connId}
          `

          const cmtId = `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          await sql`
            INSERT INTO onboarding_comments (id, connection_id, text, is_system)
            VALUES (${cmtId}, ${connId}, ${`Этап "${stage.name}" завершён. Начат этап "${nextStage[0].name}"`}, true)
          `
        } else {
          const cmtId = `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          await sql`
            INSERT INTO onboarding_comments (id, connection_id, text, is_system)
            VALUES (${cmtId}, ${connId}, ${`Этап "${stage.name}" завершён. Все этапы пройдены!`}, true)
          `
        }

        const updated = await sql`SELECT * FROM onboarding_stages WHERE id = ${stageId}`
        return json({ success: true, stage: updated[0], nextStageId: nextStage[0]?.id || null })
      }

      if (status === 'in_progress' && oldStatus === 'completed') {
        await sql`
          UPDATE onboarding_stages
          SET status = 'in_progress', completed_at = NULL
          WHERE id = ${stageId}
        `
        await sql`
          UPDATE onboarding_connections
          SET current_stage_id = ${stageId}, updated_at = NOW()
          WHERE id = ${connId}
        `

        const cmtId = `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        await sql`
          INSERT INTO onboarding_comments (id, connection_id, text, is_system)
          VALUES (${cmtId}, ${connId}, ${`Этап "${stage.name}" возвращён в работу`}, true)
        `

        const updated = await sql`SELECT * FROM onboarding_stages WHERE id = ${stageId}`
        return json({ success: true, stage: updated[0] })
      }

      return json({ error: 'Invalid status transition' }, 400)
    } catch (e: any) {
      console.error('Onboarding stage update error:', e)
      return json({ error: 'Failed to update stage', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
