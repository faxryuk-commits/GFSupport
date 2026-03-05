import express from 'express'
import { startBaileys, onMessage, downloadMediaMessage } from './baileys.js'
import { createRouter } from './routes.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = parseInt(process.env.PORT || '3001')
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || ''
const WEBHOOK_URL = process.env.GFSUPPORT_WEBHOOK_URL || ''
const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, '..', 'auth_info')

export type FilterMode = 'all' | 'groups_only'
let filterMode: FilterMode = (process.env.FILTER_MODE as FilterMode) || 'all'

export function getFilterMode(): FilterMode { return filterMode }
export function setFilterMode(mode: FilterMode) { filterMode = mode }

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
  const senderJid = isGroup ? (msg.key.participant || '') : jid
  const phone = senderJid.split('@')[0] || ''
  const pushName = msg.pushName || phone

  return { jid, isGroup, senderJid, phone, pushName }
}

onMessage(async (msg) => {
  try {
    const { jid, isGroup, phone, pushName } = getSenderInfo(msg)

    if (jid.endsWith('@broadcast') || jid === 'status@broadcast') {
      return
    }

    if (filterMode === 'groups_only' && !isGroup) {
      return
    }

    const text = extractText(msg)
    const contentType = getContentType(msg)

    let mediaUrl: string | undefined
    if (contentType !== 'text' && contentType !== 'sticker') {
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {}) as Buffer
        mediaUrl = `data:application/octet-stream;base64,${buffer.toString('base64').slice(0, 100)}...`
      } catch {
        mediaUrl = undefined
      }
    }

    const payload = {
      chatId: jid,
      messageId: msg.key.id,
      senderName: pushName,
      senderPhone: phone,
      text,
      mediaUrl: mediaUrl || null,
      contentType,
      timestamp: msg.messageTimestamp,
      isGroup,
      groupName: isGroup ? msg.pushName || undefined : undefined,
    }

    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_SECRET}`,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      console.error(`[Webhook] Failed: ${res.status} ${await res.text()}`)
    }
  } catch (e: any) {
    console.error('[Message Handler]', e.message)
  }
})

app.listen(PORT, () => {
  console.log(`[Bridge] Running on port ${PORT}`)
  console.log(`[Bridge] Webhook → ${WEBHOOK_URL}`)
  console.log(`[Bridge] Auth dir → ${AUTH_DIR}`)
  startBaileys(AUTH_DIR).catch((e) => {
    console.error('[Bridge] startBaileys crashed:', e)
  })
})
