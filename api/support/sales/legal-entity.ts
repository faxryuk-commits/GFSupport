import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { ensureSalesSchema, salesId } from '../_lib/sales-schema.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Наша сторона договора — юрлицо по стране.
 *
 * В настройках рынка лежало одно название («ООО DELEVER»), а договор просит
 * ещё адрес, налоговый номер, банк и подписанта. Юрлиц несколько, и подставлять
 * их руками в каждый договор значит однажды подписать узбекский договор
 * казахстанским юрлицом.
 *
 * GET             — список юрлиц с названием из настроек рынка
 * PUT {id?, market_id, ...поля} — создать или поправить
 */

const FIELDS = ['name', 'legal_name', 'legal_address', 'tax_code', 'bank_name',
  'bank_code', 'bank_account', 'signer_name', 'signer_title', 'signer_basis', 'requisites']

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  if (req.method === 'PUT') {
    const body = await req.json().catch(() => null)
    if (!body?.market_id) return json({ error: 'market_id is required' }, 400)

    const [existing] = await sql`
      SELECT id FROM sales_legal_entities
      WHERE org_id = ${orgId} AND market_id = ${body.market_id} LIMIT 1
    ` as any[]

    const id = existing?.id || salesId('sle')
    if (!existing) {
      await sql`
        INSERT INTO sales_legal_entities (id, org_id, market_id, name)
        VALUES (${id}, ${orgId}, ${body.market_id}, ${String(body.name || 'Наше юрлицо').slice(0, 255)})
      `
    }
    for (const f of FIELDS) {
      if (!(f in body)) continue
      const value = body[f] === '' ? null : String(body[f]).slice(0, 1000)
      await sql.query(
        `UPDATE sales_legal_entities SET ${f} = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
        [value, id, orgId],
      )
    }
    return json({ ok: true, id })
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const [entities, markets] = await sql.transaction([
    sql`SELECT * FROM sales_legal_entities WHERE org_id = ${orgId} ORDER BY market_id`,
    sql`SELECT market_id, currency, legal_entity FROM sales_market_settings
        WHERE org_id = ${orgId} ORDER BY market_id`,
  ]) as any[]

  const byMarket = new Map((entities as any[]).map(e => [e.market_id, e]))
  // Показываем строку на каждый рынок, даже незаполненную: пустая строка —
  // это видимая работа, а отсутствие строки читается как «здесь не нужно»
  const rows = (markets as any[]).map(m => byMarket.get(m.market_id) || {
    market_id: m.market_id, name: m.legal_entity || '', currency: m.currency, empty: true,
  })

  return json({ entities: rows })
}
