import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  proto,
  downloadMediaMessage,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import qrcode from 'qrcode-terminal'

const logger = pino({ level: 'warn' })

let sock: WASocket | null = null
let isConnected = false
let phoneNumber = ''
let onMessageCallback: ((msg: proto.IWebMessageInfo) => void) | null = null

export function onMessage(cb: (msg: proto.IWebMessageInfo) => void) {
  onMessageCallback = cb
}

export function getStatus() {
  return { connected: isConnected, phone: phoneNumber }
}

export function getSocket(): WASocket | null {
  return sock
}

export async function startBaileys(authDir: string) {
  const { state, saveCreds } = await useMultiFileAuthState(authDir)

  sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['GFSupport Bridge', 'Chrome', '22.0'],
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n===== SCAN QR CODE IN WHATSAPP =====')
      qrcode.generate(qr, { small: true })
      console.log('====================================\n')
    }

    if (connection === 'open') {
      isConnected = true
      phoneNumber = sock?.user?.id?.split(':')[0] || ''
      console.log(`[Baileys] Connected as ${phoneNumber}`)
    }

    if (connection === 'close') {
      isConnected = false
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      console.log(`[Baileys] Disconnected. Status: ${statusCode}. Reconnect: ${shouldReconnect}`)

      if (shouldReconnect) {
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
