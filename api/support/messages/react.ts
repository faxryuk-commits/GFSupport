/**
 * @deprecated Use /api/support/messages/reaction instead
 * This endpoint is kept for backwards compatibility
 */
import { getOrgBotToken, getSQL, json } from '../lib/db.js'
import { getRequestOrgId } from '../lib/org.js'

export const config = {
  runtime: 'edge',
}

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

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const botToken = await getOrgBotToken(orgId)
  if (!botToken) {
    return json({ error: 'Bot not configured' }, 500)
  }

  try {
    const body = await req.json()
    const { messageId, emoji, action = 'toggle' } = body // action: 'add' | 'remove' | 'toggle'

    if (!messageId || !emoji) {
      return json({ error: 'messageId and emoji are required' }, 400)
    }

    // Get message info
    const msgResult = await sql`
      SELECT m.*, ch.telegram_chat_id
      FROM support_messages m
      JOIN support_channels ch ON m.channel_id = ch.id
      WHERE m.id = ${messageId}
        AND m.org_id = ${orgId}
    `

    if (msgResult.length === 0) {
      return json({ error: 'Message not found' }, 404)
    }

    const msg = msgResult[0]

    // Check if bot already has this reaction
    const existingReaction = await sql`
      SELECT id FROM support_reactions 
      WHERE message_id = ${messageId} AND emoji = ${emoji} AND is_from_bot = true
      LIMIT 1
    `
    
    const hasReaction = existingReaction.length > 0
    const shouldAdd = action === 'add' || (action === 'toggle' && !hasReaction)
    const shouldRemove = action === 'remove' || (action === 'toggle' && hasReaction)

    if (shouldRemove && hasReaction) {
      // Remove reaction from Telegram (send empty reaction array)
      const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: msg.telegram_chat_id,
          message_id: msg.telegram_message_id,
          reaction: [], // Empty array removes all bot reactions
          is_big: false
        }),
      })
      
      const telegramData = await telegramRes.json()
      if (!telegramData.ok) {
        console.log('Telegram remove reaction response:', telegramData)
      }

      // Remove from our DB
      await sql`
        DELETE FROM support_reactions 
        WHERE message_id = ${messageId} AND emoji = ${emoji} AND is_from_bot = true
      `

    } else if (shouldAdd && !hasReaction) {
      // Add reaction via Telegram Bot API
      const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: msg.telegram_chat_id,
          message_id: msg.telegram_message_id,
          reaction: [{ type: 'emoji', emoji }],
          is_big: false
        }),
      })

      const telegramData = await telegramRes.json()

      if (!telegramData.ok) {
        return json({ 
          error: 'Failed to set reaction', 
          details: telegramData.description 
        }, 500)
      }

      // Save reaction to our DB
      const reactionId = `react_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      await sql`
        INSERT INTO support_reactions (id, message_id, channel_id, telegram_message_id, emoji, is_from_bot, user_name)
        VALUES (
          ${reactionId},
          ${messageId},
          ${msg.channel_id},
          ${msg.telegram_message_id},
          ${emoji},
          true,
          'Вы'
        )
      `
    }

    // Update aggregated reactions
    const reactionsAgg = await sql`
      SELECT emoji, COUNT(*) as count, array_agg(COALESCE(user_name, 'Bot')) as users
      FROM support_reactions WHERE message_id = ${messageId}
      GROUP BY emoji
    `
    
    const reactionsJson: Record<string, { count: number; users: string[] }> = {}
    for (const r of reactionsAgg) {
      reactionsJson[r.emoji] = { count: parseInt(r.count), users: r.users }
    }

    await sql`
      UPDATE support_messages SET reactions = ${JSON.stringify(reactionsJson)} WHERE id = ${messageId} AND org_id = ${orgId}
    `

    return json({
      success: true,
      action: shouldRemove ? 'removed' : shouldAdd ? 'added' : 'unchanged',
      emoji,
      reactions: reactionsJson
    })

  } catch (e: any) {
    console.error('React error:', e)
    return json({ error: 'Failed to react' }, 500)
  }
}
