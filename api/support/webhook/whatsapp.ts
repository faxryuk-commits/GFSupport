import { neon } from '@neondatabase/serverless'
import { identifySender } from '../lib/identification.js'

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
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function getOrCreateWhatsAppChannel(sql: any, chatId: string, senderName: string): Promise<string> {
  const existing = await sql`
    SELECT id FROM support_channels WHERE external_chat_id = ${chatId} AND source = 'whatsapp' LIMIT 1
  `

  if (existing[0]) return existing[0].id

  const channelId = generateId('ch')
  const channelName = senderName || `WhatsApp ${chatId.replace('@s.whatsapp.net', '')}`

  await sql`
    INSERT INTO support_channels (
      id, name, type, source, external_chat_id, is_active, created_at
    ) VALUES (
      ${channelId}, ${channelName}, 'client', 'whatsapp', ${chatId}, true, NOW()
    )
  `

  return channelId
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
    return json({ ok: true, message: 'WhatsApp webhook endpoint ready' })
  }

  const bridgeSecret = process.env.WHATSAPP_BRIDGE_SECRET
  if (!bridgeSecret) return json({ error: 'Bridge secret not configured' }, 500)

  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${bridgeSecret}`) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()

  try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'telegram'` } catch {}
  try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS external_chat_id VARCHAR(100)` } catch {}
  try { await sql`ALTER TABLE support_channels ALTER COLUMN telegram_chat_id DROP NOT NULL` } catch {}

  try {
    const body = await req.json()
    const { chatId, messageId, senderName, senderPhone, text, mediaUrl, contentType, timestamp, isGroup, groupName } = body

    console.log(`[WA Webhook] Received: chatId=${chatId}, sender=${senderName}, text=${(text || '').slice(0, 50)}, isGroup=${isGroup}`)

    if (!chatId) return json({ error: 'chatId is required' }, 400)

    const channelName = isGroup ? (groupName || senderName) : senderName
    const channelId = await getOrCreateWhatsAppChannel(sql, chatId, channelName || '')

    const identification = await identifySender(sql, {
      username: null,
      telegramId: senderPhone || null,
      senderName: senderName || null,
    })

    const isFromClient = identification.role === 'client'
    const senderRole = identification.role === 'client' ? 'client' : 'support'
    const msgId = generateId('msg')
    const msgContentType = contentType || 'text'

    let responseTimeMs: number | null = null
    if (!isFromClient) {
      try {
        const lastClient = await sql`
          SELECT created_at FROM support_messages
          WHERE channel_id = ${channelId} AND is_from_client = true
          ORDER BY created_at DESC LIMIT 1
        `
        if (lastClient[0]) {
          responseTimeMs = Date.now() - new Date(lastClient[0].created_at).getTime()
        }
      } catch (e) { /* non-critical */ }
    }

    await sql`
      INSERT INTO support_messages (
        id, channel_id, sender_id, sender_name, sender_role,
        is_from_client, content_type, text_content, media_url,
        is_read, response_time_ms, created_at
      ) VALUES (
        ${msgId}, ${channelId}, ${senderPhone || null}, ${senderName || 'Unknown'},
        ${senderRole}, ${isFromClient}, ${msgContentType}, ${text || null},
        ${mediaUrl || null}, ${!isFromClient}, ${responseTimeMs}, NOW()
      )
    `

    const preview = text ? text.slice(0, 100) : `[${msgContentType}]`
    if (isFromClient) {
      await sql`
        UPDATE support_channels SET
          last_message_at = NOW(),
          last_client_message_at = NOW(),
          last_sender_name = ${senderName || 'Unknown'},
          last_message_preview = ${preview},
          awaiting_reply = true,
          unread_count = COALESCE(unread_count, 0) + 1
        WHERE id = ${channelId}
      `
    } else {
      await sql`
        UPDATE support_channels SET
          last_message_at = NOW(),
          last_team_message_at = NOW(),
          last_sender_name = ${senderName || 'Support'},
          last_message_preview = ${preview},
          awaiting_reply = false
        WHERE id = ${channelId}
      `
    }

    console.log(`[WA Webhook] Saved: msgId=${msgId}, channelId=${channelId}, role=${senderRole}`)
    return json({ ok: true, messageId: msgId, channelId })

  } catch (e: any) {
    console.error('[WhatsApp Webhook] Error:', e.message, e.stack?.slice(0, 300))
    return json({ error: e.message }, 500)
  }
}
