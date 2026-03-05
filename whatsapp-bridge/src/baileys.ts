import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  proto,
  downloadMediaMessage,
  Browsers,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import * as QRCode from 'qrcode'

const logger = pino({ level: 'info' })

let sock: WASocket | null = null
let isConnected = false
let phoneNumber = ''
let currentQR: string | null = null
let lastError: string | null = null
let onMessageCallback: ((msg: proto.IWebMessageInfo) => void) | null = null

export function onMessage(cb: (msg: proto.IWebMessageInfo) => void) {
  onMessageCallback = cb
}

export function getStatus() {
  return { connected: isConnected, phone: phoneNumber, qr: currentQR, lastError }
}

export function getCurrentQR(): string | null {
  return currentQR
}

export function getSocket(): WASocket | null {
  return sock
}

export async function startBaileys(authDir: string) {
  console.log(`[Baileys] Initializing... authDir=${authDir}`)
  lastError = null

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir)
    console.log('[Baileys] Auth state loaded')

    sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
    })
    console.log('[Baileys] Socket created, waiting for connection events...')

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      console.log(`[Baileys] connection.update: connection=${connection}, hasQR=${!!qr}`)

      if (qr) {
        try {
          currentQR = await QRCode.toDataURL(qr, { width: 300, margin: 2 })
          console.log(`[Baileys] QR ready (${currentQR?.length} chars)`)
        } catch (e: any) {
          currentQR = null
          lastError = `QR generation failed: ${e.message}`
          console.error('[Baileys] QR generation error:', e.message)
        }
      }

      if (connection === 'open') {
        isConnected = true
        currentQR = null
        lastError = null
        phoneNumber = sock?.user?.id?.split(':')[0] || ''
        console.log(`[Baileys] Connected as ${phoneNumber}`)
      }

      if (connection === 'close') {
        isConnected = false
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut
        const errMsg = (lastDisconnect?.error as any)?.message || 'unknown'
        lastError = `Disconnected: ${errMsg} (status ${statusCode})`

        console.log(`[Baileys] Disconnected. Status: ${statusCode}. Error: ${errMsg}. Reconnect: ${shouldReconnect}`)

        if (statusCode === 405 || statusCode === 500) {
          console.log('[Baileys] Bad session, clearing auth and retrying...')
          const fs = await import('fs')
          try { fs.rmSync(authDir, { recursive: true, force: true }) } catch {}
          setTimeout(() => startBaileys(authDir), 2000)
        } else if (shouldReconnect) {
          setTimeout(() => startBaileys(authDir), 3000)
        } else {
          console.log('[Baileys] Logged out. Delete auth_info/ and restart to re-scan QR.')
        }
      }
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return

      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue
        onMessageCallback?.(msg)
      }
    })
  } catch (e: any) {
    lastError = `Init failed: ${e.message}`
    console.error('[Baileys] FATAL init error:', e)
  }
}

export async function sendText(chatId: string, text: string): Promise<proto.WebMessageInfo | undefined> {
  if (!sock || !isConnected) throw new Error('WhatsApp not connected')
  return sock.sendMessage(chatId, { text })
}

export async function sendMedia(
  chatId: string,
  buffer: Buffer,
  mimetype: string,
  filename: string,
  caption?: string
): Promise<proto.WebMessageInfo | undefined> {
  if (!sock || !isConnected) throw new Error('WhatsApp not connected')

  if (mimetype.startsWith('image/')) {
    return sock.sendMessage(chatId, { image: buffer, caption, mimetype })
  } else if (mimetype.startsWith('video/')) {
    return sock.sendMessage(chatId, { video: buffer, caption, mimetype })
  } else if (mimetype.startsWith('audio/')) {
    return sock.sendMessage(chatId, { audio: buffer, mimetype, ptt: mimetype.includes('ogg') })
  } else {
    return sock.sendMessage(chatId, { document: buffer, mimetype, fileName: filename, caption })
  }
}

export { downloadMediaMessage }
