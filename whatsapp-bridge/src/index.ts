import express from 'express'
import { startBaileys, onMessage, downloadMediaMessage, getGroupName, getStatus, getConnectionMetrics } from './baileys.js'
import { createRouter } from './routes.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = parseInt(process.env.PORT || '3001')
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || ''
const WEBHOOK_URL = process.env.GFSUPPORT_WEBHOOK_URL || ''
const AUTH_DIR = process.env.AUTH_DIR || '/data/auth_info'

export type FilterMode = 'all' | 'groups_only'
let filterMode: FilterMode = (process.env.FILTER_MODE as FilterMode) || 'all'

export function getFilterMode(): FilterMode { return filterMode }
export function setFilterMode(mode: FilterMode) { filterMode = mode }

let messageStats = { received: 0, forwarded: 0, errors: 0, lastAt: '', lastError: '' }
export function getMessageStats() { return messageStats }

if (!BRIDGE_SECRET) {
  console.error('BRIDGE_SECRET is required')
  process.exit(1)
}
if (!WEBHOOK_URL) {
  console.error('GFSUPPORT_WEBHOOK_URL is required (e.g. https://your-app.vercel.app/api/support/webhook/whatsapp)')
  process.exit(1)
}

const app = express()
app.use(express.json())
app.use('/', createRouter(BRIDGE_SECRET, AUTH_DIR))

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || ''

// Baileys заворачивает реальный контент в обёртки (ephemeral/view-once/edited/
// device-sent/document-with-caption). Без разворота extractText/getContentType
// видят пустую оболочку и текст теряется → в UI приходит «[text]».
// Разворачиваем рекурсивно до настоящего message-узла.
function unwrapMessage(message: any): any {
  let m = message
  for (let i = 0; i < 5 && m; i++) {
    const inner =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message ||
      m.documentWithCaptionMessage?.message ||
      m.editedMessage?.message ||
      m.protocolMessage?.editedMessage?.message ||
      m.deviceSentMessage?.message
    if (!inner) break
    m = inner
  }
  return m
}

function extractText(msg: any): string | null {
  return msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || msg.message?.imageMessage?.caption
    || msg.message?.videoMessage?.caption
    || msg.message?.documentMessage?.caption
    || null
}

function getContentType(msg: any): string {
  if (msg.message?.reactionMessage) return 'reaction'
  if (msg.message?.imageMessage) return 'photo'
  if (msg.message?.videoMessage) return 'video'
  if (msg.message?.audioMessage) return 'voice'
  if (msg.message?.documentMessage) return 'document'
  if (msg.message?.stickerMessage) return 'sticker'
  return 'text'
}

function getSenderInfo(msg: any) {
  const k = msg.key || {}
  const jid = k.remoteJid || ''
  const isGroup = jid.endsWith('@g.us')
  const fromMe = !!k.fromMe
  // Когда основной адрес отправителя — это LID (@lid), Baileys кладёт РЕАЛЬНЫЙ
  // телефонный JID в *Pn-поля (senderPn для лички, participantPn для группы).
  // Приоритет телефонному JID → senderPhone = настоящий номер, а не LID.
  const pnJid = isGroup ? (k.participantPn || '') : (k.senderPn || '')
  const lidJid = isGroup ? (k.participantLid || (String(k.participant || '').endsWith('@lid') ? k.participant : '')) : (k.senderLid || (jid.endsWith('@lid') ? jid : ''))
  const baseJid = isGroup ? (k.participant || '') : jid
  const senderJid = fromMe ? '' : (pnJid || baseJid)
  const num = (j: string) => (String(j).split('@')[0] || '').split(':')[0]
  const phone = num(senderJid)                    // реальный номер, если мост его дал
  const lid = lidJid ? num(lidJid) : null          // LID отдельно (на случай матча по LID)
  const pushName = msg.pushName || phone
  return { jid, isGroup, senderJid, phone, lid, pushName, fromMe }
}

function getReplyContext(msg: any): { replyToMessageId?: string; replyToText?: string } | null {
  const ctx = msg.message?.extendedTextMessage?.contextInfo
    || msg.message?.imageMessage?.contextInfo
    || msg.message?.videoMessage?.contextInfo
    || msg.message?.documentMessage?.contextInfo
    || msg.message?.audioMessage?.contextInfo
  if (!ctx?.quotedMessage) return null
  const quoted = ctx.quotedMessage
  const replyText = quoted.conversation || quoted.extendedTextMessage?.text
    || quoted.imageMessage?.caption || quoted.videoMessage?.caption || ''
  return { replyToMessageId: ctx.stanzaId || undefined, replyToText: replyText.slice(0, 200) || undefined }
}

