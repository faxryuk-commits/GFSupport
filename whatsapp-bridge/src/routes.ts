import { Router, Request, Response } from 'express'
import multer from 'multer'
import { getStatus, sendText, sendMedia } from './baileys.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } })

export function createRouter(bridgeSecret: string): Router {
  const router = Router()

  router.use((req: Request, res: Response, next) => {
    if (req.path === '/status' && req.method === 'GET') return next()

    const auth = req.headers.authorization
    if (auth !== `Bearer ${bridgeSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    next()
  })

  router.get('/status', (_req: Request, res: Response) => {
    res.json(getStatus())
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
