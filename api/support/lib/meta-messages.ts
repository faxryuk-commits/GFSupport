import { ensureSalesSchema, salesId } from './sales-schema.js'
import { acceptLead, logChatMessage } from './sales-intake.js'
import { accountForIg, accountForPage, readMetaConfig } from './meta-config.js'

/**
 * Входящие сообщения Meta — директ Instagram и Messenger — в общую ленту.
 *
 * Живёт отдельной библиотекой, потому что уведомления об этом приходят на два
 * разных объекта Meta (page и instagram), и оба могут быть настроены на один
 * наш адрес. Разбор должен быть один и тот же, иначе поведение разъедется:
 * директ ляжет в чаты, а Messenger — молча потеряется.
 */

/** Тип вложения человеческим языком — в текст лида и в историю. */
function describeAttachments(atts: any[]): string {
  if (!atts?.length) return ''
  return atts.map(a => {
    switch (a?.type) {
      case 'image': return '[фото]'
      case 'video': return '[видео]'
      case 'audio': return '[голосовое]'
      case 'file': return '[файл]'
      case 'share': return '[рилс или пост]'
      case 'story_mention': return '[упоминание в сторис]'
      case 'ig_reel': return '[рилс]'
      default: return '[вложение]'
    }
  }).join(' ')
}

/** Имя собеседника: без него в списке чатов будет безликий числовой id. */
async function fetchProfileName(userId: string, token: string | null): Promise<string | null> {
  if (!token) return null
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${userId}?fields=name,username&access_token=${token}`)
    if (!res.ok) return null
    const data: any = await res.json()
    return data?.username ? `@${data.username}` : (data?.name || null)
  } catch {
    return null
  }
}

async function getOrCreateChannel(
  sql: any, orgId: string, source: 'instagram' | 'messenger',
  externalId: string, name: string, marketId: string | null,
): Promise<string> {
  const [existing] = await sql`
    SELECT id, name FROM support_channels
    WHERE external_chat_id = ${externalId} AND source = ${source} AND org_id = ${orgId}
    LIMIT 1
  ` as any[]
  if (existing) {
    // Имя профиля меняется — подтягиваем, иначе в списке навсегда останется
    // числовой идентификатор вместо ника
    if (name && existing.name !== name && !/^(Instagram|Messenger) /.test(name)) {
      await sql`UPDATE support_channels SET name = ${name} WHERE id = ${existing.id}`
    }
    return existing.id
  }
  const channelId = salesId('ch')
  await sql`
    INSERT INTO support_channels (id, name, type, source, external_chat_id,
                                  is_active, market_id, org_id, created_at)
    VALUES (${channelId}, ${name}, 'client', ${source}, ${externalId}, true, ${marketId}, ${orgId}, NOW())
  `
  return channelId
}

/**
 * Разбор одного уведомления Meta с сообщениями.
 *
 * Возвращает, сколько сообщений принято, — по этому числу видно в логах,
 * работает канал или молчит.
 */
export async function handleMetaMessaging(
  sql: any, orgId: string, body: any,
): Promise<number> {
  const isInstagram = body?.object === 'instagram'
  const source: 'instagram' | 'messenger' = isInstagram ? 'instagram' : 'messenger'
  const sourceKey = isInstagram ? 'instagram_direct' : 'messenger'
  let taken = 0

  await ensureSalesSchema(sql, orgId)

  for (const entry of body?.entry || []) {
    // Кому написали: у instagram это профиль, у page — страница
    const acc = isInstagram
      ? await accountForIg(orgId, entry.id ? String(entry.id) : null)
      : await accountForPage(orgId, entry.id ? String(entry.id) : null)
    const cfg = await readMetaConfig(orgId)
    const token = acc?.pageToken || cfg.pageToken

    for (const ev of entry.messaging || []) {
      const msg = ev.message
      // Эхо наших же ответов, прочтения и реакции на доставку пропускаем
      if (!msg || msg.is_echo) continue
      const senderId = String(ev.sender?.id || '')
      if (!senderId) continue

      const text = String(msg.text || '').trim()
      const media = describeAttachments(msg.attachments || [])
      const fullText = [text, media].filter(Boolean).join(' ') || '[пустое сообщение]'

      // Диалог = один лид: external_id это id собеседника, поэтому второе
      // сообщение не создаёт вторую карточку, а дописывается в историю
      const [existing] = await sql`
        SELECT l.id, l.account_id, l.name FROM sales_leads l
        JOIN sales_sources s ON s.id = l.source_id
        WHERE l.org_id = ${orgId} AND s.key = ${sourceKey} AND l.external_id = ${senderId}
        LIMIT 1
      ` as any[]

      const fallback = `${isInstagram ? 'Instagram' : 'Messenger'} ${senderId.slice(-6)}`
      const name = existing?.name || (await fetchProfileName(senderId, token)) || fallback
      const channelId = await getOrCreateChannel(
        sql, orgId, source, senderId, name, acc?.marketId || null)

      await sql`
        INSERT INTO support_messages (id, channel_id, org_id, sender_id, sender_name, sender_role,
                                      is_from_client, content_type, text_content, is_read, created_at)
        VALUES (${salesId('msg')}, ${channelId}, ${orgId}, ${senderId}, ${name}, 'client',
                true, ${media ? 'photo' : 'text'}, ${fullText}, false, NOW())
      `
      await sql`
        UPDATE support_channels
        SET last_message_at = NOW(), last_message_preview = ${fullText.slice(0, 100)},
            last_sender_name = ${name}, awaiting_reply = true
        WHERE id = ${channelId}
      `
      taken++

      if (existing) {
        await logChatMessage(sql, orgId, existing.account_id, 'in', fullText, 'клиент')
        await sql`
          UPDATE sales_leads SET text = ${fullText}, raw = ${JSON.stringify(ev)}::jsonb
          WHERE id = ${existing.id}
        `
        continue
      }

      const result = await acceptLead(sql, orgId, {
        source: sourceKey,
        external_id: senderId,
        name,
        contact_name: name,
        text: fullText,
        market: acc?.marketId || null,
        channel_key: senderId,
        raw: ev,
      })
      if (result.ok && result.account_id) {
        await logChatMessage(sql, orgId, result.account_id, 'in', fullText, 'клиент')
        // Привязка канала к аккаунту: по ней карточка сделки показывает
        // переписку и умеет отвечать прямо оттуда
        await sql`
          UPDATE sales_accounts SET channel_id = COALESCE(channel_id, ${channelId})
          WHERE id = ${result.account_id} AND org_id = ${orgId}
        `
        await sql`
          UPDATE sales_contacts SET telegram = COALESCE(telegram, ${name})
          WHERE account_id = ${result.account_id} AND is_primary = true
        `
      }
    }
  }
  return taken
}
