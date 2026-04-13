import { getOrgBotToken, getSQL, json } from '../lib/db.js'
import { getRequestOrgId } from '../lib/org.js'
import { checkOrgRateLimit } from '../lib/rate-limit.js'

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

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const channelId = formData.get('channelId') as string
    const caption = formData.get('caption') as string || ''
    const senderName = formData.get('senderName') as string || 'Support'
    const senderId = formData.get('senderId') as string || null
    const senderUsername = formData.get('senderUsername') as string || null

    if (!file || !channelId) {
      return json({ error: 'file and channelId required' }, 400)
    }

    const orgId = await getRequestOrgId(req)
    const rateCheck = checkOrgRateLimit(orgId || 'unknown')
    if (!rateCheck.allowed) return json({ error: 'Too many requests' }, 429)

    const sql = getSQL()
    const botToken = await getOrgBotToken(orgId)

    if (!botToken) {
      return json({ error: 'Bot token not configured' }, 500)
    }

    const channelResult = await sql`
      SELECT * FROM support_channels WHERE id = ${channelId} AND org_id = ${orgId}
    `

    if (channelResult.length === 0) {
      return json({ error: 'Channel not found' }, 404)
    }

    const channel = channelResult[0]
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const fileType = file.type
    const contentType = fileType.startsWith('image/') ? 'photo'
      : fileType.startsWith('video/') ? 'video'
      : fileType.startsWith('audio/') ? 'voice'
      : 'document'

    let mediaUrl: string | null = null
    let externalMessageId: number | null = null

    if (channel.source === 'whatsapp') {
      const bridgeUrl = process.env.WHATSAPP_BRIDGE_URL
      const bridgeSecret = process.env.WHATSAPP_BRIDGE_SECRET
      if (!bridgeUrl || !bridgeSecret) {
        return json({ error: 'WhatsApp bridge not configured' }, 500)
      }

      const bridgeForm = new FormData()
      bridgeForm.append('file', file, file.name)
      bridgeForm.append('chatId', channel.external_chat_id)
      if (caption) bridgeForm.append('caption', caption)

      const bridgeRes = await fetch(`${bridgeUrl}/send-media`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${bridgeSecret}` },
        body: bridgeForm,
      })
      const bridgeData = await bridgeRes.json() as any
      if (!bridgeData.success) {
        return json({ error: 'WhatsApp media send failed', details: bridgeData.error }, 500)
      }
      mediaUrl = bridgeData.mediaUrl || null
    } else {
      const chatId = channel.telegram_chat_id
      let endpoint = 'sendDocument'
      let fieldName = 'document'

      if (fileType.startsWith('image/')) { endpoint = 'sendPhoto'; fieldName = 'photo' }
      else if (fileType.startsWith('video/')) { endpoint = 'sendVideo'; fieldName = 'video' }
      else if (fileType.startsWith('audio/') || fileType === 'audio/ogg') { endpoint = 'sendVoice'; fieldName = 'voice' }

      const telegramForm = new FormData()
      telegramForm.append('chat_id', chatId.toString())
      telegramForm.append(fieldName, file, file.name)
      if (caption) telegramForm.append('caption', caption)

      const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/${endpoint}`, {
        method: 'POST',
        body: telegramForm,
      })
      const telegramData = await telegramRes.json()

      if (!telegramData.ok) {
        return json({ error: 'Failed to send to Telegram', details: telegramData.description }, 500)
      }

      const tgMessage = telegramData.result
      externalMessageId = tgMessage.message_id

      const fileId = tgMessage.photo?.[tgMessage.photo.length - 1]?.file_id
        || tgMessage.video?.file_id || tgMessage.voice?.file_id || tgMessage.document?.file_id

      if (fileId) {
        const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)
        const fileData = await fileRes.json()
        if (fileData.ok) {
          mediaUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`
        }
      }
    }

    await sql`
      INSERT INTO support_messages (
        id, channel_id, org_id, telegram_message_id, sender_id, sender_name, sender_username, sender_role,
        is_from_client, content_type, text_content, media_url,
        is_read, created_at
      ) VALUES (
        ${messageId}, ${channelId}, ${orgId}, ${externalMessageId}, ${senderId}, ${senderName},
        ${senderUsername}, 'support', false, ${contentType}, ${caption || null},
        ${mediaUrl}, true, NOW()
      )
    `

    await sql`
      UPDATE support_channels SET
        last_message_at = NOW(),
        last_team_message_at = NOW(),
        last_sender_name = ${senderName},
        last_message_preview = ${caption || `[${contentType}]`},
        awaiting_reply = false
      WHERE id = ${channelId} AND org_id = ${orgId}
    `

    return json({
      success: true,
      messageId,
      telegramMessageId: externalMessageId,
      mediaUrl
    })

  } catch (e: any) {
    console.error('Send media error:', e)
    return json({ error: "Internal server error" }, 500)
  }
}
