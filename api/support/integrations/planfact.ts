import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { getPlanfactKey, pfSummary, pfIncomeOperations } from '../_lib/planfact.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Интеграция с ПланФактом: ключ, проверка связи, поступления.
 *
 * Ключ даёт доступ ко всем деньгам компании, поэтому сохранять и снимать его
 * могут только руководители; смотреть сводку — любой сотрудник с доступом
 * к настройкам.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const url = new URL(req.url)

  if (req.method === 'GET') {
    const action = url.searchParams.get('action') || 'status'
    const key = await getPlanfactKey(sql, orgId)

    if (action === 'status') {
      return json({
        connected: !!key,
        masked: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : '',
      })
    }

    if (action === 'income') {
      if (!key) return json({ error: 'ПланФакт не подключён' }, 400)
      const from = url.searchParams.get('from') || ''
      const to = url.searchParams.get('to') || ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return json({ error: 'нужны from и to в формате YYYY-MM-DD' }, 400)
      }
      const limit = Math.min(500, Number(url.searchParams.get('limit')) || 100)
      const offset = Number(url.searchParams.get('offset')) || 0
      const r = await pfIncomeOperations(key, from, to, limit, offset)
      if (!r.ok) return json({ error: r.error }, 502)
      return json(r.data)
    }

    return json({ error: 'unknown action' }, 400)
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')

    if (action === 'save') {
      if (!ctx.isLead) return json({ error: 'Сохранять ключ может только руководитель' }, 403)
      const apiKey = String(body.apiKey || '').trim()

      if (apiKey) {
        // Не храним ключ, который не работает: проверяем до записи
        const today = new Date().toISOString().slice(0, 10)
        const probe = await pfSummary(apiKey, today, today)
        if (!probe.ok) return json({ error: probe.error }, 400)
      }

      await sql`
        INSERT INTO support_settings (org_id, key, value, updated_at)
        VALUES (${orgId}, 'planfact_api_key', ${apiKey}, NOW())
        ON CONFLICT (org_id, key) DO UPDATE SET value = ${apiKey}, updated_at = NOW()
      `
      return json({ ok: true, connected: !!apiKey })
    }

    if (action === 'test') {
      const key = await getPlanfactKey(sql, orgId)
      if (!key) return json({ error: 'Ключ не сохранён' }, 400)

      const now = new Date()
      const monthStart = `${now.toISOString().slice(0, 8)}01`
      const today = now.toISOString().slice(0, 10)

      const [summary, recent] = await Promise.all([
        pfSummary(key, monthStart, today),
        pfIncomeOperations(key, monthStart, today, 5, 0),
      ])
      if (!summary.ok) return json({ error: summary.error }, 502)

      return json({
        ok: true,
        period: { from: monthStart, to: today },
        income: { count: summary.data?.incomeCount ?? 0, amount: summary.data?.incomeAmount ?? 0 },
        outcome: { count: summary.data?.outcomeCount ?? 0, amount: summary.data?.outcomeAmount ?? 0 },
        recentIncome: recent.ok ? recent.data?.items || [] : [],
        totalIncomeOps: recent.ok ? recent.data?.total || 0 : 0,
      })
    }

    return json({ error: 'unknown action' }, 400)
  }

  return json({ error: 'method not allowed' }, 405)
}
