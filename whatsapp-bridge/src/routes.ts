import { Router, Request, Response } from 'express'
import multer from 'multer'
import { getStatus, getCurrentQR, sendText, sendMedia, logoutWhatsApp, requestPairCode, getConnectionMetrics, getSocket } from './baileys.js'
import { getFilterMode, setFilterMode, getMessageStats, type FilterMode } from './index.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } })

export function createRouter(bridgeSecret: string, authDir: string): Router {
  const router = Router()

  router.use((req: Request, res: Response, next) => {
    // Health check remains public for infrastructure monitoring
    if (req.path === '/health' && req.method === 'GET') return next()

    const auth = req.headers.authorization
    if (auth !== `Bearer ${bridgeSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    next()
  })

  router.get('/status', (_req: Request, res: Response) => {
    const status = getStatus()
    res.json(status)
  })

  router.get('/qr', (_req: Request, res: Response) => {
    const status = getStatus()
    res.json({
      connected: status.connected,
      phone: status.phone,
      qr: status.qr,
      lastError: status.lastError,
      filterMode: getFilterMode(),
      mode: status.mode,
      pairCode: status.pairCode,
      pairCodeExpiresAt: status.pairCodeExpiresAt,
      pairCodePhone: status.pairCodePhone,
    })
  })

  router.post('/pair-code', async (req: Request, res: Response) => {
    try {
      const { phone } = req.body || {}
      if (!phone || typeof phone !== 'string') {
        return res.status(400).json({ error: 'phone is required' })
      }
      const result = await requestPairCode(authDir, phone)
      if (result.error) {
        const code = result.error === 'invalid_phone' ? 400 : result.error === 'already_connected' ? 409 : 500
        return res.status(code).json({ error: result.error })
      }
      res.json({
        success: true,
        code: result.code,
        expiresAt: result.expiresAt,
        phone: result.phone,
      })
    } catch (e: any) {
      console.error('[Route /pair-code]', e.message)
      res.status(500).json({ error: e.message })
    }
  })

  router.get('/filter', (_req: Request, res: Response) => {
    res.json({ filterMode: getFilterMode() })
  })

  router.get('/health', (_req: Request, res: Response) => {
    const status = getStatus()
    const metrics = getConnectionMetrics()
    const stats = getMessageStats()
    res.json({
      ok: status.connected,
      uptime: process.uptime(),
      phone: status.phone,
      lastError: status.lastError,
      reconnectAttempts: metrics.reconnectAttempts,
      totalDisconnects: metrics.totalDisconnects,
      initialRejectStreak: metrics.initialRejectStreak,
      everConnected: metrics.everConnected,
      uptimeMs: metrics.uptimeMs,
      downtimeMs: metrics.downtimeMs,
      lastConnectedAt: metrics.lastConnectedAt ? new Date(metrics.lastConnectedAt).toISOString() : null,
      lastDisconnectedAt: metrics.lastDisconnectedAt ? new Date(metrics.lastDisconnectedAt).toISOString() : null,
      messageStats: stats,
    })
  })

  router.post('/filter', (req: Request, res: Response) => {
    const { mode } = req.body
    if (mode !== 'all' && mode !== 'groups_only') {
      return res.status(400).json({ error: 'mode must be "all" or "groups_only"' })
    }
    setFilterMode(mode as FilterMode)
    console.log(`[Filter] Mode changed to: ${mode}`)
    res.json({ success: true, filterMode: mode })
  })

  router.post('/logout', async (_req: Request, res: Response) => {
    try {
      await logoutWhatsApp(authDir)
      res.json({ success: true, message: 'Logged out, waiting for new QR' })
    } catch (e: any) {
      console.error('[Route /logout]', e.message)
      res.status(500).json({ success: false, error: e.message })
    }
  })

  /**
   * Есть ли номер в WhatsApp. Спрашиваем сам WhatsApp (onWhatsApp), а не
   * гадаем: карточка показывает значок только по факту проверки.
   * Формат ответа общий с Telegram-мостом — CRM спрашивает их одинаково.
   */
  router.post('/check', async (req: Request, res: Response) => {
    try {
      const raw = String(req.body?.phone || '')
      const digits = raw.replace(/\D/g, '')
      if (digits.length < 9) return res.status(400).json({ error: 'phone required' })

      const sock = getSocket()
      if (!sock) return res.json({ exists: null, reason: 'WhatsApp не подключён' })

      const found = await sock.onWhatsApp(digits)
      const hit = Array.isArray(found) ? found.find((f: any) => f?.exists) : null
      res.json({ exists: !!hit, jid: hit?.jid || null })
    } catch (e: any) {
      console.error('[Route /check]', e.message)
      res.json({ exists: null, error: e.message })
    }
  })

  /**
   * Отправка по номеру, а не по известному чату: сейлз пишет клиенту,
   * с которым переписки ещё не было. Номер приводим к jid сами.
   */
  router.post('/send-to', async (req: Request, res: Response) => {
    try {
      const digits = String(req.body?.phone || '').replace(/\D/g, '')
      const text = String(req.body?.text || '')
      if (digits.length < 9 || !text) {
        return res.status(400).json({ error: 'phone and text required' })
      }
      const sock = getSocket()
      if (!sock) return res.status(503).json({ success: false, error: 'WhatsApp не подключён' })

      const found = await sock.onWhatsApp(digits)
      const hit = Array.isArray(found) ? found.find((f: any) => f?.exists) : null
      if (!hit?.jid) return res.status(404).json({ success: false, error: 'номера нет в WhatsApp' })

      const result = await sendText(hit.jid, text)
      res.json({ success: true, messageId: result?.key?.id, jid: hit.jid })
    } catch (e: any) {
      console.error('[Route /send-to]', e.message)
      res.status(500).json({ success: false, error: e.message })
    }
  })

  router.post('/send', async (req: Request, res: Response) => {
    try {
      const { chatId, text } = req.body
      if (!chatId || !text) {
        return res.status(400).json({ error: 'chatId and text required' })
      }

      const result = await sendText(chatId, text)
      res.json({ success: true, messageId: result?.key?.id })
    } catch (e: any) {
      console.error('[Route /send]', e.message)
      res.status(500).json({ success: false, error: e.message })
    }
  })

  router.post('/send-media', upload.single('file'), async (req: Request, res: Response) => {
    try {
      const chatId = req.body.chatId as string
      const caption = req.body.caption as string | undefined

      if (!chatId || !req.file) {
        return res.status(400).json({ error: 'chatId and file required' })
      }

      const result = await sendMedia(
        chatId,
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
        caption
      )
      res.json({ success: true, messageId: result?.key?.id })
    } catch (e: any) {
      console.error('[Route /send-media]', e.message)
      res.status(500).json({ success: false, error: e.message })
    }
  })

  return router
}
