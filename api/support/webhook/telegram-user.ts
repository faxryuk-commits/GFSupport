import { getSQL, json } from '../_lib/db.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Входящие из личных Telegram-аккаунтов сейлзов.
 *
 * Мост присылает сюда сообщение вместе с номером отправителя. В систему
 * попадает ТОЛЬКО то, что от известного клиента: номер должен найтись
 * в контактах или обращениях. Всё остальное — личные чаты сотрудника —
 * молча отбрасывается. Это обещание, данное сейлзу при подключении,
 * и держать его должен код, а не добрая воля.
 */

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const secret = process.env.TELEGRAM_BRIDGE_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) return json({ error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => ({})) as any
  const phone = String(body.phone || '')
  const text = String(body.text || '').trim()
  const agentId = String(body.agentId || '')
  if (!text) return json({ ok: true, skipped: 'пустое' })

  const digits = phone.replace(/\D/g, '').slice(-9)
  if (digits.length < 9) return json({ ok: true, skipped: 'номер скрыт настройками приватности' })

  const sql = getSQL()

  // Известен ли отправитель как клиент: контакт, обращение или карточка
  const [match] = await sql`
    SELECT a.id AS account_id, a.org_id,
           (SELECT d.id FROM sales_deals d
             WHERE d.account_id = a.id AND d.archived_at IS NULL
             ORDER BY (d.won_at IS NULL AND d.lost_at IS NULL) DESC, d.updated_at DESC
             LIMIT 1) AS deal_id
    FROM sales_accounts a
    WHERE a.archived_at IS NULL
      AND (
        EXISTS (SELECT 1 FROM sales_contacts c WHERE c.account_id = a.id AND c.phone IS NOT NULL
                  AND right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 9) = ${digits})
        OR EXISTS (SELECT 1 FROM sales_leads l WHERE l.account_id = a.id AND l.phone_norm IS NOT NULL
                  AND right(regexp_replace(l.phone_norm, '[^0-9]', '', 'g'), 9) = ${digits})
      )
    LIMIT 1
  `
  if (!match) return json({ ok: true, skipped: 'не наш клиент — сообщение не сохранено' })

  if (match.deal_id) {
    await sql`
      INSERT INTO sales_activities (id, org_id, deal_id, account_id, type, direction, text, agent_id, happened_at)
      VALUES (${'sa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)},
              ${match.org_id}, ${match.deal_id}, ${match.account_id}, 'message', 'in',
              ${'Telegram: ' + text}, ${agentId || null}, NOW())
    `
  }
  return json({ ok: true, saved: !!match.deal_id, dealId: match.deal_id || null })
}
