import { getSQL, json } from '../lib/db.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'
import { getBotToken, tgSend, leadCard, leadKeyboard } from '../lib/sales-bot.js'

export const config = { runtime: 'edge' }

/**
 * Cron: фоновая часть движка продаж. Раз в минуту, один идемпотентный проход.
 *
 * 1. Просроченный SLA первого касания → лид уходит другому свободному сейлзу.
 * 2. Просроченные задачи и каденции → напоминание владельцу (одно на задачу).
 * 3. Сделка дольше норматива этапа → пометка «застряла».
 * 4. Сделка без следующего шага дольше 48 часов → пометка «брошена».
 * 5. Наступил срок реактивации → сделка возвращается в очередь владельцу.
 *
 * Отдельной таблицы таймеров нет: состояние выводится из данных, поэтому
 * повторный проход ничего не дублирует. Признак «уже напомнили» — колонки
 * reminded_at у задачи и stalled_at у сделки.
 *
 * Защита: Vercel cron (user-agent) или CRON_SECRET.
 */

const ORG = process.env.SALES_ORG || 'org_delever'
const ABANDON_HOURS = 48

export default async function handler(req: Request): Promise<Response> {
  const ua = req.headers.get('user-agent') || ''
  const auth = req.headers.get('authorization') || ''
  if (!ua.includes('vercel-cron') && !(process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)) {
    return json({ error: 'unauthorized' }, 401)
  }

  const sql = getSQL()
  await ensureSalesSchema(sql, ORG)

  // Колонка появляется здесь, а не в схеме модуля: она нужна только крону,
  // чтобы не слать одно и то же напоминание каждую минуту
  await sql`ALTER TABLE sales_tasks ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ`

  const token = await getBotToken(sql)
  const out = { reassigned: 0, reminded: 0, stalled: 0, abandoned: 0, reactivated: 0 }

  // ─── 1. Просроченный SLA первого касания ────────────────────────────────────
  const overdue = await sql`
    SELECT l.*, s.label AS source_label
    FROM sales_leads l
    LEFT JOIN sales_sources s ON s.id = l.source_id
    WHERE l.org_id = ${ORG} AND l.status = 'assigned'
      AND l.first_touch_at IS NULL AND l.sla_due_at < NOW()
    ORDER BY l.sla_due_at ASC LIMIT 20
  `
  for (const lead of overdue) {
    // Свободнее всех = меньше всего висящих лидов; текущего владельца исключаем
    const [next] = await sql`
      SELECT a.id, a.telegram_id
      FROM support_agents a
      LEFT JOIN sales_leads l
        ON l.assigned_agent_id = a.id AND l.first_touch_at IS NULL AND l.status = 'assigned'
      WHERE a.telegram_id IS NOT NULL AND a.merged_into IS NULL
        AND a.id <> ${lead.assigned_agent_id}
        AND (a.org_id = ${ORG} OR a.org_id IS NULL)
        AND (LOWER(COALESCE(a.role, '')) IN ('sales', 'sales_rep', 'ae', 'sdr', 'sales_lead')
             OR LOWER(COALESCE(a.department, '')) LIKE '%прода%')
      GROUP BY a.id
      ORDER BY COUNT(l.id) ASC, a.id ASC
      LIMIT 1
    `
    if (!next) {
      // Некому передать — продлеваем таймер, чтобы не крутить проход вхолостую
      await sql`UPDATE sales_leads SET sla_due_at = NOW() + INTERVAL '15 minutes' WHERE id = ${lead.id}`
      continue
    }
    await sql`
      UPDATE sales_leads
      SET assigned_agent_id = ${next.id}, assigned_at = NOW(),
          sla_due_at = NOW() + INTERVAL '15 minutes'
      WHERE id = ${lead.id}
    `
    out.reassigned++
    if (token && next.telegram_id) {
      await tgSend(token, next.telegram_id,
        `♻️ <b>Лид передан вам</b> — предыдущий сейлз не связался за 15 минут.\n\n` +
        leadCard(lead, lead.source_label || 'источник не указан'),
        leadKeyboard(lead.id))
    }
  }

  // ─── 2. Просроченные задачи и каденции ──────────────────────────────────────
  const tasks = await sql`
    SELECT t.id, t.title, t.due_at, t.assignee_agent_id, d.title AS deal_title, a.telegram_id
    FROM sales_tasks t
    LEFT JOIN sales_deals d ON d.id = t.deal_id
    LEFT JOIN support_agents a ON a.id = t.assignee_agent_id
    WHERE t.org_id = ${ORG} AND t.done_at IS NULL
      AND t.due_at < NOW() AND t.reminded_at IS NULL
      AND a.telegram_id IS NOT NULL
    ORDER BY t.due_at ASC LIMIT 30
  `
  for (const t of tasks) {
    if (token) {
      await tgSend(token, t.telegram_id,
        `⏰ <b>Просрочена задача</b>\n${t.deal_title ? `${t.deal_title}\n` : ''}${t.title}`,
        [[{ text: '✅ Выполнено', callback_data: `sl:done:${t.id}` }]])
    }
    await sql`UPDATE sales_tasks SET reminded_at = NOW() WHERE id = ${t.id}`
    out.reminded++
  }

  // ─── 3. Сделка дольше норматива этапа ───────────────────────────────────────
  const stalled = await sql`
    UPDATE sales_deals d SET stalled_at = NOW()
    FROM sales_stages s
    WHERE s.id = d.stage_id AND d.org_id = ${ORG}
      AND d.won_at IS NULL AND d.lost_at IS NULL AND d.stalled_at IS NULL
      AND s.sla_hours IS NOT NULL
      AND d.stage_since < NOW() - (s.sla_hours * INTERVAL '1 hour')
    RETURNING d.id
  `
  out.stalled = stalled.length

  // ─── 4. Сделка без следующего шага дольше 48 часов ──────────────────────────
  const abandoned = await sql`
    UPDATE sales_deals SET stalled_at = COALESCE(stalled_at, NOW())
    WHERE org_id = ${ORG} AND won_at IS NULL AND lost_at IS NULL
      AND next_step_at IS NULL AND stalled_at IS NULL
      AND stage_since < NOW() - (${ABANDON_HOURS}::int * INTERVAL '1 hour')
    RETURNING id
  `
  out.abandoned = abandoned.length

  // ─── 5. Реактивация: срок по причине отказа наступил ────────────────────────
  const revive = await sql`
    SELECT d.id, d.title, d.owner_agent_id, a.telegram_id, r.label AS reason
    FROM sales_deals d
    LEFT JOIN support_agents a ON a.id = d.owner_agent_id
    LEFT JOIN sales_lost_reasons r ON r.id = d.lost_reason_id
    WHERE d.org_id = ${ORG} AND d.reactivate_at IS NOT NULL AND d.reactivate_at < NOW()
    ORDER BY d.reactivate_at ASC LIMIT 20
  `
  for (const d of revive) {
    await sql`
      INSERT INTO sales_tasks (id, org_id, deal_id, kind, title, due_at, assignee_agent_id, auto)
      VALUES (${'stk_' + d.id.slice(-8) + '_rev'}, ${ORG}, ${d.id}, 'followup',
              ${`Реактивация: ${d.title || 'сделка'} — причина «${d.reason || 'не указана'}» устарела`},
              NOW(), ${d.owner_agent_id}, true)
      ON CONFLICT (id) DO NOTHING
    `
    // Снимаем срок, чтобы задача не создавалась повторно каждую минуту
    await sql`UPDATE sales_deals SET reactivate_at = NULL WHERE id = ${d.id}`
    out.reactivated++
    if (token && d.telegram_id) {
      await tgSend(token, d.telegram_id,
        `⚡ <b>Вернулась из реактивации</b>\n${d.title}\nПричина отказа «${d.reason}» могла устареть — стоит новое касание.`)
    }
  }

  return json({ ok: true, ...out })
}
