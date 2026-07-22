import { identifySender } from '../lib/identification.js'
import { shouldAutoCreateCase, generateCaseId, getNextTicketNumber } from '../lib/case-detector.js'
import { getOpenAIKey, getOrgWhatsAppBridge, getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
  regions: ['iad1'],
  maxDuration: 30,
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function transcribeAudio(url: string, orgId?: string): Promise<string | null> {
  const apiKey = await getOpenAIKey(orgId)
  if (!apiKey || !url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const form = new FormData()
    form.append('file', blob, 'audio.ogg')
    form.append('model', 'whisper-1')
    form.append('language', 'ru')
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    if (!r.ok) return null
    const data = await r.json()
    return data.text?.trim() || null
  } catch (e: any) {
    console.error('[WA] Transcription error:', e.message)
    return null
  }
}

async function analyzePhoto(url: string, orgId?: string): Promise<string | null> {
  const apiKey = await getOpenAIKey(orgId)
  if (!apiKey || !url) return null
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Опиши содержание этого изображения в 1-2 предложениях на русском. Если это скриншот ошибки — опиши что видно. Если текст — перепиши его.' },
            { type: 'image_url', image_url: { url, detail: 'low' } },
          ],
        }],
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) return null
    const data = await r.json() as any
    return data.choices?.[0]?.message?.content || null
  } catch (e: any) {
    console.error('[WA] Photo analysis error:', e.message)
    return null
  }
}

async function upsertWhatsAppUser(sql: any, phone: string, name: string, channelId: string, role: string, orgId: string) {
  if (!phone || phone.length < 5) return
  try {
    try { await sql`ALTER TABLE support_users ADD COLUMN IF NOT EXISTS phone VARCHAR(50)` } catch {}
    try { await sql`CREATE INDEX IF NOT EXISTS idx_users_phone ON support_users(phone)` } catch {}

    const existing = await sql`
      SELECT id, channels FROM support_users WHERE phone = ${phone} AND org_id = ${orgId} LIMIT 1
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
        WHERE phone = ${phone} AND org_id = ${orgId}
      `
    } else {
      const userId = generateId('user')
      const userRole = role === 'client' ? 'client' : 'employee'
      const channels = [{ id: channelId, addedAt: new Date().toISOString() }]
      await sql`
        INSERT INTO support_users (id, phone, name, role, channels, org_id, first_seen_at, last_seen_at, created_at, updated_at)
        VALUES (${userId}, ${phone}, ${name || phone}, ${userRole}, ${JSON.stringify(channels)}::jsonb, ${orgId}, NOW(), NOW(), NOW(), NOW())
        ON CONFLICT DO NOTHING
      `
    }
  } catch (e: any) {
    console.error('[WA Webhook] upsertUser error:', e.message)
  }
}

const phoneCountryMap: Record<string, string> = {
  '998': 'uz', '996': 'kg', '7': 'kz', '995': 'ge', '994': 'az',
  '992': 'tj', '993': 'tm', '374': 'am', '90': 'tr', '971': 'ae',
}

async function detectMarketByPhone(sql: any, phone: string, orgId: string): Promise<string | null> {
  if (!phone) return null
  for (const [prefix, code] of Object.entries(phoneCountryMap)) {
    if (phone.startsWith(prefix)) {
      try {
        const rows = await sql`SELECT id FROM support_markets WHERE code = ${code} AND is_active = true AND org_id = ${orgId} LIMIT 1`
        return rows[0]?.id || null
      } catch { return null }
    }
  }
  return null
}

