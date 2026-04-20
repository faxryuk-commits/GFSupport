import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  proto,
  downloadMediaMessage,
  Browsers,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import * as QRCode from 'qrcode'

const logger = pino({ level: 'info' })

type LinkMode = 'qr' | 'pair_code'

let sock: WASocket | null = null
let isConnected = false
let phoneNumber = ''
let currentQR: string | null = null
let lastError: string | null = null
let onMessageCallback: ((msg: proto.IWebMessageInfo) => void) | null = null
let activeMode: LinkMode = 'qr'
let currentPairCode: string | null = null
let pairCodeExpiresAt: number | null = null
let pairCodePhone: string | null = null
let pairCodeExpireTimer: ReturnType<typeof setTimeout> | null = null

export function onMessage(cb: (msg: proto.IWebMessageInfo) => void) {
  onMessageCallback = cb
}

export function getStatus() {
  return {
    connected: isConnected,
    phone: phoneNumber,
    qr: currentQR,
    lastError,
    mode: activeMode,
    pairCode: currentPairCode,
    pairCodeExpiresAt,
    pairCodePhone,
  }
}

export function getCurrentQR(): string | null {
  return currentQR
}

export function getPairCode(): { code: string | null; expiresAt: number | null; phone: string | null } {
  return { code: currentPairCode, expiresAt: pairCodeExpiresAt, phone: pairCodePhone }
}

function clearPairCode() {
  currentPairCode = null
  pairCodeExpiresAt = null
  pairCodePhone = null
  if (pairCodeExpireTimer) {
    clearTimeout(pairCodeExpireTimer)
    pairCodeExpireTimer = null
  }
}

function formatPairCode(raw: string): string {
  const clean = raw.replace(/\s+/g, '').toUpperCase()
  if (clean.length === 8) return `${clean.slice(0, 4)}-${clean.slice(4)}`
  return clean
}

function normalizePhone(input: string): string | null {
  const digits = (input || '').replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) return null
  return digits
}

export function getSocket(): WASocket | null {
  return sock
}

const groupNameCache = new Map<string, { name: string; ts: number }>()
const GROUP_CACHE_TTL = 30 * 60 * 1000

export async function getGroupName(jid: string): Promise<string | null> {
  if (!sock || !isConnected || !jid.endsWith('@g.us')) return null

  const cached = groupNameCache.get(jid)
  if (cached && Date.now() - cached.ts < GROUP_CACHE_TTL) return cached.name

  try {
    const meta = await sock.groupMetadata(jid)
    const name = meta?.subject || null
    if (name) groupNameCache.set(jid, { name, ts: Date.now() })
    return name
  } catch (e: any) {
    console.warn(`[Baileys] groupMetadata(${jid.slice(0, 20)}) failed:`, e.message)
    return null
  }
}

