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
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const channelId = formData.get('channelId') as string
    const caption = formData.get('caption') as string || ''
    const senderName = formData.get('senderName') as string || 'Support'

    if (!file || !channelId) {
      return json({ error: 'file and channelId required' }, 400)
    }

    const sql = getSQL()
    const botToken = process.env.TELEGRAM_BOT_TOKEN

    if (!botToken) {
      return json({ error: 'Bot token not configured' }, 500)
    }

    // Get channel info
    const channelResult = await sql`
      SELECT telegram_chat_id FROM support_channels WHERE id = ${channelId}
    `

    if (channelResult.length === 0) {
      return json({ error: 'Channel not found' }, 404)
    }

    const chatId = channelResult[0].telegram_chat_id

    // Determine file type and endpoint
    const fileType = file.type
    let endpoint = 'sendDocument'
    let fieldName = 'document'

    if (fileType.startsWith('image/')) {
      endpoint = 'sendPhoto'
      fieldName = 'photo'
    } else if (fileType.startsWith('video/')) {
      endpoint = 'sendVideo'
      fieldName = 'video'
    } else if (fileType.startsWith('audio/') || fileType === 'audio/ogg') {
      endpoint = 'sendVoice'
      fieldName = 'voice'
    }

    // Send to Telegram
    const telegramForm = new FormData()
    telegramForm.append('chat_id', chatId.toString())
    telegramForm.append(fieldName, file, file.name)
    if (caption) {
      telegramForm.append('caption', caption)
    }

    const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/${endpoint}`, {
      method: 'POST',
      body: telegramForm
    })

    const telegramData = await telegramRes.json()

    if (!telegramData.ok) {
      console.error('Telegram error:', telegramData)
      return json({ error: 'Failed to send to Telegram', details: telegramData.description }, 500)
    }

    const tgMessage = telegramData.result

    // Save to our database
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const contentType = fileType.startsWith('image/') ? 'photo' 
      : fileType.startsWith('video/') ? 'video'
      : fileType.startsWith('audio/') ? 'voice'
      : 'document'

    // Get file URL from Telegram
    let mediaUrl = null
    const fileId = tgMessage.photo?.[tgMessage.photo.length - 1]?.file_id 
      || tgMessage.video?.file_id 
      || tgMessage.voice?.file_id 
      || tgMessage.document?.file_id

    if (fileId) {
      const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)
      const fileData = await fileRes.json()
      if (fileData.ok) {
        mediaUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`
      }
    }

    await sql`
      INSERT INTO support_messages (
        id, channel_id, telegram_message_id, sender_name, sender_role,
        is_from_client, content_type, text_content, media_url, media_file_id,
        is_read, created_at
      ) VALUES (
        ${messageId},
        ${channelId},
        ${tgMessage.message_id},
        ${senderName},
        'support',
        false,
        ${contentType},
        ${caption || null},
        ${mediaUrl},
        ${fileId},
        true,
        NOW()
      )
    `

    // Update channel
    await sql`
      UPDATE support_channels SET
        last_message_at = NOW(),
        last_team_message_at = NOW(),
        last_sender_name = ${senderName},
        last_message_preview = ${caption || `[${contentType}]`},
        awaiting_reply = false
      WHERE id = ${channelId}
    `

    return json({
      success: true,
      messageId,
      telegramMessageId: tgMessage.message_id,
      mediaUrl
    })

  } catch (e: any) {
    console.error('Send media error:', e)
    return json({ error: e.message }, 500)
  }
}
