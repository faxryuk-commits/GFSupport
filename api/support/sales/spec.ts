import { getRequestOrgId } from '../_lib/org.js'
import { extractAgentContext } from '../_lib/auth.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * ТЗ на подключение, которое собирается по ходу продажи.
 *
 * Выигранная сделка сама заводит проект в «Подключениях», но приезжал он
 * пустым: список задач есть, а чем именно пользуется клиент — нет. Инженер
 * открывал карточку и не понимал, какая касса, какие агрегаторы, чем
 * принимают оплату; всё это выяснялось заново звонком, через неделю после
 * того, как клиент это уже рассказал сейлзу.
 *
 * Собирать в момент выигрыша — плохая идея: там сейлз хочет закрыть сделку и
 * идти дальше, и форма заполняется словом «уточним». Поэтому ТЗ живёт в
 * карточке сделки и наполняется по ходу разговоров, а выигрыш только
 * проверяет, что главное выяснено.
 *
 * GET  ?dealId=  → шаблон задач с вариантами и текущий выбор
 * POST { dealId, selections: { [taskTypeId]: optionId[] }, note? }
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  if (req.method === 'POST') {
    const body = await req.json().catch(() => null)
    const dealId = String(body?.dealId || '')
    if (!dealId) return json({ error: 'dealId is required' }, 400)

    const [me] = await sql`
      SELECT name FROM support_agents WHERE id = ${ctx.agentId} LIMIT 1
    ` as any[]
    const spec = {
      selections: body?.selections && typeof body.selections === 'object' ? body.selections : {},
      note: body?.note ? String(body.note).slice(0, 2000) : null,
    }
    await sql`
      UPDATE sales_deals
      SET onboarding_spec = ${JSON.stringify(spec)}::jsonb,
          spec_updated_at = NOW(), spec_updated_by = ${me?.name || null}, updated_at = NOW()
      WHERE id = ${dealId} AND org_id = ${orgId}
    `
    return json({ ok: true })
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const dealId = url.searchParams.get('dealId') || ''
  if (!dealId) return json({ error: 'dealId is required' }, 400)

  const [deal, groups, options] = await sql.transaction([
    sql`
      SELECT onboarding_spec, spec_updated_at, spec_updated_by, pos, aggregators, delivery_type
      FROM sales_deals WHERE id = ${dealId} AND org_id = ${orgId} LIMIT 1
    `,
    // Только те задачи, где есть выбор поставщика: остальные в проекте
    // появятся сами по шаблону, и спрашивать о них сейлза незачем
    sql`
      SELECT tt.id, tt.label, tt.group_label, tt.option_category_id, tt.sort_order,
             c.label AS category_label
      FROM onboarding_task_types tt
      JOIN onboarding_option_categories c ON c.id = tt.option_category_id
      WHERE tt.org_id = ${orgId} AND tt.is_active = true
      ORDER BY tt.sort_order
    `,
    sql`
      SELECT id, label, category_id FROM onboarding_options
      WHERE org_id = ${orgId} AND is_active = true
      ORDER BY sort_order, label
    `,
  ]) as any[]

  const row = (deal as any[])[0]
  if (!row) return json({ error: 'Сделка не найдена' }, 404)

  const byCat = new Map<string, any[]>()
  for (const o of options as any[]) {
    const list = byCat.get(o.category_id) || []
    list.push({ id: o.id, label: o.label })
    byCat.set(o.category_id, list)
  }

  return json({
    tasks: (groups as any[]).map(t => ({
      id: t.id, label: t.label, group: t.group_label,
      category: t.category_label,
      options: byCat.get(t.option_category_id) || [],
    })),
    spec: row.onboarding_spec || { selections: {}, note: null },
    updatedAt: row.spec_updated_at,
    updatedBy: row.spec_updated_by,
    // Подсказки из квалификации: их сейлз уже выяснил, и переспрашивать
    // клиента о том же — верный способ выглядеть несобранным
    hints: { pos: row.pos, aggregators: row.aggregators, delivery: row.delivery_type },
  })
}
