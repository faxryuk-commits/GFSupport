import { getSQL, json } from '../lib/db.js'
import { ensureSalesSchema, salesId } from '../lib/sales-schema.js'
import { acceptLead, logChatMessage } from '../lib/sales-intake.js'
import { validMetaSignature } from '../lib/meta-signature.js'
import { readMetaConfig, accountForIg, readMetaAccounts } from '../lib/meta-config.js'

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

/**
 * Канал переписки для диалога в директе.
 *
 * Без него сообщения из Instagram оседали только карточкой лида и записью
 * в истории касаний — в разделе «Чаты» их не было вообще, отвечать было
 * неоткуда, и путь ответа в messages/send.ts, рассчитанный на канал
 * с источником instagram, никогда не срабатывал: такой канал никто не создавал.
 */
async function getOrCreateIgChannel(
  sql: any, igsid: string, name: string, marketId: string | null,
): Promise<string> {
  const [existing] = await sql`
    SELECT id, name FROM support_channels
    WHERE external_chat_id = ${igsid} AND source = 'instagram' AND org_id = ${ORG}
    LIMIT 1
  ` as any[]
  if (existing) {
    // Имя профиля меняется — подтягиваем, иначе в списке чатов навсегда
    // останется числовой идентификатор вместо ника
    if (name && existing.name !== name && !name.startsWith('Instagram ')) {
      await sql`UPDATE support_channels SET name = ${name} WHERE id = ${existing.id}`
    }
    return existing.id
  }
  const channelId = salesId('ch')
  await sql`
    INSERT INTO support_channels (id, name, type, source, external_chat_id,
                                  is_active, market_id, org_id, created_at)
    VALUES (${channelId}, ${name}, 'client', 'instagram', ${igsid}, true, ${marketId}, ${ORG}, NOW())
  `
  return channelId
}

/** Входящее сообщение директа в общую ленту переписки. */
async function saveIgMessage(
  sql: any, channelId: string, igsid: string, name: string, text: string, hasMedia: boolean,
): Promise<void> {
  await sql`
    INSERT INTO support_messages (id, channel_id, org_id, sender_id, sender_name, sender_role,
                                  is_from_client, content_type, text_content, is_read, created_at)
    VALUES (${salesId('msg')}, ${channelId}, ${ORG}, ${igsid}, ${name}, 'client',
            true, ${hasMedia ? 'photo' : 'text'}, ${text}, false, NOW())
  `
  await sql`
    UPDATE support_channels
    SET last_message_at = NOW(), last_message_preview = ${text.slice(0, 100)},
        last_sender_name = ${name}, awaiting_reply = true
    WHERE id = ${channelId}
  `
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

        // Токен того аккаунта, которому адресовано сообщение: entry.id —
        // это инстаграм-профиль, на который написали
        const acc = await accountForIg(ORG, entry.id ? String(entry.id) : null)
        const igToken = acc?.pageToken || cfg.pageToken

        // Диалог = один лид: external_id это id собеседника, поэтому второе
        // сообщение не создаёт вторую карточку, а дописывается в историю
        const [existing] = await sql`
          SELECT l.id, l.account_id, l.name FROM sales_leads l
          JOIN sales_sources s ON s.id = l.source_id
          WHERE l.org_id = ${ORG} AND s.key = ${SOURCE} AND l.external_id = ${igsid}
          LIMIT 1
        `

        if (existing) {
          // Переписка идёт в общую ленту наравне с телеграмом и вотсапом —
          // иначе диалог виден только карточкой лида, а ответить неоткуда
          const ch = await getOrCreateIgChannel(sql, igsid, existing.name || `Instagram ${igsid.slice(-6)}`,
            acc?.marketId || null)
          await saveIgMessage(sql, ch, igsid, existing.name || 'Instagram', fullText, Boolean(media))
          await logChatMessage(sql, ORG, existing.account_id, 'in', fullText, 'клиент')
          await sql`
            UPDATE sales_leads SET text = ${fullText}, raw = ${JSON.stringify(ev)}::jsonb
            WHERE id = ${existing.id}
          `
          continue
        }

        const name = (await fetchProfileName(igsid, igToken)) || `Instagram ${igsid.slice(-6)}`
        const channelId = await getOrCreateIgChannel(sql, igsid, name, acc?.marketId || null)
        await saveIgMessage(sql, channelId, igsid, name, fullText, Boolean(media))

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
          // Привязка канала к аккаунту: по ней карточка сделки показывает
          // переписку и умеет отвечать прямо оттуда
          await sql`
            UPDATE sales_accounts SET channel_id = COALESCE(channel_id, ${channelId})
            WHERE id = ${result.account_id} AND org_id = ${ORG}
          `
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
  // Подключённых аккаунтов может быть несколько, а к какому относится диалог,
  // из одного идентификатора собеседника не понять. Берём единственный, если
  // он один; иначе — общий доступ организации
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
