import { getSQL, json } from '../_lib/db.js'
import { validMetaSignature } from '../_lib/meta-signature.js'
import { readMetaConfig, readMetaAccounts } from '../_lib/meta-config.js'
import { handleMetaMessaging } from '../_lib/meta-messages.js'
import { handleMetaComments } from '../_lib/meta-comments.js'
import { handleCommentByAgent } from '../_lib/meta-comment-agent.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

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
    const sql = getSQL()
    // Сообщения и комментарии приходят на один адрес разными ветками:
    // первые в entry.messaging, вторые в entry.changes
    const taken = await handleMetaMessaging(sql, ORG, body)
    const fresh = await handleMetaComments(sql, ORG, body)
    await runCommentAgent(sql, fresh)
    return json({ ok: true, messages: taken, comments: fresh.length })
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

/**
 * Разбор свежих комментариев агентом.
 *
 * Делаем в вебхуке, а не кроном: комментарий под рекламой живёт минутами, и
 * ответ через час стоит примерно столько же, сколько молчание. Ограничение
 * на три штуки за доставку — предохранитель от лавины на вирусном посте,
 * остальные разберутся при следующем открытии экрана.
 */
async function runCommentAgent(sql: any, fresh: string[]): Promise<void> {
  if (!fresh.length) return
  const on = await agentSwitch(sql)
  if (!on.enabled) return
  for (const id of fresh.slice(0, 3)) {
    try {
      await handleCommentByAgent(sql, ORG, id, { autoReply: on.autoReply })
    } catch (e) {
      console.error('[агент комментариев]', id, e)
    }
  }
}

/** Выключатель агента. По умолчанию включён: иначе о нём просто забудут. */
async function agentSwitch(sql: any): Promise<{ enabled: boolean; autoReply: boolean }> {
  try {
    const [row] = await sql`
      SELECT value FROM support_settings
      WHERE org_id = ${ORG} AND key = 'meta_comment_agent' LIMIT 1
    ` as any[]
    if (!row?.value) return { enabled: true, autoReply: true }
    const v = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
    return { enabled: v.enabled !== false, autoReply: v.autoReply !== false }
  } catch {
    return { enabled: true, autoReply: true }
  }
}
