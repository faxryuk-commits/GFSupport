import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'
import { NURTURE_STEPS, MAX_STEPS } from '../lib/sales-assistant.js'

export const config = { runtime: 'edge' }

/**
 * Что делает ассистент — открыто.
 *
 * GET  — журнал действий, кто сейчас на прогреве и на каком шаге.
 * POST ?action=pause|resume {leadId} — снять лид с прогрева или вернуть.
 *
 * Экран нужен не для красоты: автоматика, которая пишет клиентам, обязана
 * показывать, кому и что она написала. Иначе через неделю никто не сможет
 * ответить, почему клиент получил сообщение, и её просто выключат целиком.
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
    if (!body?.leadId) return json({ error: 'leadId is required' }, 400)

    if (action === 'pause') {
      await sql`
        UPDATE sales_leads SET nurture_paused_at = NOW(), nurture_next_at = NULL, updated_at = NOW()
        WHERE id = ${body.leadId} AND org_id = ${orgId}
      `
      return json({ ok: true })
    }
    if (action === 'resume') {
      await sql`
        UPDATE sales_leads
        SET nurture_paused_at = NULL, nurture_next_at = NOW(), status = 'nurture', updated_at = NOW()
        WHERE id = ${body.leadId} AND org_id = ${orgId}
      `
      return json({ ok: true })
    }
    return json({ error: 'unknown action' }, 400)
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const [log, queue, stats] = await Promise.all([
    sql`
      SELECT a.id, a.action, a.channel, a.step, a.message, a.reply, a.status, a.error,
             a.created_at, l.name AS lead_name, l.id AS lead_id
      FROM sales_assistant_log a
      LEFT JOIN sales_leads l ON l.id = a.lead_id
      WHERE a.org_id = ${orgId}
      ORDER BY a.created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT l.id, l.name, l.phone, l.city, l.nurture_step, l.nurture_next_at, l.nurture_paused_at,
             l.created_at, s.label AS source, a.channel_id
      FROM sales_leads l
      LEFT JOIN sales_sources s ON s.id = l.source_id
      LEFT JOIN sales_accounts a ON a.id = l.account_id
      WHERE l.org_id = ${orgId} AND l.status = 'nurture' AND l.archived_at IS NULL
      ORDER BY l.nurture_next_at NULLS FIRST
      LIMIT 50
    `,
    sql`
      SELECT COUNT(*) FILTER (WHERE action = 'nurture_sent')::int AS sent,
             COUNT(*) FILTER (WHERE action = 'nurture_draft')::int AS drafts,
             COUNT(*) FILTER (WHERE action = 'handover')::int AS handovers,
             COUNT(*) FILTER (WHERE status = 'error')::int AS errors
      FROM sales_assistant_log WHERE org_id = ${orgId}
        AND created_at > NOW() - INTERVAL '30 days'
    `,
  ])

  return json({
    log, queue,
    stats: (stats as any[])[0] || {},
    steps: NURTURE_STEPS, maxSteps: MAX_STEPS,
  })
}
