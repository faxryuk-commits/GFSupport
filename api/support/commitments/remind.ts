import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

async function sendCommitmentNotification(
  orgId: string,
  commitment: any
): Promise<boolean> {
  try {
    const { sendNotification } = await import('../lib/notifications.js')

    const isOverdue = new Date(commitment.due_date) < new Date()
    const dueDate = new Date(commitment.due_date).toLocaleString('ru-RU', {
      timeZone: 'Asia/Tashkent', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    })

    const results = await sendNotification({
      orgId,
      type: isOverdue ? 'sla_breach' : 'agent_decision',
      title: isOverdue
        ? `⚠️ Просроченное обязательство`
        : `⏰ Напоминание об обязательстве`,
      body: `"${(commitment.commitment_text || '').slice(0, 200)}"\n\nОтветственный: ${commitment.agent_name || 'не указан'}\nСрок: ${dueDate}\nКанал: ${commitment.channel_name || 'N/A'}${isOverdue ? '\n\n❗ Срок истёк!' : ''}`,
      channelId: commitment.channel_id,
      channelName: commitment.channel_name,
      priority: isOverdue ? 'high' : 'medium',
      targetRoles: ['admin', 'manager'],
    })

    return results.length > 0
  } catch (e: any) {
    console.error('[Remind] Notification error:', e.message)
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
        const sent = await sendCommitmentNotification(orgId, commitment)
        if (sent) {
          await sql`
            UPDATE support_commitments
            SET reminder_sent = true
            WHERE id = ${commitment.id} AND org_id = ${orgId}
          `
        }
        results.push({
          id: commitment.id,
          channel: commitment.channel_name,
          status: sent ? 'sent' : 'failed',
        })
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
      
      const sent = await sendCommitmentNotification(orgId, commitment)
      
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
