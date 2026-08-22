import { getRequestOrgId } from '../lib/org.js'
import { extractAgentContext } from '../lib/auth.js'
import { getSQL, json } from '../lib/db.js'
import { ensureOnboardingSchema, obId, resolveAgentName, addParticipant } from '../lib/onboarding-schema.js'

export const config = {
  runtime: 'edge',
}

/**
 * Задачи онбординга: смена статуса с записью в журнал + история событий.
 * Ячейка может содержать несколько под-задач — по одной на поставщика.
 *
 * PUT    - сменить статус задачи / исполнителя / поставщика
 * POST   - добавить под-задачу поставщика: { brandId, taskTypeId, optionId }
 * DELETE - убрать под-задачу: ?taskId= (события остаются в журнале)
 * GET    - журнал событий (?brandId= или последние по организации)
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureOnboardingSchema(sql, orgId)

  // Читать доску может только вошедший: журнал и карточка — это клиенты,
  // задачи и переписка по ним. Проверка стояла лишь на записи, а GET отдавал
  // всё это без токена (найдено 22.08.2026)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  if (req.method === 'GET') {
    try {
      const brandId = url.searchParams.get('brandId')
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000)
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0'))
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')
      const kind = url.searchParams.get('kind')
      const actor = url.searchParams.get('actor')

      // Пагинация + фильтры: динамический WHERE через параметризованный запрос
      const conds: string[] = ['e.org_id = $1']
      const params: any[] = [orgId]
      const add = (cond: string, value: any) => {
        params.push(value)
        conds.push(cond.replace('?', `$${params.length}`))
      }
      if (brandId) add('e.brand_id = ?', brandId)
      if (from) add('e.changed_at >= ?::timestamptz', `${from}T00:00:00+05:00`)
      if (to) add('e.changed_at <= ?::timestamptz', `${to}T23:59:59+05:00`)
      if (kind) add('ns.kind = ?', kind)
      if (actor) add('e.changed_by = ?', actor)
      params.push(limit + 1, offset)

      const events = await sql.query(
        `SELECT e.*, os.label AS old_label, ns.label AS new_label, tt.label AS task_label,
                op.label AS option_label, b.name AS brand_name
         FROM onboarding_task_events e
         LEFT JOIN onboarding_statuses os ON os.id = e.old_status_id
         LEFT JOIN onboarding_statuses ns ON ns.id = e.new_status_id
         LEFT JOIN onboarding_task_types tt ON tt.id = e.task_type_id
         LEFT JOIN onboarding_options op ON op.id = e.option_id
         LEFT JOIN onboarding_brands b ON b.id = e.brand_id
         WHERE ${conds.join(' AND ')}
         ORDER BY e.changed_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ) as any[]

      const hasMore = events.length > limit
      if (hasMore) events.pop()

      return json({
        hasMore,
        events: events.map((e: any) => ({
          id: String(e.id),
          brandId: e.brand_id,
          brandName: e.brand_name,
          taskTypeId: e.task_type_id,
          taskLabel: e.task_label,
          optionLabel: e.option_label,
          oldStatusId: e.old_status_id,
          oldLabel: e.old_label,
          newStatusId: e.new_status_id,
          newLabel: e.new_label,
          changedBy: e.changed_by,
          changedAt: e.changed_at,
        })),
      })
    } catch (e: any) {
      return json({ error: 'Failed to fetch events', details: e?.message }, 500)
    }
  }

  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { taskId, statusId, assigneeName, assigneeId, optionId, waitingOn } = body
      if (!taskId) return json({ error: 'taskId is required' }, 400)

      const [task] = await sql`
        SELECT * FROM onboarding_tasks WHERE id = ${taskId} AND org_id = ${orgId} LIMIT 1
      `
      if (!task) return json({ error: 'Task not found' }, 404)

      const actorName = await resolveAgentName(sql, ctx.agentId)
      await addParticipant(sql, orgId, task.brand_id, ctx.agentId, actorName)

      if (statusId !== undefined && statusId !== task.status_id) {
        const changedBy = actorName

        await sql`
          UPDATE onboarding_tasks
          SET status_id = ${statusId}, status_since = NOW(), updated_at = NOW()
          WHERE id = ${taskId} AND org_id = ${orgId}
        `
        await sql`
          INSERT INTO onboarding_task_events (org_id, brand_id, task_type_id, option_id, old_status_id, new_status_id, changed_by)
          VALUES (${orgId}, ${task.brand_id}, ${task.task_type_id}, ${task.option_id}, ${task.status_id}, ${statusId}, ${changedBy})
        `

        // Процесс не должен стоять без ответственного: если исполнителя нет,
        // подставляем владельца процесса из справочника шага.
        if (!task.assignee_id) {
          const [tt] = await sql`
            SELECT owner_agent_id, owner_name FROM onboarding_task_types
            WHERE id = ${task.task_type_id} LIMIT 1
          `
          if (tt?.owner_agent_id) {
            await sql`
              UPDATE onboarding_tasks
              SET assignee_id = ${tt.owner_agent_id}, assignee_name = ${tt.owner_name}, updated_at = NOW()
              WHERE id = ${taskId} AND org_id = ${orgId} AND assignee_id IS NULL
            `
            await addParticipant(sql, orgId, task.brand_id, tt.owner_agent_id, tt.owner_name)
          }
        }
      }

      if (assigneeId !== undefined) {
        const name = assigneeId ? await resolveAgentName(sql, assigneeId) : null
        await sql`
          UPDATE onboarding_tasks
          SET assignee_id = ${assigneeId || null}, assignee_name = ${name}, updated_at = NOW()
          WHERE id = ${taskId} AND org_id = ${orgId}
        `
        if (assigneeId) await addParticipant(sql, orgId, task.brand_id, assigneeId, name)
      } else if (assigneeName !== undefined) {
        await sql`
          UPDATE onboarding_tasks
          SET assignee_name = ${assigneeName || null}, updated_at = NOW()
          WHERE id = ${taskId} AND org_id = ${orgId}
        `
      }

      if (optionId !== undefined) {
        await sql`
          UPDATE onboarding_tasks
          SET option_id = ${optionId || null}, updated_at = NOW()
          WHERE id = ${taskId} AND org_id = ${orgId}
        `
      }

      if (waitingOn !== undefined) {
        await sql`
          UPDATE onboarding_tasks
          SET waiting_on = ${waitingOn || null}, updated_at = NOW()
          WHERE id = ${taskId} AND org_id = ${orgId}
        `
      }

      return json({ success: true })
    } catch (e: any) {
      return json({ error: 'Failed to update task', details: e?.message }, 500)
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { brandId, taskTypeId, optionId } = body
      if (!brandId || !taskTypeId) return json({ error: 'brandId and taskTypeId are required' }, 400)

      const [defaultStatus] = await sql`
        SELECT id FROM onboarding_statuses
        WHERE org_id = ${orgId} AND kind = 'todo' AND is_active = true
        ORDER BY sort_order LIMIT 1
      `
      const actorName = await resolveAgentName(sql, ctx.agentId)
      await addParticipant(sql, orgId, brandId, ctx.agentId, actorName)

      const id = obId('obtk')
      const rows = await sql`
        INSERT INTO onboarding_tasks (id, org_id, brand_id, task_type_id, status_id, option_id)
        VALUES (${id}, ${orgId}, ${brandId}, ${taskTypeId}, ${defaultStatus?.id || null}, ${optionId || null})
        ON CONFLICT (brand_id, task_type_id, (COALESCE(option_id, ''))) DO NOTHING
        RETURNING id
      `
      if (rows.length === 0) return json({ error: 'Такой поставщик уже добавлен' }, 409)
      return json({ success: true, id })
    } catch (e: any) {
      return json({ error: 'Failed to create task', details: e?.message }, 500)
    }
  }

  if (req.method === 'DELETE') {
    try {
      const taskId = url.searchParams.get('taskId')
      if (!taskId) return json({ error: 'taskId is required' }, 400)
      await sql`DELETE FROM onboarding_tasks WHERE id = ${taskId} AND org_id = ${orgId}`
      return json({ success: true })
    } catch (e: any) {
      return json({ error: 'Failed to delete task', details: e?.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
