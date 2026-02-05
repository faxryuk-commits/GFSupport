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
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Commitments API - отслеживание обещаний и напоминаний
 * 
 * GET - список обещаний (фильтр по статусу, агенту, каналу)
 * POST - создать обещание
 * PUT - обновить статус обещания
 * DELETE - удалить обещание
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const sql = getSQL()
  const url = new URL(req.url)

  // Ensure table exists
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS support_commitments (
        id VARCHAR(50) PRIMARY KEY,
        channel_id VARCHAR(100) NOT NULL,
        message_id VARCHAR(100),
        agent_id VARCHAR(100),
        agent_name VARCHAR(255),
        commitment_text TEXT NOT NULL,
        commitment_type VARCHAR(30) DEFAULT 'promise',
        due_date TIMESTAMP,
        reminder_at TIMESTAMP,
        status VARCHAR(20) DEFAULT 'pending',
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
  } catch (e) { /* table exists */ }

  // GET - список обещаний
  if (req.method === 'GET') {
    try {
      const status = url.searchParams.get('status') || 'pending'
      const agentId = url.searchParams.get('agentId')
      const channelId = url.searchParams.get('channelId')
      const dueSoon = url.searchParams.get('dueSoon') === 'true'

      let commitments: any[]

      if (dueSoon) {
        // Обещания со сроком в ближайшие 24 часа
        commitments = await sql`
          SELECT c.*, ch.name as channel_name, ch.telegram_chat_id
          FROM support_commitments c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          WHERE c.status IN ('pending', 'overdue')
            AND c.due_date IS NOT NULL
            AND c.due_date < NOW() + INTERVAL '24 hours'
          ORDER BY c.due_date ASC
          LIMIT 50
        `
      } else if (channelId) {
        commitments = await sql`
          SELECT c.*, ch.name as channel_name, ch.telegram_chat_id
          FROM support_commitments c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          WHERE c.channel_id = ${channelId}
          ORDER BY c.created_at DESC
          LIMIT 100
        `
      } else if (agentId) {
        commitments = await sql`
          SELECT c.*, ch.name as channel_name, ch.telegram_chat_id
          FROM support_commitments c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          WHERE c.agent_id = ${agentId}
            AND c.status = ${status}
          ORDER BY c.due_date ASC NULLS LAST, c.created_at DESC
          LIMIT 100
        `
      } else {
        commitments = await sql`
          SELECT c.*, ch.name as channel_name, ch.telegram_chat_id
          FROM support_commitments c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          WHERE c.status = ${status}
          ORDER BY c.due_date ASC NULLS LAST, c.created_at DESC
          LIMIT 100
        `
      }

      // Подсчёт по статусам
      const stats = await sql`
        SELECT 
          status,
          COUNT(*) as count
        FROM support_commitments
        GROUP BY status
      `

      const statsMap = Object.fromEntries(
        stats.map((s: any) => [s.status, parseInt(s.count)])
      )

      // Check for overdue commitments and update their status
      await sql`
        UPDATE support_commitments 
        SET status = 'overdue'
        WHERE status = 'pending' 
          AND due_date < NOW()
      `.catch(() => {})

      // Recount stats after update
      const updatedStats = await sql`
        SELECT 
          status,
          COUNT(*) as count
        FROM support_commitments
        GROUP BY status
      `
      const updatedStatsMap = Object.fromEntries(
        updatedStats.map((s: any) => [s.status, parseInt(s.count)])
      )

      return json({
        commitments: commitments.map((c: any) => ({
          id: c.id,
          channelId: c.channel_id,
          channelName: c.channel_name,
          telegramChatId: c.telegram_chat_id,
          messageId: c.message_id,
          agentId: c.agent_id,
          agentName: c.agent_name,
          senderRole: c.sender_role,
          text: c.commitment_text,
          type: c.commitment_type,
          isVague: c.is_vague,
          dueDate: c.due_date,
          reminderAt: c.reminder_at,
          reminderSent: c.reminder_sent,
          status: c.status,
          completedAt: c.completed_at,
          createdAt: c.created_at,
        })),
        stats: {
          pending: updatedStatsMap.pending || 0,
          completed: updatedStatsMap.completed || 0,
          overdue: updatedStatsMap.overdue || 0,
          cancelled: updatedStatsMap.cancelled || 0,
        }
      })

    } catch (e: any) {
      return json({ error: 'Failed to fetch commitments', details: e.message }, 500)
    }
  }

  // POST - создать обещание
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { 
        channelId, 
        messageId, 
        agentId, 
        agentName, 
        text, 
        type = 'promise',
        dueDate,
        reminderAt 
      } = body

      if (!channelId || !text) {
        return json({ error: 'channelId and text are required' }, 400)
      }

      const id = generateId('commit')

      await sql`
        INSERT INTO support_commitments (
          id, channel_id, message_id, agent_id, agent_name,
          commitment_text, commitment_type, due_date, reminder_at
        ) VALUES (
          ${id}, ${channelId}, ${messageId || null}, ${agentId || null}, ${agentName || null},
          ${text}, ${type}, ${dueDate || null}, ${reminderAt || null}
        )
      `

      return json({ success: true, id })

    } catch (e: any) {
      return json({ error: 'Failed to create commitment', details: e.message }, 500)
    }
  }

  // PUT - обновить статус
  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { id, status, dueDate, reminderAt } = body

      if (!id) {
        return json({ error: 'id is required' }, 400)
      }

      if (status === 'completed') {
        await sql`
          UPDATE support_commitments 
          SET status = 'completed', completed_at = NOW()
          WHERE id = ${id}
        `
      } else if (status) {
        await sql`
          UPDATE support_commitments SET status = ${status}
          WHERE id = ${id}
        `
      }

      if (dueDate !== undefined) {
        await sql`
          UPDATE support_commitments SET due_date = ${dueDate}
          WHERE id = ${id}
        `
      }

      if (reminderAt !== undefined) {
        await sql`
          UPDATE support_commitments SET reminder_at = ${reminderAt}
          WHERE id = ${id}
        `
      }

      return json({ success: true })

    } catch (e: any) {
      return json({ error: 'Failed to update commitment', details: e.message }, 500)
    }
  }

  // DELETE - удалить
  if (req.method === 'DELETE') {
    try {
      const id = url.searchParams.get('id')
      if (!id) {
        return json({ error: 'id is required' }, 400)
      }

      await sql`DELETE FROM support_commitments WHERE id = ${id}`
      return json({ success: true })

    } catch (e: any) {
      return json({ error: 'Failed to delete commitment', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
