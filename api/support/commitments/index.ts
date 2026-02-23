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

  // Ensure table exists with all required fields
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS support_commitments (
        id VARCHAR(50) PRIMARY KEY,
        channel_id VARCHAR(100) NOT NULL,
        case_id VARCHAR(100),
        message_id VARCHAR(100),
        agent_id VARCHAR(100),
        agent_name VARCHAR(255),
        sender_role VARCHAR(30),
        commitment_text TEXT NOT NULL,
        commitment_type VARCHAR(30) DEFAULT 'promise',
        is_vague BOOLEAN DEFAULT false,
        priority VARCHAR(20) DEFAULT 'medium',
        due_date TIMESTAMPTZ,
        reminder_at TIMESTAMPTZ,
        reminder_sent BOOLEAN DEFAULT false,
        status VARCHAR(20) DEFAULT 'pending',
        notes TEXT,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
    // Add missing columns if table already exists
    await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS case_id VARCHAR(100)`.catch(() => {})
    await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium'`.catch(() => {})
    await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS notes TEXT`.catch(() => {})
    await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`.catch(() => {})
    await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS sender_role VARCHAR(30)`.catch(() => {})
    await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS is_vague BOOLEAN DEFAULT false`.catch(() => {})
  } catch (e) { /* table exists */ }

  // GET - список обещаний
  if (req.method === 'GET') {
    try {
      const status = url.searchParams.get('status') || 'pending'
      const agentId = url.searchParams.get('agentId')
      const channelId = url.searchParams.get('channelId')
      const dueSoon = url.searchParams.get('dueSoon') === 'true'

      // Сначала обновляем статусы просроченных обязательств
      await sql`
        UPDATE support_commitments 
        SET status = 'overdue', updated_at = NOW()
        WHERE status = 'pending' 
          AND due_date < NOW()
      `.catch(() => {})

      // Подсчёт по статусам (после обновления)
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

      const page = parseInt(url.searchParams.get('page') || '1')
      const limit = parseInt(url.searchParams.get('limit') || '50')
      const offset = (page - 1) * limit

      let commitments: any[]

      if (dueSoon) {
        commitments = await sql`
          SELECT c.*, ch.name as channel_name, ch.telegram_chat_id
          FROM support_commitments c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          WHERE c.status IN ('pending', 'overdue')
            AND c.due_date IS NOT NULL
            AND c.due_date < NOW() + INTERVAL '24 hours'
          ORDER BY c.due_date ASC
          LIMIT ${limit} OFFSET ${offset}
        `
      } else if (channelId) {
        commitments = await sql`
          SELECT c.*, ch.name as channel_name, ch.telegram_chat_id
          FROM support_commitments c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          WHERE c.channel_id = ${channelId}
          ORDER BY c.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      } else if (agentId) {
        // pending = pending + overdue
        const statusCondition = status === 'pending' ? ['pending', 'overdue'] : [status]
        commitments = await sql`
          SELECT c.*, ch.name as channel_name, ch.telegram_chat_id
          FROM support_commitments c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          WHERE c.agent_id = ${agentId}
            AND c.status = ANY(${statusCondition})
          ORDER BY c.due_date ASC NULLS LAST, c.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      } else {
        // pending = pending + overdue
        const statusCondition = status === 'pending' ? ['pending', 'overdue'] : [status]
        commitments = await sql`
          SELECT c.*, ch.name as channel_name, ch.telegram_chat_id
          FROM support_commitments c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          WHERE c.status = ANY(${statusCondition})
          ORDER BY c.due_date ASC NULLS LAST, c.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      }

      const totalPendingAndOverdue = (updatedStatsMap.pending || 0) + (updatedStatsMap.overdue || 0)

      return json({
        commitments: commitments.map((c: any) => ({
          id: c.id,
          channelId: c.channel_id,
          channelName: c.channel_name,
          caseId: c.case_id,
          telegramChatId: c.telegram_chat_id,
          messageId: c.message_id,
          agentId: c.agent_id,
          agentName: c.agent_name,
          assignedTo: c.agent_id,
          assigneeName: c.agent_name,
          senderRole: c.sender_role,
          text: c.commitment_text,
          type: c.commitment_type,
          isVague: c.is_vague,
          priority: c.priority || 'medium',
          dueDate: c.due_date,
          reminderAt: c.reminder_at,
          reminderSent: c.reminder_sent,
          status: c.status,
          notes: c.notes,
          completedAt: c.completed_at,
          createdAt: c.created_at,
          updatedAt: c.updated_at || c.created_at,
        })),
        total: commitments.length,
        page,
        limit,
        hasMore: commitments.length === limit,
        stats: {
          pending: updatedStatsMap.pending || 0,
          completed: updatedStatsMap.completed || 0,
          overdue: updatedStatsMap.overdue || 0,
          cancelled: updatedStatsMap.cancelled || 0,
        },
        overdue: updatedStatsMap.overdue || 0,
        pending: updatedStatsMap.pending || 0,
        completed: updatedStatsMap.completed || 0,
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
        caseId,
        messageId, 
        agentId,
        assignedTo, // alias
        agentName,
        assigneeName, // alias 
        text, 
        type = 'promise',
        priority = 'medium',
        dueDate,
        reminderAt 
      } = body

      if (!channelId || !text) {
        return json({ error: 'channelId and text are required' }, 400)
      }

      const id = generateId('commit')
      const finalAgentId = agentId || assignedTo || null
      const finalAgentName = agentName || assigneeName || null

      // Calculate reminder time if not provided (1 hour before due date)
      let finalReminderAt = reminderAt
      if (!finalReminderAt && dueDate) {
        const dueTime = new Date(dueDate).getTime()
        finalReminderAt = new Date(dueTime - 60 * 60 * 1000).toISOString()
      }

      await sql`
        INSERT INTO support_commitments (
          id, channel_id, case_id, message_id, agent_id, agent_name,
          commitment_text, commitment_type, priority, due_date, reminder_at, created_at, updated_at
        ) VALUES (
          ${id}, ${channelId}, ${caseId || null}, ${messageId || null}, 
          ${finalAgentId}, ${finalAgentName},
          ${text}, ${type}, ${priority}, 
          ${dueDate || null}::timestamptz, ${finalReminderAt || null}::timestamptz,
          NOW(), NOW()
        )
      `

      return json({ 
        success: true, 
        id,
        commitment: {
          id,
          channelId,
          caseId,
          messageId,
          assignedTo: finalAgentId,
          assigneeName: finalAgentName,
          text,
          type,
          priority,
          dueDate,
          status: 'pending',
          createdAt: new Date().toISOString(),
        }
      })

    } catch (e: any) {
      return json({ error: 'Failed to create commitment', details: e.message }, 500)
    }
  }

  // PUT - обновить статус
  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { id, status, dueDate, reminderAt, priority, notes, assignedTo, assigneeName, text } = body

      if (!id) {
        return json({ error: 'id is required' }, 400)
      }

      // Build dynamic update
      const updates: string[] = ['updated_at = NOW()']
      const values: any[] = []

      if (status === 'completed') {
        await sql`
          UPDATE support_commitments 
          SET status = 'completed', completed_at = NOW(), updated_at = NOW()
          WHERE id = ${id}
        `
      } else if (status) {
        await sql`
          UPDATE support_commitments 
          SET status = ${status}, updated_at = NOW()
          WHERE id = ${id}
        `
      }

      if (dueDate !== undefined) {
        await sql`
          UPDATE support_commitments 
          SET due_date = ${dueDate}::timestamptz, updated_at = NOW()
          WHERE id = ${id}
        `
      }

      if (reminderAt !== undefined) {
        await sql`
          UPDATE support_commitments 
          SET reminder_at = ${reminderAt}::timestamptz, updated_at = NOW()
          WHERE id = ${id}
        `
      }

      if (priority !== undefined) {
        await sql`
          UPDATE support_commitments 
          SET priority = ${priority}, updated_at = NOW()
          WHERE id = ${id}
        `
      }

      if (notes !== undefined) {
        await sql`
          UPDATE support_commitments 
          SET notes = ${notes}, updated_at = NOW()
          WHERE id = ${id}
        `
      }

      if (assignedTo !== undefined) {
        await sql`
          UPDATE support_commitments 
          SET agent_id = ${assignedTo}, updated_at = NOW()
          WHERE id = ${id}
        `
      }

      if (assigneeName !== undefined) {
        await sql`
          UPDATE support_commitments 
          SET agent_name = ${assigneeName}, updated_at = NOW()
          WHERE id = ${id}
        `
      }

      if (text !== undefined) {
        await sql`
          UPDATE support_commitments 
          SET commitment_text = ${text}, updated_at = NOW()
          WHERE id = ${id}
        `
      }

      // Fetch updated commitment
      const updated = await sql`
        SELECT c.*, ch.name as channel_name
        FROM support_commitments c
        LEFT JOIN support_channels ch ON c.channel_id = ch.id
        WHERE c.id = ${id}
      `

      const c = updated[0]
      return json({ 
        success: true,
        commitment: c ? {
          id: c.id,
          channelId: c.channel_id,
          channelName: c.channel_name,
          caseId: c.case_id,
          messageId: c.message_id,
          assignedTo: c.agent_id,
          assigneeName: c.agent_name,
          text: c.commitment_text,
          type: c.commitment_type,
          priority: c.priority || 'medium',
          dueDate: c.due_date,
          status: c.status,
          notes: c.notes,
          completedAt: c.completed_at,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        } : null
      })

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
