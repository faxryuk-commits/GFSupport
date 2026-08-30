import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema, salesId } from '../lib/sales-schema.js'
import { sendNotification } from '../lib/notifications.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Задачи продаж, которые ставит человек.
 *
 * До этого задачи умела создавать только машина — каденция этапа и реактивация,
 * — и в базе их не было ни одной: поставить себе «позвонить в четверг» было
 * нечем, поэтому команда и держала план в Amo.
 *
 * GET    ?dealId= | ?leadId= | ?accountId= | ?mine=1
 * POST   { dealId?, leadId?, accountId?, title, kind, dueAt?, assigneeAgentId? }
 * PATCH  { id, title?, dueAt?, assigneeAgentId?, done?, result? }
 * DELETE ?id=
 *
 * Закрытие задачи есть и в очереди дня (/sales/queue?action=done) — там оно
 * жило раньше и остаётся: в очереди закрывают пачкой, здесь — из карточки.
 */

/** Виды задач, которые ставят руками. Машинные — 'cadence' и 'followup'. */
const KINDS = ['call', 'meeting', 'message', 'task']

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  // ─── Создание ───────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = await req.json().catch(() => null)
    const title = String(body?.title || '').trim()
    if (!title) return json({ error: 'Опишите, что нужно сделать' }, 400)
    if (!body?.dealId && !body?.leadId && !body?.accountId) {
      return json({ error: 'Задача должна быть к сделке, лиду или клиенту' }, 400)
    }
    const kind = KINDS.includes(String(body?.kind)) ? String(body.kind) : 'task'

    // Аккаунт достаём из сделки: по нему задача видна в карточке клиента,
    // даже когда сделок у него несколько
    let accountId: string | null = body.accountId || null
    if (!accountId && body.dealId) {
      const [d] = await sql`
        SELECT account_id FROM sales_deals WHERE id = ${body.dealId} AND org_id = ${orgId} LIMIT 1
      `
      accountId = d?.account_id || null
    }
    if (!accountId && body.leadId) {
      const [l] = await sql`
        SELECT account_id FROM sales_leads WHERE id = ${body.leadId} AND org_id = ${orgId} LIMIT 1
      `
      accountId = l?.account_id || null
    }

    // Без исполнителя задача ничья и не всплывёт ни у кого в очереди дня
    const assignee = String(body.assigneeAgentId || ctx.agentId)
    const id = salesId('stk')
    await sql`
      INSERT INTO sales_tasks (id, org_id, deal_id, account_id, lead_id, kind, title,
                               channel, due_at, assignee_agent_id, created_by_agent_id, auto)
      VALUES (${id}, ${orgId}, ${body.dealId || null}, ${accountId}, ${body.leadId || null},
              ${kind}, ${title.slice(0, 500)}, ${body.channel || null},
              ${body.dueAt || null}, ${assignee}, ${ctx.agentId}, false)
    `

    // Задачу поставили другому — он должен узнать об этом, не открывая раздел
    if (assignee !== ctx.agentId) {
      const [from] = await sql`SELECT name FROM support_agents WHERE id = ${ctx.agentId} LIMIT 1`
      // Без адреса уведомление бесполезно: человек читает «вам поставили
      // задачу» и идёт искать, где именно. Ведём прямо в ту карточку
      const link = body.dealId ? `/sales/deals/${body.dealId}`
        : body.leadId ? `/sales/leads/${body.leadId}`
        : accountId ? `/sales/accounts/${accountId}` : undefined
      await sendNotification({
        orgId, type: 'assignment', priority: 'medium',
        title: 'Вам поставили задачу',
        body: `${title.slice(0, 120)}${from?.name ? ` — от ${from.name}` : ''}`,
        link,
        targetAgentIds: [assignee],
      }).catch(() => {})
    }
    return json({ ok: true, id })
  }

  // ─── Правка и закрытие ──────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body = await req.json().catch(() => null)
    if (!body?.id) return json({ error: 'id is required' }, 400)
    const [task] = await sql`
      SELECT id, title, deal_id, lead_id, account_id, created_by_agent_id
      FROM sales_tasks WHERE id = ${body.id} AND org_id = ${orgId} LIMIT 1
    ` as any[]
    if (!task) return json({ error: 'not found' }, 404)

    // Поля правим по одному именованным запросом: динамическая сборка SQL
    // в шаблонных строках neon небезопасна и нечитаема
    if (body.title !== undefined) {
      await sql`UPDATE sales_tasks SET title = ${String(body.title).slice(0, 500)} WHERE id = ${body.id} AND org_id = ${orgId}`
    }
    if (body.dueAt !== undefined) {
      await sql`UPDATE sales_tasks SET due_at = ${body.dueAt || null}, reminded_at = NULL WHERE id = ${body.id} AND org_id = ${orgId}`
    }
    if (body.assigneeAgentId !== undefined) {
      await sql`UPDATE sales_tasks SET assignee_agent_id = ${body.assigneeAgentId || null} WHERE id = ${body.id} AND org_id = ${orgId}`
    }
    if (body.done !== undefined) {
      // Снятие галочки возвращает задачу в работу: закрыли не ту — поправимо
      await sql`
        UPDATE sales_tasks
        SET done_at = ${body.done ? new Date().toISOString() : null},
            done_result = ${body.done ? (body.result || 'done') : null},
            status = ${body.done ? 'done' : 'open'}, status_at = NOW()
        WHERE id = ${body.id} AND org_id = ${orgId}
      `
      await reportBack(sql, orgId, ctx.agentId, task, body.done ? 'done' : 'open', null)
    }

    // Ход задачи: поручение перестаёт быть дорогой в один конец. Автор видит,
    // взяли её в работу, сделали или отказались — и почему
    if (body.status !== undefined) {
      const status = String(body.status)
      if (!TASK_STATUS.includes(status)) return json({ error: 'Неизвестный статус' }, 400)
      const note = body.note ? String(body.note).slice(0, 500) : null
      if (status === 'rejected' && !note) {
        return json({ error: 'Отказ без причины автору ничего не объясняет' }, 400)
      }
      const closed = status === 'done' || status === 'rejected'
      await sql`
        UPDATE sales_tasks
        SET status = ${status}, status_note = ${note}, status_at = NOW(),
            done_at = ${closed ? new Date().toISOString() : null},
            done_result = ${closed ? status : null}
        WHERE id = ${body.id} AND org_id = ${orgId}
      `
      await reportBack(sql, orgId, ctx.agentId, task, status, note)
    }
    return json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'id is required' }, 400)
    await sql`DELETE FROM sales_tasks WHERE id = ${id} AND org_id = ${orgId}`
    return json({ ok: true })
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  // ─── Списки ─────────────────────────────────────────────────────────────────
  const dealId = url.searchParams.get('dealId')
  const leadId = url.searchParams.get('leadId')
  const accountId = url.searchParams.get('accountId')
  const mine = url.searchParams.get('mine')

  // Закрытые показываем недолго: карточка должна отвечать на вопрос «что
  // дальше», а не быть архивом. История касаний живёт в активностях
  const tasks = dealId
    ? await sql`
        SELECT t.*, a.name AS assignee_name, c.name AS created_by_name FROM sales_tasks t
        LEFT JOIN support_agents a ON a.id = t.assignee_agent_id
        LEFT JOIN support_agents c ON c.id = t.created_by_agent_id
        WHERE t.org_id = ${orgId} AND t.deal_id = ${dealId}
          AND (t.done_at IS NULL OR t.done_at > NOW() - interval '14 days')
        ORDER BY t.done_at IS NOT NULL, t.due_at NULLS LAST, t.created_at
      `
    : leadId
      ? await sql`
          SELECT t.*, a.name AS assignee_name, c.name AS created_by_name FROM sales_tasks t
          LEFT JOIN support_agents a ON a.id = t.assignee_agent_id
        LEFT JOIN support_agents c ON c.id = t.created_by_agent_id
          WHERE t.org_id = ${orgId} AND t.lead_id = ${leadId}
            AND (t.done_at IS NULL OR t.done_at > NOW() - interval '14 days')
          ORDER BY t.done_at IS NOT NULL, t.due_at NULLS LAST, t.created_at
        `
      : accountId
        ? await sql`
            SELECT t.*, a.name AS assignee_name, c.name AS created_by_name FROM sales_tasks t
            LEFT JOIN support_agents a ON a.id = t.assignee_agent_id
        LEFT JOIN support_agents c ON c.id = t.created_by_agent_id
            WHERE t.org_id = ${orgId} AND t.account_id = ${accountId}
              AND (t.done_at IS NULL OR t.done_at > NOW() - interval '14 days')
            ORDER BY t.done_at IS NOT NULL, t.due_at NULLS LAST, t.created_at
          `
        : mine
          ? await sql`
              SELECT t.*, a.name AS assignee_name, c.name AS created_by_name, d.title AS deal_title FROM sales_tasks t
              LEFT JOIN support_agents a ON a.id = t.assignee_agent_id
        LEFT JOIN support_agents c ON c.id = t.created_by_agent_id
              LEFT JOIN sales_deals d ON d.id = t.deal_id
              WHERE t.org_id = ${orgId} AND t.assignee_agent_id = ${ctx.agentId} AND t.done_at IS NULL
              ORDER BY t.due_at NULLS LAST
              LIMIT 100
            `
          : []

  return json({ tasks })
}


