import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema, salesId } from '../lib/sales-schema.js'
import { FIELD_LABELS, isEmptyValue } from '../lib/sales-fields.js'

export const config = { runtime: 'edge' }

/**
 * Смена этапа сделки — здесь живёт синхронная часть движка.
 *
 * POST { dealId, toStage: "<key|id>", lostReasonCode?, comment? }
 *
 * Порядок проверок:
 *   1. Критерии выхода целевого этапа (required_fields) — пусто хотя бы одно,
 *      переход не выполняется, возвращается список незаполненного (422).
 *   2. Скидка больше 15% без подтверждения фаундера — переход блокируется.
 *   3. При успехе: журнал события, закрытие устаревших авто-задач, создание
 *      каденции целевого этапа, а для терминальных — выигрыш или отказ.
 *
 * Правила берутся из справочника sales_stages, не из кода: набор обязательных
 * полей и каденцию правит РОП из интерфейса.
 */

const MAX_DISCOUNT_WITHOUT_APPROVAL = 15

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => null)
  if (!body?.dealId || !body?.toStage) return json({ error: 'dealId and toStage are required' }, 400)

  const [deal] = await sql`
    SELECT * FROM sales_deals WHERE id = ${body.dealId} AND org_id = ${orgId} LIMIT 1
  `
  if (!deal) return json({ error: 'deal not found' }, 404)

  // Этап ищем внутри воронки сделки: после разделения по регионам ключ 'kp'
  // есть у каждой страны, и без этого условия сделка могла уехать в чужую
  // воронку — по ключу совпало бы, по смыслу нет
  const pipeline = deal.pipeline || 'sales'
  const [target] = await sql`
    SELECT * FROM sales_stages
    WHERE org_id = ${orgId} AND (key = ${String(body.toStage)} OR id = ${String(body.toStage)})
      AND (pipeline = ${pipeline} OR id = ${String(body.toStage)})
    ORDER BY (pipeline = ${pipeline}) DESC
    LIMIT 1
  `
  if (!target) return json({ error: 'stage not found' }, 404)

  const [agent] = await sql`SELECT name FROM support_agents WHERE id = ${ctx.agentId} LIMIT 1`
  const agentName = agent?.name || ctx.agentId

  // ─── 1. Критерии выхода ─────────────────────────────────────────────────────
  const required: string[] = Array.isArray(target.required_fields) ? target.required_fields : []
  const missing = required.filter(f => {
    if (f === 'lost_reason_id') return !body.lostReasonCode && isEmptyValue(deal.lost_reason_id)
    return isEmptyValue(deal[f])
  })
  if (missing.length) {
    return json({
      blocked: true,
      stage: target.label,
      missing: missing.map(f => ({ field: f, label: FIELD_LABELS[f] || f })),
      message: `Не заполнено: ${missing.map(f => FIELD_LABELS[f] || f).join(', ')}`,
    }, 422)
  }

  // ─── 2. Скидка выше порога — только с подтверждением ────────────────────────
  const discount = Number(deal.discount_pct || 0)
  if (target.kind !== 'lost' && discount > MAX_DISCOUNT_WITHOUT_APPROVAL && deal.approval_state !== 'approved') {
    await sql`UPDATE sales_deals SET approval_state = 'pending' WHERE id = ${deal.id}`
    return json({
      blocked: true,
      needsApproval: true,
      message: `Скидка ${discount}% выше порога ${MAX_DISCOUNT_WITHOUT_APPROVAL}% — нужно подтверждение фаундера`,
    }, 422)
  }

  // ─── 3. Переход ─────────────────────────────────────────────────────────────
  const now = new Date().toISOString()

  if (target.kind === 'lost') {
    const [reason] = await sql`
      SELECT id, reactivate_days FROM sales_lost_reasons
      WHERE org_id = ${orgId} AND (code = ${body.lostReasonCode || ''} OR id = ${deal.lost_reason_id || ''})
      LIMIT 1
    `
    if (!reason) return json({ error: 'lost reason not found' }, 400)
    const reactivateAt = reason.reactivate_days
      ? new Date(Date.now() + reason.reactivate_days * 86_400_000).toISOString()
      : null
    await sql`
      UPDATE sales_deals SET
        stage_id = ${target.id}, stage_since = ${now}, stalled_at = NULL, updated_at = ${now},
        lost_at = ${now}, lost_reason_id = ${reason.id},
        lost_comment = ${body.comment || null}, reactivate_at = ${reactivateAt}
      WHERE id = ${deal.id}
    `
  } else if (target.kind === 'won') {
    await sql`
      UPDATE sales_deals SET
        stage_id = ${target.id}, stage_since = ${now}, stalled_at = NULL,
        updated_at = ${now}, won_at = ${now}
      WHERE id = ${deal.id}
    `
    await sql`
      UPDATE sales_accounts SET lifecycle = 'customer' WHERE id = ${deal.account_id}
    `
  } else {
    await sql`
      UPDATE sales_deals SET
        stage_id = ${target.id}, stage_since = ${now}, stalled_at = NULL, updated_at = ${now}
      WHERE id = ${deal.id}
    `
  }

  await sql`
    INSERT INTO sales_deal_events (org_id, deal_id, old_stage_id, new_stage_id, changed_by)
    VALUES (${orgId}, ${deal.id}, ${deal.stage_id}, ${target.id}, ${agentName})
  `

  // Устаревшие авто-задачи прошлого этапа закрываем: каденция КП не должна
  // висеть, когда сделка уже на договоре. Ручные задачи не трогаем.
  await sql`
    UPDATE sales_tasks SET done_at = ${now}, done_result = 'obsolete'
    WHERE deal_id = ${deal.id} AND auto = true AND done_at IS NULL
  `

  // ─── 4. Каденция целевого этапа ─────────────────────────────────────────────
  const cadence: Array<{ day: number; title: string; channel?: string }> =
    Array.isArray(target.cadence) ? target.cadence : []
  for (const step of cadence) {
    await sql`
      INSERT INTO sales_tasks (id, org_id, deal_id, account_id, kind, title, channel,
                               due_at, assignee_agent_id, cadence_step, auto)
      VALUES (${salesId('stk')}, ${orgId}, ${deal.id}, ${deal.account_id}, 'cadence',
              ${step.title}, ${step.channel || null},
              ${new Date(Date.now() + (step.day || 0) * 86_400_000).toISOString()},
              ${deal.owner_agent_id}, ${step.day || 0}, true)
    `
  }

  // ─── 5. Выигрыш: проект внедрения через собственный intake «Подключений» ────
  let onboardingBrandId: string | null = null
  if (target.kind === 'won') {
    try {
      const res = await fetch(new URL('/api/support/onboarding/intake', req.url).toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: req.headers.get('Authorization') || '',
          'X-Org-Id': req.headers.get('X-Org-Id') || orgId,
        },
        body: JSON.stringify({
          name: deal.title || 'Без названия',
          tariff: deal.tariff || null,
          assigneeId: deal.owner_agent_id || null,
          notes: [
            `Из сделки: ${deal.title || deal.id}`,
            deal.city ? `Город: ${deal.city}` : '',
            deal.points ? `Точек: ${deal.points}` : '',
            deal.pos ? `POS: ${deal.pos}` : '',
            deal.monthly_amount ? `Подписка: ${deal.monthly_amount} ${deal.currency}` : '',
            deal.pain ? `Боль: ${deal.pain}` : '',
          ].filter(Boolean).join('\n'),
          selections: {},
        }),
      })
      const data: any = await res.json()
      onboardingBrandId = data?.id || null
      if (onboardingBrandId) {
        await sql`
          UPDATE sales_accounts SET onboarding_brand_id = ${onboardingBrandId}
          WHERE id = ${deal.account_id}
        `
      }
    } catch (e) {
      // Проект можно создать вручную; терять выигранную сделку из-за этого нельзя
      console.error('[sales/stage] onboarding intake failed:', e)
    }
  }

  return json({
    ok: true,
    stage: { id: target.id, key: target.key, label: target.label, kind: target.kind },
    tasksCreated: cadence.length,
    onboardingBrandId,
  })
}
