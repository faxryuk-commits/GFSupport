import { Router, Request, Response } from 'express'
import multer from 'multer'
import { getStatus, getCurrentQR, sendText, sendMedia, logoutWhatsApp } from './baileys.js'
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
    res.json({ connected: status.connected, phone: status.phone, qr: status.qr, lastError: status.lastError, filterMode: getFilterMode() })
  })

  router.get('/filter', (_req: Request, res: Response) => {
    res.json({ filterMode: getFilterMode() })
  })

  router.get('/health', (_req: Request, res: Response) => {
    const status = getStatus()
    res.json({
      ok: status.connected,
      uptime: process.uptime(),
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
