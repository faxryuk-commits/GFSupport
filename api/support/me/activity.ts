import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'

export const config = { runtime: 'edge' }

/**
 * Моя активность — этап 1 «Моё 2.0».
 *
 * Реальные данные из журналов, никаких новых датчиков: мои сообщения
 * клиентам, шаги онбординга, решённые тикеты, подтверждённые задачи,
 * события сделок. По дням + разрез по модулям + сравнение с прошлым
 * таким же периодом.
 *
 * GET ?days=7 (1|7|30|365) → { perDay, split, total, prevTotal }
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const days = Math.min(365, Math.max(1, parseInt(new URL(req.url).searchParams.get('days') || '7', 10)))

  const [me] = await sql`SELECT id, name FROM support_agents WHERE id = ${ctx.agentId} LIMIT 1` as any[]
  if (!me) return json({ error: 'agent not found' }, 404)

  // Наивные UTC-колонки: день считаем по Ташкенту
  const D = `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent'`
  const since = `NOW() - INTERVAL '${days} days'`
  const prevSince = `NOW() - INTERVAL '${days * 2} days'`

  // ровно те параметры, что в плейсхолдерах: часть журналов пишет имя, часть — id
  const byName = (body: string) => sql.query(body, [orgId, me.name])
  const byId = (body: string) => sql.query(body, [orgId, me.id])
  const [msgs, onb, cases, work, deals] = await sql.transaction([
    byName(`SELECT (created_at ${D})::date AS d, COUNT(*)::int c FROM support_messages
       WHERE org_id = $1 AND is_from_client = false AND sender_name = $2
         AND created_at > ${prevSince} GROUP BY 1`),
    byName(`SELECT (changed_at AT TIME ZONE 'Asia/Tashkent')::date AS d, COUNT(*)::int c FROM onboarding_task_events
       WHERE org_id = $1 AND changed_by = $2 AND changed_at > ${prevSince} GROUP BY 1`),
    byId(`SELECT (resolved_at ${D})::date AS d, COUNT(*)::int c FROM support_cases
       WHERE org_id = $1 AND assigned_to = $2 AND resolved_at > ${prevSince} GROUP BY 1`),
    byId(`SELECT (confirmed_at ${D})::date AS d, COUNT(*)::int c FROM work_items
       WHERE org_id = $1 AND owner_agent_id = $2 AND confirmed_at > ${prevSince} GROUP BY 1`),
    byName(`SELECT (changed_at ${D})::date AS d, COUNT(*)::int c FROM sales_deal_events
       WHERE org_id = $1 AND changed_by = $2 AND changed_at > ${prevSince} GROUP BY 1`),
  ]) as any[]

  const cutoff = new Date(Date.now() - days * 864e5)
  const merge = (rows: any[]) => {
    let cur = 0, prev = 0
    const byDay: Record<string, number> = {}
    for (const r of rows) {
      const key = String(r.d).slice(0, 10)
      if (new Date(key) >= cutoff) { cur += r.c; byDay[key] = (byDay[key] || 0) + r.c }
      else prev += r.c
    }
    return { cur, prev, byDay }
  }
  const parts = {
    messages: merge(msgs as any[]),
    onboarding: merge(onb as any[]),
    cases: merge(cases as any[]),
    tasks: merge(work as any[]),
    sales: merge(deals as any[]),
  }

  // Дни периода (Ташкент), нули включительно — бары не должны прыгать
  const perDay: { date: string; c: number }[] = []
  const tashNow = new Date(Date.now() + 5 * 3600_000)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(tashNow.getUTCFullYear(), tashNow.getUTCMonth(), tashNow.getUTCDate()) - i * 864e5)
    const key = d.toISOString().slice(0, 10)
    perDay.push({
      date: key,
      c: Object.values(parts).reduce((s, p) => s + (p.byDay[key] || 0), 0),
    })
  }

  const total = Object.values(parts).reduce((s, p) => s + p.cur, 0)
  const prevTotal = Object.values(parts).reduce((s, p) => s + p.prev, 0)

  return json({
    days,
    total,
    prevTotal,
    perDay,
    split: {
      messages: parts.messages.cur,
      onboarding: parts.onboarding.cur,
      cases: parts.cases.cur,
      tasks: parts.tasks.cur,
      sales: parts.sales.cur,
    },
  })
}
