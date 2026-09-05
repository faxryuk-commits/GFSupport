import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { ensureSalesSchema, salesId } from '../_lib/sales-schema.js'
import { FIELD_LABELS, isEmptyValue } from '../_lib/sales-fields.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

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

async function handlerInner(req: Request): Promise<Response> {
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

  // Возврат назад по воронке — откат, а не прогресс: критерии выхода и
  // подтверждение скидки на него не распространяются. Требовать «КП и сумму»
  // у сделки, которую честно возвращают с КП на демо, — абсурд
  const [cur] = await sql`
    SELECT sort_order, kind FROM sales_stages WHERE id = ${deal.stage_id} AND org_id = ${orgId} LIMIT 1
  ` as any[]
  const movingBack = cur && target.kind === 'open'
    && Number(target.sort_order) <= Number(cur.sort_order)

  // ─── 1. Критерии выхода ─────────────────────────────────────────────────────
  const required: string[] = movingBack ? []
    : Array.isArray(target.required_fields) ? target.required_fields : []
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
  if (!movingBack && target.kind !== 'lost' && discount > MAX_DISCOUNT_WITHOUT_APPROVAL && deal.approval_state !== 'approved') {
    await sql`UPDATE sales_deals SET approval_state = 'pending' WHERE id = ${deal.id}`
    return json({
      blocked: true,
      needsApproval: true,
      message: `Скидка ${discount}% выше порога ${MAX_DISCOUNT_WITHOUT_APPROVAL}% — нужно подтверждение фаундера`,
    }, 422)
  }

  // ТЗ на подключение проверяем до перевода: если выпустить сделку в выигрыш
  // без него, проект уедет в подключения пустым, и выяснять состав придётся
  // заново — уже без сейлза и через неделю после разговора
  const spec = deal.onboarding_spec as { selections?: Record<string, string[]>; note?: string } | null
  const specFilled = Object.values(spec?.selections || {}).filter(v => Array.isArray(v) && v.length).length

  // Спрашиваем на КП, а не на выигрыше. Во-первых, к этому моменту сейлз уже
  // всё выяснил, а на финише он хочет закрыть сделку и пишет «уточним».
  // Во-вторых, состав подключения — сам по себе довод: «ваша касса, эти
  // платёжные системы, эти агрегаторы» читается серьёзнее прайса
  if ((target.key === 'kp' || target.kind === 'won') && !specFilled && !body?.skipSpec) {
    return json({
      blocked: true,
      needSpec: true,
      message: target.key === 'kp'
        ? 'Перед отправкой КП заполните состав подключения: касса, оплата, '
          + 'агрегаторы, доставка. Он войдёт в предложение — клиент увидит, '
          + 'что именно ему подключат, а не общий прайс.'
        : 'Перед выигрышем заполните ТЗ на подключение: без него отдел '
          + 'подключения начнёт с выяснения того, что вы уже знаете.',
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
        -- Потеря одна на всю воронку, а тег объясняет, где именно она
        -- случилась: «не дозвонились» и «не устроила цена» — разные болезни
        lost_stage = (SELECT key FROM sales_stages WHERE id = ${deal.stage_id}),
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
    // Открытый этап открывает сделку целиком: возврат из проигранных или
    // выигранных снимает метки закрытия — иначе она двигалась этапом,
    // но для всех списков оставалась закрытой
    await sql`
      UPDATE sales_deals SET
        stage_id = ${target.id}, stage_since = ${now}, stalled_at = NULL, updated_at = ${now},
        won_at = NULL, lost_at = NULL, lost_reason_id = NULL
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
            deal.orders_per_day ? `Заказов в день: ${deal.orders_per_day}` : '',
            deal.delivery_type ? `Доставка: ${deal.delivery_type}` : '',
            deal.aggregators ? `Агрегаторы: ${deal.aggregators}` : '',
            deal.monthly_amount ? `Подписка: ${deal.monthly_amount} ${deal.currency}` : '',
            deal.pain ? `Боль: ${deal.pain}` : '',
            spec?.note ? `\nОт сейлза: ${spec.note}` : '',
          ].filter(Boolean).join('\n'),
          // Раньше сюда уходил пустой объект: проект заводился со списком
          // задач, но без единого поставщика — инженер открывал карточку и
          // выяснял звонком то, что клиент уже рассказал сейлзу
          selections: spec?.selections || {},
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


/**
 * Ловушка ошибок. Раньше любой невыловленный сбой превращался в опаковый
 * FUNCTION_INVOCATION_FAILED: браузер видел 500 без текста, логи — ничего,
 * а сейлз — зависшую карточку. Теперь сбой возвращается текстом и попадает
 * в лог со стеком — следующий плавающий случай назовёт себя сам.
 */
export default async function handler(req: Request): Promise<Response> {
  try {
    return await handlerInner(req)
  } catch (e) {
    console.error('[stage] unhandled:', e instanceof Error ? (e.stack || e.message) : e)
    return json({ error: 'Внутренняя ошибка: ' + (e instanceof Error ? e.message : String(e)) }, 500)
  }
}
