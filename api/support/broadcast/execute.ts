import { neon } from '@neondatabase/serverless'
import { getRequestOrgId } from '../lib/org.js'

export const config = {
  runtime: 'edge',
  maxDuration: 60,
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

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

async function getActiveBotToken(): Promise<string | null> {
  try {
    const sql = getSQL()
    const rows = await sql`SELECT value FROM support_settings WHERE key = 'telegram_bot_token' LIMIT 1`
    if (rows[0]?.value) return rows[0].value
  } catch {}
  return process.env.TELEGRAM_BOT_TOKEN || null
}

async function sendTelegramMessage(chatId: string | number, text: string, botToken: string, parseMode = 'HTML') {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  })
  return response.json()
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const url = new URL(req.url)
  const cronSecret = url.searchParams.get('secret')
  const expectedSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('Authorization')
  if (expectedSecret && cronSecret !== expectedSecret && !authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  try {
    // Fail broadcasts stuck in 'processing' for more than 10 minutes (based on sent_at used as processing_started_at)
    await sql`
      UPDATE support_broadcast_scheduled 
      SET status = 'failed', error_message = 'Timed out after 10 minutes in processing'
      WHERE org_id = ${orgId}
        AND status = 'processing'
        AND sent_at IS NOT NULL
        AND sent_at < NOW() - INTERVAL '10 minutes'
    `.catch(() => {})

    const pendingBroadcasts = await sql`
      SELECT * FROM support_broadcast_scheduled 
      WHERE org_id = ${orgId}
        AND status = 'pending' 
        AND scheduled_at <= NOW()
      ORDER BY scheduled_at ASC
      LIMIT 5
    `

    if (pendingBroadcasts.length === 0) {
      return json({ success: true, message: 'No pending broadcasts', executed: 0 })
    }

    const botToken = await getActiveBotToken()
    if (!botToken) {
      // Mark all pending as failed so they don't loop
      for (const b of pendingBroadcasts) {
        await sql`
          UPDATE support_broadcast_scheduled 
          SET status = 'failed', error_message = 'Telegram bot token не настроен'
          WHERE id = ${b.id} AND org_id = ${orgId} AND status = 'pending'
        `.catch(() => {})
      }
      return json({ success: false, error: 'Telegram bot token не настроен, рассылки помечены как failed' }, 400)
    }

    const results: any[] = []

    for (const scheduled of pendingBroadcasts) {
      try {
        // Atomic lock: UPDATE only if still 'pending', use sent_at as processing timestamp
        const locked = await sql`
          UPDATE support_broadcast_scheduled 
          SET status = 'processing', sent_at = NOW()
          WHERE id = ${scheduled.id} AND org_id = ${orgId} AND status = 'pending'
          RETURNING id
        `

        // Another process already picked this up
        if (!locked || locked.length === 0) {
          results.push({ scheduledId: scheduled.id, success: false, error: 'Already processing' })
          continue
        }

        // Check if already sent (deduplication by broadcast_id)
        if (scheduled.broadcast_id) {
          await sql`
            UPDATE support_broadcast_scheduled 
            SET status = 'sent'
            WHERE id = ${scheduled.id} AND org_id = ${orgId}
          `
          results.push({ scheduledId: scheduled.id, success: false, error: 'Already has broadcast_id' })
          continue
        }

        // Re-check status isn't cancelled (could be cancelled between SELECT and UPDATE)
        const current = await sql`
          SELECT status FROM support_broadcast_scheduled 
          WHERE id = ${scheduled.id} AND org_id = ${orgId}
        `
        if (current[0]?.status === 'cancelled') {
          results.push({ scheduledId: scheduled.id, success: false, error: 'Cancelled' })
          continue
        }

        let channels
        if (scheduled.filter_type === 'selected' && scheduled.selected_channels?.length > 0) {
          channels = await sql`
            SELECT id, telegram_chat_id, name FROM support_channels
            WHERE id = ANY(${scheduled.selected_channels}) AND telegram_chat_id IS NOT NULL AND org_id = ${orgId}
          `
        } else if (scheduled.filter_type === 'active') {
          channels = await sql`
            SELECT id, telegram_chat_id, name FROM support_channels
            WHERE telegram_chat_id IS NOT NULL AND org_id = ${orgId} AND last_message_at > NOW() - INTERVAL '30 days'
          `
        } else if (scheduled.filter_type === 'clients') {
          channels = await sql`
            SELECT id, telegram_chat_id, name FROM support_channels
            WHERE telegram_chat_id IS NOT NULL AND org_id = ${orgId} AND (type = 'client' OR sla_category = 'client')
          `
        } else if (scheduled.filter_type === 'partners') {
          channels = await sql`
            SELECT id, telegram_chat_id, name FROM support_channels
            WHERE telegram_chat_id IS NOT NULL AND org_id = ${orgId} AND (type = 'partner' OR sla_category = 'partner')
          `
        } else {
          channels = await sql`
            SELECT id, telegram_chat_id, name FROM support_channels
            WHERE telegram_chat_id IS NOT NULL AND org_id = ${orgId}
          `
        }

        if (channels.length === 0) {
          await sql`
            UPDATE support_broadcast_scheduled 
            SET status = 'failed', error_message = 'No channels found'
            WHERE id = ${scheduled.id} AND org_id = ${orgId}
          `
          results.push({ scheduledId: scheduled.id, success: false, error: 'No channels found' })
          continue
        }

        const broadcastId = `bc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

        // Immediately write broadcast_id to prevent re-execution
        await sql`
          UPDATE support_broadcast_scheduled 
          SET broadcast_id = ${broadcastId}
          WHERE id = ${scheduled.id} AND org_id = ${orgId}
        `

        const typeEmoji: Record<string, string> = { announcement: '📢', update: '🔄', warning: '⚠️' }
        const typeNames: Record<string, string> = { announcement: 'Объявление', update: 'Обновление', warning: 'Предупреждение' }
        const emoji = typeEmoji[scheduled.message_type] || '📢'
        const typeName = typeNames[scheduled.message_type] || 'Объявление'
        const formattedMessage = `${emoji} <b>${typeName}</b>\n\n${scheduled.message_text}\n\n<i>— ${scheduled.created_by || 'Support'}</i>`

        let successful = 0
        let failed = 0

        for (const channel of channels) {
          // Check if cancelled mid-send
          if (successful + failed > 0 && (successful + failed) % 20 === 0) {
            const check = await sql`
              SELECT status FROM support_broadcast_scheduled 
              WHERE id = ${scheduled.id} AND org_id = ${orgId}
            `
            if (check[0]?.status === 'cancelled') {
              break
            }
          }

          try {
            const result = await sendTelegramMessage(channel.telegram_chat_id, formattedMessage, botToken)
            if (result.ok) {
              successful++
              const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
              await sql`
                INSERT INTO support_messages (
                  id, channel_id, org_id, telegram_message_id, sender_name, sender_role,
                  content_type, text_content, created_at
                ) VALUES (
                  ${msgId}, ${channel.id}, ${orgId}, ${result.result?.message_id}, 
                  ${scheduled.created_by || 'Broadcast'}, 'broadcast',
                  'text', ${scheduled.message_text}, NOW()
                )
              `.catch(() => {})
            } else {
              failed++
            }
          } catch {
            failed++
          }
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        // Final status check — could have been cancelled during sending
        const finalCheck = await sql`
          SELECT status FROM support_broadcast_scheduled 
          WHERE id = ${scheduled.id} AND org_id = ${orgId}
        `
        const wasCancelled = finalCheck[0]?.status === 'cancelled'

        await sql`
          INSERT INTO support_broadcasts (
            id, org_id, message_type, message_text, filter_type, sender_name,
            channels_count, successful_count, failed_count, created_at
          ) VALUES (
            ${broadcastId}, ${orgId}, ${scheduled.message_type}, ${scheduled.message_text},
            ${scheduled.filter_type}, ${scheduled.created_by || 'Scheduled'},
            ${channels.length}, ${successful}, ${failed}, NOW()
          )
        `.catch(() => {})

        if (!wasCancelled) {
          await sql`
            UPDATE support_broadcast_scheduled 
            SET status = 'sent', sent_at = NOW(),
                recipients_count = ${channels.length}, delivered_count = ${successful}
            WHERE id = ${scheduled.id} AND org_id = ${orgId}
          `
        }

        results.push({
          scheduledId: scheduled.id,
          broadcastId,
          success: true,
          channels: channels.length,
          successful,
          failed,
          cancelled: wasCancelled,
        })

      } catch (e: any) {
        await sql`
          UPDATE support_broadcast_scheduled 
          SET status = 'failed', error_message = ${e.message?.slice(0, 500)}
          WHERE id = ${scheduled.id} AND org_id = ${orgId}
        `.catch(() => {})
        results.push({ scheduledId: scheduled.id, success: false, error: e.message })
      }
    }

    return json({
      success: true,
      message: `Executed ${results.length} scheduled broadcasts`,
      executed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    })

  } catch (e: any) {
    console.error('[Broadcast Execute Error]', e)
    return json({ success: false, error: e.message }, 500)
  }
}
