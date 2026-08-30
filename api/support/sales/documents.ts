import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema, salesId } from '../lib/sales-schema.js'
import { contractValues, renderTemplate, missingRequisites } from '../lib/sales-requisites.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Документы сделки: КП, договор, оферта.
 *
 * GET    ?dealId=...            — список документов сделки
 * GET    ?id=...                — один документ со статистикой просмотров
 * POST   {dealId, kind}         — создать черновик (строки подтягиваются из сделки)
 * PUT    {id, lines?, requisites?, body?, validTill?, title?} — правка вручную
 * POST   ?action=publish {id}   — присвоить номер, выдать ссылку, статус «отправлен»
 * POST   ?action=version {id}   — новая версия документа (старая остаётся в истории)
 *
 * Номер внутренний и сквозной: клиенту он не обязателен, а учёту нужен ориентир.
 * Берётся атомарным UPDATE ... RETURNING, поэтому два менеджера одновременно
 * не получат один и тот же номер.
 */

const PREFIX: Record<string, string> = {
  quote: 'KP', contract: 'DG', offer: 'OF', act: 'AKT', partner_contract: 'P',
}

/**
 * Номер по формату шаблона: у Узбекистана это «108/26», у Казахстана сквозной
 * «181», у КП — свой префикс. Формат живёт в шаблоне, потому что он привязан
 * к юрлицу и стране, а не к нашему коду.
 */
async function nextNumber(sql: any, orgId: string, kind: string, format?: string | null): Promise<string> {
  const now = new Date()
  const year = now.getFullYear()
  const [row] = await sql`
    INSERT INTO sales_doc_counters (org_id, kind, year, last_seq)
    VALUES (${orgId}, ${kind}, ${year}, 1)
    ON CONFLICT (org_id, kind, year) DO UPDATE SET last_seq = sales_doc_counters.last_seq + 1
    RETURNING last_seq
  `
  const seq = row.last_seq
  if (format) {
    return format
      .replace('{seq}', String(seq))
      .replace('{seq4}', String(seq).padStart(4, '0'))
      .replace('{yyyy}', String(year))
      .replace('{yy}', String(year).slice(-2))
  }
  return `${PREFIX[kind] || 'DOC'}-${year}-${String(seq).padStart(4, '0')}`
}

/**
 * Сборка КП: строки из прайса плюс условия предложения.
 *
 * Три механики, которые нельзя свести к одной строке с ценой:
 *   1. Тариф включает N заказов в месяц, сверх пакета — доплата за заказ.
 *      В КП это условие, а не сумма: фактический объём станет известен
 *      только после запуска.
 *   2. Депозит — не платёж за период, а предоплата, которая расходуется
 *      помесячно в счёт подписки. В ежемесячную сумму не входит.
 *   3. Установка, интеграции и доработки оцениваются свободно. Такие строки
 *      сейлз добавляет вручную с собственной ценой и описанием объёма.
 */
function fmt(v: number, currency: string) {
  return `${Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${currency}`
}

