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
 * Вид «dupes» показывает склейки: обращения, приклеенные к существующему
 * аккаунту. Это не мусор, а доказательство, что система не плодит карточки.
 */
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

    if (!body?.leadId) return json({ error: 'leadId is required' }, 400)

    if (action === 'archive') {
      await sql`
        UPDATE sales_leads SET archived_at = NOW(), status = 'junk'
        WHERE id = ${body.leadId} AND org_id = ${orgId}
      `
      return json({ ok: true })
    }
    if (action === 'restore') {
      await sql`
        UPDATE sales_leads SET archived_at = NULL, status = 'new'
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
          text = COALESCE(${f.text ?? null}, text)
        WHERE id = ${body.leadId} AND org_id = ${orgId}
      `
      return json({ ok: true })
    }

    if (action === 'assign') {
      const agentId = body.agentId || ctx.agentId
      await sql`
        UPDATE sales_leads
        SET assigned_agent_id = ${agentId}, assigned_at = NOW(), status = 'assigned',
            sla_due_at = COALESCE(sla_due_at, NOW() + INTERVAL '15 minutes')
        WHERE id = ${body.leadId} AND org_id = ${orgId}
      `
      return json({ ok: true })
    }
    if (action === 'nurture') {
      await sql`
        UPDATE sales_leads SET status = 'nurture', sla_due_at = NULL
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
  if (source) add('s.key = ?', source)
  if (q) {
    params.push(`%${q}%`, `%${q}%`)
    conds.push(`(l.name ILIKE $${params.length - 1} OR l.phone ILIKE $${params.length})`)
  }
  if (view === 'inbox') conds.push(`l.created_at > NOW() - INTERVAL '7 days'`)
  if (view === 'queue') conds.push(`l.status = 'new'`)
  if (view === 'nurture') conds.push(`l.status = 'nurture'`)
  // Склейка: у лида есть аккаунт, созданный раньше самого лида
  if (view === 'dupes') conds.push('a.created_at < l.created_at - INTERVAL \'1 minute\'')

  const rows = await sql.query(
    `SELECT l.id, l.name, l.phone, l.city, l.icp_score, l.icp_reasons, l.status,
            l.sla_due_at, l.first_touch_at, l.created_at, l.campaign, l.text,
            l.raw->>'pos' AS pos, l.raw->>'orders_per_day' AS orders_per_day,
            (l.raw->>'points')::text AS points,
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
  ) as any[]

  // Берём на одну строку больше запрошенного: так узнаём, есть ли следующая
  // страница, без второго запроса на подсчёт
  const hasMore = rows.length > limit
  if (hasMore) rows.pop()

  const [stats] = await sql`
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

  const sources = await sql`
    SELECT s.key, s.label, COUNT(l.id)::int AS leads
    FROM sales_sources s
    LEFT JOIN sales_leads l ON l.source_id = s.id AND l.created_at > NOW() - INTERVAL '30 days'
      AND (${market} = '' OR l.market_id = ${market})
    WHERE s.org_id = ${orgId} AND s.is_active = true
    GROUP BY s.key, s.label ORDER BY leads DESC
  `

  return json({ leads: rows, stats: stats || {}, sources, view, hasMore, offset, limit, market })
}
