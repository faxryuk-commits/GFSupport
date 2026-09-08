import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * WhatsApp продаж: у каждого сейлза свой номер и своя сессия.
 *
 * Поддержка работает через GreenAPI и этого сервиса не касается — там один
 * рабочий номер на всю команду и свой вебхук. Здесь наоборот: сейлз
 * сканирует QR своим телефоном и пишет клиентам от себя, а переписка
 * попадает в карточку сделки.
 *
 * GET  ?action=status        мой QR/подключение и лимит
 * GET  ?action=team          у кого подключено (руководителю)
 * POST { action:'login' }    показать QR
 * POST { action:'logout' }   отключить
 * POST { action:'send', phone, text, dealId? }
 */

const BRIDGE = process.env.WA_SALES_URL
const SECRET = process.env.WA_SALES_SECRET

async function bridge(path: string, init?: RequestInit) {
  if (!BRIDGE || !SECRET) throw new Error('Сервис WhatsApp для продаж не настроен')
  const res = await fetch(`${BRIDGE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}`, ...(init?.headers || {}) },
    signal: AbortSignal.timeout(25000),
  })
  const body = await res.json().catch(() => ({})) as any
  if (!res.ok) throw new Error(body?.error || `сервис ответил ${res.status}`)
  return body
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const action = url.searchParams.get('action') || 'status'

    if (action === 'status') {
      try {
        return json(await bridge(`/login/status?agentId=${encodeURIComponent(ctx.agentId)}`))
      } catch (e: any) {
        return json({ connected: false, bridgeError: e?.message || 'сервис недоступен' })
      }
    }

    if (action === 'team') {
      if (!ctx.isLead) return json({ error: 'forbidden' }, 403)
      const agents = await sql`
        SELECT id, name FROM support_agents
        WHERE org_id = ${orgId} AND is_active = true AND merged_into IS NULL
          AND (department IN ('sales', 'sale')
               OR role IN ('cco', 'sales', 'sale', 'kam', 'sdr', 'sales_lead', 'admin', 'org_admin'))
        ORDER BY name
      `
      let accounts: any[] = []
      try { accounts = (await bridge('/health')).accounts || [] } catch { /* сервис молчит */ }
      const byId = new Map(accounts.map((a: any) => [a.agent_id, a]))
      return json({
        team: (agents as any[]).map(a => {
          const acc: any = byId.get(a.id)
          return {
            agentId: a.id, name: a.name,
            connected: !!acc?.ready,
            state: acc?.state || 'off',
            phone: acc?.phone || null,
            lastError: acc?.last_error || null,
          }
        }),
      })
    }

    return json({ error: 'unknown action' }, 400)
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')
    try {
      if (action === 'login') {
        return json(await bridge('/login/start', {
          method: 'POST', body: JSON.stringify({ agentId: ctx.agentId }),
        }))
      }
      if (action === 'logout') {
        await bridge('/logout', { method: 'POST', body: JSON.stringify({ agentId: ctx.agentId }) })
        return json({ ok: true })
      }
      if (action === 'send') {
        const phone = String(body.phone || '')
        const text = String(body.text || '').trim()
        if (!phone || !text) return json({ error: 'нужны номер и текст' }, 400)

        // С теми, кто уже отвечал, лимит тратить незачем
        const digits = phone.replace(/\D/g, '').slice(-9)
        const [seen] = await sql`
          SELECT 1 AS x FROM sales_activities
          WHERE org_id = ${orgId} AND type = 'message' AND direction = 'in'
            AND text LIKE ${'%' + digits + '%'} LIMIT 1
        `
        const r = await bridge('/send', {
          method: 'POST',
          body: JSON.stringify({ agentId: ctx.agentId, phone, text, firstTouch: !seen }),
        })
        if (body.dealId) {
          await sql`
            INSERT INTO sales_activities (id, org_id, deal_id, type, direction, text, agent_id, happened_at)
            VALUES (${'sa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)},
                    ${orgId}, ${String(body.dealId)}, 'message', 'out',
                    ${'WhatsApp: ' + text}, ${ctx.agentId}, NOW())
          `.catch(() => {})
        }
        return json({ ok: true, used: r.used, limit: r.limit })
      }
      return json({ error: 'unknown action' }, 400)
    } catch (e: any) {
      return json({ error: e?.message || 'не получилось' }, 400)
    }
  }

  return json({ error: 'method not allowed' }, 405)
}
