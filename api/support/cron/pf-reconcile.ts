/**
 * Ночная сверка ручных поступлений с ПланФактом.
 *
 * Сейлз отмечает оплату в системе сразу, а в ПланФакт та же операция попадает
 * позже — её проводит бухгалтерия. Пока сверки не было, ручной ввод оставался
 * ничем не подтверждённым: в отчёте деньги есть, в ПланФакте их нет, и никто
 * об этом не узнавал.
 *
 * Крон раз в сутки ищет каждой ручной записи пару среди операций ПланФакта
 * и проставляет `sales_payments.pf_status`:
 *   matched   — нашлась ровно одна операция: та же сумма, близкая дата, тот же
 *               клиент. Операция помечается linked, чтобы РОП не привязал её
 *               второй раз и деньги не задвоились.
 *   ambiguous — кандидатов несколько (6 500 000 — типовой тариф, таких операций
 *               в месяц десяток). Решает человек.
 *   pending   — ждём: операция могла ещё не дойти до ПланФакта.
 *   missing   — прошло больше двух недель, пары нет. Это сигнал РОПу.
 *
 * В ПланФакт ничего не пишется: сверка читает наше зеркало `sales_pf_inbox`.
 *
 * Расписание: 04:10 UTC = 09:10 Ташкент (vercel.json) — к началу рабочего дня.
 * Идемпотентен: повторный прогон пересчитывает статусы и ничего не дублирует.
 */
import { getSQL, json } from '../_lib/db.js'
import { assertCron } from '../_lib/cron-auth.js'
import { nameScore } from '../_lib/pf-match.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

const ORG = process.env.SALES_ORG || 'org_delever'

/** Окно поиска пары: бухгалтерия проводит операцию не в тот же день. */
const WINDOW_DAYS = 10
/** После этого срока молчание ПланФакта — уже не задержка, а расхождение. */
const GIVE_UP_DAYS = 14
/** Ниже этого сходства имён совпадением не считаем. */
const MIN_NAME_SCORE = 60

export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

  const sql = getSQL()
  try {
    // Ручные записи без подтверждения. Уже сматченные не трогаем: их операция
    // помечена linked, повторная сверка только запутала бы
    const payments = await sql`
      SELECT p.id, p.deal_id, p.amount, p.paid_at::text AS paid_at,
             d.title AS deal_title, a.name AS account_name
      FROM sales_payments p
      LEFT JOIN sales_deals d ON d.id = p.deal_id
      LEFT JOIN sales_accounts a ON a.id = d.account_id
      WHERE p.org_id = ${ORG} AND p.source = 'manual' AND p.external_id IS NULL
        AND COALESCE(p.pf_status, '') <> 'matched'
    ` as any[]

    if (!payments.length) return json({ ok: true, checked: 0 })

    let matched = 0, ambiguous = 0, pending = 0, missing = 0

    for (const p of payments) {
      // Кандидаты: та же сумма, дата рядом, операция ещё никому не отдана
      const cands = await sql`
        SELECT pf_operation_id, operation_date::text AS d, contragent, category, comment
        FROM sales_pf_inbox
        WHERE org_id = ${ORG} AND amount = ${p.amount}
          AND status IN ('new', 'subscription')
          AND operation_date BETWEEN ${p.paid_at}::date - ${WINDOW_DAYS}
                                 AND ${p.paid_at}::date + ${WINDOW_DAYS}
      ` as any[]

      // Имя клиента решает: сумма 6 500 000 — типовой тариф, по ней одной
      // сойдётся половина месяца
      const hits = cands
        .map(c => ({ c, score: nameScore([c.contragent, c.category, c.comment], [p.deal_title, p.account_name]) }))
        .filter(x => x.score >= MIN_NAME_SCORE)
        .sort((a, b) => b.score - a.score)

      const ageDays = Math.floor((Date.now() - Date.parse(p.paid_at)) / 86400000)

      if (hits.length === 1) {
        const opId = Number(hits[0].c.pf_operation_id)
        await sql`
          UPDATE sales_payments
          SET external_id = ${'pf_' + opId}, pf_status = 'matched', pf_checked_at = NOW()
          WHERE id = ${p.id} AND org_id = ${ORG}
        `
        await sql`
          UPDATE sales_pf_inbox
          SET status = 'linked', deal_id = ${p.deal_id}, payment_id = ${Number(p.id)}
          WHERE org_id = ${ORG} AND pf_operation_id = ${opId} AND status IN ('new', 'subscription')
        `
        matched++
      } else if (hits.length > 1) {
        await sql`
          UPDATE sales_payments SET pf_status = 'ambiguous', pf_checked_at = NOW()
          WHERE id = ${p.id} AND org_id = ${ORG}
        `
        ambiguous++
      } else if (ageDays > GIVE_UP_DAYS) {
        await sql`
          UPDATE sales_payments SET pf_status = 'missing', pf_checked_at = NOW()
          WHERE id = ${p.id} AND org_id = ${ORG}
        `
        missing++
      } else {
        await sql`
          UPDATE sales_payments SET pf_status = 'pending', pf_checked_at = NOW()
          WHERE id = ${p.id} AND org_id = ${ORG}
        `
        pending++
      }
    }

    return json({ ok: true, checked: payments.length, matched, ambiguous, pending, missing })
  } catch (e: any) {
    return json({ error: e?.message || 'reconcile failed' }, 500)
  }
}
