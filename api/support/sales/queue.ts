import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema, salesId } from '../lib/sales-schema.js'
import { missingFields } from '../lib/sales-fields.js'
import { pipelineForMarket } from '../lib/sales-amo.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Очередь дня — то, с чего сейлз начинает работу.
 *
 * GET  ?agent=<id>   — очередь сотрудника (по умолчанию своя)
 * POST ?action=take  {leadId}  — взять лид, создаётся сделка на этапе дозвона
 * POST ?action=done  {taskId}  — закрыть задачу
 *
 * Порядок секций задан системой, а не сейлзом: сначала то, что горит по SLA,
 * потом сделки в шаге от закрытия, потом плановые касания, потом вернувшиеся
 * из реактивации. Смысл в том, чтобы не приходилось решать, с чего начать.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const agentId = url.searchParams.get('agent') || ctx.agentId

  if (req.method === 'POST') {
    const action = url.searchParams.get('action')
    const body = await req.json().catch(() => null)

    if (action === 'take' && body?.leadId) {
      const [lead] = await sql`
        SELECT id, name, account_id, market_id, status FROM sales_leads
        WHERE id = ${body.leadId} AND org_id = ${orgId} LIMIT 1
      `
      if (!lead) return json({ error: 'lead not found' }, 404)
      if (lead.status === 'converted') return json({ error: 'лид уже взят' }, 409)

      // Сделка попадает в воронку своего рынка: у каждого региона свои этапы
      const pipeline = pipelineForMarket(lead.market_id)
      const [stage] = await sql`
        SELECT id FROM sales_stages
        -- Сделка рождается уже квалифицированной: дозвон и выяснение
        -- «наш ли клиент» происходят на стороне обращений
        WHERE org_id = ${orgId} AND pipeline = ${pipeline}
          AND key = 'qualified' AND is_active = true
        LIMIT 1
      `
      const dealId = salesId('sd')
      await sql`
        INSERT INTO sales_deals (id, org_id, account_id, stage_id, owner_agent_id, market_id,
                                 title, deal_type, source_lead_id, pipeline)
        VALUES (${dealId}, ${orgId}, ${lead.account_id}, ${stage?.id || ''}, ${ctx.agentId},
                ${lead.market_id}, ${lead.name}, 'new', ${lead.id}, ${pipeline})
      `
      await sql`
        INSERT INTO sales_deal_events (org_id, deal_id, new_stage_id, changed_by)
        VALUES (${orgId}, ${dealId}, ${stage?.id || ''}, ${ctx.agentId})
      `
      // Взял в работу = первое касание: таймер SLA останавливается здесь
      await sql`
        UPDATE sales_leads SET status = 'converted', assigned_agent_id = ${ctx.agentId},
               assigned_at = COALESCE(assigned_at, NOW()), first_touch_at = NOW()
        WHERE id = ${lead.id}
      `
      return json({ ok: true, dealId })
    }

    if (action === 'done' && body?.taskId) {
      await sql`
        UPDATE sales_tasks SET done_at = NOW(), done_result = ${body.result || 'done'}
        WHERE id = ${body.taskId} AND org_id = ${orgId} AND done_at IS NULL
      `
      return json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  }

  const [sla, hot, tasks, revival, stats, comments] = await Promise.all([
    // 1. Горит SLA первого касания
    sql`
      SELECT l.id, l.name, l.icp_score, l.city, l.phone, l.sla_due_at, l.created_at, s.label AS source
      FROM sales_leads l
      LEFT JOIN sales_sources s ON s.id = l.source_id
      WHERE l.org_id = ${orgId} AND l.assigned_agent_id = ${agentId}
        AND l.first_touch_at IS NULL AND l.status = 'assigned' AND l.archived_at IS NULL
      ORDER BY l.sla_due_at ASC LIMIT 20
    `,
    // 2. Деньги в одном шаге: договор и КП, где клиент уже читал
    sql`
      SELECT d.id, d.title, d.monthly_amount, d.currency, d.stage_since, d.pipeline,
             d.next_step, d.next_step_at, d.city, d.pos, d.tariff,
             st.key AS stage_key, st.label AS stage, st.sort_order, a.name AS account,
             (SELECT phone FROM sales_contacts c WHERE c.account_id = d.account_id
               ORDER BY c.is_primary DESC LIMIT 1) AS phone,
             (SELECT MAX(opened_count) FROM sales_documents doc WHERE doc.deal_id = d.id) AS doc_opens
      FROM sales_deals d
      JOIN sales_stages st ON st.id = d.stage_id
      LEFT JOIN sales_accounts a ON a.id = d.account_id
      WHERE d.org_id = ${orgId} AND d.owner_agent_id = ${agentId}
        AND d.won_at IS NULL AND d.lost_at IS NULL AND d.archived_at IS NULL
        AND st.probability >= 40
      ORDER BY st.probability DESC, d.stage_since ASC LIMIT 20
    `,
    // 3. Задачи и каденции на сегодня
    sql`
      SELECT t.id, t.title, t.kind, t.due_at, t.channel, d.id AS deal_id, d.title AS deal_title
      FROM sales_tasks t
      LEFT JOIN sales_deals d ON d.id = t.deal_id
      WHERE t.org_id = ${orgId} AND t.assignee_agent_id = ${agentId}
        AND t.done_at IS NULL AND t.due_at <= NOW() + INTERVAL '1 day'
      ORDER BY t.due_at ASC LIMIT 30
    `,
    // 4. Вернулись из реактивации
    sql`
      SELECT d.id, d.title, d.lost_at, r.label AS reason, a.name AS account
      FROM sales_deals d
      LEFT JOIN sales_lost_reasons r ON r.id = d.lost_reason_id
      LEFT JOIN sales_accounts a ON a.id = d.account_id
      WHERE d.org_id = ${orgId} AND d.owner_agent_id = ${agentId}
        AND d.lost_at IS NOT NULL AND d.archived_at IS NULL
        AND d.reactivate_at IS NOT NULL AND d.reactivate_at <= NOW()
      ORDER BY d.reactivate_at ASC LIMIT 10
    `,
    // Счётчики шапки
    sql`
      SELECT
        (SELECT COUNT(*) FROM sales_deals d WHERE d.org_id = ${orgId}
           AND d.owner_agent_id = ${agentId} AND d.won_at IS NULL AND d.lost_at IS NULL
           AND d.archived_at IS NULL) AS active_deals,
        (SELECT COALESCE(SUM(d.monthly_amount), 0) FROM sales_deals d WHERE d.org_id = ${orgId}
           AND d.owner_agent_id = ${agentId} AND d.won_at IS NULL AND d.lost_at IS NULL
           AND d.archived_at IS NULL) AS pipeline_amount,
        (SELECT COUNT(*) FROM sales_tasks t WHERE t.org_id = ${orgId}
           AND t.assignee_agent_id = ${agentId} AND t.done_at IS NULL AND t.due_at < NOW()) AS overdue_tasks,
        (SELECT COUNT(*) FROM sales_deals d WHERE d.org_id = ${orgId}
           AND d.owner_agent_id = ${agentId} AND d.won_at >= date_trunc('month', NOW())) AS won_this_month,
        -- Для значков в меню: что горит лично у этого сейлза
        (SELECT COUNT(*) FROM sales_deals d WHERE d.org_id = ${orgId}
           AND d.owner_agent_id = ${agentId} AND d.won_at IS NULL AND d.lost_at IS NULL
           AND d.archived_at IS NULL
           AND (d.stalled_at IS NOT NULL OR d.next_step_at IS NULL)) AS hot_deals,
        -- Тоже лично по сейлзу, как и сделки рядом: соседние значки должны
        -- мерить одно и то же. Раньше сделки считались по владельцу, а лиды —
        -- по всей организации, и «10» с «72» стояли рядом, означая разное
        (SELECT COUNT(*) FROM sales_leads l WHERE l.org_id = ${orgId}
           AND l.archived_at IS NULL AND l.assigned_agent_id = ${agentId}
           AND l.first_touch_at IS NULL) AS new_leads
    `,
    // Комментарии — общая корзина, а не личная: под постом вопрос видят все,
    // и владельца у него нет. Поэтому считаем по организации, в отличие от
    // сделок и лидов рядом. Таблица заводится при подключении Meta, поэтому
    // отказ гасим: без неё значок должен быть нулём, а не пятисоткой на всю
    // очередь
    sql`
      SELECT COUNT(*)::int AS n FROM support_meta_comments
      WHERE org_id = ${orgId} AND NOT is_ours AND NOT is_hidden AND replied_at IS NULL
    `.catch(() => [{ n: 0 }]),
  ])

  // Чего не хватает, чтобы двинуть сделку дальше. Считаем здесь, а не в
  // браузере: правила этапов живут на сервере, и очередь должна говорить не
  // «открой и разберись», а «не хватает суммы»
  const stageRows = await sql`
    SELECT id, key, label, kind, sort_order, required_fields, pipeline
    FROM sales_stages WHERE org_id = ${orgId} AND is_active = true ORDER BY sort_order
  ` as any[]
  const dealRows = hot.length
    ? await sql`SELECT * FROM sales_deals WHERE id = ANY(${hot.map((h: any) => h.id)})` as any[]
    : []
  const hotEnriched = (hot as any[]).map(h => {
    const deal = dealRows.find(d => d.id === h.id) || {}
    const pipeline = h.pipeline || 'sales'
    const next = stageRows
      .filter(st => (st.pipeline || 'sales') === pipeline && st.kind === 'open'
        && st.sort_order > (h.sort_order ?? -1))
      .sort((a, b) => a.sort_order - b.sort_order)[0]
      || stageRows.find(st => (st.pipeline || 'sales') === pipeline && st.kind === 'won')
    return {
      ...h,
      next_stage_key: next?.key || null,
      next_stage_label: next?.label || null,
      blockers: next ? missingFields(deal, next.required_fields) : [],
    }
  })

  return json({
    agentId,
    sla, hot: hotEnriched, tasks, revival,
    stats: { ...(stats[0] || {}), meta_comments: (comments as any[])[0]?.n ?? 0 },
    total: sla.length + hot.length + tasks.length + revival.length,
  })
}
