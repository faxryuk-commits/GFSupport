import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { currencyForMarket, ensureSalesSchema, salesId } from '../_lib/sales-schema.js'
import { resolveRegionScoped, pipelineForMarket } from '../_lib/sales-amo.js'
import { FIELD_LABELS, missingFields } from '../_lib/sales-fields.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Единая воронка: обращения и сделки на одном экране.
 *
 * Слева очередь реакции (лиды), справа процесс продажи (сделки), граница
 * проходит по квалификации. Разрезать этот путь на два раздела — наше
 * техническое удобство, а не работа сейлза: он ведёт клиента от первого
 * сообщения до денег, и переключаться между экранами посреди дороги незачем.
 *
 * GET  ?region=&owner=&q=&perColumn=  — обе зоны одним запросом
 * POST ?action=convert { leadId, toStage } — лид становится сделкой сразу на
 *      нужном этапе; критерии выхода проверяются так же, как при обычном
 *      переходе, иначе доска стала бы дырой в правилах
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  // Счётчики для выпадашки регионов: сколько лидов и сделок в работе.
  // Выигранное и проигранное не считаем — фильтру нужен объём живой работы,
  // а не историческая статистика
  if (req.method === 'GET' && url.searchParams.get('action') === 'region-counts') {
    const [leadRows, dealRows] = await sql.transaction([
      sql`
        SELECT COALESCE(market_id, '') AS m, COUNT(*)::int AS n FROM sales_leads
        WHERE org_id = ${orgId} AND archived_at IS NULL
          AND status IN ('new', 'assigned', 'nurture')
        GROUP BY 1
      `,
      sql`
        SELECT COALESCE(market_id, '') AS m, COUNT(*)::int AS n FROM sales_deals
        WHERE org_id = ${orgId} AND archived_at IS NULL
          AND won_at IS NULL AND lost_at IS NULL
        GROUP BY 1
      `,
    ]) as any[]
    const regions: Record<string, { leads: number; deals: number }> = {}
    for (const r of leadRows) {
      regions[r.m] = regions[r.m] || { leads: 0, deals: 0 }; regions[r.m].leads = r.n
    }
    for (const r of dealRows) {
      regions[r.m] = regions[r.m] || { leads: 0, deals: 0 }; regions[r.m].deals = r.n
    }
    return json({ regions }, 200, 60)
  }

  const market = await resolveRegionScoped(sql, orgId, url, ctx)
  // Тип воронки: обычные продажи или enterprise. Этапы у типов разные,
  // и без этого среза «все регионы» смешивал бы колонки двух миров
  const ptype = url.searchParams.get('type') === 'enterprise' ? 'enterprise' : 'sales'
  const pipeline = market ? `${ptype}_${market}` : null
  // Булево сравнение вместо ветвления: (тип=ЭП) должно совпадать с
  // (воронка начинается с enterprise) — одна строка на оба направления
  const isEnt = ptype === 'enterprise'

  if (req.method === 'POST' && url.searchParams.get('action') === 'convert') {
    const body = await req.json().catch(() => null)
    if (!body?.leadId) return json({ error: 'leadId is required' }, 400)

    const [lead] = await sql`
      SELECT id, name, account_id, market_id, status, phone, city
      FROM sales_leads WHERE id = ${body.leadId} AND org_id = ${orgId} LIMIT 1
    ` as any[]
    if (!lead) return json({ error: 'обращение не найдено' }, 404)

    const leadPipeline = pipelineForMarket(lead.market_id)
    const [target] = await sql`
      SELECT id, key, label, required_fields, sort_order FROM sales_stages
      WHERE org_id = ${orgId} AND pipeline = ${leadPipeline}
        AND key = ${String(body.toStage || 'qualified')} AND is_active = true
      LIMIT 1
    ` as any[]
    if (!target) return json({ error: 'этап не найден' }, 404)

    // Свежая сделка почти пустая: если у этапа есть критерии выхода, честно
    // говорим, чего не хватает, вместо того чтобы завести пустышку на «КП»
    const draft = { city: lead.city, title: lead.name }
    const missing = missingFields(draft, target.required_fields)
    if (missing.length) {
      return json({
        blocked: true,
        stage: target.label,
        missing,
        message: `Для этапа «${target.label}» не хватает: ${missing.map(m => m.label).join(', ')}. `
          + 'Возьмите обращение в работу и заполните поля — тогда сделка встанет сюда.',
      }, 422)
    }

    const dealId = salesId('sd')
    await sql`
      INSERT INTO sales_deals (id, org_id, account_id, stage_id, owner_agent_id, market_id,
                               title, deal_type, source_lead_id, pipeline, city, currency, stage_since)
      VALUES (${dealId}, ${orgId}, ${lead.account_id}, ${target.id}, ${ctx.agentId},
              ${lead.market_id}, ${lead.name}, 'new', ${lead.id}, ${leadPipeline},
              ${lead.city}, ${await currencyForMarket(sql, orgId, lead.market_id)}, NOW())
    `
    await sql`
      INSERT INTO sales_deal_events (org_id, deal_id, new_stage_id, changed_by)
      VALUES (${orgId}, ${dealId}, ${target.id}, ${'из обращения на доске'})
    `
    // Взяли в работу — таймер первого касания останавливается здесь
    await sql`
      UPDATE sales_leads
      SET status = 'converted', assigned_agent_id = ${ctx.agentId},
          assigned_at = COALESCE(assigned_at, NOW()), first_touch_at = COALESCE(first_touch_at, NOW()),
          updated_at = NOW()
      WHERE id = ${lead.id} AND org_id = ${orgId}
    `
    return json({ ok: true, dealId, stage: target.key })
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const owner = url.searchParams.get('owner') || ''
  const q = url.searchParams.get('q') || ''
  // Потолок поднят с полусотни: колонка «на прогреве» бывает и в полторы
  // сотни, а раскрыть её было нечем — счётчик внизу был просто текстом
  const perColumn = Math.min(300, Math.max(5, parseInt(url.searchParams.get('perColumn') || '15', 10)))
  const like = q ? `%${q}%` : ''

  // Все выборки экрана уходят ОДНОЙ пачкой, а не семью запросами подряд.
  // Стоимость здесь не в работе базы (5–40 мс на запрос), а в дороге до неё:
  // функции Vercel живут в Азии, база — во Франкфурте, и каждый заход стоит
  // ~190 мс кругосветки. Семь заходов — это полторы секунды ожидания на ровном
  // месте; пачка обходится в один. Замер 16.08.2026: 5 запросов подряд 669 мс,
  // те же пять пачкой — 96 мс.
  const [leadRows, leadCounts, dealRows, stageRows, closed, totalsRows, owners] = await sql.transaction([
    // Обращения: срез по каждой колонке входа, без архива
    sql`
      SELECT * FROM (
        SELECT l.id, l.name, l.contact_name, l.phone, l.city, l.status, l.icp_score, l.market_id,
               l.sla_due_at, l.first_touch_at, l.created_at, l.text, l.lead_kind,
               l.nurture_step, l.nurture_next_at,
               s.label AS source, ag.name AS agent_name,
               ROW_NUMBER() OVER (PARTITION BY l.status ORDER BY l.created_at DESC) AS rn
        FROM sales_leads l
        LEFT JOIN sales_sources s ON s.id = l.source_id
        LEFT JOIN support_agents ag ON ag.id = l.assigned_agent_id
        WHERE l.org_id = ${orgId} AND l.archived_at IS NULL
          AND l.status IN ('new', 'assigned', 'attempting', 'nurture')
          AND (${market} = '' OR l.market_id = ${market})
          AND (${owner} = '' OR l.assigned_agent_id = ${owner})
          AND (${like} = '' OR l.name ILIKE ${like} OR l.phone ILIKE ${like})
      ) t WHERE rn <= ${perColumn}
    `,
    sql`
      SELECT status, COUNT(*)::int AS total FROM sales_leads
      WHERE org_id = ${orgId} AND archived_at IS NULL
        AND status IN ('new', 'assigned', 'attempting', 'nurture')
        AND (${market} = '' OR market_id = ${market})
        AND (${owner} = '' OR assigned_agent_id = ${owner})
        AND (${like} = '' OR name ILIKE ${like} OR phone ILIKE ${like})
      GROUP BY status
    `,
    // Сделки: срез по каждому этапу
    sql`
      SELECT * FROM (
        SELECT d.id, d.title, d.monthly_amount, d.currency, d.city, d.pos, d.points, d.market_id,
               d.orders_per_day, d.tariff, d.next_step, d.next_step_at, d.stage_since,
               d.stalled_at, d.updated_at, a.name AS account, ag.name AS owner_name,
               (SELECT c.phone FROM sales_contacts c WHERE c.account_id = d.account_id
                 ORDER BY c.is_primary DESC LIMIT 1) AS phone,
               (SELECT MAX(doc.opened_count) FROM sales_documents doc WHERE doc.deal_id = d.id) AS doc_opens,
               s.key AS stage_key, d.won_at, d.lost_at, lr.label AS lost_reason,
               ROW_NUMBER() OVER (PARTITION BY s.key
                 ORDER BY COALESCE(d.updated_at, d.stage_since, d.created_at) DESC) AS rn
        FROM sales_deals d
        JOIN sales_stages s ON s.id = d.stage_id
        LEFT JOIN sales_accounts a ON a.id = d.account_id
        LEFT JOIN support_agents ag ON ag.id = d.owner_agent_id
        LEFT JOIN sales_lost_reasons lr ON lr.id = d.lost_reason_id
        -- Закрытые сделки тоже отдаём карточками: раньше выигранное и
        -- проигранное было счётчиком, и посмотреть, что именно там лежит,
        -- из воронки было нельзя. Срез свой на каждую колонку, так что
        -- открытые этапы это не утяжеляет
        WHERE d.org_id = ${orgId} AND d.archived_at IS NULL
          AND d.pipeline <> 'partner'
          AND (${isEnt} = (d.pipeline LIKE 'enterprise%'))
          AND (${market} = '' OR d.market_id = ${market})
          AND (${owner} = '' OR d.owner_agent_id = ${owner})
          AND (${like} = '' OR d.title ILIKE ${like} OR a.name ILIKE ${like})
      ) t WHERE rn <= ${perColumn}
    `,
    sql`
      SELECT s.key, MIN(s.label) AS label, MIN(s.sort_order) AS sort_order,
             MIN(s.description) AS description, MAX(s.sla_hours) AS sla_hours,
             COUNT(d.id)::int AS total,
             -- Суммы складываем по валютам: у нас в одной воронке живут
             -- доллары и сумы, и общий итог был бы просто неверным числом
             COALESCE(jsonb_object_agg(d.currency, d.amt) FILTER (WHERE d.currency IS NOT NULL),
                      '{}'::jsonb) AS amounts
      FROM sales_stages s
      LEFT JOIN (
        SELECT stage_id, currency, SUM(monthly_amount) AS amt, MIN(id) AS id
        FROM sales_deals
        WHERE org_id = ${orgId} AND archived_at IS NULL AND won_at IS NULL AND lost_at IS NULL
          AND COALESCE(monthly_amount, 0) <> 0
          AND (${market} = '' OR market_id = ${market})
          AND (${owner} = '' OR owner_agent_id = ${owner})
        GROUP BY stage_id, currency
      ) d ON d.stage_id = s.id
      WHERE s.org_id = ${orgId} AND s.kind = 'open' AND s.is_active = true
        AND s.pipeline <> 'partner'
        AND (${isEnt} = (s.pipeline LIKE 'enterprise%'))
        AND (${pipeline || ''} = '' OR s.pipeline = ${pipeline || ''})
      GROUP BY s.key ORDER BY MIN(s.sort_order)
    `,
    sql`
      SELECT s.key, MIN(s.label) AS label, MIN(s.kind) AS kind,
             COALESCE(SUM(d.cnt), 0)::int AS total,
             COALESCE(SUM(d.last30), 0)::int AS last30,
             COALESCE(jsonb_object_agg(d.currency, d.won30) FILTER (
               WHERE d.currency IS NOT NULL AND d.won30 > 0), '{}'::jsonb) AS amounts30
      FROM sales_stages s
      LEFT JOIN (
        SELECT stage_id, currency, MIN(id) AS id,
               COUNT(*)::int AS cnt,
               COUNT(*) FILTER (WHERE COALESCE(won_at, lost_at) > NOW() - INTERVAL '30 days')::int AS last30,
               COALESCE(SUM(monthly_amount) FILTER (
                 WHERE won_at > NOW() - INTERVAL '30 days'), 0) AS won30
        FROM sales_deals
        WHERE org_id = ${orgId} AND archived_at IS NULL
          AND (${market} = '' OR market_id = ${market})
          AND (${owner} = '' OR owner_agent_id = ${owner})
        GROUP BY stage_id, currency
      ) d ON d.stage_id = s.id
      WHERE s.org_id = ${orgId} AND s.kind IN ('won', 'lost') AND s.is_active = true
        AND s.pipeline <> 'partner'
        AND (${isEnt} = (s.pipeline LIKE 'enterprise%'))
        AND (${pipeline || ''} = '' OR s.pipeline = ${pipeline || ''})
      GROUP BY s.key ORDER BY MIN(s.kind) DESC
    `,
    sql`
      SELECT COUNT(*)::int AS open_deals,
             COUNT(*) FILTER (WHERE next_step_at IS NULL)::int AS no_next_step,
             -- Итог по валютам, а не одной кучей: в воронке живут и доллары,
             -- и сумы, и общее число было бы просто неверным
             COALESCE((
               SELECT jsonb_object_agg(currency, amt) FROM (
                 SELECT currency, SUM(monthly_amount) AS amt FROM sales_deals
                 WHERE org_id = ${orgId} AND archived_at IS NULL
                   AND won_at IS NULL AND lost_at IS NULL AND pipeline <> 'partner'
                   AND (${isEnt} = (pipeline LIKE 'enterprise%'))
                   AND COALESCE(monthly_amount, 0) <> 0
                   AND (${market} = '' OR market_id = ${market})
                 GROUP BY currency
               ) x
             ), '{}'::jsonb) AS pipeline_amounts
      FROM sales_deals
      WHERE org_id = ${orgId} AND archived_at IS NULL AND won_at IS NULL AND lost_at IS NULL
        AND pipeline <> 'partner' AND (${isEnt} = (pipeline LIKE 'enterprise%'))
        AND (${market} = '' OR market_id = ${market})
    `,
    sql`
      SELECT DISTINCT ag.id, ag.name FROM sales_deals d
      JOIN support_agents ag ON ag.id = d.owner_agent_id
      WHERE d.org_id = ${orgId} AND d.archived_at IS NULL
      ORDER BY ag.name
    `,
  ]) as any[]

  const counts: Record<string, number> = {}
  for (const r of leadCounts as any[]) counts[r.status] = r.total
  const totals = (totalsRows as any[])[0]

  return json({
    // Колонки входа описываем здесь: у обращений нет справочника этапов, их
    // «этапы» — это статусы, и правила у них другие
    leadColumns: [
      { key: 'new', label: 'Новые', hint: 'норматив касания 15 минут', total: counts.new || 0 },
      { key: 'assigned', label: 'Ждут касания', hint: 'назначены, но не тронуты', total: counts.assigned || 0 },
      // Дозвон — работа по выяснению, наш ли это клиент, то есть сама
      // квалификация. Сделка рождается уже после неё, поэтому колонка здесь
      { key: 'attempting', label: 'Дозвон', hint: 'выясняем, наш ли клиент', total: counts.attempting || 0 },
      { key: 'nurture', label: 'На прогреве', hint: 'греет ассистент', total: counts.nurture || 0 },
    ],
    leads: leadRows,
    stages: stageRows,
    deals: dealRows,
    closed,
    totals: totals || {},
    owners,
    labels: FIELD_LABELS,
    market,
  })
}
