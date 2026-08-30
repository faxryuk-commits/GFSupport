import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { ensureSalesSchema, salesId, normPhone } from '../lib/sales-schema.js'
import { acceptLead } from '../lib/sales-intake.js'
import { stopNurtureOnReply, logAssistant } from '../lib/sales-assistant.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Мост переписки: сообщения из Telegram-бота сайта и чата delever.io.
 *
 * До сих пор диалог с клиентом жил там, где начался: бот на Railway, виджет на
 * сайте, группа в Telegram. Сейлз работал в CRM, а половину контекста читал в
 * другом приложении — или не читал вовсе.
 *
 * Что делает приёмник:
 *   1. заводит канал под этот диалог (или находит существующий),
 *   2. кладёт сообщение в общую ленту переписки,
 *   3. заводит лид на первом сообщении клиента — с источником и видом обращения,
 *   4. связывает аккаунт с каналом, чтобы переписка была видна в карточке,
 *   5. останавливает прогрев: ответил человек — дальше разговаривает человек.
 *
 * POST { source, chatId, name?, username?, phone?, text, direction?, at? }
 *   Authorization: X-Intake-Secret — тот же, что у приёмника заявок
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  // Секрет сравниваем по обрезанным значениям: переменные окружения легко
  // сохраняются с переводом строки на конце, и тогда верный ключ отвергается
  const secret = (req.headers.get('X-Intake-Secret') || '').trim()
  const expected = (process.env.SALES_INTAKE_SECRET || '').trim()
  if (!expected || secret !== expected) return json({ error: 'unauthorized' }, 401)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const body = await req.json().catch(() => null)
  const chatId = String(body?.chatId || '').trim()
  const text = String(body?.text || '').trim()
  if (!chatId || !text) return json({ error: 'chatId и text обязательны' }, 400)

  const source = String(body?.source || 'telegram_bot')
  const fromClient = body?.direction !== 'out'
  const at = body?.at ? new Date(body.at).toISOString() : new Date().toISOString()
  const name = String(body?.name || body?.username || 'Клиент').slice(0, 120)
  const phone = body?.phone ? String(body.phone) : null

  // 1. Канал разговора. Ключ — внешний id чата: один диалог = один канал,
  //    сколько бы сообщений ни пришло.
  //    telegram_chat_id в базе числовой, а id чата из виджета сайта — строка,
  //    поэтому сравниваем его только когда он действительно число
  const externalId = `${source}:${chatId}`
  const numericChatId = /^-?\d+$/.test(chatId) ? chatId : null
  let [channel] = await sql`
    SELECT id FROM support_channels
    WHERE org_id = ${orgId}
      AND (external_chat_id = ${externalId}
           OR (${numericChatId}::bigint IS NOT NULL AND telegram_chat_id = ${numericChatId}::bigint))
    LIMIT 1
  ` as any[]

  if (!channel) {
    const channelId = `ch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    await sql`
      INSERT INTO support_channels (id, org_id, name, type, source, external_chat_id,
                                    telegram_chat_id, is_active, created_at, last_message_at)
      VALUES (${channelId}, ${orgId}, ${name}, 'client', ${source}, ${externalId},
              ${source.startsWith('telegram') ? numericChatId : null}::bigint, true, NOW(), NOW())
    `
    channel = { id: channelId }
  }

  // 2. Сообщение в общую ленту: то же место, где живёт переписка поддержки
  await sql`
    INSERT INTO support_messages (id, org_id, channel_id, sender_name, is_from_client,
                                  text_content, content_type, external_message_id, created_at)
    VALUES (${`msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`}, ${orgId},
            ${channel.id}, ${fromClient ? name : 'Delever'}, ${fromClient},
            ${text.slice(0, 4000)}, 'text', ${body?.messageId ? String(body.messageId) : null}, ${at})
  `
  await sql`
    UPDATE support_channels
    SET last_message_at = ${at}, last_message_preview = ${text.slice(0, 200)},
        last_sender_name = ${fromClient ? name : 'Delever'},
        last_client_message_at = CASE WHEN ${fromClient} THEN ${at}::timestamp ELSE last_client_message_at END,
        updated_at = NOW()
    WHERE id = ${channel.id}
  `

  if (!fromClient) return json({ ok: true, channelId: channel.id, direction: 'out' })

  // 3. Лид на первом сообщении: обращение в мессенджере — такой же вход, как форма
  const [existingLead] = await sql`
    SELECT l.id, l.account_id, l.status FROM sales_leads l
    WHERE l.org_id = ${orgId} AND l.external_id = ${externalId} LIMIT 1
  ` as any[]

  let leadId = existingLead?.id || null
  let accountId = existingLead?.account_id || null

  if (!existingLead) {
    const res = await acceptLead(sql, orgId, {
      source: source === 'site_chat' ? 'site_chat' : 'telegram_bot',
      external_id: externalId,
      name,
      phone,
      text: text.slice(0, 500),
      lead_kind: 'message',
      channel_key: chatId,
      raw: { source, chatId, username: body?.username || null, first_text: text.slice(0, 500) },
    })
    leadId = res.lead_id || null
    accountId = res.account_id || null
  } else {
    // Ответ клиента останавливает прогрев: дальше разговаривает человек
    if (existingLead.status === 'nurture') {
      await stopNurtureOnReply(sql, orgId, existingLead.id, text.slice(0, 500))
    }
    await sql`UPDATE sales_leads SET updated_at = NOW() WHERE id = ${existingLead.id}`
  }

  // 4. Связь аккаунта с каналом: без неё переписка не появится в карточке
  if (accountId) {
    await sql`
      UPDATE sales_accounts SET channel_id = COALESCE(channel_id, ${channel.id})
      WHERE id = ${accountId} AND org_id = ${orgId}
    `
  }

  // 5. Касание в путь клиента — чтобы диалог был виден в общей ленте истории
  await sql`
    INSERT INTO sales_touchpoints (id, org_id, account_id, lead_id, kind, channel,
                                   title, detail, identity, happened_at)
    VALUES (${salesId('stp')}, ${orgId}, ${accountId}, ${leadId}, 'message', ${source},
            ${`Сообщение: ${name}`}, ${text.slice(0, 500)}, ${normPhone(phone) || chatId}, ${at})
  `

  if (leadId && !existingLead) {
    await logAssistant(sql, orgId, {
      leadId, accountId, action: 'inbox_lead', channel: source,
      message: text.slice(0, 300), status: 'received',
    })
  }

  return json({ ok: true, channelId: channel.id, leadId, accountId, created: !existingLead })
}
