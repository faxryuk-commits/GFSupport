import { getSQL, json } from '../_lib/db.js'
import { fileIncoming } from '../_lib/bridge-inbox.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Входящие из личных Telegram-аккаунтов сейлзов.
 *
 * Разбор — в общем приёмнике `_lib/bridge-inbox.ts`: он один и тот же
 * для Telegram и WhatsApp, чтобы обещание «в систему попадает только
 * переписка с клиентом» держалось в одном месте, а не в двух копиях.
 */

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const secret = process.env.TELEGRAM_BRIDGE_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) return json({ error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => ({})) as any
  return json(await fileIncoming(getSQL(), {
    phone: String(body.phone || ''),
    text: String(body.text || ''),
    agentId: body.agentId ? String(body.agentId) : null,
    senderName: body.name || (body.username ? '@' + body.username : null),
    messageId: body.messageId ? String(body.messageId) : null,
    tgUserId: body.userId ? String(body.userId) : null,
    username: body.username ? String(body.username) : null,
    channel: 'Telegram',
    direction: body.direction === 'out' ? 'out' : 'in',
  }))
}
