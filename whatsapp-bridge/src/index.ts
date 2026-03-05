import express from 'express'
import { startBaileys, onMessage, downloadMediaMessage } from './baileys.js'
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
app.use('/', createRouter(BRIDGE_SECRET))

function extractText(msg: any): string | null {
  return msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || msg.message?.imageMessage?.caption
    || msg.message?.videoMessage?.caption
    || msg.message?.documentMessage?.caption
    || null
}

function getContentType(msg: any): string {
  if (msg.message?.imageMessage) return 'photo'
  if (msg.message?.videoMessage) return 'video'
  if (msg.message?.audioMessage) return 'voice'
  if (msg.message?.documentMessage) return 'document'
  if (msg.message?.stickerMessage) return 'sticker'
  return 'text'
}

function getSenderInfo(msg: any) {
  const jid = msg.key.remoteJid || ''
  const isGroup = jid.endsWith('@g.us')
  const fromMe = !!msg.key.fromMe
  const senderJid = fromMe ? '' : (isGroup ? (msg.key.participant || '') : jid)
  const phone = senderJid.split('@')[0] || ''
  const pushName = msg.pushName || phone

  return { jid, isGroup, senderJid, phone, pushName, fromMe }
}

onMessage(async (msg) => {
  try {
    const { jid, isGroup, phone, pushName, fromMe } = getSenderInfo(msg)
    messageStats.received++
    messageStats.lastAt = new Date().toISOString()

    console.log(`[MSG] From: ${pushName} (${phone}), Group: ${isGroup}, FromMe: ${fromMe}, JID: ${jid.slice(0, 30)}`)

    if (jid.endsWith('@broadcast') || jid === 'status@broadcast') {
      console.log('[MSG] Skipped: broadcast')
      return
    }

    if (filterMode === 'groups_only' && !isGroup) {
      console.log('[MSG] Skipped: groups_only filter')
      return
    }

    const text = extractText(msg)
    const contentType = getContentType(msg)

    const payload = {
      chatId: jid,
      messageId: msg.key.id,
      senderName: fromMe ? 'Support' : pushName,
      senderPhone: phone,
      text,
      mediaUrl: null,
      contentType,
      timestamp: msg.messageTimestamp,
      isGroup,
      fromMe,
      groupName: isGroup ? msg.pushName || undefined : undefined,
    }

    console.log(`[MSG] Forwarding to webhook: ${WEBHOOK_URL.slice(0, 50)}...`)
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_SECRET}`,
      },
      body: JSON.stringify(payload),
    })

    if (res.ok) {
      messageStats.forwarded++
      const body = await res.json().catch(() => null)
      console.log(`[MSG] Forwarded OK: ${JSON.stringify(body)}`)
    } else {
      messageStats.errors++
      const errText = await res.text().catch(() => 'unknown')
      messageStats.lastError = `${res.status}: ${errText.slice(0, 200)}`
      console.error(`[Webhook] Failed: ${res.status} ${errText}`)
    }
  } catch (e: any) {
    messageStats.errors++
    messageStats.lastError = e.message
    console.error('[Message Handler]', e.message)
  }
})

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
})
