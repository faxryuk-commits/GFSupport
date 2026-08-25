import { getSQL, json } from '../lib/db.js'
import { ensureSalesSchema, salesId } from '../lib/sales-schema.js'
import { acceptLead, logChatMessage } from '../lib/sales-intake.js'
import { validMetaSignature } from '../lib/meta-signature.js'
import { readMetaConfig } from '../lib/meta-config.js'

export const config = { runtime: 'edge' }

/**
 * Instagram Direct → GFSupport напрямую, минуя AmoCRM.
 *
 * Почему не через Amo: заявки лид-форм становятся в Amo сделками и читаются
 * обычным API — там мост работает. А директ живёт в подсистеме чатов, чей API
 * рассчитан на владельца канала, а не на чтение чужого. Ассистенту нужен ответ
 * за минуту, поэтому канал забираем себе.
 *
 * GET  — проверка вебхука Meta (hub.challenge)
 * POST — входящие сообщения
 *
 * ВАЖНО: директ отдаётся только одному приложению. Пока Instagram подключён
 * как канал в Amo, сообщения уходят туда и сюда не придут — канал в Amo нужно
 * отключить (лид-формы это не затрагивает, они живут отдельно).
 *
 * Доступы берутся из настроек организации (карточка «Instagram и Facebook»
 * в интеграциях), переменные окружения остаются запасным путём.
 */

const ORG = process.env.SALES_ORG || 'org_delever'
const SOURCE = 'instagram_direct'

/** Тип вложения человеческим языком — в текст лида и в историю. */
function describeAttachments(atts: any[]): string {
  if (!atts?.length) return ''
  const names = atts.map(a => {
    switch (a?.type) {
      case 'image': return '[фото]'
      case 'video': return '[видео]'
      case 'audio': return '[голосовое]'
      case 'share': return '[рилс или пост]'
      case 'story_mention': return '[упоминание в сторис]'
      case 'ig_reel': return '[рилс]'
      default: return '[вложение]'
    }
  })
  return names.join(' ')
}

/** Имя профиля: без него в очереди будет безликий числовой id. */
async function fetchProfileName(igsid: string, token: string | null): Promise<string | null> {
  if (!token) return null
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${igsid}?fields=name,username&access_token=${token}`)
    if (!res.ok) return null
    const data: any = await res.json()
    return data?.username ? `@${data.username}` : (data?.name || null)
  } catch {
    return null
  }
}

export default async function handler(req: Request): Promise<Response> {
  // ─── Проверка подписки со стороны Meta ───────────────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    const cfg = await readMetaConfig(ORG)
    if (mode === 'subscribe' && token && cfg.verifyToken && token === cfg.verifyToken) {
      return new Response(challenge || '', { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
    return new Response('forbidden', { status: 403 })
  }

  if (req.method !== 'POST') return json({ ok: true })

  // Подпись Meta проверяем до разбора тела: иначе адрес вебхука — открытая
  // дверь для поддельных обращений. Нет секрета в переменных — не принимаем
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
    await ensureSalesSchema(sql, ORG)

    for (const entry of body.entry || []) {
      for (const ev of entry.messaging || []) {
        const msg = ev.message
        // Эхо наших же ответов, прочтения и реакции на доставку пропускаем
        if (!msg || msg.is_echo) continue

        const igsid = String(ev.sender?.id || '')
        if (!igsid) continue

        const text = String(msg.text || '').trim()
        const media = describeAttachments(msg.attachments || [])
        const fullText = [text, media].filter(Boolean).join(' ') || '[пустое сообщение]'

        // Диалог = один лид: external_id это id собеседника, поэтому второе
        // сообщение не создаёт вторую карточку, а дописывается в историю
        const [existing] = await sql`
          SELECT l.id, l.account_id FROM sales_leads l
          JOIN sales_sources s ON s.id = l.source_id
          WHERE l.org_id = ${ORG} AND s.key = ${SOURCE} AND l.external_id = ${igsid}
          LIMIT 1
        `

        if (existing) {
          await logChatMessage(sql, ORG, existing.account_id, 'in', fullText, 'клиент')
          await sql`
            UPDATE sales_leads SET text = ${fullText}, raw = ${JSON.stringify(ev)}::jsonb
            WHERE id = ${existing.id}
          `
          continue
        }

        const name = (await fetchProfileName(igsid, cfg.pageToken)) || `Instagram ${igsid.slice(-6)}`
        const result = await acceptLead(sql, ORG, {
          source: SOURCE,
          external_id: igsid,
          name,
          contact_name: name,
          text: fullText,
          channel_key: igsid,
          raw: ev,
        })

        if (result.ok && result.account_id) {
          await logChatMessage(sql, ORG, result.account_id, 'in', fullText, 'клиент')
          // Ник пригодится для склейки с существующим клиентом по контактам
          await sql`
            UPDATE sales_contacts SET telegram = COALESCE(telegram, ${name})
            WHERE account_id = ${result.account_id} AND is_primary = true
          `
        }
      }
    }
  } catch (e) {
    console.error('[webhook/instagram] error:', e)
  }

  return json({ ok: true })
}

/** Отправка ответа в директ — используется ассистентом и менеджером. */
export async function sendInstagramMessage(igsid: string, text: string, orgId?: string): Promise<boolean> {
  const cfg = await readMetaConfig(orgId || ORG)
  const token = cfg.pageToken
  if (!token) return false
  const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: igsid }, message: { text } }),
  })
  return res.ok
}