export async function startBaileys(
  authDir: string,
  opts?: { mode?: LinkMode; phoneNumber?: string }
) {
  const mode: LinkMode = opts?.mode || 'qr'
  const pairPhone = mode === 'pair_code' ? normalizePhone(opts?.phoneNumber || '') : null

  if (mode === 'pair_code' && !pairPhone) {
    lastError = 'Invalid phone number for pair-code (expected 10-15 digits)'
    console.error('[Baileys]', lastError)
    return
  }

  console.log(`[Baileys] Initializing... authDir=${authDir}, mode=${mode}`)
  activeMode = mode
  lastError = null
  clearPairCode()

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir)
    console.log('[Baileys] Auth state loaded')

    let version: [number, number, number] | undefined
    try {
      const fetched = await fetchLatestBaileysVersion()
      version = fetched.version
      console.log(`[Baileys] Using WA version: ${version.join('.')}`)
    } catch (e: any) {
      console.warn('[Baileys] Could not fetch latest version, using default:', e.message)
    }

    sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      ...(version ? { version } : {}),
    })
    console.log('[Baileys] Socket created, waiting for connection events...')

    sock.ev.on('creds.update', saveCreds)

    // Pair-code flow: запрашиваем 8-значный код СРАЗУ после создания сокета,
    // до того как Baileys уйдёт по QR-ветке. Работает только если сессия не зарегистрирована.
    if (mode === 'pair_code' && pairPhone && !state.creds.registered) {
      try {
        const rawCode = await sock.requestPairingCode(pairPhone)
        currentPairCode = formatPairCode(rawCode)
        pairCodeExpiresAt = Date.now() + 180_000
        pairCodePhone = pairPhone
        console.log(`[Baileys] Pair code issued for +${pairPhone}: ${currentPairCode}`)

        // Через 180 сек код невалиден — очищаем состояние,
        // чтобы UI не показывал протухший код.
        pairCodeExpireTimer = setTimeout(() => {
          console.log('[Baileys] Pair code expired')
          clearPairCode()
        }, 185_000)
      } catch (e: any) {
        lastError = `Pair code request failed: ${e.message}`
        console.error('[Baileys]', lastError)
      }
    }

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      console.log(`[Baileys] connection.update: connection=${connection}, hasQR=${!!qr}, mode=${activeMode}`)

      // В pair-code режиме Baileys всё равно может прислать QR-строку — игнорируем,
      // чтобы UI не показывал одновременно два способа привязки.
      if (qr && activeMode === 'qr') {
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
        clearPairCode()
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

        // После disconnect любой текущий pair-code становится невалидным
        clearPairCode()

        if (statusCode === 401 || statusCode === 403 || statusCode === 405 || statusCode === 500) {
          console.log(`[Baileys] Bad session (${statusCode}), clearing auth and retrying in QR mode...`)
          const fs = await import('fs')
          try { fs.rmSync(authDir, { recursive: true, force: true }) } catch {}
          // При восстановлении после ошибки всегда возвращаемся в QR-режим —
          // pair-code одноразовый, повторно использовать тот же phone нельзя.
          setTimeout(() => startBaileys(authDir, { mode: 'qr' }), 2000)
        } else if (shouldReconnect) {
          setTimeout(() => startBaileys(authDir, { mode: activeMode, phoneNumber: pairCodePhone || undefined }), 3000)
        } else {
          console.log('[Baileys] Logged out. Delete auth_info/ and restart to re-scan QR.')
        }
      }
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      console.log(`[Baileys] messages.upsert: type=${type}, count=${messages.length}`)

      if (type !== 'notify' && type !== 'append') return

      for (const msg of messages) {
        if (!msg.message) continue
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

export async function logoutWhatsApp(authDir: string) {
  console.log('[Baileys] Logging out...')
  try { await sock?.logout() } catch (e: any) { console.warn('[Baileys] logout():', e.message) }
  isConnected = false
  phoneNumber = ''
  currentQR = null
  lastError = null
  clearPairCode()
  sock = null
  const fs = await import('fs')
  try { fs.rmSync(authDir, { recursive: true, force: true }) } catch {}
  console.log('[Baileys] Session cleared, restarting for new QR...')
  setTimeout(() => startBaileys(authDir, { mode: 'qr' }), 1500)
}

/**
 * Перезапустить сокет в pair-code режиме с чистой auth-сессией.
 * Single-flight: если активный неистёкший код уже есть для того же номера — возвращаем его.
 */
export async function requestPairCode(authDir: string, rawPhone: string): Promise<{
  code: string | null
  expiresAt: number | null
  phone: string | null
  error?: string
}> {
  const phone = normalizePhone(rawPhone)
  if (!phone) return { code: null, expiresAt: null, phone: null, error: 'invalid_phone' }

  if (isConnected) {
    return { code: null, expiresAt: null, phone: null, error: 'already_connected' }
  }

  const now = Date.now()
  if (
    currentPairCode &&
    pairCodeExpiresAt &&
    pairCodeExpiresAt > now + 15_000 &&
    pairCodePhone === phone
  ) {
    console.log('[Baileys] Reusing active pair code for', phone)
    return { code: currentPairCode, expiresAt: pairCodeExpiresAt, phone }
  }

  try { await sock?.end(undefined) } catch {}
  sock = null
  clearPairCode()

  const fs = await import('fs')
  try { fs.rmSync(authDir, { recursive: true, force: true }) } catch {}

  await startBaileys(authDir, { mode: 'pair_code', phoneNumber: phone })

  // Ждём до 15 сек пока код появится — requestPairingCode асинхронный.
  const deadline = Date.now() + 15_000
  while (!currentPairCode && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250))
    if (lastError) break
  }

  if (!currentPairCode) {
    return { code: null, expiresAt: null, phone: null, error: lastError || 'timeout' }
  }
  return { code: currentPairCode, expiresAt: pairCodeExpiresAt, phone: pairCodePhone }
}

export { downloadMediaMessage }
