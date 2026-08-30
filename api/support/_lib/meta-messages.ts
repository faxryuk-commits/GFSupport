import { ensureSalesSchema, salesId } from './sales-schema.js'
import { acceptLead, logChatMessage } from './sales-intake.js'
import { stopNurtureOnReply } from './sales-assistant.js'
import { runQualifier } from './sales-qualifier.js'
import { waitUntil } from '@vercel/functions'
import { accountForIg, accountForPage, readMetaAccounts, readMetaConfig } from './meta-config.js'

/**
 * Входящие сообщения Meta — директ Instagram и Messenger — в общую ленту.
 *
 * Живёт отдельной библиотекой, потому что уведомления об этом приходят на два
 * разных объекта Meta (page и instagram), и оба могут быть настроены на один
 * наш адрес. Разбор должен быть один и тот же, иначе поведение разъедется:
 * директ ляжет в чаты, а Messenger — молча потеряется.
 */

/**
 * Запрос к Meta с ограничением по времени.
 *
 * У метода conversations Meta регулярно отвечает собственным «Timeout», и
 * висящий запрос съедал весь бюджет функции: страница диалогов не успевала
 * закончиться, и шлюз обрывал соединение раньше, чем мы возвращали курсор.
 */
async function graphFetch(url: string, ms = 8000): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) })
  return res.json()
}

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

/**
 * Имя собеседника: без него в списке чатов будет безликий числовой id.
 *
 * Набор полей у площадок разный, и лишнее поле Graph не игнорирует, а
 * отвергает весь запрос. Поле username у собеседника из Messenger объявлено
 * устаревшим — из-за него не приходило ни имени, ни ошибки, и все диалоги
 * назывались «Messenger 545555».
 */