async function getOrCreateWhatsAppChannel(sql: any, chatId: string, channelName: string, senderPhone?: string, defaultOrgId?: string): Promise<{ channelId: string, orgId: string }> {
  const existing = await sql`
    SELECT id, name, org_id FROM support_channels WHERE external_chat_id = ${chatId} AND source = 'whatsapp' LIMIT 1
  `

  if (existing[0]) {
    const orgId = existing[0].org_id || 'org_delever'
    if (channelName && existing[0].name !== channelName) {
      await sql`UPDATE support_channels SET name = ${channelName} WHERE id = ${existing[0].id} AND org_id = ${orgId}`.catch(() => {})
    }
    return { channelId: existing[0].id, orgId }
  }

  const channelId = generateId('ch')
  const resolvedDefaultOrgId = defaultOrgId || 'org_delever'
  const name = channelName || `WhatsApp ${chatId.replace('@s.whatsapp.net', '').replace('@g.us', '')}`
  const marketId = await detectMarketByPhone(sql, senderPhone || chatId.replace('@s.whatsapp.net', '').replace('@g.us', ''), resolvedDefaultOrgId)

  await sql`
    INSERT INTO support_channels (
      id, name, type, source, external_chat_id, is_active, market_id, org_id, created_at
    ) VALUES (
      ${channelId}, ${name}, 'client', 'whatsapp', ${chatId}, true, ${marketId}, ${resolvedDefaultOrgId}, NOW()
    )
  `

  return { channelId, orgId: resolvedDefaultOrgId }
}

