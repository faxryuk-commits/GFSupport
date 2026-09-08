import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Личный Telegram сейлза: подключение, состояние, отправка клиенту.
 *
 * Аккаунт подключает сам сотрудник — клиенту пишет живой человек, а не
 * «уведомление компании», и лимиты Telegram не копятся на одном номере.
 * Пароль и код никуда не сохраняются: они уходят в мост и живут там ровно
 * до конца входа. Мост в CRM отдаёт только переписку с известными клиентами.
 *
 * GET  ?action=status                 моё состояние и лимит
 * GET  ?action=team                   у кого подключено (руководителю)
 * GET  ?action=app                    ключи приложения заданы? (руководителю)
 * POST { action:'app', apiId, apiHash }        сохранить ключи приложения
 * POST { action:'login', phone }      запросить код
 * POST { action:'code', code }        подтвердить
 * POST { action:'password', password} облачный пароль, если включён
 * POST { action:'logout' }            отключить
 * POST { action:'send', phone, text, dealId? }  написать клиенту
 */

const BRIDGE = process.env.TELEGRAM_BRIDGE_URL
const SECRET = process.env.TELEGRAM_BRIDGE_SECRET

async function bridge(path: string, init?: RequestInit) {
  if (!BRIDGE || !SECRET) throw new Error('Telegram-мост не настроен')
  const res = await fetch(`${BRIDGE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}`, ...(init?.headers || {}) },
    signal: AbortSignal.timeout(20000),
  })
  const body = await res.json().catch(() => ({})) as any
  if (!res.ok) throw new Error(body?.error || `мост ответил ${res.status}`)
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
        const health = await bridge('/health')
        const mine = (health.accounts || []).find((a: any) => a.agent_id === ctx.agentId)
        if (!mine) return json({ connected: false })
        const q = await bridge(`/quota?agentId=${encodeURIComponent(ctx.agentId)}`)
        return json({
          connected: true, phone: mine.phone, username: mine.username,
          connectedAt: mine.connected_at, pausedUntil: mine.paused_until,
          lastError: mine.last_error, used: q.used, limit: q.limit,
        })
      } catch (e: any) {
        return json({ connected: false, bridgeError: e?.message || 'мост недоступен' })
      }
    }

    if (action === 'app') {
      if (!ctx.isLead) return json({ error: 'forbidden' }, 403)
      const rows = await sql`
        SELECT key, value FROM support_settings
        WHERE org_id = ${orgId} AND key IN ('telegram_api_id', 'telegram_api_hash')
      `
      const map: Record<string, string> = {}
      for (const r of rows as any[]) {
        try { map[r.key] = JSON.parse(r.value) } catch { map[r.key] = r.value }
      }
      let bridgeOk = false
      let hasKeys = false
      try {
        const h = await bridge('/health')
        bridgeOk = !!h.ok
        hasKeys = !!h.hasKeys
      } catch { /* мост молчит — так и скажем */ }
      return json({
        apiId: map.telegram_api_id || '',
        apiHashMasked: map.telegram_api_hash
          ? `${map.telegram_api_hash.slice(0, 4)}…${map.telegram_api_hash.slice(-4)}` : '',
        bridgeOk, hasKeys,
      })
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
      try { accounts = (await bridge('/health')).accounts || [] } catch { /* мост молчит — покажем как «не подключено» */ }
      const byId = new Map(accounts.map((a: any) => [a.agent_id, a]))
      return json({
        team: (agents as any[]).map(a => {
          const acc: any = byId.get(a.id)
          return {
            agentId: a.id, name: a.name,
            connected: !!acc, username: acc?.username || null,
            phone: acc?.phone || null, pausedUntil: acc?.paused_until || null,
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
        const phone = String(body.phone || '').trim()
        if (phone.replace(/\D/g, '').length < 9) return json({ error: 'нужен номер телефона' }, 400)
        await bridge('/login/start', { method: 'POST', body: JSON.stringify({ agentId: ctx.agentId, phone }) })
        return json({ ok: true, sent: true })
      }

      if (action === 'code') {
        const r = await bridge('/login/code', {
          method: 'POST', body: JSON.stringify({ agentId: ctx.agentId, code: String(body.code || '') }),
        })
        return json(r)
      }

      if (action === 'password') {
        const r = await bridge('/login/password', {
          method: 'POST', body: JSON.stringify({ agentId: ctx.agentId, password: String(body.password || '') }),
        })
        return json(r)
      }

      if (action === 'app') {
        if (!ctx.isLead) return json({ error: 'Ключи приложения задаёт руководитель' }, 403)
        const apiId = String(body.apiId || '').replace(/\D/g, '')
        const apiHash = String(body.apiHash || '').trim()
        if (!apiId || apiHash.length < 16) {
          return json({ error: 'нужны api_id и api_hash с my.telegram.org' }, 400)
        }
        for (const [k, v] of [['telegram_api_id', apiId], ['telegram_api_hash', apiHash]]) {
          await sql`
            INSERT INTO support_settings (org_id, key, value, updated_at)
            VALUES (${orgId}, ${k}, ${v}, NOW())
            ON CONFLICT (org_id, key) DO UPDATE SET value = ${v}, updated_at = NOW()
          `
        }
        return json({ ok: true })
      }

      if (action === 'logout') {
        await bridge('/logout', { method: 'POST', body: JSON.stringify({ agentId: ctx.agentId }) })
        return json({ ok: true })
      }

      if (action === 'send') {
        const phone = String(body.phone || '')
        const text = String(body.text || '').trim()
        if (!phone || !text) return json({ error: 'нужны номер и текст' }, 400)

        // Первое касание считаем по своей базе: с теми, кто уже отвечал,
        // Telegram не ограничивает — и лимит на них тратить незачем
        const digits = phone.replace(/\D/g, '').slice(-9)
        const [seen] = await sql`
          SELECT 1 AS x FROM sales_activities a
          WHERE a.org_id = ${orgId} AND a.type = 'message' AND a.direction = 'in'
            AND a.text LIKE ${'%' + digits + '%'} LIMIT 1
        `
        const r = await bridge('/send', {
          method: 'POST',
          body: JSON.stringify({ agentId: ctx.agentId, phone, text, firstTouch: !seen }),
        })

        // След в карточке — ради этого всё и делалось
        if (body.dealId) {
          await sql`
            INSERT INTO sales_activities (id, org_id, deal_id, type, direction, text, agent_id, happened_at)
            VALUES (${'sa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)},
                    ${orgId}, ${String(body.dealId)}, 'message', 'out',
                    ${'Telegram: ' + text}, ${ctx.agentId}, NOW())
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
