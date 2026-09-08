import { getSQL, json } from '../_lib/db.js'
import { fileIncoming } from '../_lib/bridge-inbox.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Входящие из личных WhatsApp сейлзов.
 *
 * Поддержка живёт на GreenAPI и сюда не ходит — здесь только продажи.
 * Разбор общий с Telegram, см. `_lib/bridge-inbox.ts`.
 */

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const secret = process.env.WA_SALES_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) return json({ error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => ({})) as any
  return json(await fileIncoming(getSQL(), {
    phone: String(body.phone || ''),
    text: String(body.text || ''),
    agentId: body.agentId ? String(body.agentId) : null,
    senderName: body.name || null,
    messageId: body.messageId ? String(body.messageId) : null,
    channel: 'WhatsApp',
  }))
}
