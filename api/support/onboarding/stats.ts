import { getRequestOrgId } from '../_lib/org.js'
import { extractAgentContext } from '../_lib/auth.js'
import { getSQL, json } from '../_lib/db.js'
import { ensureOnboardingSchema } from '../_lib/onboarding-schema.js'

export const config = {
  runtime: 'edge', regions: ['fra1'],
}

/**
 * Аналитика онбординга.
 *
 * GET → {
 *   stages:    по шагам чек-листа — среднее/максимум времени, готово/застряло
 *   people:    по сотрудникам — активность в журнале, закрытые шаги, назначено сейчас
 *   brands:    по брендам — длительность онбординга, прогресс
 *   stuck:     топ застрявших задач (сигналы)
 * }
 *
 * Время «в работе»/«ожидание» — из журнала событий (kind active/waiting).
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  // Доска подключений — это список клиентов, кто их ведёт и что о них написано
  // в комментариях. Ручка отдавала всё это без токена любому, кто знает адрес
  // (найдено 22.08.2026)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  await ensureOnboardingSchema(sql, orgId)

  // Регион из шапки раздела: '' = все, бренды без региона видны всегда
  const market = (new URL(req.url).searchParams.get('market') || '').trim()

  try {
    // Интервалы по kind из журнала (закрытые интервалы + текущий открытый до NOW)
    const stages = await sql`
      WITH ev AS (
        SELECT e.brand_id, e.task_type_id, e.option_id, e.new_status_id, e.changed_at,
               LEAD(e.changed_at) OVER (PARTITION BY e.brand_id, e.task_type_id, COALESCE(e.option_id, '') ORDER BY e.changed_at) AS next_at
        FROM onboarding_task_events e
        JOIN onboarding_brands b ON b.id = e.brand_id
        WHERE e.org_id = ${orgId} AND b.archived_at IS NULL
          AND (${market} = '' OR b.market_id IS NULL OR b.market_id = ${market})
      ),
      per_task AS (
        SELECT ev.task_type_id, ev.brand_id, COALESCE(ev.option_id, '') AS option_key, s.kind,
               SUM(EXTRACT(EPOCH FROM (COALESCE(ev.next_at, NOW()) - ev.changed_at))) AS seconds
        FROM ev
        JOIN onboarding_statuses s ON s.id = ev.new_status_id
        WHERE s.kind IN ('active', 'waiting')
        GROUP BY ev.task_type_id, ev.brand_id, COALESCE(ev.option_id, ''), s.kind
      )
      SELECT tt.id, tt.label, pt.kind,
             COUNT(*)::int AS tasks,
             ROUND(AVG(pt.seconds))::bigint AS avg_seconds,
             ROUND(MAX(pt.seconds))::bigint AS max_seconds
      FROM per_task pt
      JOIN onboarding_task_types tt ON tt.id = pt.task_type_id
      GROUP BY tt.id, tt.label, pt.kind
      ORDER BY tt.sort_order
    `

    const stageStatus = await sql`
      SELECT tt.id, tt.label,
             COUNT(*) FILTER (WHERE s.kind = 'done')::int AS done,
             COUNT(*) FILTER (WHERE s.kind = 'active')::int AS active,
             COUNT(*) FILTER (WHERE s.kind = 'waiting')::int AS waiting,
             COUNT(*) FILTER (WHERE s.kind = 'todo')::int AS todo
      FROM onboarding_tasks t
      JOIN onboarding_brands b ON b.id = t.brand_id
      JOIN onboarding_task_types tt ON tt.id = t.task_type_id
      LEFT JOIN onboarding_statuses s ON s.id = t.status_id
      WHERE t.org_id = ${orgId} AND b.archived_at IS NULL
          AND (${market} = '' OR b.market_id IS NULL OR b.market_id = ${market})
      GROUP BY tt.id, tt.label, tt.sort_order
      ORDER BY tt.sort_order
    `

    // По сотрудникам: события в журнале + переводы в done + текущие назначения.
    // Рейтинг скорости: среднее время закрытия этапа = интервал от предыдущего
    // события той же задачи до перевода в done (кто перевёл — тому и время).
    const people = await sql`
      WITH seq AS (
        SELECT e.changed_by, e.changed_at, s.kind AS new_kind,
               LAG(e.changed_at) OVER (
                 PARTITION BY e.brand_id, e.task_type_id, COALESCE(e.option_id, '')
                 ORDER BY e.changed_at
               ) AS prev_at
        FROM onboarding_task_events e
        JOIN onboarding_brands b ON b.id = e.brand_id
        LEFT JOIN onboarding_statuses s ON s.id = e.new_status_id
        WHERE e.org_id = ${orgId}
          AND (${market} = '' OR b.market_id IS NULL OR b.market_id = ${market})
      )
      SELECT changed_by AS name,
             COUNT(*)::int AS events,
             COUNT(*) FILTER (WHERE new_kind = 'done')::int AS completed,
             ROUND(AVG(EXTRACT(EPOCH FROM (changed_at - prev_at)))
               FILTER (WHERE new_kind = 'done' AND prev_at IS NOT NULL))::bigint AS avg_close_seconds,
             MAX(changed_at) AS last_activity
      FROM seq
      WHERE changed_by IS NOT NULL AND changed_by NOT LIKE 'импорт%'
      GROUP BY changed_by
      ORDER BY completed DESC, avg_close_seconds ASC NULLS LAST
    `
    const assigned = await sql`
      SELECT COALESCE(t.assignee_name, b.assignee_name) AS name, COUNT(*)::int AS open_tasks
      FROM onboarding_tasks t
      JOIN onboarding_brands b ON b.id = t.brand_id
      LEFT JOIN onboarding_statuses s ON s.id = t.status_id
      WHERE t.org_id = ${orgId} AND b.archived_at IS NULL
        AND (${market} = '' OR b.market_id IS NULL OR b.market_id = ${market})
        AND s.kind IN ('active', 'waiting', 'todo')
        AND COALESCE(t.assignee_name, b.assignee_name) IS NOT NULL
      GROUP BY COALESCE(t.assignee_name, b.assignee_name)
    `

    // По брендам: возраст онбординга, прогресс
    const brands = await sql`
      SELECT b.id, b.name, b.assignee_name, b.started_at, b.blockers,
             EXTRACT(EPOCH FROM (NOW() - b.started_at))::bigint AS age_seconds,
             COUNT(*) FILTER (WHERE s.kind = 'done')::int AS done,
             COUNT(*) FILTER (WHERE s.kind NOT IN ('na', 'cancelled'))::int AS total
      FROM onboarding_brands b
      LEFT JOIN onboarding_tasks t ON t.brand_id = b.id
      LEFT JOIN onboarding_statuses s ON s.id = t.status_id
      WHERE b.org_id = ${orgId} AND b.archived_at IS NULL
          AND (${market} = '' OR b.market_id IS NULL OR b.market_id = ${market})
      GROUP BY b.id, b.name, b.assignee_name, b.started_at, b.blockers
      ORDER BY b.started_at
    `

    // Сигналы: задачи, дольше всего висящие в active/waiting прямо сейчас
    const stuck = await sql`
      SELECT b.name AS brand_name, tt.label AS task_label, op.label AS option_label,
             s.label AS status_label, s.kind,
             COALESCE(t.assignee_name, b.assignee_name) AS assignee_name,
             EXTRACT(EPOCH FROM (NOW() - t.status_since))::bigint AS seconds
      FROM onboarding_tasks t
      JOIN onboarding_brands b ON b.id = t.brand_id
      JOIN onboarding_task_types tt ON tt.id = t.task_type_id
      JOIN onboarding_statuses s ON s.id = t.status_id
      LEFT JOIN onboarding_options op ON op.id = t.option_id
      WHERE t.org_id = ${orgId} AND b.archived_at IS NULL AND s.kind IN ('active', 'waiting')
          AND (${market} = '' OR b.market_id IS NULL OR b.market_id = ${market})
      ORDER BY seconds DESC
      LIMIT 15
    `

    const assignedMap: Record<string, number> = Object.fromEntries(
      assigned.map((a: any) => [a.name, a.open_tasks]),
    )

    const stagesById: Record<string, any> = {}
    for (const s of stageStatus) {
      stagesById[s.id] = {
        id: s.id, label: s.label,
        done: s.done, active: s.active, waiting: s.waiting, todo: s.todo,
        avgActiveSeconds: 0, maxActiveSeconds: 0, avgWaitingSeconds: 0, maxWaitingSeconds: 0,
      }
    }
    for (const s of stages) {
      const row = stagesById[s.id]
      if (!row) continue
      if (s.kind === 'active') {
        row.avgActiveSeconds = Number(s.avg_seconds)
        row.maxActiveSeconds = Number(s.max_seconds)
      } else {
        row.avgWaitingSeconds = Number(s.avg_seconds)
        row.maxWaitingSeconds = Number(s.max_seconds)
      }
    }

    return json({
      stages: Object.values(stagesById),
      people: people.map((p: any) => ({
        name: p.name,
        events: p.events,
        completed: p.completed,
        avgCloseSeconds: p.avg_close_seconds != null ? Number(p.avg_close_seconds) : null,
        openTasks: assignedMap[p.name] || 0,
        lastActivity: p.last_activity,
      })).concat(
        // сотрудники с назначениями, но без событий
        Object.keys(assignedMap)
          .filter(n => !people.some((p: any) => p.name === n))
          .map(n => ({ name: n, events: 0, completed: 0, avgCloseSeconds: null, openTasks: assignedMap[n], lastActivity: null })),
      ),
      brands: brands.map((b: any) => ({
        id: b.id,
        name: b.name,
        assigneeName: b.assignee_name,
        startedAt: b.started_at,
        ageSeconds: Number(b.age_seconds),
        done: b.done,
        total: b.total,
        hasBlockers: !!(b.blockers && String(b.blockers).trim()),
      })),
      stuck: stuck.map((s: any) => ({
        brandName: s.brand_name,
        taskLabel: s.option_label ? `${s.task_label} · ${s.option_label}` : s.task_label,
        statusLabel: s.status_label,
        kind: s.kind,
        assigneeName: s.assignee_name,
        seconds: Number(s.seconds),
      })),
    })
  } catch (e: any) {
    return json({ error: 'Failed to compute stats', details: e?.message }, 500)
  }
}