function getMimeType(msg: any): string | null {
  return msg.message?.imageMessage?.mimetype
    || msg.message?.videoMessage?.mimetype
    || msg.message?.audioMessage?.mimetype
    || msg.message?.documentMessage?.mimetype
    || msg.message?.stickerMessage?.mimetype
    || null
}

function getFileName(msg: any): string | null {
  return msg.message?.documentMessage?.fileName || null
}

async function uploadToBlob(buffer: Buffer, filename: string): Promise<string | null> {
  if (!BLOB_TOKEN) {
    console.log('[Media] No BLOB_READ_WRITE_TOKEN, skipping upload')
    return null
  }
  try {
    const url = `https://blob.vercel-storage.com/${filename}`
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${BLOB_TOKEN}`,
        'x-api-version': '7',
        'x-content-type': 'application/octet-stream',
      },
      body: new Uint8Array(buffer),
    })
    if (!res.ok) {
      console.error(`[Media] Blob upload failed: ${res.status}`)
      return null
    }
    const data = await res.json() as any
    console.log(`[Media] Uploaded: ${data.url?.slice(0, 80)}`)
    return data.url || null
  } catch (e: any) {
    console.error('[Media] Upload error:', e.message)
    return null
  }
}

onMessage(async (msg) => {
  try {
    const { jid, isGroup, phone, lid, pushName, fromMe } = getSenderInfo(msg)
    messageStats.received++
    messageStats.lastAt = new Date().toISOString()

    console.log(`[MSG] From: ${pushName} (phone=${phone}${lid ? `, lid=${lid}` : ''}), Group: ${isGroup}, FromMe: ${fromMe}, JID: ${jid.slice(0, 30)}, MsgID: ${msg.key.id?.slice(0, 15)}`)

    if (jid.endsWith('@broadcast') || jid === 'status@broadcast') {
      console.log(`[MSG] Skipped: broadcast message`)
      return
    }

    if (filterMode === 'groups_only' && !isGroup) {
      console.log(`[MSG] Skipped: not a group (filter=${filterMode})`)
      return
    }

    // Разворачиваем обёртки ОДИН раз и дальше работаем с нормализованным m:
    // key/pushName берём из оригинала, message — развёрнутый внутренний узел.
    const m = { ...msg, message: unwrapMessage(msg.message) }

    const text = extractText(m)
    const contentType = getContentType(m)

    if (contentType === 'text' && !text) {
      // Диагностика: текст не извлёкся даже после разворота — покажет реальную структуру.
      console.warn(`[MSG] empty text. innerKeys=${JSON.stringify(Object.keys(m.message || {}))} rawKeys=${JSON.stringify(Object.keys(msg.message || {}))}`)
    }

    if (contentType === 'reaction') {
      const reaction = m.message?.reactionMessage
      const payload = {
        type: 'reaction',
        chatId: jid,
        emoji: reaction?.text || '',
        targetMessageId: reaction?.key?.id || '',
        senderName: fromMe ? 'Support' : pushName,
        senderPhone: phone,
        senderLid: lid || undefined,
        fromMe,
        isGroup,
      }
      await forwardToWebhook(payload)
      return
    }

    let mediaUrl: string | null = null
    let thumbnailUrl: string | null = null
    if (contentType !== 'text' && m.message) {
      try {
        const buffer = await downloadMediaMessage(m, 'buffer', {})
        if (buffer && buffer.length > 0) {
          const ext = (getMimeType(m) || '').split('/')[1] || 'bin'
          const fname = `wa/${Date.now()}_${msg.key.id}.${ext}`
          mediaUrl = await uploadToBlob(buffer as Buffer, fname)
        }
      } catch (e: any) {
        console.error('[Media] Download failed:', e.message)
      }
      const thumb = m.message?.imageMessage?.jpegThumbnail
        || m.message?.videoMessage?.jpegThumbnail
        || m.message?.stickerMessage?.pngThumbnail
      if (thumb) {
        try {
          const thumbBuf = Buffer.isBuffer(thumb) ? thumb : Buffer.from(thumb)
          thumbnailUrl = await uploadToBlob(thumbBuf, `wa/thumb_${Date.now()}_${msg.key.id}.jpg`)
        } catch {}
      }
    }

    const reply = getReplyContext(m)
    const payload: Record<string, any> = {
      chatId: jid,
      messageId: msg.key.id,
      senderName: fromMe ? 'Support' : pushName,
      senderPhone: phone,
      senderLid: lid || undefined,
      text,
      mediaUrl,
      thumbnailUrl,
      contentType,
      mimeType: getMimeType(m),
      fileName: getFileName(m),
      timestamp: msg.messageTimestamp,
      isGroup,
      fromMe,
      groupName: isGroup ? (await getGroupName(jid) || msg.pushName || undefined) : undefined,
    }
    if (reply) {
      payload.replyToMessageId = reply.replyToMessageId
      payload.replyToText = reply.replyToText
    }

    await forwardToWebhook(payload)
  } catch (e: any) {
    messageStats.errors++
    messageStats.lastError = e.message
    console.error('[Message Handler]', e.message)
  }
})

async function forwardToWebhook(payload: Record<string, any>, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${BRIDGE_SECRET}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        messageStats.forwarded++
        return
      }
      const errText = await res.text().catch(() => 'unknown')
      messageStats.lastError = `${res.status}: ${errText.slice(0, 200)}`
      console.error(`[Webhook] Failed (attempt ${attempt + 1}/${retries}): ${res.status}`)

      // Don't retry on client errors (4xx)
      if (res.status >= 400 && res.status < 500) break
    } catch (e: any) {
      messageStats.lastError = e.message
      console.error(`[Webhook] Error (attempt ${attempt + 1}/${retries}):`, e.message)
    }

    // Exponential backoff: 1s, 2s, 4s
    if (attempt < retries - 1) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
    }
  }
  messageStats.errors++
}

app.listen(PORT, async () => {
  console.log(`[Bridge] Running on port ${PORT}`)
  console.log(`[Bridge] Webhook → ${WEBHOOK_URL}`)
  console.log(`[Bridge] Auth dir → ${AUTH_DIR}`)

  const fs = await import('fs')
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true })
    const files = fs.readdirSync(AUTH_DIR)
    console.log(`[Bridge] Auth dir has ${files.length} files: ${files.slice(0, 5).join(', ')}${files.length > 5 ? '...' : ''}`)
  } catch (e: any) {
    console.error(`[Bridge] Auth dir error: ${e.message}`)
  }

  startBaileys(AUTH_DIR).catch((e) => {
    console.error('[Bridge] startBaileys crashed:', e)
  })

  // Watchdog: каждые 60 сек проверяем что мы connected.
  // Если down дольше 5 мин — форсим reconnect (вдруг event-handler застрял).
  // Если down дольше 30 мин — кричим в логи "manual intervention required".
  const WATCHDOG_INTERVAL_MS = 60_000
  const FORCE_RECONNECT_AFTER_MS = 5 * 60_000
  const SHOUT_AFTER_MS = 30 * 60_000

  let lastForceReconnectAt = 0
  setInterval(async () => {
    const status = getStatus()
    const metrics = getConnectionMetrics()
    if (status.connected) return

    const downtime = metrics.downtimeMs ?? Infinity
    const sinceLastForce = Date.now() - lastForceReconnectAt

    // Если бридж в initial-reject (WA отвергает незарегистрированный handshake) — watchdog
    // НЕ должен форсить рестарт. Это сломает длинный backoff из baileys.ts и продолжит долбить
    // в WA, удерживая IP в anti-abuse списке. Дальше работает только основной retry-loop.
    if (metrics.initialRejectStreak > 0) {
      if (downtime >= SHOUT_AFTER_MS && sinceLastForce > 30 * 60_000) {
        console.error(`[Watchdog] 🚨 WA bridge in initial-reject loop (streak=${metrics.initialRejectStreak}, down ${Math.round(downtime / 60000)} min). Action needed: recreate Railway service for fresh IP, or wait for anti-abuse cooldown. lastError=${status.lastError}`)
        lastForceReconnectAt = Date.now()
      }
      return
    }

    if (downtime >= SHOUT_AFTER_MS && sinceLastForce > 5 * 60_000) {
      console.error(`[Watchdog] 🚨 WA bridge DOWN for ${Math.round(downtime / 60000)} min. Manual QR re-scan or restart likely needed. lastError=${status.lastError}`)
    }

    if (downtime >= FORCE_RECONNECT_AFTER_MS && sinceLastForce > 5 * 60_000) {
      console.warn(`[Watchdog] Force-reconnecting (down ${Math.round(downtime / 1000)}s, attempts=${metrics.reconnectAttempts})`)
      lastForceReconnectAt = Date.now()
      try {
        await startBaileys(AUTH_DIR, { mode: 'qr' })
      } catch (e: any) {
        console.error('[Watchdog] Force-reconnect failed:', e.message)
      }
    }
  }, WATCHDOG_INTERVAL_MS)
})
