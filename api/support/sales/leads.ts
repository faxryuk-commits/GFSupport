import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'
import { resolveRegion } from '../lib/sales-amo.js'
import { acceptLead } from '../lib/sales-intake.js'

export const config = { runtime: 'edge' }

/**
 * Лиды — входящие обращения из всех каналов.
 *
 * GET  ?view=inbox|queue|dupes|nurture&source=&q=
 * POST ?action=assign  {leadId, agentId?}  — взять себе или назначить
 * POST ?action=nurture {leadId}            — увести в nurture без участия человека
 *
 * POST ?action=qual    {leadId, fields}    — квалификация нашими руками
 *
 * Вид «dupes» показывает склейки: обращения, приклеенные к существующему
 * аккаунту. Это не мусор, а доказательство, что система не плодит карточки.
 */

/**
 * Поля квалификации, которые заполняет человек. Хранятся в своей колонке
 * поверх сырых данных заявки: читаем «сначала своё, потом из заявки», чтобы
 * уже заведённые карточки ничего не потеряли при уходе с Amo.
 */
export const QUAL_KEYS = ['pos', 'orders_per_day', 'points', 'aggregators',
  'delivery_type', 'segment', 'pain', 'dm_name', 'dm_role', 'budget_stated']

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  if (req.method === 'POST') {
    const action = url.searchParams.get('action')
    const body = await req.json().catch(() => null)

    // Лид с улицы: позвонили, встретили на выставке, привёл знакомый. Без этого
    // сейлз заводит такие обращения «в голове», и они не попадают в отчёты
    if (action === 'create') {
      if (!body?.name && !body?.phone) {
        return json({ error: 'нужно указать бренд или телефон' }, 400)
      }
      const res = await acceptLead(sql, orgId, {
        source: body.source || 'manual',
        name: body.name || null,
        phone: body.phone || null,
        city: body.city || null,
        market: body.market || (await resolveRegion(sql, orgId, url)) || null,
        text: body.text || null,
        pos: body.pos || null,
        orders_per_day: body.orders_per_day || null,
        points: body.points || null,
        owner_hint: ctx.agentId,
      })
      if (!res.ok) return json({ error: res.error }, 400)
      // Завёл сам — сам и ведёшь: иначе лид повиснет в общей очереди
      await sql`
        UPDATE sales_leads
        SET assigned_agent_id = ${ctx.agentId}, assigned_at = NOW(), status = 'assigned',
            sla_due_at = NOW() + INTERVAL '15 minutes'
        WHERE id = ${res.lead_id} AND org_id = ${orgId}
      `
      return json({ ok: true, lead_id: res.lead_id, account_id: res.account_id })
    }

    // Массовые действия: отмечать по одному и повторять двадцать раз — не работа
    if (action === 'bulk') {
      const ids: string[] = Array.isArray(body?.ids) ? body.ids : []
      if (!ids.length) return json({ error: 'нечего менять' }, 400)
      const op = String(body?.op || '')

      if (op === 'assign') {
        const target = body.agentId || ctx.agentId
        await sql`
          UPDATE sales_leads
          SET assigned_agent_id = ${target}, assigned_at = NOW(), status = 'assigned',
              sla_due_at = COALESCE(sla_due_at, NOW() + INTERVAL '15 minutes'), updated_at = NOW()
          WHERE id = ANY(${ids}) AND org_id = ${orgId}
        `
        return json({ ok: true, changed: ids.length })
      }
      if (op === 'nurture') {
        await sql`
          UPDATE sales_leads SET status = 'nurture', sla_due_at = NULL, updated_at = NOW()
          WHERE id = ANY(${ids}) AND org_id = ${orgId}
        `
        return json({ ok: true, changed: ids.length })
      }
      if (op === 'archive') {
        await sql`
          UPDATE sales_leads SET archived_at = NOW(), status = 'junk', updated_at = NOW()
          WHERE id = ANY(${ids}) AND org_id = ${orgId}
        `
        return json({ ok: true, changed: ids.length })
      }
      if (op === 'delete') {
        if (!ctx.isOrgAdmin && !ctx.isGlobalAdmin) return json({ error: 'только администратор' }, 403)
        // Лиды, из которых уже выросли сделки, не трогаем: удалить их значит
        // оторвать сделку от истории обращения
        const kept = await sql`
          SELECT DISTINCT source_lead_id FROM sales_deals
          WHERE org_id = ${orgId} AND source_lead_id = ANY(${ids})
        ` as any[]
        const protectedIds = kept.map(k => k.source_lead_id)
        const toDelete = ids.filter(id => !protectedIds.includes(id))
        if (toDelete.length) {
          await sql`DELETE FROM sales_leads WHERE id = ANY(${toDelete}) AND org_id = ${orgId}`
        }
        return json({ ok: true, deleted: toDelete.length, skipped: protectedIds.length })
      }
      return json({ error: 'unknown op' }, 400)
    }

    if (!body?.leadId) return json({ error: 'leadId is required' }, 400)

    // Передача лида другому сейлзу: у уходящего в отпуск остаются десятки
    if (action === 'reassign') {
      if (!body.agentId) return json({ error: 'нужен сотрудник' }, 400)
      await sql`
        UPDATE sales_leads
        SET assigned_agent_id = ${body.agentId}, assigned_at = NOW(),
            status = CASE WHEN status = 'new' THEN 'assigned' ELSE status END,
            updated_at = NOW()
        WHERE id = ${body.leadId} AND org_id = ${orgId}
      `
      return json({ ok: true })
    }

    if (action === 'archive') {
      // Причина отказа обязательна по смыслу, но не по форме: заставлять
      // выбирать её в разгар разбора очереди значит получить «Другое» на всём.
      // Спрашиваем, принимаем и без неё — но тогда честно видно, что не знаем
      // Тег «где потеряли» ставим из текущего состояния обращения: потом
      // его не восстановить, а без него потеря на первом касании
      // неотличима от потери после долгого прогрева
      await sql`
        UPDATE sales_leads
        SET archived_at = NOW(), status = 'junk',
            lost_stage = COALESCE(lost_stage, status),
            lost_reason_id = COALESCE(${body.reasonId || null}, lost_reason_id),
            lost_comment = COALESCE(${body.comment || null}, lost_comment),
            updated_at = NOW()
        WHERE id = ${body.leadId} AND org_id = ${orgId}
      `
      return json({ ok: true })
    }
    if (action === 'delete') {
      // Лид удаляем насовсем только если он ни во что не превратился
      if (!ctx.isOrgAdmin && !ctx.isGlobalAdmin) return json({ error: 'только администратор' }, 403)
      const [{ deals }] = await sql`
        SELECT COUNT(*)::int AS deals FROM sales_deals
        WHERE source_lead_id = ${body.leadId} AND org_id = ${orgId}
      ` as any[]
      if (deals > 0) {
        return json({ error: 'По лиду уже есть сделка — удалить нельзя, уберите в архив.' }, 409)
      }
      await sql`DELETE FROM sales_leads WHERE id = ${body.leadId} AND org_id = ${orgId}`
      return json({ ok: true, deleted: true })
    }
    if (action === 'restore') {
      await sql`
        UPDATE sales_leads SET archived_at = NULL, status = 'new', updated_at = NOW()
        WHERE id = ${body.leadId} AND org_id = ${orgId}
      `
      return json({ ok: true })
    }
    if (action === 'update') {
      const f = body.fields || {}
      await sql`
        UPDATE sales_leads SET
          name = COALESCE(${f.name ?? null}, name),
          phone = COALESCE(${f.phone ?? null}, phone),
          city = COALESCE(${f.city ?? null}, city),
          text = COALESCE(${f.text ?? null}, text),
          updated_at = NOW()
        WHERE id = ${body.leadId} AND org_id = ${orgId}
      `
      return json({ ok: true })
    }

    // Квалификация обращения. Эти поля менеджер заполнял в Amo, а мы читали их
    // из сырых данных заявки — без Amo они бы осиротели. Пишем в свой слой
    // поверх: пустая строка означает «здесь пусто», и это отличается от
    // «не заполняли» — иначе очистка поля возвращала бы старое значение Amo
    if (action === 'qual') {
      const f = body.fields || {}
      const patch: Record<string, string> = {}
      for (const k of QUAL_KEYS) {
        if (f[k] !== undefined) patch[k] = f[k] === null ? '' : String(f[k])
      }
      if (!Object.keys(patch).length) return json({ error: 'nothing to update' }, 400)

      // Город живёт своей колонкой — по ней идут фильтры и региональные срезы
      if (f.city !== undefined) {
        await sql`
          UPDATE sales_leads SET city = ${f.city || null}
          WHERE id = ${body.leadId} AND org_id = ${orgId}
        `
      }
      // Заполнил квалификацию — значит, с человеком уже говорили. Раньше
      // отметка первого касания стояла у двух обращений из тысячи, и норматив
      // 15 минут был написан, но не измерялся ничем
      await sql`
        UPDATE sales_leads SET
          qual = COALESCE(qual, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
          first_touch_at = COALESCE(first_touch_at, NOW()),
          updated_at = NOW()
        WHERE id = ${body.leadId} AND org_id = ${orgId}
      `
      return json({ ok: true })
    }

    if (action === 'assign') {
      const agentId = body.agentId || ctx.agentId
      await sql`
        UPDATE sales_leads
        SET assigned_agent_id = ${agentId}, assigned_at = NOW(), status = 'assigned',
            sla_due_at = COALESCE(sla_due_at, NOW() + INTERVAL '15 minutes'), updated_at = NOW()
        WHERE id = ${body.leadId} AND org_id = ${orgId}
      `
      return json({ ok: true })
    }
    if (action === 'nurture') {
      await sql`
        UPDATE sales_leads SET status = 'nurture', sla_due_at = NULL, updated_at = NOW()
        WHERE id = ${body.leadId} AND org_id = ${orgId}
      `
      return json({ ok: true })
    }
    return json({ error: 'unknown action' }, 400)
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const view = url.searchParams.get('view') || 'inbox'
  const source = url.searchParams.get('source')
  const q = url.searchParams.get('q') || ''
  const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10))

  const conds: string[] = ['l.org_id = $1']
  if (view !== 'archived') conds.push('l.archived_at IS NULL')
  else conds.push('l.archived_at IS NOT NULL')
  const params: any[] = [orgId]
  const add = (cond: string, value: any) => {
    params.push(value)
    conds.push(cond.replace('?', `$${params.length}`))
  }
  const market = await resolveRegion(sql, orgId, url)
  if (market) add('l.market_id = ?', market)
  // Период: даты приходят днями в рабочей зоне, поэтому и границы сдвинуты на +05
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if (from) add('l.created_at >= ?::timestamptz', `${from}T00:00:00+05:00`)
  if (to) add('l.created_at <= ?::timestamptz', `${to}T23:59:59+05:00`)
  if (source) add('s.key = ?', source)
  // Те же срезы, что и в сделках: касса, город, нагрузка — лид ищут по ним же
  const pos = url.searchParams.get('pos')
  const city = url.searchParams.get('city')
  const load = url.searchParams.get('orders_per_day')
  if (pos) add("COALESCE(l.qual->>'pos', l.raw->>'pos') = ?", pos)
  if (city) add('l.city = ?', city)
  if (load) add("COALESCE(l.qual->>'orders_per_day', l.raw->>'orders_per_day') = ?", load)
  const kind = url.searchParams.get('kind')
  if (kind) add('l.lead_kind = ?', kind)
  if (q) {
    params.push(`%${q}%`, `%${q}%`)
    conds.push(`(l.name ILIKE $${params.length - 1} OR l.phone ILIKE $${params.length})`)
  }
  if (view === 'inbox') conds.push(`l.created_at > NOW() - INTERVAL '7 days'`)
  if (view === 'queue') conds.push(`l.status = 'new'`)
  if (view === 'nurture') conds.push(`l.status = 'nurture'`)
  // Склейка: у лида есть аккаунт, созданный раньше самого лида
  if (view === 'dupes') conds.push('a.created_at < l.created_at - INTERVAL \'1 minute\'')

  const rowsQ = sql.query(
    `SELECT l.id, l.name, l.phone, l.city, l.icp_score, l.icp_reasons, l.status,
            l.sla_due_at, l.first_touch_at, l.created_at, l.updated_at, l.campaign, l.text,
            l.lead_kind, l.contact_name, l.raw, l.qual,
            NULLIF(COALESCE(l.qual->>'pos', l.raw->>'pos'), '') AS pos,
            NULLIF(COALESCE(l.qual->>'orders_per_day', l.raw->>'orders_per_day'), '') AS orders_per_day,
            NULLIF(COALESCE(l.qual->>'points', l.raw->>'points'), '') AS points,
            s.key AS source_key, s.label AS source,
            a.id AS account_id, a.name AS account_name, a.created_at AS account_created,
            ag.name AS agent_name
     FROM sales_leads l
     LEFT JOIN sales_sources s ON s.id = l.source_id
     LEFT JOIN sales_accounts a ON a.id = l.account_id
     LEFT JOIN support_agents ag ON ag.id = l.assigned_agent_id
     WHERE ${conds.join(' AND ')}
     ORDER BY l.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit + 1, offset],
  )

  const statsQ = sql`
    SELECT COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today,
           COUNT(*) FILTER (WHERE status = 'assigned' AND first_touch_at IS NULL)::int AS waiting,
           COUNT(*) FILTER (WHERE status = 'new')::int AS unassigned,
           COUNT(*) FILTER (WHERE status = 'nurture')::int AS nurture,
           COUNT(*) FILTER (WHERE first_touch_at IS NOT NULL
             AND first_touch_at <= created_at + INTERVAL '15 minutes')::int AS in_sla,
           COUNT(*) FILTER (WHERE first_touch_at IS NOT NULL)::int AS touched
    FROM sales_leads WHERE org_id = ${orgId} AND created_at > NOW() - INTERVAL '30 days'
      AND (${market} = '' OR market_id = ${market})
  `

  const sourcesQ = sql`
    SELECT s.key, s.label, COUNT(l.id)::int AS leads
    FROM sales_sources s
    LEFT JOIN sales_leads l ON l.source_id = s.id AND l.created_at > NOW() - INTERVAL '30 days'
      AND (${market} = '' OR l.market_id = ${market})
    WHERE s.org_id = ${orgId} AND s.is_active = true
    GROUP BY s.key, s.label ORDER BY leads DESC
  `

  // Сколько всего под текущим фильтром — без этого «Назад/Дальше» вслепую
  const totalQ = sql.query(
    `SELECT COUNT(*)::int AS total
     FROM sales_leads l
     LEFT JOIN sales_sources s ON s.id = l.source_id
     LEFT JOIN sales_accounts a ON a.id = l.account_id
     WHERE ${conds.join(' AND ')}`,
    params,
  )

  const agentsQ = sql`
    SELECT id, name FROM support_agents
    WHERE org_id = ${orgId} AND is_active = true AND (department = 'sales' OR role = 'admin')
    ORDER BY name
  `

  // Одной пачкой вместо пяти заходов: функция и база стоят на разных концах
  // света, каждый заход стоит ~190 мс дороги — именно из них и складывалось
  // ожидание, а не из работы базы
  const [rows, statsRows, sources, totalRows, agents] =
    await sql.transaction([rowsQ, statsQ, sourcesQ, totalQ, agentsQ]) as any[]

  // Берём на одну строку больше запрошенного: так узнаём, есть ли следующая
  // страница, без второго запроса на подсчёт
  const hasMore = rows.length > limit
  if (hasMore) rows.pop()

  // Поля заявки — то, что человек реально заполнил в форме. Они лежат в raw
  // по-разному: у Amo это custom_fields_values, у неразобранных — _unsorted_meta,
  // у формы сайта — плоский объект. Разбираем здесь, чтобы список показывал
  // суть заявки, а не одинаковые строки «Ташкент · сумма не указана»
  const SKIP = new Set(['id', 'name', '_links', '_embedded', 'created_at', 'updated_at',
    'pipeline_id', 'status_id', 'account_id', 'created_by', 'updated_by', 'is_deleted',
    'labor_cost', 'score', 'price', 'group_id', 'closest_task_at', 'responsible_user_id',
    'price_with_minor_units', 'custom_fields_values', '_unsorted_meta', 'loss_reason_id',
    'closed_at', 'raw', 'utm', 'visitorId', 'sessionId'])

  for (const row of rows) {
    const raw = row.raw || {}
    const details: Array<{ label: string; value: string }> = []

    for (const f of raw.custom_fields_values || []) {
      const v = f?.values?.[0]?.value
      const text = typeof v === 'object' && v ? v.name : v
      if (f?.field_name && text !== undefined && text !== null && String(text).trim()) {
        details.push({ label: String(f.field_name), value: String(text).slice(0, 80) })
      }
    }

    const meta = raw._unsorted_meta
    if (meta) {
      if (meta.form_name) details.push({ label: 'Форма', value: String(meta.form_name).slice(0, 80) })
      if (meta.client?.name) details.push({ label: 'Профиль', value: String(meta.client.name).slice(0, 80) })
      if (meta.form_page) details.push({ label: 'Страница', value: String(meta.form_page).slice(0, 80) })
    }

    // Форма сайта кладёт поля плоско: имя, компания, страна, точки, сообщение
    const LABELS: Record<string, string> = {
      company: 'Компания', firstName: 'Имя', lastName: 'Фамилия', email: 'Почта',
      country: 'Страна', locations: 'Точек', message: 'Сообщение', tag: 'Кнопка',
      source: 'Откуда узнал', language: 'Язык', formType: 'Форма', pos: 'POS',
      orders_per_day: 'Заказов в день', points: 'Точек',
    }
    for (const [k, v] of Object.entries(raw)) {
      if (SKIP.has(k) || v === null || v === undefined || typeof v === 'object') continue
      const text = String(v).trim()
      if (!text || text === 'null') continue
      details.push({ label: LABELS[k] || k, value: text.slice(0, 80) })
    }

    // Убираем повторы: у рекламной формы «Форма», «Страница» и название лида
    // часто одно и то же — «Facebook №2668813440199987» трижды подряд
    const seen = new Set<string>()
    const name = String(row.name || '').toLowerCase()
    row.details = details
      .filter(d => {
        const v = d.value.trim().toLowerCase()
        if (!v || v === name) return false
        if (seen.has(v)) return false
        seen.add(v)
        return true
      })
      .slice(0, 10)
    delete row.raw
  }

  return json({
    leads: rows, stats: (statsRows as any[])[0] || {}, sources,
    total: (totalRows as any[])[0]?.total ?? null,
    agents,
    view, hasMore, offset, limit, market,
  })
}
