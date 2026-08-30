import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

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

  // ::date приходит объектом Date (или строкой — зависит от драйвера):
  // String(Date).slice(0,10) давала «Fri Aug 25» → Invalid Date → вся
  // активность улетала в «прошлый период» и экран показывал 0 при живых данных
  const dayKey = (d: any): string => {
    // Date берём по календарным компонентам: toISOString в не-UTC рантайме
    // сдвигал дату на день назад
    if (d instanceof Date) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    const m = String(d).match(/\d{4}-\d{2}-\d{2}/)
    return m ? m[0] : ''
  }
  const cutoff = new Date(Date.now() - days * 864e5)
  const merge = (rows: any[]) => {
    let cur = 0, prev = 0
    const byDay: Record<string, number> = {}
    for (const r of rows) {
      const key = dayKey(r.d)
      const t = new Date(key + 'T00:00:00Z')
      if (key && Number.isFinite(t.getTime()) && t >= cutoff) { cur += r.c; byDay[key] = (byDay[key] || 0) + r.c }
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

  // Активное время: кластеры событий (пауза <15 мин = одна сессия).
  // Для года не считаем — слишком много точек, и смысл там в тренде, не в часах
  let activeMinutesPerDay: number | null = null
  if (days <= 31) {
    const tq = (body: string, params: any[]) => sql.query(body, params)
    const [t1, t2, t3] = await sql.transaction([
      tq(`SELECT created_at AS ts FROM support_messages
          WHERE org_id = $1 AND is_from_client = false AND sender_name = $2
            AND created_at > ${since} ORDER BY created_at LIMIT 3000`, [orgId, me.name]),
      tq(`SELECT changed_at AS ts FROM onboarding_task_events
          WHERE org_id = $1 AND changed_by = $2 AND changed_at > ${since}
          ORDER BY changed_at LIMIT 2000`, [orgId, me.name]),
      tq(`SELECT changed_at AS ts FROM sales_deal_events
          WHERE org_id = $1 AND changed_by = $2 AND changed_at > ${since}
          ORDER BY changed_at LIMIT 2000`, [orgId, me.name]),
    ]) as any[]
    const stamps = [...(t1 as any[]), ...(t2 as any[]), ...(t3 as any[])]
      .map((r: any) => new Date(String(r.ts).includes('Z') || String(r.ts).includes('+') ? r.ts : r.ts + 'Z').getTime())
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
    let minutes = 0
    const GAP = 15 * 60_000
    const activeDays = new Set<string>()
    for (let i = 0; i < stamps.length; i++) {
      activeDays.add(new Date(stamps[i] + 5 * 3600_000).toISOString().slice(0, 10))
      minutes += i > 0 && stamps[i] - stamps[i - 1] < GAP
        ? (stamps[i] - stamps[i - 1]) / 60_000
        : 5 // одиночное событие = минимум 5 минут работы вокруг него
    }
    activeMinutesPerDay = activeDays.size ? Math.round(minutes / activeDays.size) : 0
  }

  return json({
    days,
    total,
    prevTotal,
    activeMinutesPerDay,
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
