import { neon } from '@neondatabase/serverless'
import { identifySender } from '../lib/identification.js'

const problemRe = /ishlamay|ишламай|не\s*работает|not\s*working|kelmay|келмай|не\s*приходит|xato|хато|ошибк|error|muammo|муаммо|проблем|buzil|бузил|сломал|broken|qotib|завис|stuck/i
const urgentRe = /срочно|urgent|tez|тез|shoshilinch|asap|критич|critical|авария/i

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

async function upsertWhatsAppUser(sql: any, phone: string, name: string, channelId: string, role: string) {
  if (!phone || phone.length < 5) return
  try {
    try { await sql`ALTER TABLE support_users ADD COLUMN IF NOT EXISTS phone VARCHAR(50)` } catch {}
    try { await sql`CREATE INDEX IF NOT EXISTS idx_users_phone ON support_users(phone)` } catch {}

    const existing = await sql`
      SELECT id, channels FROM support_users WHERE phone = ${phone} LIMIT 1
    `
    if (existing[0]) {
      const raw = existing[0].channels || []
      const channels: any[] = Array.isArray(raw) ? raw : []
      const has = channels.some((c: any) => (typeof c === 'string' ? c : c?.id) === channelId)
      if (!has) channels.push({ id: channelId, addedAt: new Date().toISOString() })
      await sql`
        UPDATE support_users SET
          name = COALESCE(${name || null}, name),
          channels = ${JSON.stringify(channels)}::jsonb,
          last_seen_at = NOW(), updated_at = NOW()
        WHERE phone = ${phone}
      `
    } else {
      const userId = generateId('user')
      const userRole = role === 'client' ? 'client' : 'employee'
      const channels = [{ id: channelId, addedAt: new Date().toISOString() }]
      await sql`
        INSERT INTO support_users (id, phone, name, role, channels, first_seen_at, last_seen_at, created_at, updated_at)
        VALUES (${userId}, ${phone}, ${name || phone}, ${userRole}, ${JSON.stringify(channels)}::jsonb, NOW(), NOW(), NOW(), NOW())
        ON CONFLICT DO NOTHING
      `
    }
  } catch (e: any) {
    console.error('[WA Webhook] upsertUser error:', e.message)
  }
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

async function handleReaction(sql: any, body: any): Promise<Response> {
  const { chatId, emoji, targetMessageId, senderName } = body
  if (!chatId || !targetMessageId) return json({ ok: true, skipped: 'no target' })

  try {
    const channelRows = await sql`
      SELECT id FROM support_channels WHERE external_chat_id = ${chatId} AND source = 'whatsapp' LIMIT 1
    `
    if (!channelRows[0]) return json({ ok: true, skipped: 'channel not found' })
    const channelId = channelRows[0].id

    const msgRows = await sql`
      SELECT id, reactions FROM support_messages
      WHERE channel_id = ${channelId}
      ORDER BY created_at DESC LIMIT 50
    `
    const target = msgRows.find((m: any) => m.id?.includes(targetMessageId))
    if (!target) return json({ ok: true, skipped: 'message not found' })

    const reactions: Record<string, string[]> = target.reactions || {}
    if (emoji) {
      if (!reactions[emoji]) reactions[emoji] = []
      if (!reactions[emoji].includes(senderName)) reactions[emoji].push(senderName)
    }

    await sql`UPDATE support_messages SET reactions = ${JSON.stringify(reactions)}::jsonb WHERE id = ${target.id}`
    return json({ ok: true, reaction: emoji })
  } catch (e: any) {
    console.error('[WA Reaction]', e.message)
    return json({ ok: true, error: e.message })
  }
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
  try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS thumbnail_url TEXT` } catch {}
  try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS file_name TEXT` } catch {}
  try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS mime_type TEXT` } catch {}
  try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS reply_to_text TEXT` } catch {}
  try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS reply_to_sender TEXT` } catch {}
  try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS forwarded_from TEXT` } catch {}
  try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS reactions JSONB` } catch {}

  try {
    const body = await req.json()

    if (body.type === 'reaction') {
      return await handleReaction(sql, body)
    }

    const { chatId, messageId, senderName, senderPhone, text, mediaUrl, thumbnailUrl,
            contentType, mimeType, fileName, timestamp, isGroup, fromMe, groupName,
            replyToMessageId, replyToText } = body

    console.log(`[WA Webhook] Received: chatId=${chatId}, type=${contentType}, sender=${senderName}, fromMe=${fromMe}, media=${!!mediaUrl}`)

    if (!chatId) return json({ error: 'chatId is required' }, 400)

    const channelName = isGroup ? (groupName || senderName) : senderName
    const channelId = await getOrCreateWhatsAppChannel(sql, chatId, channelName || '')

    let isFromClient: boolean
    let senderRole: string

    if (fromMe) {
      isFromClient = false
      senderRole = 'support'
    } else {
      const identification = await identifySender(sql, {
        username: null,
        telegramId: senderPhone || null,
        senderName: senderName || null,
      })
      isFromClient = identification.role === 'client'
      senderRole = identification.role === 'client' ? 'client' : 'support'
    }
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
      } catch { /* non-critical */ }
    }

    await sql`
      INSERT INTO support_messages (
        id, channel_id, sender_id, sender_name, sender_role,
        is_from_client, content_type, text_content, media_url,
        thumbnail_url, file_name, mime_type,
        reply_to_message_id, reply_to_text,
        is_read, response_time_ms, created_at
      ) VALUES (
        ${msgId}, ${channelId}, ${senderPhone || null}, ${senderName || 'Unknown'},
        ${senderRole}, ${isFromClient}, ${msgContentType}, ${text || null},
        ${mediaUrl || null},
        ${thumbnailUrl || null}, ${fileName || null}, ${mimeType || null},
        ${replyToMessageId || null}, ${replyToText || null},
        ${!isFromClient}, ${responseTimeMs}, NOW()
      )
    `

    const preview = text ? text.slice(0, 100) : `[${msgContentType}]`
    if (isFromClient) {
      await sql`
        UPDATE support_channels SET
          last_message_at = NOW(), last_client_message_at = NOW(),
          last_sender_name = ${senderName || 'Unknown'},
          last_message_preview = ${preview},
          awaiting_reply = true,
          unread_count = COALESCE(unread_count, 0) + 1
        WHERE id = ${channelId}
      `
    } else {
      await sql`
        UPDATE support_channels SET
          last_message_at = NOW(), last_team_message_at = NOW(),
          last_sender_name = ${senderName || 'Support'},
          last_message_preview = ${preview},
          awaiting_reply = false
        WHERE id = ${channelId}
      `
    }

    if (!fromMe && senderPhone) {
      upsertWhatsAppUser(sql, senderPhone, senderName || '', channelId, senderRole).catch(() => {})
    }

    if (isFromClient && text && problemRe.test(text)) {
      try {
        const existing = await sql`
          SELECT id FROM support_cases
          WHERE channel_id = ${channelId} AND status NOT IN ('resolved','closed')
            AND created_at >= NOW() - INTERVAL '24 hours' LIMIT 1
        `
        if (!existing[0]) {
          const caseId = generateId('case')
          const priority = urgentRe.test(text) ? 'high' : 'medium'
          const maxRow = await sql`SELECT COALESCE(MAX(ticket_number), 1000) as n FROM support_cases`
          const ticketNum = parseInt(maxRow[0]?.n || '1000') + 1
          await sql`
            INSERT INTO support_cases (id, ticket_number, channel_id, title, description, priority, status, source_message_id)
            VALUES (${caseId}, ${ticketNum}, ${channelId}, ${(text).slice(0, 100)}, ${text.slice(0, 500)}, ${priority}, 'detected', ${msgId})
          `
        }
      } catch (e: any) { console.error('[WA Case]', e.message) }
    }

    return json({ ok: true, messageId: msgId, channelId })

  } catch (e: any) {
    console.error('[WhatsApp Webhook] Error:', e.message, e.stack?.slice(0, 300))
    return json({ error: e.message }, 500)
  }
}
