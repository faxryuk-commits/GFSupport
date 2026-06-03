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

// Reconnect bookkeeping — exponential backoff чтобы не DDoS'ить WA серверы.
let reconnectAttempts = 0
let lastConnectedAt: number | null = null
let lastDisconnectedAt: number | null = null
let totalDisconnects = 0
// Серия 401/403/405/500 на handshake до первого успеха = WA отверг клиент/IP (anti-abuse).
// Считаем отдельно — выходим в очень длинный backoff и не wipe'аем пустой authDir.
let initialRejectStreak = 0

function calcBackoffMs(attempt: number): number {
  // 2^attempt * 1000 (1s, 2s, 4s, 8s, 16s, 32s) max 60s + jitter ±20%
  const base = Math.min(1000 * Math.pow(2, attempt), 60_000)
  const jitter = base * (0.8 + Math.random() * 0.4)
  return Math.round(jitter)
}

// Для initial-rejection (401/403/etc до первого успеха): минимум 30 мин,
// потом удваивается до 6 часов. Цель — дать IP «остыть» в anti-abuse списке WA.
function calcInitialRejectBackoffMs(streak: number): number {
  const base = Math.min(30 * 60_000 * Math.pow(2, Math.max(0, streak - 1)), 6 * 60 * 60_000)
  const jitter = base * (0.9 + Math.random() * 0.2)
  return Math.round(jitter)
}

function getDisconnectReasonName(code: number | undefined): string {
  if (code == null) return 'unknown'
  // Baileys DisconnectReason значения совпадают с HTTP statusCode'ами WA сервера.
  // Используем switch чтобы избежать дубликатов ключей в литерале.
  switch (code) {
    case DisconnectReason.loggedOut: return 'logged_out'
    case DisconnectReason.connectionClosed: return 'connection_closed'
    case DisconnectReason.connectionLost: return 'connection_lost'
    case DisconnectReason.connectionReplaced: return 'connection_replaced'
    case DisconnectReason.timedOut: return 'timed_out'
    case DisconnectReason.restartRequired: return 'restart_required'
    case DisconnectReason.badSession: return 'bad_session'
    case DisconnectReason.multideviceMismatch: return 'multidevice_mismatch'
    case 401: return 'unauthorized'
    case 403: return 'forbidden'
    case 405: return 'method_not_allowed'
    case 408: return 'timed_out_http'
    case 500: return 'internal_error'
    case 515: return 'restart_required_post_pair'
    default: return `code_${code}`
  }
}

