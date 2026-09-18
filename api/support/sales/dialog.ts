import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { ensureSalesSchema } from '../_lib/sales-schema.js'
import { ensureDialogSchema, promoteDialog } from '../_lib/sales-qualifier.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Диалог продаж как предмет: что агент выяснил, стал ли он обращением,
 * и ручные действия сейлза над ним.
 *
 * GET  ?channelId=…            — состояние: факты, кто пишет, обращение/сделка
 * POST ?action=to-lead         — сделать обращение сейчас, с накопленными фактами
 * POST ?action=not-client      — отметить «не клиент»: агент замолкает,
 *                                обращение из диалога не родится
 *
 * Сделка из диалога — это обращение плюс обычный перевод на доску
 * (funnel?action=convert) с проверкой обязательных полей: второй дороги
 * с другими правилами быть не должно.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  await ensureSalesSchema(sql, orgId)
  await ensureDialogSchema(sql)

  const load = async (channelId: string) => {
    const [ch] = await sql`
      SELECT c.id, c.name, c.source, c.external_chat_id, c.meta_page_id, c.market_id,
             st.facts, st.who, st.lead_id, st.draft, st.draft_at
      FROM support_channels c
      LEFT JOIN sales_dialog_state st ON st.channel_id = c.id
      WHERE c.id = ${channelId} AND c.org_id = ${orgId} LIMIT 1
    ` as any[]
    if (!ch) return null
    // Обращение могло родиться и до появления состояния диалога — ищем
    // по внешнему id собеседника, как делает приёмник
    const sourceKey = ch.source === 'instagram' ? 'instagram_direct'
      : ch.source === 'messenger' ? 'messenger' : ch.source
    const [lead] = ch.lead_id
      ? await sql`SELECT id, name, status, phone, assigned_agent_id FROM sales_leads WHERE id = ${ch.lead_id} LIMIT 1` as any[]
      : await sql`
          SELECT l.id, l.name, l.status, l.phone, l.assigned_agent_id FROM sales_leads l
          JOIN sales_sources s ON s.id = l.source_id
          WHERE l.org_id = ${orgId} AND s.key = ${sourceKey} AND l.external_id = ${String(ch.external_chat_id || '')}
            AND l.archived_at IS NULL
          ORDER BY l.created_at DESC LIMIT 1
        ` as any[]
    const [deal] = lead ? await sql`
      SELECT d.id, d.title, s.label AS stage FROM sales_deals d
      LEFT JOIN sales_stages s ON s.id = d.stage_id
      WHERE d.source_lead_id = ${lead.id} AND d.archived_at IS NULL
      ORDER BY d.created_at DESC LIMIT 1
    ` as any[] : [null]
    return { channel: ch, lead: lead || null, deal: deal || null }
  }

  if (req.method === 'GET') {
    const channelId = String(url.searchParams.get('channelId') || '')
    if (!channelId) return json({ error: 'channelId is required' }, 400)
    const d = await load(channelId)
    if (!d) return json({ error: 'диалог не найден' }, 404)
    return json({
      channelId: d.channel.id,
      source: d.channel.source,
      facts: d.channel.facts || {},
      who: d.channel.who || null,
      draft: d.channel.draft || null,
      draftAt: d.channel.draft_at || null,
      lead: d.lead ? { id: d.lead.id, name: d.lead.name, status: d.lead.status, phone: d.lead.phone } : null,
      deal: d.deal,
    })
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const body = await req.json().catch(() => null)
  const channelId = String(body?.channelId || '')
  if (!channelId) return json({ error: 'channelId is required' }, 400)
  const d = await load(channelId)
  if (!d) return json({ error: 'диалог не найден' }, 404)
  const action = url.searchParams.get('action')

  if (action === 'to-lead') {
    if (d.lead) return json({ ok: true, leadId: d.lead.id, existed: true })
    if (!['instagram', 'messenger'].includes(String(d.channel.source))) {
      return json({ error: 'из этого канала обращение заводится иначе' }, 400)
    }
    const [last] = await sql`
      SELECT text_content FROM support_messages
      WHERE channel_id = ${channelId} AND org_id = ${orgId} AND is_from_client = true
      ORDER BY created_at DESC LIMIT 1
    ` as any[]
    await sql`
      INSERT INTO sales_dialog_state (channel_id, org_id) VALUES (${channelId}, ${orgId})
      ON CONFLICT (channel_id) DO NOTHING
    `
    const facts = { ...(d.channel.facts || {}), ...(body.facts && typeof body.facts === 'object' ? body.facts : {}) }
    const leadId = await promoteDialog(sql, orgId, { channel_id: channelId }, d.channel,
      { name: d.channel.name, contact_name: d.channel.name }, facts, 'manual',
      String(last?.text_content || ''))
    if (!leadId) return json({ error: 'не удалось завести обращение' }, 500)
    // Кто нажал — тот и ведёт: сейлз сделал это руками, значит берёт
    await sql`
      UPDATE sales_leads SET assigned_agent_id = COALESCE(assigned_agent_id, ${ctx.agentId}),
             assigned_at = COALESCE(assigned_at, NOW()), status = CASE WHEN status = 'new' THEN 'assigned' ELSE status END
      WHERE id = ${leadId} AND org_id = ${orgId}
    `
    return json({ ok: true, leadId })
  }

  if (action === 'not-client') {
    const who = ['personal', 'spam', 'existing_client', 'job_seeker', 'partner'].includes(String(body.who))
      ? String(body.who) : 'personal'
    await sql`
      INSERT INTO sales_dialog_state (channel_id, org_id, who) VALUES (${channelId}, ${orgId}, ${who})
      ON CONFLICT (channel_id) DO UPDATE SET who = EXCLUDED.who, updated_at = NOW()
    `
    return json({ ok: true, who })
  }

  // Вернуть в работу: сейлз решил, что агент ошибся с «не клиент»
  if (action === 'reopen') {
    await sql`
      UPDATE sales_dialog_state SET who = NULL, updated_at = NOW() WHERE channel_id = ${channelId}
    `
    return json({ ok: true })
  }

  // Черновик использован (вставлен в поле) или отклонён — убираем
  if (action === 'draft-done') {
    await sql`
      UPDATE sales_dialog_state SET draft = NULL, draft_at = NULL, updated_at = NOW() WHERE channel_id = ${channelId}
    `
    return json({ ok: true })
  }

  return json({ error: 'unknown action' }, 400)
}
