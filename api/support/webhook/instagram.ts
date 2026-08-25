import { getSQL, json } from '../lib/db.js'
import { validMetaSignature } from '../lib/meta-signature.js'
import { readMetaConfig, readMetaAccounts } from '../lib/meta-config.js'
import { handleMetaMessaging } from '../lib/meta-messages.js'

export const config = { runtime: 'edge' }

/**
 * Instagram Direct → GFSupport напрямую, минуя AmoCRM.
 *
 * Разбор общий с приёмником заявок (lib/meta-messages): в консоли Meta адрес
 * задаётся отдельно для каждого объекта, и оба можно направить сюда либо оба
 * на /webhook/meta-leads — поведение будет одинаковым. Два разных пути для
 * одного и того же директа означали бы расхождение при первой же правке
 * одного из них.
 *
 * ВАЖНО: директ отдаётся только одному приложению. Пока Instagram подключён
 * как канал в Amo, сообщения уходят туда и сюда не придут — канал в Amo нужно
 * отключить (лид-формы это не затрагивает, они живут отдельно).
 *
 * Доступы берутся из настроек организации (карточка «Instagram и Facebook»
 * в интеграциях), переменные окружения остаются запасным путём.
 */

const ORG = process.env.SALES_ORG || 'org_delever'

export default async function handler(req: Request): Promise<Response> {
  // ─── Проверка подписки со стороны Meta ───────────────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const token = url.searchParams.get('hub.verify_token')
    const cfg = await readMetaConfig(ORG)
    if (url.searchParams.get('hub.mode') === 'subscribe' && token && cfg.verifyToken && token === cfg.verifyToken) {
      return new Response(url.searchParams.get('hub.challenge') || '', {
        status: 200, headers: { 'Content-Type': 'text/plain' },
      })
    }
    return new Response('forbidden', { status: 403 })
  }

  if (req.method !== 'POST') return json({ ok: true })

  // Подпись Meta проверяем до разбора тела: иначе адрес вебхука — открытая
  // дверь для поддельных обращений. Нет секрета в настройках — не принимаем
  const cfg = await readMetaConfig(ORG)
  const raw = await req.text()
  if (!(await validMetaSignature(raw, req.headers.get('x-hub-signature-256'), cfg.appSecret))) {
    console.error('[webhook/instagram] подпись не сошлась или не задан секрет приложения')
    return new Response('forbidden', { status: 403 })
  }

  // Дальше Meta ждёт 200 в любом случае: ошибка на нашей стороне не должна
  // приводить к повторной доставке и отключению подписки
  try {
    const body: any = JSON.parse(raw)
    if (body?.object !== 'instagram' && body?.object !== 'page') return json({ ok: true })
    const taken = await handleMetaMessaging(getSQL(), ORG, body)
    return json({ ok: true, messages: taken })
  } catch (e) {
    console.error('[webhook/instagram] error:', e)
  }

  return json({ ok: true })
}

/**
 * Отправка ответа в директ — используется ассистентом и менеджером.
 *
 * Подключённых аккаунтов может быть несколько, а к какому относится диалог,
 * из одного идентификатора собеседника не понять. Берём единственный, если
 * он один; иначе — общий доступ организации.
 */
export async function sendInstagramMessage(igsid: string, text: string, orgId?: string): Promise<boolean> {
  const org = orgId || ORG
  const accounts = await readMetaAccounts(org)
  const cfg = await readMetaConfig(org)
  const token = accounts.length === 1 ? accounts[0].pageToken : cfg.pageToken
  if (!token) return false
  const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: igsid }, message: { text } }),
  })
  return res.ok
}