async function fetchProfileName(
  userId: string, token: string | null, platform: 'instagram' | 'messenger',
): Promise<string | null> {
  if (!token) return null
  const fields = platform === 'instagram' ? 'name,username' : 'name,first_name,last_name'
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${userId}?fields=${fields}&access_token=${token}`)
    if (!res.ok) return null
    const data: any = await res.json()
    if (data?.username) return `@${data.username}`
    if (data?.name) return String(data.name)
    const full = [data?.first_name, data?.last_name].filter(Boolean).join(' ').trim()
    return full || null
  } catch {
    return null
  }
}

/**
 * Регион канала хранится идентификатором из справочника рынков, а у аккаунта
 * Meta он лежит кодом («uz», «kz»). Разница незаметна ровно до того момента,
 * когда фильтр региона в чатах прячет новые каналы: коду там взяться неоткуда,
 * и диалоги просто исчезают из списка.
 */
async function marketIdByCode(sql: any, orgId: string, code: string | null): Promise<string | null> {
  if (!code) return null
  const [row] = await sql`
    SELECT id FROM support_markets
    WHERE org_id = ${orgId} AND LOWER(code) = LOWER(${code}) LIMIT 1
  ` as any[]
  return row?.id || null
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
    // Отключённая страница не должна продолжать наполнять систему
    if (!acc && (await readMetaAccounts(orgId)).length) continue

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
        SELECT l.id, l.account_id, l.name, l.status FROM sales_leads l
        JOIN sales_sources s ON s.id = l.source_id
        WHERE l.org_id = ${orgId} AND s.key = ${sourceKey} AND l.external_id = ${senderId}
        LIMIT 1
      ` as any[]

      const fallback = `${isInstagram ? 'Instagram' : 'Messenger'} ${senderId.slice(-6)}`
      const name = existing?.name || (await fetchProfileName(senderId, token, source)) || fallback
      const channelId = await getOrCreateChannel(
        sql, orgId, source, senderId, name,
        await marketIdByCode(sql, orgId, acc?.marketId || null), acc?.pageId || null)

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
        // Ответ в директ останавливает прогрев так же, как ответ боту сайта:
        // до сих пор прогреватель продолжал слать касания поверх живого
        // разговора — эту остановку знал только приёмник Telegram
        if (existing.status === 'nurture') {
          await stopNurtureOnReply(sql, orgId, existing.id, fullText.slice(0, 500))
        }
        waitUntil(runQualifier(sql, orgId, {
          leadId: existing.id, channelId, inboundText: fullText,
        }).catch(() => {}))
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
        if (result.lead_id) {
          waitUntil(runQualifier(sql, orgId, {
            leadId: result.lead_id, channelId, inboundText: fullText,
          }).catch(() => {}))
        }
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
 * Подгрузка истории переписок из Meta — порциями, с продолжением.
 *
 * Вебхуки приносят только то, что происходит после подключения, — а диалоги
 * шли и до него. Meta отдаёт архив через conversations, и без него в чатах
 * первое время пусто, хотя переписка с человеком идёт полгода.
 *
 * Раньше функция обходила все аккаунты и все диалоги за один заход и не
 * укладывалась во время: на каждый диалог отдельный запрос за сообщениями,
 * и на второй сотне шлюз отвечал 504. Теперь за один вызов делается
 * столько, сколько влезает в бюджет, а место остановки возвращается
 * курсором — вызывающий продолжает с него.
 *
 * Повторный запуск безопасен: сообщения различаются по идентификатору Meta,
 * уже загруженные пропускаются.
 */
export interface ImportCursor {
  accountId: string
  platform: 'instagram' | 'messenger'
  after?: string
}

export async function importMetaHistory(
  sql: any, orgId: string,
  opts: {
    conversations?: number; messages?: number
    budgetMs?: number; cursor?: ImportCursor | null
  } = {},
): Promise<{ channels: number; messages: number; errors: string[]; next: ImportCursor | null }> {
  const GRAPH = 'https://graph.facebook.com/v21.0'
  // Порция маленькая намеренно: бюджет проверяется между страницами, и одна
  // большая страница успевала съесть всё время до проверки
  const pageSize = Math.min(10, Math.max(1, opts.conversations ?? 5))
  const msgLimit = Math.min(200, Math.max(1, opts.messages ?? 50))
  const budgetMs = Math.max(3000, opts.budgetMs ?? 12_000)
  const until = Date.now() + budgetMs
  const accounts = await readMetaAccounts(orgId)
  const out = { channels: 0, messages: 0, errors: [] as string[], next: null as ImportCursor | null }

  await ensureSalesSchema(sql, orgId)

  // Работа разложена в плоский список: аккаунт × площадка. По нему легко
  // и продолжить с нужного места, и понять, что осталось
  const tasks: Array<{ acc: any; platform: 'instagram' | 'messenger' }> = []
  for (const acc of accounts) {
    if (!acc.pageToken) continue
    for (const platform of ['instagram', 'messenger'] as const) tasks.push({ acc, platform })
  }

  let start = 0
  let after = opts.cursor?.after
  if (opts.cursor) {
    const at = tasks.findIndex(t =>
      t.acc.id === opts.cursor!.accountId && t.platform === opts.cursor!.platform)
    if (at >= 0) start = at
    else after = undefined
  }

  for (let i = start; i < tasks.length; i++) {
    const { acc, platform } = tasks[i]
    const source: 'instagram' | 'messenger' = platform
    const sourceKey = platform === 'instagram' ? 'instagram_direct' : 'messenger'
    const ours = new Set([acc.pageId, acc.igUserId].filter(Boolean).map(String))
    const marketId = await marketIdByCode(sql, orgId, acc.marketId)

    for (;;) {
      const url = `${GRAPH}/${acc.pageId}/conversations?platform=${platform}`
        + `&fields=id,participants,updated_time&limit=${pageSize}`
        + (after ? `&after=${encodeURIComponent(after)}` : '')
        + `&access_token=${acc.pageToken}`

      let data: any
      try {
        data = await graphFetch(url)
      } catch (e: any) {
        out.errors.push(`${acc.pageName} ${platform}: `
          + (e?.name === 'TimeoutError' ? 'Meta не ответила вовремя' : (e?.message || 'нет связи')))
        break
      }
      if (data?.error) {
        // Таймаут у Meta на этом методе — обычное дело, не поломка
        out.errors.push(`${acc.pageName} ${platform}: ${String(data.error.message).slice(0, 120)}`)
        break
      }

      const convs = (data?.data || []) as any[]
      // Сообщения тянем пачками: сорок диалогов подряд по одному запросу —
      // это и есть те сорок секунд, на которых всё обрывалось
      for (let b = 0; b < convs.length; b += 5) {
        await Promise.all(convs.slice(b, b + 5).map(conv =>
          ingestConversation(sql, orgId, acc, source, sourceKey, ours, marketId,
                             conv, msgLimit, GRAPH, out)))
      }

      after = data?.paging?.cursors?.after || ''
      const more = Boolean(after && convs.length === pageSize)
      if (!more) { after = undefined; break }
      if (Date.now() > until) {
        out.next = { accountId: acc.id, platform, after }
        return out
      }
    }

    if (Date.now() > until && i + 1 < tasks.length) {
      out.next = { accountId: tasks[i + 1].acc.id, platform: tasks[i + 1].platform }
      return out
    }
  }
  return out
}

/** Один диалог: канал, сообщения и обращение в продажах. */
async function ingestConversation(
  sql: any, orgId: string, acc: any,
  source: 'instagram' | 'messenger', sourceKey: string,
  ours: Set<string>, marketId: string | null,
  conv: any, msgLimit: number, GRAPH: string,
  out: { channels: number; messages: number; errors: string[] },
): Promise<void> {
  const other = (conv.participants?.data || []).find((p: any) => !ours.has(String(p.id)))
  if (!other?.id) return
  const name = other.username ? `@${other.username}`
    : (other.name || `${source} ${String(other.id).slice(-6)}`)

  const channelId = await getOrCreateChannel(
    sql, orgId, source, String(other.id), name, marketId, acc.pageId)
  out.channels++

  // Meta отдаёт сообщения от новых к старым — разворачиваем, чтобы в ленте
  // они легли в том порядке, в каком люди их писали
  let msgs: any[] = []
  try {
    const md: any = await graphFetch(
      `${GRAPH}/${conv.id}/messages?fields=id,created_time,from,message`
      + `&limit=${msgLimit}&access_token=${acc.pageToken}`)
    msgs = [...(md?.data || [])].reverse()
  } catch { /* диалог без сообщений — не повод ронять весь импорт */ }

  // Сообщения пишем одной пачкой, а не по одному. Каждая вставка — это заход
  // в базу примерно на двести миллисекунд, и полсотни сообщений в диалоге
  // превращались в десять секунд на ровном месте
  const fresh = msgs.filter(m => String(m.message || '').trim())
  if (fresh.length) {
    const ids = fresh.map(m => String(m.id))
    const known = new Set((await sql`
      SELECT external_message_id FROM support_messages
      WHERE org_id = ${orgId} AND external_message_id = ANY(${ids})
    ` as any[]).map(r => r.external_message_id))

    const rows = fresh.filter(m => !known.has(String(m.id)))
    if (rows.length) {
      const params: any[] = []
      const values = rows.map(m => {
        const mine = ours.has(String(m.from?.id || ''))
        params.push(
          salesId('msg'), channelId, orgId, String(m.from?.id || ''),
          mine ? (m.from?.name || 'Мы') : name, mine ? 'support' : 'client', !mine,
          String(m.message).trim(), String(m.id),
          m.created_time ? new Date(m.created_time).toISOString() : new Date().toISOString(),
        )
        const at = params.length - 10
        return `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, $${at + 5}, $${at + 6}, `
          + `$${at + 7}, 'text', $${at + 8}, $${at + 9}, true, $${at + 10}::timestamptz)`
      })
      await sql.query(
        `INSERT INTO support_messages (id, channel_id, org_id, sender_id, sender_name,
           sender_role, is_from_client, content_type, text_content, external_message_id,
           is_read, created_at) VALUES ${values.join(', ')}`,
        params,
      )
      out.messages += rows.length
    }
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
  if (known) return

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
