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
        'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const url = new URL(req.url)

  // Ensure table and columns exist
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS support_reminders (
        id VARCHAR(50) PRIMARY KEY,
        channel_id VARCHAR(50) NOT NULL,
        case_id VARCHAR(50),
        message_id VARCHAR(100),
        commitment_text TEXT,
        commitment_type VARCHAR(50),
        is_vague BOOLEAN DEFAULT false,
        deadline TIMESTAMPTZ,
        detected_deadline TIMESTAMP,
        auto_deadline TIMESTAMP,
        reminder_at TIMESTAMP,
        escalation_level INTEGER DEFAULT 0,
        assigned_to VARCHAR(50),
        assigned_name VARCHAR(255),
        created_by VARCHAR(255),
        status VARCHAR(30) DEFAULT 'active',
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
  } catch (e) { /* table exists */ }
  
  // Add missing columns if they don't exist
  try {
    await sql`ALTER TABLE support_reminders ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ`
    await sql`ALTER TABLE support_reminders ADD COLUMN IF NOT EXISTS created_by VARCHAR(255)`
  } catch (e) { /* columns exist */ }

  // GET - list reminders
  if (req.method === 'GET') {
    try {
      const status = url.searchParams.get('status') || 'active'
      const channelId = url.searchParams.get('channelId')
      const assignedTo = url.searchParams.get('assignedTo')
      const limit = parseInt(url.searchParams.get('limit') || '50')
      const debug = url.searchParams.get('debug') === 'true'

      // Debug mode - show raw data
      if (debug) {
        const rawData = await sql`SELECT * FROM support_reminders ORDER BY created_at DESC LIMIT 10`
        return json({ debug: true, rawData })
      }

      const reminders = await sql`
        SELECT 
          r.*,
          ch.name as channel_name,
          ch.telegram_chat_id,
          m.text_content as message_text,
          m.sender_name as message_sender
        FROM support_reminders r
        LEFT JOIN support_channels ch ON r.channel_id = ch.id
        LEFT JOIN support_messages m ON r.message_id = m.id
        WHERE 1=1
          ${status === 'all' ? sql`` : status ? sql`AND r.status = ${status}` : sql``}
          ${channelId ? sql`AND r.channel_id = ${channelId}` : sql``}
          ${assignedTo ? sql`AND r.assigned_to = ${assignedTo}` : sql``}
        ORDER BY 
          CASE WHEN r.is_vague THEN 0 ELSE 1 END,
          COALESCE(r.deadline, r.detected_deadline, r.auto_deadline) ASC
        LIMIT ${limit}
      `

      const now = new Date()

      // Calculate urgency for each reminder
      const enrichedReminders = reminders.map((r: any) => {
        const deadlineValue = r.deadline || r.detected_deadline || r.auto_deadline
        const deadline = deadlineValue ? new Date(deadlineValue) : new Date()
        const msLeft = deadline.getTime() - now.getTime()
        const hoursLeft = msLeft / (1000 * 60 * 60)
        const minutesLeft = msLeft / (1000 * 60)

        let urgencyLevel = 'low'
        if (msLeft < 0) urgencyLevel = 'overdue'
        else if (hoursLeft < 1) urgencyLevel = 'critical'
        else if (hoursLeft < 4) urgencyLevel = 'high'
        else if (hoursLeft < 8) urgencyLevel = 'medium'

        // Формируем полный текст обещания из контекста сообщения
        const fullContext = r.message_text 
          ? (r.message_text.length > 200 ? r.message_text.slice(0, 200) + '...' : r.message_text)
          : r.commitment_text
        
        return {
          id: r.id,
          channelId: r.channel_id,
          channelName: r.channel_name || 'Неизвестный канал',
          caseId: r.case_id,
          messageId: r.message_id,
          commitmentText: r.commitment_text,
          commitmentType: r.commitment_type,
          messageContext: fullContext, // Полный контекст сообщения
          messageSender: r.message_sender, // Кто написал сообщение
          isVague: r.is_vague,
          deadline: deadlineValue,
          isAutoDeadline: !r.detected_deadline && !r.deadline,
          reminderAt: r.reminder_at,
          escalationLevel: r.escalation_level || 0,
          assignedTo: r.assigned_to,
          assignedName: r.assigned_name || r.created_by,
          status: r.status,
          createdAt: r.created_at,
          createdBy: r.created_by,
          // Computed fields
          urgencyLevel,
          hoursLeft: Math.round(hoursLeft * 10) / 10,
          minutesLeft: Math.round(minutesLeft),
          timeLeftFormatted: formatTimeLeft(msLeft),
          isOverdue: msLeft < 0,
        }
      })

      // Stats
      const stats = await sql`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'active') as active,
          COUNT(*) FILTER (WHERE status = 'active' AND is_vague = true) as vague,
          COUNT(*) FILTER (WHERE status = 'active' AND COALESCE(deadline, detected_deadline, auto_deadline) < NOW()) as overdue,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'escalated') as escalated
        FROM support_reminders
      `

      return json({
        reminders: enrichedReminders,
        stats: {
          active: parseInt(stats[0]?.active || 0),
          vague: parseInt(stats[0]?.vague || 0),
          overdue: parseInt(stats[0]?.overdue || 0),
          completed: parseInt(stats[0]?.completed || 0),
          escalated: parseInt(stats[0]?.escalated || 0),
        }
      })

    } catch (e: any) {
      return json({ error: 'Failed to fetch reminders', details: e.message }, 500)
    }
  }

  // PATCH - update reminder status
  if (req.method === 'PATCH') {
    try {
      const body = await req.json()
      const { reminderId, action, extendMinutes } = body

      if (!reminderId || !action) {
        return json({ error: 'reminderId and action are required' }, 400)
      }

      if (action === 'complete') {
        await sql`
          UPDATE support_reminders SET 
            status = 'completed',
            completed_at = NOW()
          WHERE id = ${reminderId}
        `
      } else if (action === 'extend' && extendMinutes) {
        await sql`
          UPDATE support_reminders SET 
            detected_deadline = COALESCE(detected_deadline, auto_deadline) + INTERVAL '1 minute' * ${extendMinutes},
            auto_deadline = auto_deadline + INTERVAL '1 minute' * ${extendMinutes},
            reminder_at = reminder_at + INTERVAL '1 minute' * ${extendMinutes},
            escalation_level = GREATEST(0, escalation_level - 1)
          WHERE id = ${reminderId}
        `
      } else if (action === 'dismiss') {
        await sql`
          UPDATE support_reminders SET status = 'dismissed' WHERE id = ${reminderId}
        `
      }

      return json({ success: true, action })

    } catch (e: any) {
      return json({ error: 'Failed to update reminder', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}

function formatTimeLeft(ms: number): string {
  if (ms < 0) {
    const overdue = -ms
    const hours = Math.floor(overdue / (1000 * 60 * 60))
    const mins = Math.floor((overdue % (1000 * 60 * 60)) / (1000 * 60))
    if (hours > 24) return `${Math.floor(hours / 24)}д просрочено`
    if (hours > 0) return `${hours}ч ${mins}м просрочено`
    return `${mins}м просрочено`
  }
  
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  
  if (hours > 24) return `${Math.floor(hours / 24)}д ${hours % 24}ч`
  if (hours > 0) return `${hours}ч ${mins}м`
  return `${mins}м`
}
