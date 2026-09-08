/**
 * Приём входящего сообщения из личного мессенджера сейлза.
 *
 * Общий обработчик для Telegram и WhatsApp: раньше эта логика была
 * скопирована в два вебхука и разошлась бы при первой же правке.
 *
 * Здесь держатся три обещания, данных сейлзу при подключении:
 *
 *  1. В систему попадает только переписка с клиентом. Проверки совпадения
 *     номера мало: личные номера сотрудников тоже лежат в базе — тестовыми
 *     заявками с сайта и контактами клиентов, — поэтому переписка коллег
 *     между собой законно проходила фильтр и оседала в чужой карточке.
 *     Номера команды исключаются до поиска клиента.
 *  2. Одно сообщение — одна запись. Мосты после переподключения отдают
 *     пропущенные апдейты заново, поэтому ключ сообщения обязателен:
 *     повтор отсекает уникальный индекс, а не удача.
 *  3. Опознанный клиент не теряется. Если сделки у него ещё нет, запись
 *     ложится на клиента — лента лида читает журнал по нему.
 */

type SQL = any

export type IncomingMessage = {
  phone: string
  text: string
  agentId?: string | null
  senderName?: string | null
  messageId?: string | null
  channel: 'Telegram' | 'WhatsApp'
  /**
   * 'out' — сейлз написал клиенту сам, с телефона. Такие тоже нужны:
   * иначе в карточке половина разговора — то, что ушло из системы, есть,
   * а набранное в телефоне пропадает.
   */
  direction?: 'in' | 'out'
}

export type InboxResult = {
  ok: true
  saved: boolean
  skipped?: string
  dealId?: string | null
  accountId?: string | null
}

export async function fileIncoming(sql: SQL, m: IncomingMessage): Promise<InboxResult> {
  const text = String(m.text || '').trim()
  if (!text) return { ok: true, saved: false, skipped: 'пустое' }

  const direction = m.direction === 'out' ? 'out' : 'in'
  const digits = String(m.phone || '').replace(/\D/g, '').slice(-9)
  if (digits.length < 9) {
    return { ok: true, saved: false, skipped: 'номер скрыт настройками приватности' }
  }

  // Сотрудник — не клиент. Проверяем раньше всего: его номер вполне может
  // найтись и среди контактов, и среди заявок
  const [staff] = await sql`
    SELECT id FROM support_agents
    WHERE phone IS NOT NULL
      AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) = ${digits}
    LIMIT 1
  `
  if (staff) return { ok: true, saved: false, skipped: 'номер сотрудника — не клиент' }

  // Клиент ищется по контактам и заявкам. Порядок явный: когда номер
  // встречается у нескольких клиентов, выбор не должен зависеть от того,
  // как база сегодня разложила строки
  const [match] = await sql`
    SELECT a.id AS account_id, a.org_id,
           (SELECT d.id FROM sales_deals d
             WHERE d.account_id = a.id AND d.archived_at IS NULL
             ORDER BY (d.won_at IS NULL AND d.lost_at IS NULL) DESC, d.updated_at DESC
             LIMIT 1) AS deal_id,
           (SELECT max(d2.updated_at) FROM sales_deals d2 WHERE d2.account_id = a.id) AS touched_at
    FROM sales_accounts a
    WHERE a.archived_at IS NULL
      AND (
        EXISTS (SELECT 1 FROM sales_contacts c WHERE c.account_id = a.id AND c.phone IS NOT NULL
                  AND right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 9) = ${digits})
        OR EXISTS (SELECT 1 FROM sales_leads l WHERE l.account_id = a.id AND l.phone_norm IS NOT NULL
                  AND right(regexp_replace(l.phone_norm, '[^0-9]', '', 'g'), 9) = ${digits})
      )
    ORDER BY touched_at DESC NULLS LAST, a.id
    LIMIT 1
  `
  if (!match) return { ok: true, saved: false, skipped: 'не наш клиент — сообщение не сохранено' }

  // Ключ сообщения даёт мост. Если его нет — пишем без него: потерять
  // сообщение хуже, чем однажды увидеть дубль
  const messageId = m.messageId ? String(m.messageId).slice(0, 100) : null

  const rows = await sql`
    INSERT INTO sales_activities
      (id, org_id, deal_id, account_id, type, direction, channel, text, sender_name, message_id, agent_id, happened_at)
    VALUES (${'sa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)},
            ${match.org_id}, ${match.deal_id || null}, ${match.account_id}, 'message', ${direction},
            ${m.channel}, ${text}, ${direction === 'in' ? (m.senderName || null) : null},
            ${messageId}, ${m.agentId || null}, NOW())
    ON CONFLICT DO NOTHING
    RETURNING id
  `
  return {
    ok: true,
    saved: rows.length > 0,
    skipped: rows.length ? undefined : 'уже записано',
    dealId: match.deal_id || null,
    accountId: match.account_id,
  }
}