/** Состояния задачи: открыта, в работе, выполнена, отклонена. */
const TASK_STATUS = ['open', 'in_progress', 'done', 'rejected']

const STATUS_VERB: Record<string, string> = {
  open: 'вернул в работу',
  in_progress: 'взял в работу',
  done: 'выполнил',
  rejected: 'отклонил',
}

/**
 * Обратная связь автору поручения.
 *
 * Раньше задача уходила в один конец: поставил — и жди, гадая, взяли её
 * вообще или нет. Теперь каждое изменение хода возвращается тому, кто
 * поручил, — кроме случая, когда человек ведёт свою же задачу.
 */
async function reportBack(
  sql: any, orgId: string, actorId: string, task: any, status: string, note: string | null,
): Promise<void> {
  const author = task?.created_by_agent_id
  if (!author || author === actorId) return
  try {
    const [who] = await sql`SELECT name FROM support_agents WHERE id = ${actorId} LIMIT 1` as any[]
    const link = task.deal_id ? `/sales/deals/${task.deal_id}`
      : task.lead_id ? `/sales/leads/${task.lead_id}`
      : task.account_id ? `/sales/accounts/${task.account_id}` : undefined
    await sendNotification({
      orgId, type: 'assignment',
      priority: status === 'rejected' ? 'high' : 'medium',
      title: `Задача: ${STATUS_VERB[status] || 'изменена'}`,
      body: `${who?.name || 'Исполнитель'} ${STATUS_VERB[status] || 'изменил'}: `
        + `«${String(task.title || '').slice(0, 100)}»${note ? ` — ${note.slice(0, 160)}` : ''}`,
      link,
      targetAgentIds: [author],
    })
  } catch { /* обратная связь не должна ронять саму правку задачи */ }
}
