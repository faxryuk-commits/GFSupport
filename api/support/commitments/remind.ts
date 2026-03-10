import { neon } from '@neondatabase/serverless'
import { getRequestOrgId } from '../lib/org.js'

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

// ОТКЛЮЧЕНО: Отправка напоминаний в Telegram-каналы клиентов
// Информирование работает только внутри системы для сотрудников
async function sendTelegramReminder(
  chatId: string, 
  commitment: any
): Promise<boolean> {
  // Отключено - не отправляем напоминания в каналы с клиентами
  console.log(`[Remind] Telegram notifications disabled - skipping channel ${chatId}`)
  return false
  
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return false

  const isOverdue = new Date(commitment.due_date) < new Date()
  const statusEmoji = isOverdue ? '⚠️' : '⏰'
  const statusText = isOverdue ? 'ПРОСРОЧЕНО' : 'Напоминание'
  
  const roleLabels: Record<string, string> = {
    client: '👤 Клиент',
    support: '👨‍💼 Поддержка', 
    team: '👥 Команда',
    partner: '🤝 Партнёр',
  }
  const roleLabel = roleLabels[commitment.sender_role] || commitment.sender_role

  const message = `${statusEmoji} <b>${statusText}</b>

📝 Обязательство: "${commitment.commitment_text}"
👤 Дал: ${commitment.agent_name} (${roleLabel})
⏰ Срок: ${new Date(commitment.due_date).toLocaleString('ru-RU', { 
    timeZone: 'Asia/Tashkent',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })}
${isOverdue ? '\n❗️ Срок истёк. Пожалуйста, обновите статус.' : ''}

Ответьте "готово" или "выполнено" чтобы закрыть обязательство.`

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    })
    const data = await res.json()
    return data.ok === true
  } catch (e) {
    console.error('[Remind] Failed to send Telegram message:', e)
    return false
  }
}

/**
 * Commitments Reminder API
 * 
 * GET - Check and send reminders for due commitments
 * POST - Manually trigger reminder for specific commitment
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  // GET - Check and send reminders
  if (req.method === 'GET') {
    try {
      // Find commitments that need reminders:
      // 1. Status is pending or overdue
      // 2. reminder_at has passed
      // 3. reminder_sent is false
      const dueCommitments = await sql`
        SELECT c.*, ch.telegram_chat_id, ch.name as channel_name
        FROM support_commitments c
        LEFT JOIN support_channels ch ON c.channel_id = ch.id
        WHERE c.status IN ('pending', 'overdue')
          AND c.reminder_sent = false
          AND c.reminder_at IS NOT NULL
          AND c.reminder_at <= NOW()
          AND c.org_id = ${orgId}
        ORDER BY c.due_date ASC
        LIMIT 20
      `

      // Also update overdue status
      await sql`
        UPDATE support_commitments 
        SET status = 'overdue'
        WHERE status = 'pending' 
          AND due_date < NOW()
          AND org_id = ${orgId}
      `

      const results = []
      
      for (const commitment of dueCommitments) {
        if (commitment.telegram_chat_id) {
          const sent = await sendTelegramReminder(commitment.telegram_chat_id, commitment)
          
          if (sent) {
            // Mark reminder as sent
            await sql`
              UPDATE support_commitments 
              SET reminder_sent = true
              WHERE id = ${commitment.id} AND org_id = ${orgId}
            `
            results.push({ 
              id: commitment.id, 
              channel: commitment.channel_name,
              status: 'sent' 
            })
          } else {
            results.push({ 
              id: commitment.id, 
              channel: commitment.channel_name,
              status: 'failed' 
            })
          }
        } else {
          results.push({ 
            id: commitment.id, 
            channel: commitment.channel_name,
            status: 'no_chat_id' 
          })
        }
      }

      // Get counts
      const stats = await sql`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'overdue') as overdue,
          COUNT(*) FILTER (WHERE reminder_sent = false AND reminder_at <= NOW()) as pending_reminders
        FROM support_commitments
        WHERE org_id = ${orgId}
      `

      return json({
        success: true,
        processed: results.length,
        results,
        stats: stats[0] || { pending: 0, overdue: 0, pending_reminders: 0 }
      })

    } catch (e: any) {
      return json({ error: 'Failed to process reminders', details: e.message }, 500)
    }
  }

  // POST - Manually send reminder for specific commitment
  if (req.method === 'POST') {
    try {
      const { commitmentId } = await req.json()
      
      if (!commitmentId) {
        return json({ error: 'commitmentId required' }, 400)
      }

      const commitments = await sql`
        SELECT c.*, ch.telegram_chat_id, ch.name as channel_name
        FROM support_commitments c
        LEFT JOIN support_channels ch ON c.channel_id = ch.id
        WHERE c.id = ${commitmentId} AND c.org_id = ${orgId}
      `

      if (commitments.length === 0) {
        return json({ error: 'Commitment not found' }, 404)
      }

      const commitment = commitments[0]
      
      if (!commitment.telegram_chat_id) {
        return json({ error: 'No Telegram chat ID for this channel' }, 400)
      }

      const sent = await sendTelegramReminder(commitment.telegram_chat_id, commitment)
      
      if (sent) {
        await sql`
          UPDATE support_commitments 
          SET reminder_sent = true
          WHERE id = ${commitmentId} AND org_id = ${orgId}
        `
        return json({ success: true, message: 'Reminder sent' })
      } else {
        return json({ success: false, error: 'Failed to send reminder' }, 500)
      }

    } catch (e: any) {
      return json({ error: 'Failed to send reminder', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
