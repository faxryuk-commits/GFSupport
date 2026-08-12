import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'
import { EDITABLE_FIELDS, FIELD_LABELS, missingFields } from '../lib/sales-fields.js'

export const config = { runtime: 'edge' }

/**
 * Карточка сделки — всё, что нужно во время звонка, одним запросом.
 *
 * GET   ?id=...   — сделка, аккаунт, этапы, критерии выхода, задачи, документы,
 *                   контакты и история
 * PATCH {id, fields:{...}} — правка полей из белого списка. Этап здесь не
 *                   меняется: для этого есть /sales/stage с проверкой критериев.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

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
        case 'dm_name': await sql`UPDATE sales_deals SET dm_name = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'dm_confirmed': await sql`UPDATE sales_deals SET dm_confirmed = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'meeting_at': await sql`UPDATE sales_deals SET meeting_at = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'budget_stated': await sql`UPDATE sales_deals SET budget_stated = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'tariff': await sql`UPDATE sales_deals SET tariff = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'monthly_amount': await sql`UPDATE sales_deals SET monthly_amount = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'onetime_amount': await sql`UPDATE sales_deals SET onetime_amount = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'discount_pct': await sql`UPDATE sales_deals SET discount_pct = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
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
      SELECT id, key, label, kind, owner_role, sla_hours, required_fields, probability, sort_order
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

  return json({
    deal,
    account: account[0] || null,
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
