import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema, salesId } from '../lib/sales-schema.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Прайс-лист для конструктора КП.
 *
 * GET ?market=uz            — позиции с ценой в валюте территории
 * POST {key, name, ...}     — новая позиция прайса
 * PUT {key, prices, ...}    — правка цены, названия, единицы тарификации
 * DELETE ?key=...           — мягкое отключение (позиция могла попасть в КП)
 *
 * Прайс живёт в базе, а не в коде: пересмотр цен не требует деплоя.
 *
 * unit_kind — за что берём деньги, и от этого зависит количество в КП:
 *   flat        — за подключение целиком (тариф, модуль на бренд)
 *   per_point   — за точку/филиал
 *   per_service — за каждый подключённый сервис (агрегатор, курьерка)
 *   per_kiosk   — за устройство
 *   per_brand   — за бренд
 *
 * Валюта берётся из настроек территории: в Узбекистане сум, в Казахстане тенге,
 * в Грузии лари, в Эмиратах доллар. Цены заданы в каждой валюте отдельно и
 * курсом не пересчитываются — это разные ценовые решения, а не конвертация.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  if (req.method === 'GET') {
    const market = url.searchParams.get('market') || 'uz'
    const [settings] = await sql`
      SELECT currency, legal_entity FROM sales_market_settings
      WHERE org_id = ${orgId} AND market_id = ${market} LIMIT 1
    `
    const currency = settings?.currency || 'USD'

    const rows = await sql`
      SELECT key, name, description, category, unit, unit_kind, recurring, prices,
             included_orders, extra_order_price, sort_order
      FROM sales_price_items
      WHERE org_id = ${orgId} AND is_active = true
      ORDER BY sort_order
    `
    // Отдаём цену в валюте территории отдельным полем: конструктор КП не должен
    // сам решать, какую из четырёх цен показать
    const items = rows.map((r: any) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      category: r.category,
      unit: r.unit,
      unitKind: r.unit_kind,
      recurring: r.recurring,
      price: r.prices?.[currency] ?? null,
      includedOrders: r.included_orders,
      extraOrderPrice: r.extra_order_price?.[currency] ?? null,
      available: r.prices?.[currency] !== undefined && r.prices?.[currency] !== null,
    }))

    const markets = await sql`
      SELECT market_id, currency, legal_entity FROM sales_market_settings
      WHERE org_id = ${orgId} AND is_active = true ORDER BY market_id
    `
    return json({ market, currency, legalEntity: settings?.legal_entity || null, items, markets })
  }

  if (req.method === 'PUT') {
    if (!ctx.isOrgAdmin && !ctx.isGlobalAdmin) return json({ error: 'admin only' }, 403)
    const body = await req.json().catch(() => null)
    if (!body?.key) return json({ error: 'key is required' }, 400)

    const [item] = await sql`
      SELECT prices FROM sales_price_items WHERE org_id = ${orgId} AND key = ${body.key} LIMIT 1
    `
    if (!item) return json({ error: 'not found' }, 404)

    // Правим только переданные валюты: частичное обновление не должно затирать
    // цену в остальных регионах
    const prices = { ...(item.prices || {}), ...(body.prices || {}) }
    await sql`
      UPDATE sales_price_items SET
        prices = ${JSON.stringify(prices)}::jsonb,
        name = COALESCE(${body.name ?? null}, name),
        description = COALESCE(${body.description ?? null}, description),
        unit = COALESCE(${body.unit ?? null}, unit),
        unit_kind = COALESCE(${body.unitKind ?? null}, unit_kind),
        category = COALESCE(${body.category ?? null}, category),
        recurring = COALESCE(${body.recurring ?? null}, recurring),
        included_orders = COALESCE(${body.includedOrders ?? null}, included_orders),
        extra_order_price = COALESCE(${body.extraOrderPrice ? JSON.stringify(body.extraOrderPrice) : null}::jsonb, extra_order_price),
        is_active = COALESCE(${body.isActive ?? null}, is_active),
        updated_at = NOW()
      WHERE org_id = ${orgId} AND key = ${body.key}
    `
    return json({ ok: true, prices })
  }

  if (req.method === 'POST') {
    if (!ctx.isOrgAdmin && !ctx.isGlobalAdmin) return json({ error: 'admin only' }, 403)
    const body = await req.json().catch(() => null)
    if (!body?.key || !body?.name) return json({ error: 'key and name are required' }, 400)
    const [{ max }] = await sql`
      SELECT COALESCE(MAX(sort_order), -1)::int AS max FROM sales_price_items WHERE org_id = ${orgId}
    `
    await sql`
      INSERT INTO sales_price_items (id, org_id, key, name, description, category, unit, unit_kind,
                                     recurring, prices, included_orders, extra_order_price, sort_order)
      VALUES (${salesId('spi')}, ${orgId}, ${body.key}, ${body.name}, ${body.description || null},
              ${body.category || 'module'}, ${body.unit || null}, ${body.unitKind || 'flat'},
              ${body.recurring || 'monthly'}, ${JSON.stringify(body.prices || {})}::jsonb,
              ${body.includedOrders ?? null},
              ${body.extraOrderPrice ? JSON.stringify(body.extraOrderPrice) : null}::jsonb, ${max + 1})
      ON CONFLICT (org_id, key) DO NOTHING
    `
    return json({ ok: true, key: body.key })
  }

  if (req.method === 'DELETE') {
    if (!ctx.isOrgAdmin && !ctx.isGlobalAdmin) return json({ error: 'admin only' }, 403)
    const key = url.searchParams.get('key')
    if (!key) return json({ error: 'key is required' }, 400)
    // Мягко: позиция могла попасть в уже отправленные КП, история не должна рваться
    await sql`
      UPDATE sales_price_items SET is_active = false, updated_at = NOW()
      WHERE org_id = ${orgId} AND key = ${key}
    `
    return json({ ok: true, soft: true })
  }

  return json({ error: 'method not allowed' }, 405)
}