async function handleReaction(sql: any, body: any): Promise<Response> {
  const { chatId, emoji, targetMessageId, senderName } = body
  if (!chatId || !targetMessageId) return json({ ok: true, skipped: 'no target' })

  try {
    const channelRows = await sql`
      SELECT id, org_id FROM support_channels WHERE external_chat_id = ${chatId} AND source = 'whatsapp' LIMIT 1
    `
    if (!channelRows[0]) return json({ ok: true, skipped: 'channel not found' })
    const channelId = channelRows[0].id
    const orgId = channelRows[0].org_id || 'org_delever'

    const msgRows = await sql`
      SELECT id, reactions FROM support_messages
      WHERE channel_id = ${channelId} AND org_id = ${orgId}
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

/**
 * Транслятор вебхука GreenAPI → наш внутренний формат (тот же, что шлёт
 * Baileys-мост). Так вся ингест-логика ниже («группа = канал», identifySender,
 * запись сообщения) переиспользуется без изменений — GreenAPI просто заменяет
 * звено «мост».
 *
 * Возвращает объект в формате моста, либо null — если событие не сообщение
 * (статусы доставки и т.п.), тогда обработчик его пропускает.
 * Формат GreenAPI: https://green-api.com (typeWebhook=incomingMessageReceived).
 */
function translateGreenApi(b: any): any | null {
  const tw = b?.typeWebhook
  if (tw !== 'incomingMessageReceived' && tw !== 'outgoingMessageReceived' && tw !== 'outgoingAPIMessageReceived') {
    return null // outgoingMessageStatus, stateInstanceChanged и пр. — не сообщения
  }
  const fromMe = tw !== 'incomingMessageReceived'
  const sd = b.senderData || {}
  const md = b.messageData || {}
  const chatId: string = sd.chatId || ''
  const isGroup = chatId.endsWith('@g.us')
  const stripJid = (j?: string) => (j || '').replace(/@c\.us$|@g\.us$|@s\.whatsapp\.net$/,'').replace(/[^0-9]/g,'')
  // Телефон отправителя: в группе — participant (sender), в 1:1 — сам chatId.
  const senderPhone = stripJid(sd.sender || (isGroup ? '' : chatId))
  const senderName = sd.senderContactName || sd.senderName || senderPhone

  // Текст + тип + медиа
  const type = md.typeMessage
  let text = ''
  let contentType = 'text'
  let mediaUrl: string | null = null
  let mimeType: string | null = null
  let fileName: string | null = null

  if (type === 'textMessage') {
    text = md.textMessageData?.textMessage || ''
  } else if (type === 'extendedTextMessage') {
    text = md.extendedTextMessageData?.text || ''
  } else if (type === 'reactionMessage') {
    // Реакция → отдельный путь handleReaction
    return {
      type: 'reaction',
      chatId,
      emoji: md.reactionMessage?.text || md.extendedTextMessageData?.text || '',
      targetMessageId: md.reactionMessage?.key?.id || md.quotedMessage?.stanzaId || '',
      senderName: fromMe ? 'Support' : senderName,
    }
  } else if (md.fileMessageData) {
    const fm = md.fileMessageData
    mediaUrl = fm.downloadUrl || null
    text = fm.caption || ''
    fileName = fm.fileName || null
    mimeType = fm.mimeType || null
    contentType = type === 'imageMessage' ? 'image'
      : type === 'videoMessage' ? 'video'
      : type === 'audioMessage' ? 'audio'
      : type === 'documentMessage' ? 'document'
      : type === 'stickerMessage' ? 'sticker'
      : 'document'
  } else {
    // locationMessage/contactMessage/прочее — сохраняем как текст-заглушку
    text = md.extendedTextMessageData?.text || md.textMessageData?.textMessage || `[${type || 'unsupported'}]`
  }

  const quoted = md.quotedMessage
  return {
    chatId,
    messageId: b.idMessage,
    senderName: fromMe ? 'Support' : senderName,
    senderPhone,
    text,
    mediaUrl,
    thumbnailUrl: null,
    contentType,
    mimeType,
    fileName,
    timestamp: b.timestamp,
    isGroup,
    fromMe,
    groupName: isGroup ? (sd.chatName || undefined) : undefined,
    replyToMessageId: quoted?.stanzaId || undefined,
    replyToText: quoted?.textMessage || quoted?.caption || undefined,
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

  const authHeader = req.headers.get('Authorization')
  // Терпимо к формату: принимаем и "Bearer <секрет>", и просто "<секрет>"
  // (GreenAPI шлёт секрет в заголовке авторизации, префикс может отличаться).
  const authToken = (authHeader || '').replace(/^Bearer\s+/i, '').trim()
  const webhookUrl = new URL(req.url)
  const orgParam = webhookUrl.searchParams.get('org')

  let webhookOrgId: string | null = null

  if (orgParam) {
    const bridge = await getOrgWhatsAppBridge(orgParam)
    if (bridge.secret && authToken === bridge.secret) {
      webhookOrgId = orgParam
    } else {
      const envSecret = process.env.WHATSAPP_BRIDGE_SECRET
      if (!envSecret || authToken !== envSecret) {
        return json({ error: 'Unauthorized' }, 401)
      }
    }
  } else {
    const bridgeSecret = process.env.WHATSAPP_BRIDGE_SECRET
    if (!bridgeSecret) return json({ error: 'Bridge secret not configured' }, 500)
    if (authToken !== bridgeSecret) {
      return json({ error: 'Unauthorized' }, 401)
    }
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
  try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS external_message_id VARCHAR(120)` } catch {}

  try {
    let body = await req.json()

    // GreenAPI (managed-провайдер) шлёт свой формат — транслируем в формат моста.
    if (body?.typeWebhook) {
      const translated = translateGreenApi(body)
      if (!translated) return json({ ok: true, skipped: `greenapi:${body.typeWebhook}` })
      body = translated
    }

    if (body.type === 'reaction') {
      return await handleReaction(sql, body)
    }

    const { chatId, messageId, senderName, senderPhone, text, mediaUrl, thumbnailUrl,
            contentType, mimeType, fileName, timestamp, isGroup, fromMe, groupName,
            replyToMessageId, replyToText } = body

    console.log(`[WA Webhook] Received: chatId=${chatId}, type=${contentType}, sender=${senderName}, fromMe=${fromMe}, media=${!!mediaUrl}`)

    if (!chatId) return json({ error: 'chatId is required' }, 400)

    const channelName = isGroup ? (groupName || senderName) : senderName
    const { channelId, orgId } = await getOrCreateWhatsAppChannel(sql, chatId, channelName || '', senderPhone || '', webhookOrgId || undefined)

    // Дедуп: одно WhatsApp-сообщение (idMessage уникален) = одна запись.
    // GreenAPI ретраит доставку, если не получил быстрый 200 — без этой проверки
    // одно сообщение вставлялось многократно (наблюдалось 8 копий). Ранний выход
    // → мгновенный 200 на ретрае → GreenAPI перестаёт слать.
    if (messageId) {
      const dup = await sql`
        SELECT id FROM support_messages
        WHERE external_message_id = ${String(messageId)} AND channel_id = ${channelId}
        LIMIT 1` as any[]
      if (dup[0]) return json({ ok: true, deduped: true, messageId: dup[0].id, channelId })
    }

    let isFromClient: boolean
    let senderRole: string

    if (fromMe) {
      isFromClient = false
      senderRole = 'support'
    } else {
      const identification = await identifySender(sql, {
        username: null,
        telegramId: null,
        phone: senderPhone || null,
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
          WHERE channel_id = ${channelId} AND is_from_client = true AND org_id = ${orgId}
          ORDER BY created_at DESC LIMIT 1
        `
        if (lastClient[0]) {
          responseTimeMs = Date.now() - new Date(lastClient[0].created_at).getTime()
        }
      } catch { /* non-critical */ }
    }

    await sql`
      INSERT INTO support_messages (
        id, channel_id, org_id, sender_id, sender_name, sender_role,
        is_from_client, content_type, text_content, media_url,
        thumbnail_url, file_name, mime_type,
        reply_to_message_id, reply_to_text, external_message_id,
        is_read, response_time_ms, created_at
      ) VALUES (
        ${msgId}, ${channelId}, ${orgId}, ${senderPhone || null}, ${senderName || 'Unknown'},
        ${senderRole}, ${isFromClient}, ${msgContentType}, ${text || null},
        ${mediaUrl || null},
        ${thumbnailUrl || null}, ${fileName || null}, ${mimeType || null},
        ${replyToMessageId || null}, ${replyToText || null}, ${messageId ? String(messageId) : null},
        ${!isFromClient}, ${responseTimeMs}, NOW()
      )
    `

    // FRT: первый ответ команды в канале стампим на открытых кейсах.
    // Идемпотентно — COALESCE не перезаписывает уже проставленное время.
    // (Telegram делает это в updateCasesOnStaffReply; здесь — эквивалент для WhatsApp.)
    if (!isFromClient) {
      await sql`
        UPDATE support_cases
        SET first_response_at = COALESCE(first_response_at, NOW()), updated_at = NOW()
        WHERE channel_id = ${channelId} AND org_id = ${orgId}
          AND status NOT IN ('resolved','closed','cancelled')
          AND first_response_at IS NULL
      `.catch(() => { /* non-critical */ })
    }

    const preview = text ? text.slice(0, 100) : `[${msgContentType}]`
    if (isFromClient) {
      await sql`
        UPDATE support_channels SET
          last_message_at = NOW(), last_client_message_at = NOW(),
          last_sender_name = ${senderName || 'Unknown'},
          last_message_preview = ${preview},
          awaiting_reply = true,
          unread_count = COALESCE(unread_count, 0) + 1
        WHERE id = ${channelId} AND org_id = ${orgId}
      `
    } else {
      await sql`
        UPDATE support_channels SET
          last_message_at = NOW(), last_team_message_at = NOW(),
          last_sender_name = ${senderName || 'Support'},
          last_message_preview = ${preview},
          awaiting_reply = false,
          unread_count = 0
        WHERE id = ${channelId} AND org_id = ${orgId}
      `
      // Команда ответила (в т.ч. прямо из WhatsApp) → клиентские сообщения прочитаны.
      // Раньше unread_count/is_read не сбрасывались — канал висел в «Непрочитанных».
      await sql`
        UPDATE support_messages SET is_read = true
        WHERE channel_id = ${channelId} AND org_id = ${orgId} AND is_from_client = true AND is_read = false
      `.catch(() => {})
    }

    if (!fromMe && senderPhone) {
      upsertWhatsAppUser(sql, senderPhone, senderName || '', channelId, senderRole, orgId).catch(() => {})
    }

    // Транскрипция и анализ медиа — для КАЖДОГО входящего медиа,
    // а не только когда нет подписи. Подпись не заменяет содержимое
    // скриншота/голосового — категоризация и поиск должны видеть и то и другое.
    if (mediaUrl) {
      try {
        let transcript: string | null = null
        let summary: string | null = null

        if (['voice', 'audio'].includes(msgContentType)) {
          transcript = await transcribeAudio(mediaUrl, orgId)
        } else if (['video', 'video_note'].includes(msgContentType)) {
          transcript = await transcribeAudio(mediaUrl, orgId)
        } else if (msgContentType === 'photo' || msgContentType === 'image') {
          summary = await analyzePhoto(mediaUrl, orgId)
        }

        if (transcript || summary) {
          await sql`
            UPDATE support_messages SET
              transcript = COALESCE(${transcript}, transcript),
              ai_summary = COALESCE(${summary}, ai_summary),
              text_content = COALESCE(text_content, ${transcript || summary})
            WHERE id = ${msgId} AND org_id = ${orgId}
          `.catch(() => {})
          console.log(`[WA] Media analyzed: ${msgContentType}, transcript=${!!transcript}, summary=${!!summary}`)
        }
      } catch (e: any) {
        console.error('[WA Media]', e.message)
      }
    }

    if (text) {
      try {
        const detection = await shouldAutoCreateCase(sql, {
          text, isFromClient, channelId, senderRole,
        })
        if (detection.shouldCreate) {
          const caseId = generateCaseId()
          const ticketNum = await getNextTicketNumber(sql)
          await sql`
            INSERT INTO support_cases (id, ticket_number, channel_id, org_id, title, description, priority, status, source_message_id, is_shadow)
            VALUES (${caseId}, ${ticketNum}, ${channelId}, ${orgId}, ${text.slice(0, 100)}, ${text.slice(0, 500)}, ${detection.priority}, ${detection.isShadow ? 'resolved' : 'detected'}, ${msgId}, ${detection.isShadow})
          `.catch(() => {})
        }
      } catch (e: any) { console.error('[WA Case]', e.message) }
    }

    if (isFromClient && text && text.length > 2) {
      try {
        const { runAgent, executeDecision } = await import('../lib/ai-agent.js')
        const agentResult = await runAgent({
          channelId, channelName: channelName || 'WhatsApp', orgId,
          incomingMessage: text, senderName: senderName || 'Client',
          senderPhone: senderPhone || undefined,
          isGroup: !!isGroup, source: 'whatsapp',
        })
        if (agentResult && !agentResult.skipped && agentResult.decision) {
          const d = agentResult.decision
          const bridge = await getOrgWhatsAppBridge(orgId)
          const sendWa = bridge.url
            ? async (_chId: string, msgText: string) => {
                await fetch(`${bridge.url}/send`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridge.secret}` },
                  body: JSON.stringify({ chatId, text: msgText }),
                }).catch(() => {})
              }
            : async () => {}

          const canAutoReply = d.confidence >= 0.8 && (d.action === 'reply' || d.action === 'reply_and_tag')
          const needsExecution = canAutoReply || d.action === 'escalate' || d.action === 'tag_agent' || d.action === 'create_case'

          if (needsExecution) {
            await executeDecision({
              channelId, channelName: channelName || '', orgId,
              incomingMessage: text, senderName: senderName || 'Client',
              isGroup: !!isGroup, source: 'whatsapp',
            }, d, sendWa)
          }
          console.log(`[WA] AI Agent: action=${d.action}, confidence=${d.confidence}, executed=${needsExecution}`)
        }
      } catch (e: any) {
        console.log(`[WA] AI Agent skipped: ${e.message}`)
      }
    }

    return json({ ok: true, messageId: msgId, channelId })

  } catch (e: any) {
    console.error('[WhatsApp Webhook] Error:', e.message, e.stack?.slice(0, 300))
    return json({ error: "Internal server error" }, 500)
  }
}
