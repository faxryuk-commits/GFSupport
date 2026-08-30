import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { currencyForMarket, ensureSalesSchema, salesId } from '../_lib/sales-schema.js'
import { resolveRegion } from '../_lib/sales-amo.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Список сделок: таблица, канбан и блок «требуют внимания».
 *
 * GET ?pipeline=sales&stage=&owner=&market=&q=&view=&from=&to=&limit=&offset=
 *
 *   view=mine       — только свои
 *   view=attention  — то, что собрал движок: сорванная каденция, нет следующего
 *                     шага, превышен норматив этапа
 *
 * Канбан и таблица берут одни и те же данные: это одно представление, а не два
 * разных списка, иначе цифры начнут расходиться.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  // Сделка без лида: пришли по знакомству, допродажа существующему клиенту,
  // разговор на выставке. Раньше такую можно было завести только через лид
  if (req.method === 'POST') {
    const body = await req.json().catch(() => null)
    const title = String(body?.title || '').trim()
    if (!title) return json({ error: 'нужно название сделки' }, 400)

    const market = String(body?.market || '').trim() || null
    const pipeline = market ? `sales_${market}` : 'sales'

    // Аккаунт: либо указанный, либо новый под тем же названием
    let accountId: string | null = body?.accountId || null
    if (!accountId) {
      accountId = salesId('sa')
      await sql`
        INSERT INTO sales_accounts (id, org_id, name, market_id, city, lifecycle, owner_agent_id)
        VALUES (${accountId}, ${orgId}, ${title.slice(0, 255)}, ${market},
                ${body?.city || null}, 'lead', ${ctx.agentId})
      `
    }

    const [stage] = await sql`
      -- Сделку заводят, когда клиент уже квалифицирован: дозвон и выяснение
      -- «наш ли это клиент» живут на стороне обращений
      SELECT id FROM sales_stages
      WHERE org_id = ${orgId} AND pipeline = ${pipeline}
        AND key = 'qualified' AND is_active = true
      LIMIT 1
    `
    const dealId = salesId('sd')
    await sql`
      INSERT INTO sales_deals (id, org_id, account_id, stage_id, owner_agent_id, market_id,
                               title, deal_type, pipeline, city, monthly_amount, currency,
                               tariff, pos, orders_per_day, points, stage_since)
      VALUES (${dealId}, ${orgId}, ${accountId}, ${stage?.id || ''},
              ${body?.ownerAgentId || ctx.agentId}, ${market}, ${title.slice(0, 255)},
              ${body?.dealType || 'new'}, ${pipeline}, ${body?.city || null},
              ${body?.monthlyAmount || null},
              ${body?.currency || (await currencyForMarket(sql, orgId, market)) || 'UZS'},
              ${body?.tariff || null}, ${body?.pos || null},
              ${body?.ordersPerDay || null}, ${body?.points || null}, NOW())
    `
    await sql`
      INSERT INTO sales_deal_events (org_id, deal_id, new_stage_id, changed_by)
      VALUES (${orgId}, ${dealId}, ${stage?.id || null}, 'заведена вручную')
    `
    return json({ ok: true, id: dealId, account_id: accountId })
  }

  if (req.method === 'DELETE') {
    // Архив, а не удаление: сделка — часть истории аккаунта и отчётов
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'id is required' }, 400)
    if (url.searchParams.get('hard') === '1') {
      // Удаление насовсем — намеренное действие администратора. Выигранные и
      // проигранные не трогаем: на них стоят отчёты и история аккаунта
      if (!ctx.isOrgAdmin && !ctx.isGlobalAdmin) return json({ error: 'только администратор' }, 403)
      const [deal] = await sql`
        SELECT won_at, lost_at FROM sales_deals WHERE id = ${id} AND org_id = ${orgId}
      ` as any[]
      if (!deal) return json({ error: 'сделка не найдена' }, 404)
      if (deal.won_at || deal.lost_at) {
        return json({ error: 'Закрытую сделку удалить нельзя — она в отчётах. Уберите в архив.' }, 409)
      }
      await sql`DELETE FROM sales_deal_events WHERE deal_id = ${id} AND org_id = ${orgId}`
      await sql`DELETE FROM sales_tasks WHERE deal_id = ${id} AND org_id = ${orgId}`
      await sql`UPDATE sales_documents SET deal_id = NULL WHERE deal_id = ${id} AND org_id = ${orgId}`
      await sql`DELETE FROM sales_deals WHERE id = ${id} AND org_id = ${orgId}`
      return json({ ok: true, deleted: true })
    }
    await sql`
      UPDATE sales_deals SET archived_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND org_id = ${orgId}
    `
    return json({ ok: true, archived: true })
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  // Рынок приходит из переключателя в шапке приложения. Выбран — работаем с
  // его воронкой, «все рынки» — показываем всё, но колонки берём из общей
  const market = await resolveRegion(sql, orgId, url)
  const pipeline = url.searchParams.get('pipeline')
    || (market ? `sales_${market}` : null)
  const view = url.searchParams.get('view') || 'all'
  const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '100', 10))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10))

  // Динамический WHERE через параметризованный запрос — как в журнале «Подключений»
  const conds: string[] = ['d.org_id = $1', "d.pipeline <> 'partner'", 'd.archived_at IS NULL']
  const params: any[] = [orgId]
  if (pipeline) {
    params.push(pipeline)
    conds.push(`d.pipeline = $${params.length}`)
  }
  const add = (cond: string, value: any) => {
    params.push(value)
    conds.push(cond.replace('?', `$${params.length}`))
  }

  const stage = url.searchParams.get('stage')
  const owner = url.searchParams.get('owner')
  const q = url.searchParams.get('q')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  // Срезы по признакам квалификации: «покажи всех с IIKO в Ташкенте»
  const pos = url.searchParams.get('pos')
  const city = url.searchParams.get('city')
  const segment = url.searchParams.get('segment')
  const tariff = url.searchParams.get('tariff')
  const load = url.searchParams.get('orders_per_day')
  const source = url.searchParams.get('source')

  if (stage) add('s.key = ?', stage)
  if (pos) add('d.pos = ?', pos)
  // У бренда точки бывают в нескольких городах, и город хранится списком
  // через запятую. Сравнение строки целиком такой бренд не находило вовсе
  if (city) add(
    "strpos(',' || replace(lower(COALESCE(NULLIF(d.city, ''), a.city, '')), ', ', ',') || ',', ?) > 0",
    `,${city.toLowerCase()},`)
  if (segment) add('d.segment = ?', segment)
  if (tariff) add('d.tariff ILIKE ?', `${tariff}%`)
  if (load) add('d.orders_per_day = ?', load)
  if (source) add('src.key = ?', source)
  if (owner) add('d.owner_agent_id = ?', owner)
  if (market) add('d.market_id = ?', market)
  if (q) {
    // Поиск идёт по двум колонкам одним текстом — поэтому два плейсхолдера
    params.push(`%${q}%`, `%${q}%`)
    conds.push(`(d.title ILIKE $${params.length - 1} OR a.name ILIKE $${params.length})`)
  }
  if (from) add('d.created_at >= ?::timestamptz', `${from}T00:00:00+05:00`)
  if (to) add('d.created_at <= ?::timestamptz', `${to}T23:59:59+05:00`)

  if (view === 'mine') add('d.owner_agent_id = ?', ctx.agentId)
  if (view === 'open') conds.push('d.won_at IS NULL AND d.lost_at IS NULL')
  if (view === 'attention') {
    // Ровно те признаки, по которым крон помечает сделку проблемной
    conds.push(`d.won_at IS NULL AND d.lost_at IS NULL AND (
      d.stalled_at IS NOT NULL
      OR d.next_step_at IS NULL
      OR (s.sla_hours IS NOT NULL AND d.stage_since < NOW() - (s.sla_hours * INTERVAL '1 hour'))
    )`)
  }
  if (view === 'reactivation') conds.push('d.reactivate_at IS NOT NULL AND d.reactivate_at <= NOW()')
  if (view === 'archive') conds.push('(d.won_at IS NOT NULL OR d.lost_at IS NOT NULL)')
  // Закрытые сделки: выигранные и проигранные смотрят отдельно и почти всегда
  // за период — «все 3400 проигранных» никому не нужны
  if (view === 'won') conds.push('d.won_at IS NOT NULL')
  if (view === 'lost') conds.push('d.lost_at IS NOT NULL')
  if (view === 'all') conds.push('d.won_at IS NULL AND d.lost_at IS NULL')

  const where = conds.join(' AND ')

  // Канбан берёт срез по каждому этапу, а не общий постраничный список.
  //
  // Общий LIMIT с сортировкой по времени входа на этап приводил к тому, что
  // только что перенесённая карточка исчезала с доски: у неё самый свежий
  // stage_since, значит она уезжала в конец списка и не попадала на страницу.
  const perStage = Math.min(50, parseInt(url.searchParams.get('perStage') || '0', 10))

  const SELECT_FIELDS = `d.id, d.title, d.monthly_amount, d.onetime_amount, d.currency, d.points,
            d.pos, d.orders_per_day, d.tariff, d.city AS deal_city,
            d.stage_since, d.stalled_at, d.next_step, d.next_step_at, d.expected_close_at,
            d.won_at, d.lost_at, d.created_at, d.updated_at, d.market_id,
            s.key AS stage_key, s.label AS stage, s.probability, s.sla_hours,
            a.name AS account, a.city,
            ag.name AS owner_name,
            src.label AS source,
            lr.label AS lost_reason, d.lost_comment,
            (SELECT MAX(doc.opened_count) FROM sales_documents doc WHERE doc.deal_id = d.id) AS doc_opens,
            (SELECT c.phone FROM sales_contacts c WHERE c.account_id = d.account_id
              ORDER BY c.is_primary DESC LIMIT 1) AS phone`

  const FROM_JOINS = `FROM sales_deals d
     LEFT JOIN sales_stages s ON s.id = d.stage_id
     LEFT JOIN sales_accounts a ON a.id = d.account_id
     LEFT JOIN support_agents ag ON ag.id = d.owner_agent_id
     LEFT JOIN sales_leads l ON l.id = d.source_lead_id
     LEFT JOIN sales_sources src ON src.id = l.source_id
     LEFT JOIN sales_lost_reasons lr ON lr.id = d.lost_reason_id`

  const rowsQ = perStage
    ? sql.query(
        `SELECT * FROM (
           SELECT ${SELECT_FIELDS},
                  ROW_NUMBER() OVER (PARTITION BY s.key
                    ORDER BY COALESCE(d.updated_at, d.stage_since, d.created_at) DESC) AS rn
           ${FROM_JOINS}
           WHERE ${where}
         ) t WHERE rn <= $${params.length + 1}`,
        [...params, perStage],
      )
    : sql.query(
        `SELECT ${SELECT_FIELDS}
         ${FROM_JOINS}
         WHERE ${where}
         ORDER BY COALESCE(d.updated_at, d.stage_since, d.created_at) DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit + 1, offset],
      )

  // Сводка по этапам для канбана — по всем открытым сделкам воронки,
  // независимо от фильтра вида, чтобы колонки не пустели при переключении.
  // Без выбранного региона колонки складываются по ключу этапа: воронки у
  // стран разные, но смысл этапов общий, иначе «Все регионы» показывали бы ноль
  // Счётчики колонок считаем по тем же условиям, что и карточки. Раньше они
  // жили своей жизнью: при фильтре «Сегодня» в колонке стояло «показано 0 из
  // 28» — карточки отфильтрованы, а число нет
  const fromTs = from ? `${from}T00:00:00+05:00` : null
  const toTs = to ? `${to}T23:59:59+05:00` : null
  const summaryQ = sql`
    SELECT s.key, MIN(s.label) AS label, MIN(s.sort_order) AS sort_order,
           MAX(s.probability) AS probability, MAX(s.sla_hours) AS sla_hours,
           MIN(s.description) AS description,
           COUNT(d.id)::int AS deals,
           COALESCE(SUM(d.monthly_amount), 0) AS amount
    FROM sales_stages s
    LEFT JOIN sales_deals d ON d.won_at IS NULL AND d.lost_at IS NULL AND d.archived_at IS NULL
      AND d.org_id = s.org_id AND d.stage_id = s.id
      AND (${market || ''} = '' OR d.market_id = ${market || ''})
      AND (${owner || ''} = '' OR d.owner_agent_id = ${owner || ''})
      AND (${pos || ''} = '' OR d.pos = ${pos || ''})
      AND (${city || ''} = '' OR strpos(
            ',' || replace(lower(COALESCE(NULLIF(d.city, ''), '')), ', ', ',') || ',',
            ${city ? `,${city.toLowerCase()},` : ''}) > 0)
      AND (${segment || ''} = '' OR d.segment = ${segment || ''})
      AND (${load || ''} = '' OR d.orders_per_day = ${load || ''})
      AND (${fromTs}::timestamptz IS NULL OR d.created_at >= ${fromTs}::timestamptz)
      AND (${toTs}::timestamptz IS NULL OR d.created_at <= ${toTs}::timestamptz)
    WHERE s.org_id = ${orgId} AND s.kind = 'open' AND s.is_active = true
      AND (${pipeline || ''} = '' OR s.pipeline = ${pipeline || ''})
      AND s.pipeline <> 'partner'
    GROUP BY s.key
    ORDER BY MIN(s.sort_order)
  `

  // Закрытые этапы держим отдельной сводкой: тащить на доску 3400 проигранных
  // сделок незачем, но бросить карточку в «Выиграна» или «Проиграна» нужно
  const closedQ = sql`
    SELECT s.key, MIN(s.label) AS label, MIN(s.kind) AS kind,
           COUNT(d.id) FILTER (WHERE COALESCE(d.won_at, d.lost_at) > NOW() - INTERVAL '30 days')::int AS deals,
           COALESCE(SUM(d.monthly_amount) FILTER (
             WHERE d.won_at > NOW() - INTERVAL '30 days'), 0) AS amount
    FROM sales_stages s
    LEFT JOIN sales_deals d ON d.org_id = s.org_id AND d.stage_id = s.id AND d.archived_at IS NULL
    WHERE s.org_id = ${orgId} AND s.kind IN ('won', 'lost') AND s.is_active = true
      AND (${pipeline || ''} = '' OR s.pipeline = ${pipeline || ''})
      AND s.pipeline <> 'partner'
      AND (${market || ''} = '' OR d.market_id IS NULL OR d.market_id = ${market || ''})
    GROUP BY s.key
    ORDER BY MIN(s.kind) DESC
  `

  const totalsQ = sql`
    SELECT COUNT(*)::int AS open_deals,
           COALESCE(SUM(monthly_amount), 0) AS pipeline_amount,
           COUNT(*) FILTER (WHERE stalled_at IS NOT NULL)::int AS stalled,
           COUNT(*) FILTER (WHERE next_step_at IS NULL)::int AS no_next_step
    FROM sales_deals
    WHERE org_id = ${orgId} AND pipeline <> 'partner' AND won_at IS NULL AND lost_at IS NULL
      AND archived_at IS NULL AND (${market || ''} = '' OR market_id = ${market || ''})
      AND (${owner || ''} = '' OR owner_agent_id = ${owner || ''})
      AND (${pos || ''} = '' OR pos = ${pos || ''})
      AND (${segment || ''} = '' OR segment = ${segment || ''})
      AND (${load || ''} = '' OR orders_per_day = ${load || ''})
      AND (${fromTs}::timestamptz IS NULL OR created_at >= ${fromTs}::timestamptz)
      AND (${toTs}::timestamptz IS NULL OR created_at <= ${toTs}::timestamptz)
  `

  const ownersQ = sql`
    SELECT DISTINCT ag.id, ag.name
    FROM sales_deals d JOIN support_agents ag ON ag.id = d.owner_agent_id
    WHERE d.org_id = ${orgId} AND d.pipeline <> 'partner'
    ORDER BY ag.name
  `

  // Все выборки экрана — ОДНОЙ пачкой. Стоимость здесь не в работе базы
  // (единицы миллисекунд на запрос), а в дороге до неё: функция и база стоят
  // на разных концах света, каждый заход ~190 мс. Пять заходов подряд — почти
  // секунда ожидания на ровном месте, пачка обходится в один
  const [rows, summary, closed, totalsRows, owners] =
    await sql.transaction([rowsQ, summaryQ, closedQ, totalsQ, ownersQ]) as any[]

  const hasMore = !perStage && rows.length > limit
  if (hasMore) rows.pop()

  return json({
    deals: rows, summary, closed, totals: (totalsRows as any[])[0] || {},
    owners, hasMore, offset, limit,
    // Чтобы подпись под колонками закрытия не врала про период
    closedWindow: from || to ? { from, to } : null,
  })
}
