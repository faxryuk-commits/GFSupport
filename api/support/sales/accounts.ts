import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'
import { resolveRegion } from '../lib/sales-amo.js'

export const config = { runtime: 'edge' }

/**
 * Аккаунты — сквозной объект: клиент до продажи, во время внедрения и после.
 *
 * GET ?id=...        — карточка: сделки, документы, контакты, проект внедрения,
 *                      обращения в поддержку, партнёр, который его привёл
 * GET ?type=partner  — список (клиенты или партнёры)
 * PATCH {id, fields} — merchant_id, ИНН, канал, тип, программа партнёрства
 *
 * Ради этой карточки модуль и живёт внутри GFSupport: в отдельной CRM половина
 * блоков была бы недоступна.
 */
const EDITABLE = ['merchant_id', 'inn', 'channel_id', 'city', 'account_type',
  'partner_kind', 'partner_program_id', 'referred_by_account_id', 'notes', 'owner_agent_id']

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
    for (const [k, raw] of Object.entries(body.fields)) {
      if (!EDITABLE.includes(k)) continue
      const v: any = raw === '' ? null : raw
      switch (k) {
        case 'merchant_id': await sql`UPDATE sales_accounts SET merchant_id = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'inn': await sql`UPDATE sales_accounts SET inn = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'channel_id': await sql`UPDATE sales_accounts SET channel_id = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'city': await sql`UPDATE sales_accounts SET city = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'account_type': await sql`UPDATE sales_accounts SET account_type = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'partner_kind': await sql`UPDATE sales_accounts SET partner_kind = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'partner_program_id': await sql`UPDATE sales_accounts SET partner_program_id = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'referred_by_account_id': await sql`UPDATE sales_accounts SET referred_by_account_id = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'notes': await sql`UPDATE sales_accounts SET notes = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
        case 'owner_agent_id': await sql`UPDATE sales_accounts SET owner_agent_id = ${v} WHERE id = ${body.id} AND org_id = ${orgId}`; break
      }
    }
    return json({ ok: true })
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const id = url.searchParams.get('id')

  if (id) {
    const [account] = await sql`
      SELECT a.*, p.name AS program_name, p.model AS program_model, p.rate_pct,
             ref.name AS referrer_name, ag.name AS owner_name
      FROM sales_accounts a
      LEFT JOIN sales_partner_programs p ON p.id = a.partner_program_id
      LEFT JOIN sales_accounts ref ON ref.id = a.referred_by_account_id
      LEFT JOIN support_agents ag ON ag.id = a.owner_agent_id
      WHERE a.id = ${id} AND a.org_id = ${orgId} LIMIT 1
    `
    if (!account) return json({ error: 'not found' }, 404)

    const [deals, contacts, documents, leads, referred] = await Promise.all([
      sql`
        SELECT d.id, d.title, d.monthly_amount, d.currency, d.deal_type, d.won_at, d.lost_at,
               d.created_at, s.label AS stage, ag.name AS owner_name
        FROM sales_deals d
        LEFT JOIN sales_stages s ON s.id = d.stage_id
        LEFT JOIN support_agents ag ON ag.id = d.owner_agent_id
        WHERE d.account_id = ${id} ORDER BY d.created_at DESC LIMIT 20
      `,
      sql`SELECT name, role, phone, telegram, is_primary FROM sales_contacts
          WHERE account_id = ${id} ORDER BY is_primary DESC LIMIT 20`,
      sql`SELECT id, kind, number, status, total, currency, share_token, opened_count, created_at
          FROM sales_documents WHERE account_id = ${id} ORDER BY created_at DESC LIMIT 10`,
      sql`SELECT l.id, l.name, l.icp_score, l.status, l.created_at, s.label AS source
          FROM sales_leads l LEFT JOIN sales_sources s ON s.id = l.source_id
          WHERE l.account_id = ${id} ORDER BY l.created_at DESC LIMIT 10`,
      // Кого этот аккаунт привёл — для партнёров это главный отчёт
      sql`SELECT id, name, lifecycle, created_at FROM sales_accounts
          WHERE referred_by_account_id = ${id} ORDER BY created_at DESC LIMIT 20`,
    ])

    // Обращения в поддержку по тому же чату: связь есть только если канал привязан
    let tickets: any[] = []
    if (account.channel_id) {
      try {
        tickets = await sql`
          SELECT id, title, status, priority, created_at, resolved_at
          FROM support_cases WHERE channel_id = ${account.channel_id}
          ORDER BY created_at DESC LIMIT 10
        ` as any[]
      } catch {
        // модуль кейсов может быть недоступен — карточка аккаунта из-за этого не падает
        tickets = []
      }
    }

    return json({ account, deals, contacts, documents, leads, referred, tickets })
  }

  const type = url.searchParams.get('type') || 'client'
  const market = await resolveRegion(sql, orgId, url)
  const q = url.searchParams.get('q') || ''
  const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10))
  const rows = await sql`
    SELECT a.id, a.name, a.city, a.lifecycle, a.account_type, a.partner_kind,
           a.merchant_id, a.first_order_at, a.created_at,
           p.name AS program_name,
           (SELECT COUNT(*) FROM sales_deals d WHERE d.account_id = a.id)::int AS deals,
           (SELECT COALESCE(SUM(d.monthly_amount), 0) FROM sales_deals d
              WHERE d.account_id = a.id AND d.won_at IS NOT NULL) AS won_amount,
           (SELECT COUNT(*) FROM sales_accounts r WHERE r.referred_by_account_id = a.id)::int AS referred
    FROM sales_accounts a
    LEFT JOIN sales_partner_programs p ON p.id = a.partner_program_id
    WHERE a.org_id = ${orgId} AND a.account_type = ${type} AND a.archived_at IS NULL
      AND (${market} = '' OR a.market_id = ${market})
      AND (${q} = '' OR a.name ILIKE ${'%' + q + '%'})
    ORDER BY a.created_at DESC LIMIT ${limit + 1} OFFSET ${offset}
  `
  const hasMore = rows.length > limit
  if (hasMore) rows.pop()
  return json({ accounts: rows, type, hasMore, offset, limit, market })
}
