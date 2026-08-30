import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { ensureSalesSchema } from '../_lib/sales-schema.js'
import { EDITABLE_FIELDS, FIELD_LABELS, missingFields } from '../_lib/sales-fields.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Карточка сделки — всё, что нужно во время звонка, одним запросом.
 *
 * GET   ?id=...   — сделка, аккаунт, этапы, критерии выхода, задачи, документы,
 *                   контакты и история
 * PATCH {id, fields:{...}} — правка полей из белого списка. Этап здесь не
 *                   меняется: для этого есть /sales/stage с проверкой критериев.
 * POST  ?action=approve-discount|reject-discount {id, comment?} — снять или
 *                   подтвердить блокировку по скидке выше порога.
 */

/**
 * Кто вправе подтвердить скидку выше порога: руководство, а не сам продавец.
 * Администраторы приходят готовым признаком, коммерческим директорам (cco)
 * права даём по роли — они и ведут переговоры о цене.
 */
async function canApproveDiscount(sql: any, ctx: any): Promise<boolean> {
  if (ctx.isOrgAdmin || ctx.isGlobalAdmin || ctx.isSuperAdmin) return true
  const [a] = await sql`SELECT role FROM support_agents WHERE id = ${ctx.agentId} LIMIT 1`
  return ['cco', 'sales_lead'].includes(String(a?.role || ''))
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  // ─── Подтверждение скидки ───────────────────────────────────────────────────
  // Движок этапов ставит сделке approval_state='pending', когда скидка выше
  // порога. Раньше снять эту пометку было нечем — сделка замирала навсегда
  if (req.method === 'POST') {
    const action = url.searchParams.get('action')
    if (action !== 'approve-discount' && action !== 'reject-discount') {
      return json({ error: 'unknown action' }, 400)
    }
    const body = await req.json().catch(() => null)
    if (!body?.id) return json({ error: 'id is required' }, 400)

    const [deal] = await sql`
      SELECT id, account_id, discount_pct, approval_state FROM sales_deals
      WHERE id = ${body.id} AND org_id = ${orgId} LIMIT 1
    `
    if (!deal) return json({ error: 'not found' }, 404)
    if (!(await canApproveDiscount(sql, ctx))) {
      return json({ error: 'Подтвердить скидку может только руководитель' }, 403)
    }

    const approved = action === 'approve-discount'
    const [agent] = await sql`SELECT name FROM support_agents WHERE id = ${ctx.agentId} LIMIT 1`
    const who = agent?.name || ctx.agentId
    await sql`
      UPDATE sales_deals SET approval_state = ${approved ? 'approved' : 'rejected'}, updated_at = NOW()
      WHERE id = ${deal.id} AND org_id = ${orgId}
    `
    await sql`
      INSERT INTO sales_activities (id, org_id, deal_id, account_id, type, result, text, agent_id)
      VALUES (${'sa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)}, ${orgId},
              ${deal.id}, ${deal.account_id}, 'approval', ${approved ? 'approved' : 'rejected'},
              ${`Скидка ${deal.discount_pct}% ${approved ? 'подтверждена' : 'отклонена'}: ${who}` +
                (body.comment ? ` — ${body.comment}` : '')}, ${ctx.agentId})
    `
    return json({ ok: true, approvalState: approved ? 'approved' : 'rejected' })
  }

  if (req.method === 'PATCH') {
    const body = await req.json().catch(() => null)
    if (!body?.id || !body?.fields) return json({ error: 'id and fields are required' }, 400)

    const entries = Object.entries(body.fields)
      .filter(([k]) => (EDITABLE_FIELDS as readonly string[]).includes(k))
    if (!entries.length) return json({ error: 'nothing to update' }, 400)

    // Поля обновляем по одному именованным запросом: динамическая сборка SQL
    // в шаблонных строках neon небезопасна и нечитаема
    for (const [key, value] of entries) {
      const v: any = value === '' ? null : value
      switch (key) {
        case 'title': await sql`UPDATE sales_deals SET title = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'city': await sql`UPDATE sales_deals SET city = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'points': await sql`UPDATE sales_deals SET points = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'orders_per_day': await sql`UPDATE sales_deals SET orders_per_day = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'pos': await sql`UPDATE sales_deals SET pos = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'aggregators': await sql`UPDATE sales_deals SET aggregators = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'delivery_type': await sql`UPDATE sales_deals SET delivery_type = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'pain': await sql`UPDATE sales_deals SET pain = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'segment': await sql`UPDATE sales_deals SET segment = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'dm_role': await sql`UPDATE sales_deals SET dm_role = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'dm_name': await sql`UPDATE sales_deals SET dm_name = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'dm_confirmed': await sql`UPDATE sales_deals SET dm_confirmed = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'meeting_at': await sql`UPDATE sales_deals SET meeting_at = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'budget_stated': await sql`UPDATE sales_deals SET budget_stated = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'tariff': await sql`UPDATE sales_deals SET tariff = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'monthly_amount': await sql`UPDATE sales_deals SET monthly_amount = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'onetime_amount': await sql`UPDATE sales_deals SET onetime_amount = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        // Изменили размер скидки — прежнее подтверждение больше не действует:
        // иначе можно согласовать 16%, а потом тихо поставить 40% и провести
        case 'discount_pct': await sql`
          UPDATE sales_deals SET discount_pct = ${v},
            approval_state = CASE
              WHEN COALESCE(discount_pct, 0)::numeric IS DISTINCT FROM COALESCE(${v}, '0')::numeric
              THEN NULL ELSE approval_state END
          WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'term_months': await sql`UPDATE sales_deals SET term_months = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'valid_till': await sql`UPDATE sales_deals SET valid_till = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'kp_file': await sql`UPDATE sales_deals SET kp_file = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'legal_name': await sql`UPDATE sales_deals SET legal_name = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'start_date': await sql`UPDATE sales_deals SET start_date = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'paid_at': await sql`UPDATE sales_deals SET paid_at = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'expected_close_at': await sql`UPDATE sales_deals SET expected_close_at = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'probability': await sql`UPDATE sales_deals SET probability = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'next_step': await sql`UPDATE sales_deals SET next_step = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'next_step_at': await sql`UPDATE sales_deals SET next_step_at = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'currency': await sql`UPDATE sales_deals SET currency = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'items': await sql`UPDATE sales_deals SET items = ${JSON.stringify(v || [])}::jsonb WHERE id = ${body.id} AND org_id = ${orgId}`; break
      }
    }
    // Заполнили следующий шаг — сделка перестаёт считаться брошенной
    await sql`
      UPDATE sales_deals SET updated_at = NOW(),
        stalled_at = CASE WHEN next_step_at IS NOT NULL THEN NULL ELSE stalled_at END
      WHERE id = ${body.id} AND org_id = ${orgId}
    `
    return json({ ok: true, updated: entries.map(([k]) => k) })
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const id = url.searchParams.get('id')
  if (!id) return json({ error: 'id is required' }, 400)

  const [deal] = await sql`
    SELECT * FROM sales_deals WHERE id = ${id} AND org_id = ${orgId} LIMIT 1
  `
  if (!deal) return json({ error: 'not found' }, 404)

  const [account, stages, tasks, documents, events, contacts, reasons] = await Promise.all([
    sql`SELECT * FROM sales_accounts WHERE id = ${deal.account_id} LIMIT 1`,
    sql`
      SELECT id, key, label, kind, owner_role, sla_hours, required_fields, probability, sort_order,
             description
      FROM sales_stages
      WHERE org_id = ${orgId} AND pipeline = ${deal.pipeline || 'sales'} AND is_active = true
      ORDER BY sort_order
    `,
    sql`
      SELECT id, title, kind, channel, due_at, done_at, done_result, cadence_step, auto
      FROM sales_tasks WHERE deal_id = ${id} ORDER BY due_at ASC NULLS LAST LIMIT 50
    `,
    sql`
      SELECT id, kind, number, version, status, title, total, currency, valid_till,
             share_token, opened_count, read_seconds, first_opened_at, last_opened_at, created_at
      FROM sales_documents WHERE deal_id = ${id} ORDER BY created_at DESC LIMIT 20
    `,
    sql`
      SELECT e.changed_at, e.changed_by, so.label AS from_stage, sn.label AS to_stage
      FROM sales_deal_events e
      LEFT JOIN sales_stages so ON so.id = e.old_stage_id
      LEFT JOIN sales_stages sn ON sn.id = e.new_stage_id
      WHERE e.deal_id = ${id} ORDER BY e.changed_at DESC LIMIT 30
    `,
    sql`
      SELECT name, role, phone, telegram, is_primary FROM sales_contacts
      WHERE account_id = ${deal.account_id} ORDER BY is_primary DESC LIMIT 10
    `,
    sql`SELECT id, code, label, reactivate_days FROM sales_lost_reasons
        WHERE org_id = ${orgId} AND is_active = true ORDER BY sort_order`,
  ])

  const open = stages.filter((s: any) => s.kind === 'open')
  const idx = open.findIndex((s: any) => s.id === deal.stage_id)
  const nextStage = idx >= 0 && idx < open.length - 1
    ? open[idx + 1]
    : stages.find((s: any) => s.kind === 'won') || null

  // Переписка клиента: если аккаунт связан с каналом поддержки, показываем
  // последние сообщения прямо в сделке. Иначе сейлз читает диалог в одном
  // приложении, а работает в другом — и половина контекста теряется по дороге
  let messages: any[] = []
  const channelId = account[0]?.channel_id
  if (channelId) {
    try {
      messages = await sql`
        SELECT id, sender_name, is_from_client, text_content, content_type, created_at
        FROM support_messages
        WHERE channel_id = ${channelId} AND is_deleted IS NOT TRUE
        ORDER BY created_at DESC LIMIT 20
      ` as any[]
      messages.reverse()
    } catch {
      messages = []
    }
  }

  return json({
    deal,
    account: account[0] || null,
    messages,
    channelId: channelId || null,
    stages,
    currentStage: stages.find((s: any) => s.id === deal.stage_id) || null,
    nextStage,
    missing: nextStage ? missingFields(deal, nextStage.required_fields) : [],
    // Подписи полей отдаём целиком: на карточке они нужны и для заполненных
    // критериев, иначе сейлз увидит имя колонки вместо названия
    labels: FIELD_LABELS,
    tasks, documents, events, contacts, reasons,
  })
}
