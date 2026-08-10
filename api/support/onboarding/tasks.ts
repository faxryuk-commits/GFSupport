import { getRequestOrgId } from '../lib/org.js'
import { extractAgentContext } from '../lib/auth.js'
import { getSQL, json } from '../lib/db.js'
import { ensureOnboardingSchema, obId, resolveAgentName } from '../lib/onboarding-schema.js'

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

  if (req.method === 'GET') {
    try {
      const brandId = url.searchParams.get('brandId')
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500)

      const events = brandId
        ? await sql`
            SELECT e.*, os.label AS old_label, ns.label AS new_label, tt.label AS task_label,
                   op.label AS option_label
            FROM onboarding_task_events e
            LEFT JOIN onboarding_statuses os ON os.id = e.old_status_id
            LEFT JOIN onboarding_statuses ns ON ns.id = e.new_status_id
            LEFT JOIN onboarding_task_types tt ON tt.id = e.task_type_id
            LEFT JOIN onboarding_options op ON op.id = e.option_id
            WHERE e.org_id = ${orgId} AND e.brand_id = ${brandId}
            ORDER BY e.changed_at DESC
            LIMIT ${limit}
          `
        : await sql`
            SELECT e.*, os.label AS old_label, ns.label AS new_label, tt.label AS task_label,
                   op.label AS option_label, b.name AS brand_name
            FROM onboarding_task_events e
            LEFT JOIN onboarding_statuses os ON os.id = e.old_status_id
            LEFT JOIN onboarding_statuses ns ON ns.id = e.new_status_id
            LEFT JOIN onboarding_task_types tt ON tt.id = e.task_type_id
            LEFT JOIN onboarding_options op ON op.id = e.option_id
            LEFT JOIN onboarding_brands b ON b.id = e.brand_id
            WHERE e.org_id = ${orgId}
            ORDER BY e.changed_at DESC
            LIMIT ${limit}
          `

      return json({
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
      const { taskId, statusId, assigneeName, assigneeId, optionId } = body
      if (!taskId) return json({ error: 'taskId is required' }, 400)

      const [task] = await sql`
        SELECT * FROM onboarding_tasks WHERE id = ${taskId} AND org_id = ${orgId} LIMIT 1
      `
      if (!task) return json({ error: 'Task not found' }, 404)

      if (statusId !== undefined && statusId !== task.status_id) {
        const ctx = await extractAgentContext(req)
        const changedBy = await resolveAgentName(sql, ctx.agentId)

        await sql`
          UPDATE onboarding_tasks
          SET status_id = ${statusId}, status_since = NOW(), updated_at = NOW()
          WHERE id = ${taskId} AND org_id = ${orgId}
        `
        await sql`
          INSERT INTO onboarding_task_events (org_id, brand_id, task_type_id, option_id, old_status_id, new_status_id, changed_by)
          VALUES (${orgId}, ${task.brand_id}, ${task.task_type_id}, ${task.option_id}, ${task.status_id}, ${statusId}, ${changedBy})
        `
      }

      if (assigneeId !== undefined) {
        const name = assigneeId ? await resolveAgentName(sql, assigneeId) : null
        await sql`
          UPDATE onboarding_tasks
          SET assignee_id = ${assigneeId || null}, assignee_name = ${name}, updated_at = NOW()
          WHERE id = ${taskId} AND org_id = ${orgId}
        `
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
