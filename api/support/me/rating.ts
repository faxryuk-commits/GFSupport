import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'

export const config = { runtime: 'edge' }

/**
 * Рейтинг и ачивки — этапы 3–4 «Моё 2.0».
 *
 * Перцентили по команде за период из тех же журналов, что активность:
 * никакой субъективщины — только записанные действия. Ачивки — жёсткие
 * пороги на тех же метриках: получил/не получил видно из данных.
 *
 * GET ?days=7 → { rank, of, metrics[], achievements[] }
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const days = Math.min(365, Math.max(1, parseInt(new URL(req.url).searchParams.get('days') || '7', 10)))
  const since = `NOW() - INTERVAL '${days} days'`

  const q = (body: string) => sql.query(body, [orgId])
  const [agents, msgs, onbDone, casesRes, workConf, myCommit, myStuck] = await sql.transaction([
    q(`SELECT id, name FROM support_agents WHERE org_id = $1 AND is_active = true`),
    q(`SELECT sender_name AS k, COUNT(*)::int c FROM support_messages
       WHERE org_id = $1 AND is_from_client = false AND created_at > ${since}
       GROUP BY 1`),
    q(`SELECT e.changed_by AS k, COUNT(*)::int c FROM onboarding_task_events e
       JOIN onboarding_statuses s ON s.id = e.new_status_id AND s.kind = 'done'
       WHERE e.org_id = $1 AND e.changed_at > ${since} AND e.changed_by IS NOT NULL
       GROUP BY 1`),
    q(`SELECT assigned_to AS k, COUNT(*)::int c FROM support_cases
       WHERE org_id = $1 AND resolved_at > ${since} AND assigned_to IS NOT NULL GROUP BY 1`),
    q(`SELECT owner_agent_id AS k, COUNT(*)::int c FROM work_items
       WHERE org_id = $1 AND confirmed_at > ${since} AND owner_agent_id IS NOT NULL GROUP BY 1`),
    sql.query(`SELECT
        COUNT(*) FILTER (WHERE status = 'overdue')::int AS overdue,
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > ${since})::int AS kept
      FROM support_commitments WHERE org_id = $1 AND agent_id = $2`, [orgId, ctx.agentId]),
    sql.query(`SELECT COUNT(*)::int AS stuck FROM onboarding_tasks t
      JOIN onboarding_statuses s ON s.id = t.status_id AND s.kind = 'waiting'
      WHERE t.org_id = $1 AND t.assignee_id = $2 AND t.status_since < NOW() - INTERVAL '7 days'`,
      [orgId, ctx.agentId]),
  ]) as any[]

  const nameOf: Record<string, string> = {}
  const idOf: Record<string, string> = {}
  for (const a of agents as any[]) { nameOf[a.id] = a.name; idOf[a.name] = a.id }
  const me = { id: ctx.agentId, name: nameOf[ctx.agentId] || '' }

  // Свод по сотруднику: имя-ключи мапим на id через справочник
  const totals: Record<string, { msgs: number; onb: number; cases: number; tasks: number }> = {}
  const bump = (id: string | null, key: 'msgs' | 'onb' | 'cases' | 'tasks', c: number) => {
    if (!id || !nameOf[id]) return
    totals[id] = totals[id] || { msgs: 0, onb: 0, cases: 0, tasks: 0 }
    totals[id][key] += c
  }
  for (const r of msgs as any[]) bump(idOf[r.k] || null, 'msgs', r.c)
  for (const r of onbDone as any[]) bump(idOf[r.k] || null, 'onb', r.c)
  for (const r of casesRes as any[]) bump(r.k, 'cases', r.c)
  for (const r of workConf as any[]) bump(r.k, 'tasks', r.c)

  const rows = Object.entries(totals).map(([id, t]) => ({
    id, name: nameOf[id],
    total: t.msgs + t.onb * 2 + t.cases * 3 + t.tasks * 2, // вес: тикет тяжелее реплики
    ...t,
  })).sort((a, b) => b.total - a.total)

  const my = rows.find(r => r.id === me.id) || { id: me.id, name: me.name, total: 0, msgs: 0, onb: 0, cases: 0, tasks: 0 }
  const rank = rows.findIndex(r => r.id === me.id) + 1 || rows.length + 1
  const pct = (key: 'msgs' | 'onb' | 'cases' | 'tasks') => {
    const vals = rows.map(r => r[key])
    if (!vals.length) return 0
    const below = vals.filter(v => v <= (my as any)[key]).length
    return Math.round((below / vals.length) * 100)
  }

  const commit = (myCommit as any[])[0] || { overdue: 0, kept: 0 }
  const stuck = Number((myStuck as any[])[0]?.stuck || 0)

  const achievements = [
    { icon: '⚡', label: `${days === 1 ? '10' : '30'}+ ответов клиентам`, earned: my.msgs >= (days === 1 ? 10 : 30) },
    { icon: '🔥', label: 'Ни одного просроченного обещания', earned: Number(commit.overdue) === 0 && Number(commit.kept) > 0 },
    { icon: '🚀', label: 'Закрыт шаг запуска', earned: my.onb >= 1 },
    { icon: '🎯', label: '3+ решённых тикета', earned: my.cases >= 3 },
    { icon: '🧹', label: 'Ноль зависших дольше недели', earned: stuck === 0 },
    { icon: '🏆', label: 'Топ-3 команды за период', earned: rank > 0 && rank <= 3 && my.total > 0 },
  ]

  return json({
    rank, of: rows.length,
    leader: rows[0] ? { name: rows[0].name, total: rows[0].total } : null,
    metrics: [
      { key: 'msgs', label: 'Ответы клиентам', value: my.msgs, pct: pct('msgs') },
      { key: 'onb', label: 'Закрытые шаги', value: my.onb, pct: pct('onb') },
      { key: 'cases', label: 'Решённые тикеты', value: my.cases, pct: pct('cases') },
      { key: 'tasks', label: 'Подтверждённые задачи', value: my.tasks, pct: pct('tasks') },
    ],
    achievements,
  })
}
