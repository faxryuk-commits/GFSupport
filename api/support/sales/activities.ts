import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { ensureSalesSchema, salesId } from '../_lib/sales-schema.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * История касаний клиента: звонки, встречи, заметки.
 *
 * Таблица существовала и раньше, но писали в неё только вебхук Instagram и
 * голосовая заметка бота, а читать её было некому — ни одного экрана. Из-за
 * этого итог разговора записать было некуда, и половина работы менеджера
 * оставалась в голове или в Amo.
 *
 * GET    ?dealId= | ?accountId=
 * POST   { dealId?, accountId?, type, result?, text?, direction?, happenedAt? }
 * DELETE ?id=
 *
 * Записи типа 'message' создаёт переписка, 'approval' — решение по скидке:
 * они попадают в ту же ленту, чтобы разговор и решения читались вместе.
 */

const TYPES = ['call', 'meeting', 'note']

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  if (req.method === 'POST') {
    const body = await req.json().catch(() => null)
    const type = String(body?.type || '')
    if (!TYPES.includes(type)) return json({ error: 'unknown type' }, 400)
    if (!body?.dealId && !body?.accountId) {
      return json({ error: 'Запись должна быть к сделке или клиенту' }, 400)
    }
    const text = String(body?.text || '').trim()
    // У звонка и встречи содержательным может быть один только исход:
    // «не дозвонился» — это законченная запись, требовать текст незачем
    if (!text && !body?.result) return json({ error: 'Опишите, что было' }, 400)

    let accountId: string | null = body.accountId || null
    if (!accountId && body.dealId) {
      const [d] = await sql`
        SELECT account_id FROM sales_deals WHERE id = ${body.dealId} AND org_id = ${orgId} LIMIT 1
      `
      accountId = d?.account_id || null
    }

    const id = salesId('sa')
    await sql`
      INSERT INTO sales_activities (id, org_id, deal_id, account_id, type, direction,
                                    result, text, agent_id, happened_at)
      VALUES (${id}, ${orgId}, ${body.dealId || null}, ${accountId}, ${type},
              ${body.direction || 'out'}, ${body.result || null}, ${text || null},
              ${ctx.agentId}, ${body.happenedAt || new Date().toISOString()})
    `

    // Записали разговор — сделка перестаёт считаться брошенной без касаний
    if (body.dealId) {
      await sql`UPDATE sales_deals SET updated_at = NOW() WHERE id = ${body.dealId} AND org_id = ${orgId}`
    }
    return json({ ok: true, id })
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'id is required' }, 400)
    // Свои записи может убрать автор, чужие — только администратор: история
    // касаний тем и ценна, что её не переписывают задним числом
    const [row] = await sql`
      SELECT agent_id FROM sales_activities WHERE id = ${id} AND org_id = ${orgId} LIMIT 1
    `
    if (!row) return json({ error: 'not found' }, 404)
    if (row.agent_id !== ctx.agentId && !(ctx.isOrgAdmin || ctx.isGlobalAdmin)) {
      return json({ error: 'Удалить чужую запись может только администратор' }, 403)
    }
    await sql`DELETE FROM sales_activities WHERE id = ${id} AND org_id = ${orgId}`
    return json({ ok: true })
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const dealId = url.searchParams.get('dealId')
  const accountId = url.searchParams.get('accountId')
  if (!dealId && !accountId) return json({ activities: [] })

  // По клиенту показываем всё, по сделке — её записи плюс общие записи
  // клиента: разговор мог состояться до того, как завели сделку
  const activities = dealId
    ? await sql`
        SELECT ac.*, ag.name AS agent_name FROM sales_activities ac
        LEFT JOIN support_agents ag ON ag.id = ac.agent_id
        WHERE ac.org_id = ${orgId}
          AND (ac.deal_id = ${dealId}
               OR (ac.deal_id IS NULL AND ac.account_id = (
                     SELECT account_id FROM sales_deals WHERE id = ${dealId} AND org_id = ${orgId})))
        ORDER BY ac.happened_at DESC
        LIMIT 60
      `
    : await sql`
        SELECT ac.*, ag.name AS agent_name FROM sales_activities ac
        LEFT JOIN support_agents ag ON ag.id = ac.agent_id
        WHERE ac.org_id = ${orgId} AND ac.account_id = ${accountId}
        ORDER BY ac.happened_at DESC
        LIMIT 60
      `

  // Звонки из АТС живут в касаниях (sales_touchpoints) — их пишет синк
  // телефонии с дедупликацией по uuid звонка. Здесь подмешиваем их к журналу
  // на чтении: у каждой таблицы один писатель, а сейлз видит одну ленту —
  // и свои заметки, и реальные звонки из OnlinePBX
  const acc = accountId || (dealId ? await sql`
    SELECT account_id FROM sales_deals WHERE id = ${dealId} AND org_id = ${orgId} LIMIT 1
  `.then((r: any[]) => r[0]?.account_id || null) : null)

  let calls: any[] = []
  if (acc) {
    const tps = await sql`
      SELECT id, title, detail, happened_at FROM sales_touchpoints
      WHERE org_id = ${orgId} AND account_id = ${acc} AND kind = 'call'
      ORDER BY happened_at DESC LIMIT 40
    ` as any[]
    calls = tps.map((t: any) => ({
      id: `tp_${t.id}`,
      record_uuid: t.identity || null,
      type: 'call',
      direction: /входящ/i.test(t.title) ? 'in' : 'out',
      result: String(t.title).split('·')[1]?.trim() || null,
      text: t.detail,
      agent_id: null,
      agent_name: 'АТС',
      happened_at: t.happened_at,
      readonly: true,
    }))
  }

  const merged = [...(activities as any[]), ...calls]
    .sort((a, b) => new Date(b.happened_at).getTime() - new Date(a.happened_at).getTime())
    .slice(0, 60)

  return json({ activities: merged })
}
