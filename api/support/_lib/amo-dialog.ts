import { salesId } from './sales-schema.js'
import { ensureDialogSchema } from './sales-qualifier.js'
import { marketByPipeline } from './sales-amo.js'

/**
 * Чат из «Неразобранного» Amo → диалог в «Диалогах», а не обращение.
 *
 * Правило «диалог сначала, обращение — когда заслужил» действовало только
 * для нашего вебхука Meta. Мост Amo шёл старой дорогой: каждое «здравствуйте»
 * в директе становилось карточкой «Umarov nodir · без телефона · данных нет»
 * в очереди — по два в день, и сейлзу с ними нечего было делать.
 *
 * Amo для чата отдаёт только имя профиля и id переписки — ни текста, ни
 * телефона (`last_message_text` у них хранит время, а не текст). Поэтому
 * диалог здесь — это карточка собеседника со ссылкой на переписку в Amo:
 * читать и отвечать пока там, а обращение рождается двумя путями — сейлз
 * нажимает «сделать обращение» в «Диалогах», либо заявку разбирают в Amo,
 * и она приезжает сделкой по курсору и привязывается к этому же диалогу
 * (см. linkAmoLeadToDialog). После одобрения Meta и отключения Instagram
 * в Amo дорога станет прямой, и этот файл будет не нужен.
 */

/** Как Amo подписывает мессенджер в metadata.service. */
export function amoChatSource(lead: any): 'instagram' | 'messenger' | null {
  const service = String(lead?._unsorted_meta?.service || '').toLowerCase()
  // У разобранной заявки metadata уже нет, но служебное имя сделки остаётся
  if (service.includes('instagram') || /^instagram_business:/i.test(String(lead?.name || ''))) return 'instagram'
  if (service.includes('facebook') || service.includes('messenger')) return 'messenger'
  return null
}

export const amoDialogKey = (amoLeadId: number | string) => `amo_${amoLeadId}`

export function amoLeadUrl(domain: string, amoLeadId: number | string): string {
  return `https://${domain}/leads/detail/${amoLeadId}`
}

/**
 * Заводит диалог, если его ещё нет. Возвращает true, когда создан новый.
 */
export async function dialogFromAmoChat(
  sql: any, orgId: string, domain: string, lead: any,
): Promise<boolean> {
  const source = amoChatSource(lead)
  if (!source) return false
  const key = amoDialogKey(lead.id)
  const [existing] = await sql`
    SELECT id FROM support_channels WHERE org_id = ${orgId} AND external_chat_id = ${key} LIMIT 1
  ` as any[]
  if (existing) return false

  const meta = lead._unsorted_meta || {}
  const name = String(meta.client?.name || meta.from || '').trim()
    || `${source === 'instagram' ? 'Instagram' : 'Messenger'} ${String(lead.id).slice(-6)}`
  // Страница, в которую написали: по ней «Диалоги» показывают, от чьего
  // имени идёт переписка, и по ней же рынок
  const [acc] = meta.to ? await sql`
    SELECT page_id, market_id FROM support_meta_accounts
    WHERE org_id = ${orgId} AND (ig_user_id = ${String(meta.to)} OR page_id = ${String(meta.to)})
    LIMIT 1
  ` as any[] : [null]
  let marketId: string | null = acc?.market_id || null
  if (!marketId) {
    const code = marketByPipeline(Number(lead.pipeline_id))
    if (code) {
      const [m] = await sql`
        SELECT id FROM support_markets WHERE org_id = ${orgId} AND LOWER(code) = LOWER(${code}) LIMIT 1
      ` as any[]
      marketId = m?.id || null
    }
  }
  const receivedAt = meta.received_at ? new Date(Number(meta.received_at) * 1000) : new Date()
  const url = amoLeadUrl(domain, lead.id)
  const note = `[${source === 'instagram' ? 'директ Instagram' : 'Messenger'} через AmoCRM — текст переписки там: ${url}]`

  await ensureDialogSchema(sql)
  const channelId = salesId('ch')
  await sql.transaction([
    sql`
      INSERT INTO support_channels (id, name, type, source, external_chat_id, is_active, market_id,
                                    org_id, meta_page_id, created_at, last_message_at,
                                    last_message_preview, last_sender_name, awaiting_reply)
      VALUES (${channelId}, ${name}, 'client', ${source}, ${key}, true, ${marketId}, ${orgId},
              ${acc?.page_id || null}, ${receivedAt.toISOString()}, ${receivedAt.toISOString()},
              ${'переписка в AmoCRM'}, ${name}, true)
    `,
    sql`
      INSERT INTO support_messages (id, channel_id, org_id, sender_id, sender_name, sender_role,
                                    is_from_client, content_type, text_content, is_read, created_at)
      VALUES (${salesId('msg')}, ${channelId}, ${orgId}, ${key}, ${name}, 'client',
              true, 'text', ${note}, false, ${receivedAt.toISOString()})
    `,
    sql`
      INSERT INTO sales_dialog_state (channel_id, org_id, facts)
      VALUES (${channelId}, ${orgId}, '{}'::jsonb)
      ON CONFLICT (channel_id) DO NOTHING
    `,
  ])
  return true
}

/**
 * Заявку разобрали в Amo — она приехала сделкой и стала обращением у нас.
 * Связываем с диалогом, который завели раньше, чтобы «Диалоги» показали
 * обращение и сделку, а карточка знала свой канал.
 */
export async function linkAmoLeadToDialog(
  sql: any, orgId: string, amoLeadId: number | string, leadId: string, accountId: string | null,
): Promise<void> {
  const key = amoDialogKey(amoLeadId)
  const [ch] = await sql`
    SELECT id FROM support_channels WHERE org_id = ${orgId} AND external_chat_id = ${key} LIMIT 1
  ` as any[]
  if (!ch) return
  await sql`
    UPDATE sales_dialog_state SET lead_id = ${leadId}, updated_at = NOW()
    WHERE channel_id = ${ch.id} AND lead_id IS NULL
  `
  if (accountId) {
    await sql`
      UPDATE sales_accounts SET channel_id = COALESCE(channel_id, ${ch.id})
      WHERE id = ${accountId} AND org_id = ${orgId}
    `
  }
}
