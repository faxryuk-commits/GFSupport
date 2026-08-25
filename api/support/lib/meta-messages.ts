import { ensureSalesSchema, salesId } from './sales-schema.js'
import { acceptLead, logChatMessage } from './sales-intake.js'
import { accountForIg, accountForPage, readMetaAccounts, readMetaConfig } from './meta-config.js'

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
  externalId: string, name: string, marketId: string | null, pageId: string | null,
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
    // Страницу запоминаем и у старых каналов: по ней берётся токен для ответа,
    // и без неё при двух аккаунтах ответ ушёл бы не от того имени
    if (pageId) {
      await sql`
        UPDATE support_channels SET meta_page_id = COALESCE(meta_page_id, ${pageId})
        WHERE id = ${existing.id}
      `
    }
    return existing.id
  }
  const channelId = salesId('ch')
  await sql`
    INSERT INTO support_channels (id, name, type, source, external_chat_id,
                                  is_active, market_id, org_id, meta_page_id, created_at)
    VALUES (${channelId}, ${name}, 'client', ${source}, ${externalId}, true, ${marketId},
            ${orgId}, ${pageId}, NOW())
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
        sql, orgId, source, senderId, name, acc?.marketId || null, acc?.pageId || null)

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

/**
 * Разовая подгрузка истории переписок из Meta.
 *
 * Вебхуки приносят только то, что происходит после подключения, — а диалоги
 * шли и до него. Meta отдаёт архив через conversations, и без него в чатах
 * первое время пусто, хотя переписка с человеком идёт полгода.
 *
 * Повторный запуск безопасен: сообщения различаются по идентификатору Meta,
 * уже загруженные пропускаются.
 */
export async function importMetaHistory(
  sql: any, orgId: string, opts: { conversations?: number; messages?: number } = {},
): Promise<{ channels: number; messages: number; errors: string[] }> {
  const GRAPH = 'https://graph.facebook.com/v21.0'
  const convLimit = Math.min(200, Math.max(1, opts.conversations ?? 50))
  const msgLimit = Math.min(200, Math.max(1, opts.messages ?? 50))
  const accounts = await readMetaAccounts(orgId)
  const out = { channels: 0, messages: 0, errors: [] as string[] }

  await ensureSalesSchema(sql, orgId)

  for (const acc of accounts) {
    if (!acc.pageToken) continue
    // Наши собственные идентификаторы: по ним отличаем свои реплики от клиентских
    const ours = new Set([acc.pageId, acc.igUserId].filter(Boolean).map(String))

    for (const platform of ['instagram', 'messenger'] as const) {
      const source = platform === 'instagram' ? 'instagram' : 'messenger'
      const sourceKey = platform === 'instagram' ? 'instagram_direct' : 'messenger'
      let url = `${GRAPH}/${acc.pageId}/conversations?platform=${platform}`
        + `&fields=participants,updated_time,messages.limit(${msgLimit}){id,created_time,from,message}`
        + `&limit=${Math.min(25, convLimit)}&access_token=${acc.pageToken}`
      let taken = 0

      while (url && taken < convLimit) {
        let data: any
        try {
          const res = await fetch(url)
          data = await res.json()
        } catch (e: any) {
          out.errors.push(`${acc.pageName} ${platform}: ${e?.message || 'нет связи'}`)
          break
        }
        if (data?.error) {
          // Таймаут у Meta на этом методе — обычное дело, не поломка
          out.errors.push(`${acc.pageName} ${platform}: ${String(data.error.message).slice(0, 120)}`)
          break
        }

        for (const conv of (data?.data || [])) {
          taken++
          const other = (conv.participants?.data || []).find((p: any) => !ours.has(String(p.id)))
          if (!other?.id) continue
          const name = other.username ? `@${other.username}` : (other.name || `${source} ${String(other.id).slice(-6)}`)
          const channelId = await getOrCreateChannel(
            sql, orgId, source, String(other.id), name, acc.marketId, acc.pageId)
          out.channels++

          // Меты отдаёт сообщения от новых к старым — разворачиваем, чтобы
          // в ленте они легли в том порядке, в каком люди их писали
          const msgs = [...(conv.messages?.data || [])].reverse()
          for (const m of msgs) {
            const text = String(m.message || '').trim()
            if (!text) continue
            const mine = ours.has(String(m.from?.id || ''))
            const done = await sql`
              INSERT INTO support_messages (id, channel_id, org_id, sender_id, sender_name, sender_role,
                                            is_from_client, content_type, text_content,
                                            external_message_id, is_read, created_at)
              SELECT ${salesId('msg')}, ${channelId}, ${orgId}, ${String(m.from?.id || '')},
                     ${mine ? (m.from?.name || 'Мы') : name}, ${mine ? 'support' : 'client'},
                     ${!mine}, 'text', ${text}, ${String(m.id)}, true,
                     ${m.created_time ? new Date(m.created_time).toISOString() : new Date().toISOString()}
              WHERE NOT EXISTS (
                SELECT 1 FROM support_messages
                WHERE org_id = ${orgId} AND external_message_id = ${String(m.id)}
              )
              RETURNING id
            ` as any[]
            out.messages += done.length
          }

          const last = msgs[msgs.length - 1]
          if (last) {
            await sql`
              UPDATE support_channels
              SET last_message_at = GREATEST(COALESCE(last_message_at, to_timestamp(0)),
                                             ${new Date(last.created_time || Date.now()).toISOString()}),
                  last_message_preview = COALESCE(last_message_preview, ${String(last.message || '').slice(0, 100)}),
                  last_sender_name = COALESCE(last_sender_name, ${name})
              WHERE id = ${channelId}
            `
          }

          // Диалог из архива — тоже обращение: без этого он появится в чатах,
          // но в продажах его не будет, и сейлз о нём не узнает
          const [known] = await sql`
            SELECT l.id FROM sales_leads l JOIN sales_sources s ON s.id = l.source_id
            WHERE l.org_id = ${orgId} AND s.key = ${sourceKey} AND l.external_id = ${String(other.id)}
            LIMIT 1
          ` as any[]
          if (!known) {
            const res = await acceptLead(sql, orgId, {
              source: sourceKey, external_id: String(other.id), name, contact_name: name,
              text: String(msgs[msgs.length - 1]?.message || '').slice(0, 500) || null,
              market: acc.marketId, channel_key: String(other.id), raw: { _imported: true },
            })
            if (res.ok && res.account_id) {
              await sql`
                UPDATE sales_accounts SET channel_id = COALESCE(channel_id, ${channelId})
                WHERE id = ${res.account_id} AND org_id = ${orgId}
              `
            }
          }
        }

        url = taken < convLimit ? (data?.paging?.next || '') : ''
      }
    }
  }
  return out
}
