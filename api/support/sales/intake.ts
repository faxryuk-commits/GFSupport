import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { checkRateLimit } from '../lib/rate-limit.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'
import { acceptLead } from '../lib/sales-intake.js'

export const config = { runtime: 'edge' }

/**
 * Единый приёмник лидов по HTTP. Поставщики: мост AmoCRM, формы сайта, ручной
 * ввод из интерфейса. Каналы с диалогом (Instagram Direct и далее) заходят в то
 * же ядро через свои вебхуки — см. lib/sales-intake.ts.
 *
 * POST /api/support/sales/intake
 * { source, external_id?, name, phone, contact_name?, city?, market?, campaign?,
 *   form_id?, ad_id?, text?, orders_per_day?, points?, pos?, aggregators?,
 *   delivery_type?, raw? }
 *
 * Доступ: заголовок X-Intake-Secret (внешние поставщики) либо агентская
 * авторизация (ручной ввод).
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = checkRateLimit(`sales-intake:${ip}`, 120, 60_000)
  if (!rl.allowed) return json({ error: 'rate limited', retryAfterMs: rl.retryAfterMs }, 429)

  const secret = req.headers.get('X-Intake-Secret')
  const expected = process.env.SALES_INTAKE_SECRET || null
  let authorized = Boolean(expected && secret === expected)
  if (!authorized) {
    const ctx = await extractAgentContext(req)
    authorized = Boolean(ctx.agentId)
  }
  if (!authorized) return json({ error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => null)
  if (!body) return json({ error: 'invalid json' }, 400)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const result = await acceptLead(sql, orgId, body)
  if (!result.ok) return json({ error: result.error }, 400)
  return json(result)
}