async function buildLines(sql: any, orgId: string, deal: any) {
  const [ms] = await sql`
    SELECT currency FROM sales_market_settings
    WHERE org_id = ${orgId} AND market_id = ${deal.market_id || ''} LIMIT 1
  `
  const currency = ms?.currency || deal.currency || 'USD'
  const selected: Array<any> = Array.isArray(deal.items) ? deal.items : []
  const conditions: Array<{ kind: string; text: string }> = []

  if (!selected.length) {
    const lines: any[] = []
    if (deal.monthly_amount) {
      lines.push({
        title: `Подписка Delever${deal.tariff ? ` · ${deal.tariff}` : ''}`,
        qty: 1, unit: '/мес', recurring: 'monthly',
        price: Number(deal.monthly_amount), total: Number(deal.monthly_amount),
      })
    }
    if (deal.onetime_amount && Number(deal.onetime_amount) > 0) {
      lines.push({
        title: 'Единоразовые работы', qty: 1, unit: 'шт', recurring: 'one-time',
        price: Number(deal.onetime_amount), total: Number(deal.onetime_amount),
      })
    }
    return { lines, currency, conditions }
  }

  const rows = await sql`
    SELECT key, name, unit, unit_kind, category, recurring, prices, included_orders, extra_order_price
    FROM sales_price_items WHERE org_id = ${orgId} AND is_active = true
  `
  const byKey = new Map(rows.map((r: any) => [r.key, r]))

  const lines = selected.map(sel => {
    // Свободная позиция: установка, интеграция, доработка по оценке.
    // Цену и объём задаёт сейлз, каталог тут ни при чём.
    if (sel.custom || !byKey.has(sel.key)) {
      const price = Number(sel.price || 0)
      const qty = Number(sel.qty ?? 1)
      if (!sel.title) return null
      if (sel.scope) conditions.push({ kind: 'custom', text: `${sel.title}: ${sel.scope}` })
      return {
        key: sel.key || 'custom', title: sel.title, qty, unit: sel.unit || 'по оценке',
        unitKind: 'flat', recurring: sel.recurring || 'one-time', price, total: price * qty, custom: true,
      }
    }

    const item: any = byKey.get(sel.key)
    const price = Number(sel.price ?? item.prices?.[currency] ?? 0)
    // Количество по единице тарификации: «за точку» — число филиалов из
    // квалификации, «за сервис» и «за киоск» сейлз указывает сам
    const defaultQty = item.unit_kind === 'per_point' ? Number(deal.points || 1) : 1
    const qty = Number(sel.qty ?? defaultQty)

    // Условие по сверхлимитным заказам — из самого тарифа
    if (item.included_orders && item.extra_order_price?.[currency] != null) {
      conditions.push({
        kind: 'extra_orders',
        text: `${item.name}: включено ${item.included_orders.toLocaleString('ru-RU')} заказов в месяц. ` +
              `Заказы сверх пакета — ${fmt(item.extra_order_price[currency], currency)} за заказ.`,
      })
    }
    // Депозит: предоплата, а не платёж за период
    if (item.category === 'deposit') {
      conditions.push({
        kind: 'deposit',
        text: `${item.name}: вносится при подключении и расходуется помесячно в счёт оплаты. ` +
              `В ежемесячный платёж не входит.`,
      })
    }

    return {
      key: item.key,
      title: item.name + (item.included_orders ? ` · до ${item.included_orders.toLocaleString('ru-RU')} заказов/мес` : ''),
      qty, unit: item.unit || '', unitKind: item.unit_kind,
      recurring: item.recurring, category: item.category,
      price, total: price * qty,
    }
  }).filter(Boolean) as any[]

  return { lines, currency, conditions }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  // ─── Чтение ─────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const id = url.searchParams.get('id')
    if (id) {
      const [doc] = await sql`
        SELECT * FROM sales_documents WHERE id = ${id} AND org_id = ${orgId} LIMIT 1
      `
      if (!doc) return json({ error: 'not found' }, 404)
      const views = await sql`
        SELECT opened_at, seconds, viewer_hash FROM sales_document_views
        WHERE document_id = ${id} ORDER BY opened_at DESC LIMIT 50
      `
      // Разные читатели = документ переслали внутри компании клиента.
      // Это сильный сигнал: значит его смотрит кто-то ещё, кроме контакта.
      const readers = new Set(views.map((v: any) => v.viewer_hash)).size
      return json({ document: doc, views, readers })
    }

    const dealId = url.searchParams.get('dealId')
    if (!dealId) return json({ error: 'dealId or id is required' }, 400)
    const docs = await sql`
      SELECT id, kind, number, version, status, title, total, currency, valid_till,
             opened_count, read_seconds, first_opened_at, last_opened_at, sent_at, created_at,
             materials
      FROM sales_documents
      WHERE org_id = ${orgId} AND deal_id = ${dealId}
      ORDER BY created_at DESC
    `
    return json({ documents: docs })
  }

  if (req.method === 'PUT') {
    const body = await req.json().catch(() => null)
    if (!body?.id) return json({ error: 'id is required' }, 400)
    const [doc] = await sql`
      SELECT * FROM sales_documents WHERE id = ${body.id} AND org_id = ${orgId} LIMIT 1
    `
    if (!doc) return json({ error: 'not found' }, 404)

    const lines = body.lines ?? doc.lines
    const total = Array.isArray(lines)
      ? lines.reduce((a: number, l: any) => a + Number(l.total || 0), 0)
      : doc.total

    await sql`
      UPDATE sales_documents SET
        lines = ${JSON.stringify(lines)}::jsonb,
        requisites = ${JSON.stringify(body.requisites ?? doc.requisites)}::jsonb,
        conditions = ${JSON.stringify(body.conditions ?? doc.conditions)}::jsonb,
        body = COALESCE(${body.body ?? null}, body),
        title = COALESCE(${body.title ?? null}, title),
        valid_till = COALESCE(${body.validTill ?? null}, valid_till),
        -- Материалы к предложению: одна ссылка вместо россыпи вложений,
        -- и видно, дочитал ли клиент до презентации
        materials = ${body.materials !== undefined
          ? JSON.stringify(body.materials || [])
          : (doc.materials ? JSON.stringify(doc.materials) : null)}::jsonb,
        total = ${total},
        updated_at = NOW()
      WHERE id = ${body.id}
    `
    return json({ ok: true, total })
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const action = url.searchParams.get('action')
  const body = await req.json().catch(() => null)
  if (!body) return json({ error: 'invalid json' }, 400)

  // ─── Публикация: номер + ссылка + статус ────────────────────────────────────
  if (action === 'publish') {
    const [doc] = await sql`
      SELECT * FROM sales_documents WHERE id = ${body.id} AND org_id = ${orgId} LIMIT 1
    `
    if (!doc) return json({ error: 'not found' }, 404)

    const [tplFmt] = await sql`
      SELECT number_format FROM sales_doc_templates WHERE id = ${doc.template_id || ''} LIMIT 1
    `
    const number = doc.number || await nextNumber(sql, orgId, doc.kind, tplFmt?.number_format)
    // Токен — не идентификатор, а ключ доступа: угадываемый timestamp тут нельзя,
    // по ссылке видно цены и условия сделки
    const token = doc.share_token || crypto.randomUUID().replace(/-/g, '')
    await sql`
      UPDATE sales_documents
      SET number = ${number}, share_token = ${token}, status = 'sent',
          sent_at = COALESCE(sent_at, NOW()), updated_at = NOW()
      WHERE id = ${doc.id}
    `
    // Критерий выхода на «КП отправлено» требует файл КП — а он вот, только что
    // отправлен. Заставлять сейлза копировать ссылку в поле руками значит
    // получить этап, заблокированный на работе, которая уже сделана
    const link = `${url.origin}/d/${token}`
    if (doc.kind === 'quote' && doc.deal_id) {
      await sql`
        UPDATE sales_deals
        SET kp_file = ${link},
            valid_till = COALESCE(valid_till, ${doc.valid_till || null}),
            updated_at = NOW()
        WHERE id = ${doc.deal_id} AND org_id = ${orgId}
      `
    }

    return json({ ok: true, number, token, url: link })
  }

  // ─── Новая версия: старая остаётся в истории со своей статистикой ───────────
  if (action === 'version') {
    const [doc] = await sql`
      SELECT * FROM sales_documents WHERE id = ${body.id} AND org_id = ${orgId} LIMIT 1
    `
    if (!doc) return json({ error: 'not found' }, 404)
    const newId = salesId('sdoc')
    await sql`
      INSERT INTO sales_documents (id, org_id, deal_id, account_id, kind, number, version,
                                   parent_id, status, title, lines, requisites, body,
                                   total, currency, valid_till, template_id, created_by)
      VALUES (${newId}, ${orgId}, ${doc.deal_id}, ${doc.account_id}, ${doc.kind}, ${doc.number},
              ${doc.version + 1}, ${doc.parent_id || doc.id}, 'draft', ${doc.title},
              ${JSON.stringify(doc.lines)}::jsonb, ${JSON.stringify(doc.requisites)}::jsonb,
              ${doc.body}, ${doc.total}, ${doc.currency}, ${doc.valid_till},
              ${doc.template_id}, ${ctx.agentId})
    `
    await sql`UPDATE sales_documents SET status = 'superseded' WHERE id = ${doc.id}`
    return json({ ok: true, id: newId, version: doc.version + 1 })
  }

  // ─── Создание черновика из сделки ───────────────────────────────────────────
  const kind = String(body.kind || 'quote')
  if (!['quote', 'contract', 'offer', 'act', 'partner_contract'].includes(kind)) {
    return json({ error: 'unknown kind' }, 400)
  }
  if (!body.dealId) return json({ error: 'dealId is required' }, 400)

  const [deal] = await sql`
    SELECT * FROM sales_deals WHERE id = ${body.dealId} AND org_id = ${orgId} LIMIT 1
  `
  if (!deal) return json({ error: 'deal not found' }, 404)

  const [account] = await sql`
    SELECT name, inn, city, legal_name, legal_address, tax_code,
           bank_name, bank_code, bank_account, signer_name, signer_title, signer_basis
    FROM sales_accounts WHERE id = ${deal.account_id} LIMIT 1
  `

  // Шаблон выбирается по территории сделки: у Узбекистана и Казахстана разные
  // юрлица, реквизиты и нумерация. Нет шаблона под территорию — берём общий.
  let templateBody: string | null = null
  let templateId: string | null = null
  let docNumber: string | null = null
  // Чего не хватает в реквизитах — говорим сразу, а не после подписи
  let missing: Array<{ field: string; label: string }> = []
  if (kind !== 'quote') {
    const [tpl] = await sql`
      SELECT id, body FROM sales_doc_templates
      WHERE org_id = ${orgId} AND kind = ${kind} AND is_active = true
        AND (market_id = ${deal.market_id || ''} OR market_id IS NULL)
      ORDER BY (market_id = ${deal.market_id || ''}) DESC, is_default DESC
      LIMIT 1
    `
    templateBody = tpl?.body || null
    templateId = tpl?.id || null

    // Договор собираем сразу готовым. Раньше в базу ложился шаблон как есть,
    // и клиент по публичной ссылке видел «{{client_legal}}» вместо своего
    // юрлица — документ приходилось доделывать в Word, где номер, дата и
    // суммы неизбежно расходились со сделкой
    if (templateBody) {
      const [entity] = await sql`
        SELECT * FROM sales_legal_entities
        WHERE org_id = ${orgId} AND is_active = true
          AND (market_id = ${deal.market_id || ''} OR market_id IS NULL)
        ORDER BY (market_id = ${deal.market_id || ''}) DESC, is_default DESC
        LIMIT 1
      `
      const [tplFmt] = await sql`
        SELECT number_format FROM sales_doc_templates WHERE id = ${templateId || ''} LIMIT 1
      `
      docNumber = await nextNumber(sql, orgId, kind, tplFmt?.number_format)
      missing = missingRequisites(account)
      templateBody = renderTemplate(templateBody,
        contractValues({ deal, account, entity, number: docNumber }))
    }
  }

  const built = kind === 'quote'
    ? await buildLines(sql, orgId, deal)
    : { lines: [] as any[], currency: deal.currency || 'USD', conditions: [] as any[] }
  const lines = built.lines
  // Три суммы, а не одна: ежемесячный платёж, разовые работы и депозит — разные
  // деньги и разные сроки. В total кладём ежемесячный: на нём стоят прогноз,
  // средний чек и сверка с начислениями админки.
  const sum = (fn: (l: any) => boolean) =>
    lines.filter(fn).reduce((a: number, l: any) => a + Number(l.total || 0), 0)
  const monthlyTotal = sum((l: any) => l.category !== 'deposit' && l.recurring === 'monthly')
  const onetimeTotal = sum((l: any) => l.category !== 'deposit' && l.recurring === 'one-time')
  const depositTotal = sum((l: any) => l.category === 'deposit')
  const total = monthlyTotal
  const id = salesId('sdoc')

  // Материалы «по умолчанию» кладём сразу: общая презентация продукта нужна
  // почти всегда, и заставлять отмечать её каждый раз — способ забыть
  const defaults = kind === 'quote'
    ? (await sql`
        SELECT id FROM sales_materials
        WHERE org_id = ${orgId} AND is_active = true AND default_on = true
          AND (markets IS NULL OR ${deal.market_id || ''} = ANY(markets))
        ORDER BY sort_order
      ` as any[]).map(r => r.id)
    : []

  await sql`
    INSERT INTO sales_documents (id, org_id, deal_id, account_id, kind, status, title, number,
                                 lines, conditions, requisites, body, total, currency, valid_till,
                                 discount_pct, template_id, materials, created_by)
    VALUES (${id}, ${orgId}, ${deal.id}, ${deal.account_id}, ${kind}, 'draft',
            ${`${kind === 'quote' ? 'КП' : kind === 'offer' ? 'Оферта' : 'Договор'} — ${account?.name || deal.title || ''}`},
            ${docNumber},
            ${JSON.stringify(lines)}::jsonb, ${JSON.stringify(built.conditions)}::jsonb,
            -- Реквизиты фиксируем на момент создания: договор — снимок
            -- договорённости, а не окно в текущую карточку клиента
            ${JSON.stringify({
              legal_name: account?.legal_name || deal.legal_name,
              tax_code: account?.tax_code || account?.inn,
              legal_address: account?.legal_address,
              bank_name: account?.bank_name, bank_code: account?.bank_code,
              bank_account: account?.bank_account,
              signer_name: account?.signer_name, signer_title: account?.signer_title,
              signer_basis: account?.signer_basis, city: account?.city,
            })}::jsonb,
            ${templateBody}, ${total || deal.monthly_amount || null}, ${built.currency},
            ${deal.valid_till}, ${deal.discount_pct}, ${templateId},
            ${JSON.stringify(defaults)}::jsonb, ${ctx.agentId})
  `

  return json({
    ok: true, id, kind, lines, currency: built.currency, conditions: built.conditions,
    number: docNumber, missingRequisites: missing,
    totals: { monthly: monthlyTotal, onetime: onetimeTotal, deposit: depositTotal },
  })
}
