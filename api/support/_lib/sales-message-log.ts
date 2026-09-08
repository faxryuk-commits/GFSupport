/**
 * След исходящего сообщения клиенту (Telegram / WhatsApp) в журнале продаж.
 *
 * Пишем в sales_activities с account_id всегда, когда его можно узнать:
 * лента лида читает журнал по клиенту, лента сделки — по сделке плюс общие
 * записи клиента. Без account_id сообщение из карточки лида просто
 * пропадало бы после перезагрузки — раньше след оставался только у сделки.
 */
export type OutgoingRef = {
  dealId?: string | null
  accountId?: string | null
  leadId?: string | null
}

export async function logOutgoingMessage(
  sql: any, orgId: string, agentId: string, ref: OutgoingRef, channel: 'Telegram' | 'WhatsApp', text: string,
): Promise<void> {
  const dealId = ref.dealId ? String(ref.dealId) : null
  let accountId = ref.accountId ? String(ref.accountId) : null
  try {
    if (!accountId && dealId) {
      const [d] = await sql`SELECT account_id FROM sales_deals WHERE id = ${dealId} AND org_id = ${orgId} LIMIT 1`
      accountId = d?.account_id || null
    }
    if (!accountId && ref.leadId) {
      const [l] = await sql`SELECT account_id FROM sales_leads WHERE id = ${String(ref.leadId)} AND org_id = ${orgId} LIMIT 1`
      accountId = l?.account_id || null
    }
    if (!dealId && !accountId) return
    await sql`
      INSERT INTO sales_activities (id, org_id, deal_id, account_id, type, direction, text, agent_id, happened_at)
      VALUES (${'sa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)},
              ${orgId}, ${dealId}, ${accountId}, 'message', 'out',
              ${channel + ': ' + text}, ${agentId}, NOW())
    `
  } catch {
    // Сообщение уже ушло клиенту — отсутствие следа не повод отдавать ошибку
  }
}