export function getConnectionMetrics() {
  return {
    isConnected,
    reconnectAttempts,
    lastConnectedAt,
    lastDisconnectedAt,
    totalDisconnects,
    initialRejectStreak,
    everConnected: lastConnectedAt !== null,
    downtimeMs: isConnected ? 0 : (lastDisconnectedAt ? Date.now() - lastDisconnectedAt : null),
    uptimeMs: isConnected && lastConnectedAt ? Date.now() - lastConnectedAt : null,
  }
}

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
      // Heartbeat: WA сбрасывает соединение если нет активности.
      // keepAliveIntervalMs по умолчанию 30s, явно ставим 25s для надёжности.
      keepAliveIntervalMs: 25_000,
      // Connect timeout — короче дефолтного, чтобы быстрее уходить в backoff.
      connectTimeoutMs: 60_000,
      // Retry счётчик от Baileys для отдельных запросов
      retryRequestDelayMs: 250,
      ...(version ? { version } : {}),
    })
    console.log('[Baileys] Socket created, waiting for connection events...')

    // Если creds.registered=false и мы в initialRejectStreak — не пытаемся даже коннектиться
    // в ближайшие N минут. Защита от ситуации когда watchdog или внешний триггер форсит рестарт
    // в окно длинного backoff'а, и мы сами себе ломаем «остывание» IP.
    // NB: проверка здесь, после makeWASocket — потому что состояние state.creds.registered
    // доступно только после useMultiFileAuthState.

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
        lastConnectedAt = Date.now()
        reconnectAttempts = 0 // успех — сбрасываем backoff
        initialRejectStreak = 0 // успех — сбрасываем счётчик anti-abuse
        console.log(`[Baileys] Connected as ${phoneNumber} (reconnect counter reset)`)
      }

      if (connection === 'close') {
        isConnected = false
        lastDisconnectedAt = Date.now()
        totalDisconnects++

        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode
        const errMsg = (lastDisconnect?.error as any)?.message || 'unknown'

        // Классифицируем причину disconnect:
        //   loggedOut          — пользователь отключил с телефона. НЕ реконнектим.
        //   connectionReplaced — кто-то ещё подключился. 30s wait.
        //   401/403/405/500    — reject. Дискриминатор — state.creds.registered:
        //       а) registered=true  → в authDir лежит сессия, а сервер её отвергает →
        //          сессия отозвана/протухла. Wipe authDir + QR (один раз). После wipe
        //          сокет становится незарегистрированным, и повторный 401 уйдёт в ветку (б).
        //       б) registered=false → отвергают свежий QR/pair handshake → клиент/IP в
        //          anti-abuse у WA. НЕ wipe (нечего), длинный backoff 30мин-6ч, чтобы IP остыл.
        //   timedOut, lost, restartRequired, badSession — временно, exp backoff.
        //
        // ВАЖНО: дискриминатор — именно registered, НЕ lastConnectedAt. Иначе протухшая
        // сессия в volume (registered=true, но процесс ещё ни разу не коннектился)
        // зациклит длинный backoff без wipe и QR никогда не появится.
        const registered = !!state.creds?.registered
        const isLoggedOut = statusCode === DisconnectReason.loggedOut
        const isReplaced = statusCode === DisconnectReason.connectionReplaced
        const isRejectCode = statusCode === 401 || statusCode === 403 || statusCode === 405 || statusCode === 500 || statusCode === DisconnectReason.badSession
        const isBadSession = isRejectCode && registered
        const isInitialReject = isRejectCode && !registered

        console.log(`[Baileys] Disconnected #${totalDisconnects}. Status=${statusCode} (${getDisconnectReasonName(statusCode)}). Error: ${errMsg}. registered=${registered}`)

        // Любой текущий pair-code невалиден после disconnect
        clearPairCode()

        if (isLoggedOut) {
          lastError = 'Аккаунт WhatsApp отключён с телефона. Нужен повторный QR-скан.'
          console.log('[Baileys] Logged out by user. Manual QR re-scan required (POST /disconnect to wipe).')
          return
        }

        if (isReplaced) {
          lastError = 'Сессию заняло другое устройство. Жду 30 сек.'
          console.log('[Baileys] Connection replaced (another device logged in). Stopping reconnect to avoid fight.')
          setTimeout(() => {
            reconnectAttempts = 0
            startBaileys(authDir, { mode: activeMode, phoneNumber: pairCodePhone || undefined })
          }, 30_000)
          return
        }

        if (isInitialReject) {
          // Ключевая ветка для нашей проблемы (3128 disconnect'ов). Отвергают незарегистрированный
          // handshake (свежий QR/pair) — частая причина: IP в anti-abuse, устаревший Baileys,
          // блокированный browser fingerprint. Wiping authDir тут бесполезен (сессии и так нет)
          // и только усугубляет ban на IP. Длинный backoff даёт IP остыть.
          initialRejectStreak++
          const delay = calcInitialRejectBackoffMs(initialRejectStreak)
          const delayMin = Math.round(delay / 60_000)
          lastError = `WhatsApp отверг подключение (status ${statusCode}). ` +
            `Возможные причины: IP-адрес в anti-abuse списке WA, устаревший протокол. ` +
            `Следующая попытка через ~${delayMin} мин. ` +
            `Если повторяется > 1 часа — пересоздайте Railway service для смены IP.`
          console.warn(`[Baileys] Initial reject #${initialRejectStreak} (status ${statusCode}). Long backoff ${delayMin} min. NOT wiping authDir.`)
          setTimeout(
            () => startBaileys(authDir, { mode: activeMode, phoneNumber: pairCodePhone || undefined }),
            delay
          )
          return
        }

        if (isBadSession) {
          // Зарегистрированная сессия отвергнута сервером → она протухла/отозвана.
          // Wipe + QR. После wipe следующий старт будет registered=false: если WA
          // продолжит отвергать (теперь уже свежий handshake) — попадём в isInitialReject
          // с длинным backoff. Т.е. максимум ОДИН wipe+быстрый рестарт, дальше — остывание IP.
          // Это и убивает старый цикл из 3128 disconnect'ов.
          lastError = `Сессия отозвана сервером (status ${statusCode}). Очищаю и жду новый QR.`
          console.log(`[Baileys] Bad session (${statusCode}), registered creds rejected, wiping auth and re-issuing QR...`)
          const fs = await import('fs')
          try { fs.rmSync(authDir, { recursive: true, force: true }) } catch {}
          reconnectAttempts = 0
          setTimeout(() => startBaileys(authDir, { mode: 'qr' }), 2000)
          return
        }

        // Временный disconnect — exponential backoff
        lastError = `Временный сбой соединения: ${errMsg} (status ${statusCode}).`
        reconnectAttempts++
        const delay = calcBackoffMs(reconnectAttempts)
        console.log(`[Baileys] Will reconnect in ${delay}ms (attempt #${reconnectAttempts})`)
        setTimeout(
          () => startBaileys(authDir, { mode: activeMode, phoneNumber: pairCodePhone || undefined }),
          delay
        )
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
