import { getOrgBotToken, getSQL, json } from '../lib/db.js'
import { getRequestOrgId } from '../lib/org.js'

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const sql = getSQL()
    const orgId = await getRequestOrgId(req)
    const { messageId, reason = 'manual' } = await req.json()

    if (!messageId) {
      return json({ error: 'messageId required' }, 400)
    }

    // Get message details
    const msgResult = await sql`
      SELECT m.*, c.name as channel_name, c.telegram_chat_id
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.id = ${messageId}
        AND m.org_id = ${orgId}
    `

    if (msgResult.length === 0) {
      return json({ error: 'Message not found' }, 404)
    }

    const msg = msgResult[0]

    // Update message urgency to max
    await sql`
      UPDATE support_messages 
      SET ai_urgency = 5, is_problem = true
      WHERE id = ${messageId} AND org_id = ${orgId}
    `

    // Update channel - set awaiting_reply and increment urgency indicator
    await sql`
      UPDATE support_channels
      SET awaiting_reply = true, unread_count = COALESCE(unread_count, 0) + 1
      WHERE id = ${msg.channel_id} AND org_id = ${orgId}
    `

    const escalationId = `esc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

    // Send notification to Telegram (if configured)
    const botToken = await getOrgBotToken(orgId)
    const notifyChatId = process.env.SUPPORT_NOTIFY_CHAT_ID

    if (botToken && notifyChatId) {
      const alertText = `🚨 *ЭСКАЛАЦИЯ*\n\nКанал: ${msg.channel_name}\nОт: ${msg.sender_name}\n\n"${(msg.text_content || '').slice(0, 200)}"\n\nПричина: ${reason}`
      
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: notifyChatId,
          text: alertText,
          parse_mode: 'Markdown'
        })
      })
    }

    return json({
      success: true,
      escalationId,
      message: 'Message escalated successfully'
    })

  } catch (e: any) {
    console.error('Escalation error:', e)
    return json({ error: e.message }, 500)
  }
}
