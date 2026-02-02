import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
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
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const sql = getSQL()
    const { messageId, description, title, priority = 'medium' } = await req.json()

    if (!messageId) {
      return json({ error: 'messageId required' }, 400)
    }

    // Get message details
    const msgResult = await sql`
      SELECT m.*, c.name as channel_name, c.company_id
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.id = ${messageId}
    `

    if (msgResult.length === 0) {
      return json({ error: 'Message not found' }, 404)
    }

    const msg = msgResult[0]

    // Create case
    const caseId = `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const caseTitle = title || msg.ai_summary || description?.slice(0, 100) || 'Новое обращение'

    // Add source_message_id column if not exists
    try {
      await sql`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS source_message_id VARCHAR(64)`
    } catch (e) { /* column exists */ }

    await sql`
      INSERT INTO support_cases (
        id, channel_id, company_id, title, description,
        category, priority, severity, status, source_message_id
      ) VALUES (
        ${caseId},
        ${msg.channel_id},
        ${msg.company_id},
        ${caseTitle},
        ${description || msg.text_content || ''},
        ${msg.ai_category || 'general'},
        ${priority},
        ${msg.ai_urgency >= 4 ? 'critical' : msg.ai_urgency >= 3 ? 'high' : 'normal'},
        'open',
        ${messageId}
      )
    `

    // Link message to case
    await sql`
      UPDATE support_messages SET case_id = ${caseId} WHERE id = ${messageId}
    `

    // Create activity
    await sql`
      INSERT INTO support_case_activities (id, case_id, type, title, description)
      VALUES (
        ${'act_' + Date.now()},
        ${caseId},
        'manual_created',
        'Тикет создан вручную',
        ${'Создан из сообщения от ' + msg.sender_name}
      )
    `

    return json({
      success: true,
      caseId,
      message: 'Case created successfully'
    })

  } catch (e: any) {
    console.error('Create case error:', e)
    return json({ error: e.message }, 500)
  }
}
