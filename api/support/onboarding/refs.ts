import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'
import { ensureOnboardingSchema, obId } from '../lib/onboarding-schema.js'

export const config = {
  runtime: 'edge',
}

/**
 * Справочники модуля «Подключения» — редактируемые для масштабирования.
 *
 * kind (в body) выбирает справочник: status | taskType | pos | posTaskMap
 * POST   - добавить элемент
 * PUT    - изменить (label/color/kind/sort/is_active; для posTaskMap — enabled)
 * DELETE - ?kind=...&id=... (мягко: is_active=false, если элемент используется)
 *
 * У статусов поле metricKind (todo|active|waiting|done|cancelled|na) —
 * семантика для метрик времени, переживает переименования.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureOnboardingSchema(sql, orgId)

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { kind } = body

      if (kind === 'status') {
        const { label, metricKind = 'todo', color = 'gray' } = body
        if (!label) return json({ error: 'label is required' }, 400)
        const [{ max }] = await sql`
          SELECT COALESCE(MAX(sort_order), -1)::int AS max FROM onboarding_statuses WHERE org_id = ${orgId}
        `
        const id = obId('obst')
        await sql`
          INSERT INTO onboarding_statuses (id, org_id, label, kind, color, sort_order)
          VALUES (${id}, ${orgId}, ${label}, ${metricKind}, ${color}, ${max + 1})
        `
        return json({ success: true, id })
      }

      if (kind === 'taskType') {
        const { label } = body
        if (!label) return json({ error: 'label is required' }, 400)
        const [{ max }] = await sql`
          SELECT COALESCE(MAX(sort_order), -1)::int AS max FROM onboarding_task_types WHERE org_id = ${orgId}
        `
        const id = obId('obtt')
        await sql`
          INSERT INTO onboarding_task_types (id, org_id, label, sort_order)
          VALUES (${id}, ${orgId}, ${label}, ${max + 1})
        `
        // Новый шаг по умолчанию входит в шаблон всех POS-систем.
        await sql`
          INSERT INTO onboarding_pos_task_map (org_id, pos_id, task_type_id)
          SELECT ${orgId}, p.id, ${id} FROM onboarding_pos_systems p WHERE p.org_id = ${orgId}
          ON CONFLICT DO NOTHING
        `
        return json({ success: true, id })
      }

      if (kind === 'category') {
        const { label } = body
        if (!label) return json({ error: 'label is required' }, 400)
        const [{ max }] = await sql`
          SELECT COALESCE(MAX(sort_order), -1)::int AS max FROM onboarding_option_categories WHERE org_id = ${orgId}
        `
        const id = obId('obcat')
        await sql`
          INSERT INTO onboarding_option_categories (id, org_id, label, sort_order)
          VALUES (${id}, ${orgId}, ${label}, ${max + 1})
        `
        return json({ success: true, id })
      }

      if (kind === 'option') {
        const { label, categoryId } = body
        if (!label || !categoryId) return json({ error: 'label and categoryId are required' }, 400)
        const [{ max }] = await sql`
          SELECT COALESCE(MAX(sort_order), -1)::int AS max FROM onboarding_options
          WHERE org_id = ${orgId} AND category_id = ${categoryId}
        `
        const id = obId('obopt')
        await sql`
          INSERT INTO onboarding_options (id, org_id, category_id, label, sort_order)
          VALUES (${id}, ${orgId}, ${categoryId}, ${label}, ${max + 1})
        `
        return json({ success: true, id })
      }

      if (kind === 'pos') {
        const { name } = body
        if (!name) return json({ error: 'name is required' }, 400)
        const id = obId('obps')
        await sql`
          INSERT INTO onboarding_pos_systems (id, org_id, name) VALUES (${id}, ${orgId}, ${name})
        `
        await sql`
          INSERT INTO onboarding_pos_task_map (org_id, pos_id, task_type_id)
          SELECT ${orgId}, ${id}, t.id FROM onboarding_task_types t
          WHERE t.org_id = ${orgId} AND t.is_active = true
          ON CONFLICT DO NOTHING
        `
        return json({ success: true, id })
      }

      return json({ error: 'Unknown kind' }, 400)
    } catch (e: any) {
      return json({ error: 'Failed to create ref item', details: e?.message }, 500)
    }
  }

  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { kind, id } = body

      if (kind === 'posTaskMap') {
        const { posId, taskTypeId, enabled } = body
        if (!posId || !taskTypeId) return json({ error: 'posId and taskTypeId are required' }, 400)
        if (enabled) {
          await sql`
            INSERT INTO onboarding_pos_task_map (org_id, pos_id, task_type_id)
            VALUES (${orgId}, ${posId}, ${taskTypeId})
            ON CONFLICT DO NOTHING
          `
        } else {
          await sql`
            DELETE FROM onboarding_pos_task_map
            WHERE org_id = ${orgId} AND pos_id = ${posId} AND task_type_id = ${taskTypeId}
          `
        }
        return json({ success: true })
      }

      if (!id) return json({ error: 'id is required' }, 400)

      if (kind === 'status') {
        const { label, metricKind, color, sortOrder, isActive } = body
        if (label !== undefined) {
          await sql`UPDATE onboarding_statuses SET label = ${label} WHERE id = ${id} AND org_id = ${orgId}`
        }
        if (metricKind !== undefined) {
          await sql`UPDATE onboarding_statuses SET kind = ${metricKind} WHERE id = ${id} AND org_id = ${orgId}`
        }
        if (color !== undefined) {
          await sql`UPDATE onboarding_statuses SET color = ${color} WHERE id = ${id} AND org_id = ${orgId}`
        }
        if (sortOrder !== undefined) {
          await sql`UPDATE onboarding_statuses SET sort_order = ${sortOrder} WHERE id = ${id} AND org_id = ${orgId}`
        }
        if (isActive !== undefined) {
          await sql`UPDATE onboarding_statuses SET is_active = ${isActive} WHERE id = ${id} AND org_id = ${orgId}`
        }
        return json({ success: true })
      }

      if (kind === 'taskType') {
        const { label, sortOrder, isActive, categoryId } = body
        if (label !== undefined) {
          await sql`UPDATE onboarding_task_types SET label = ${label} WHERE id = ${id} AND org_id = ${orgId}`
        }
        if (sortOrder !== undefined) {
          await sql`UPDATE onboarding_task_types SET sort_order = ${sortOrder} WHERE id = ${id} AND org_id = ${orgId}`
        }
        if (isActive !== undefined) {
          await sql`UPDATE onboarding_task_types SET is_active = ${isActive} WHERE id = ${id} AND org_id = ${orgId}`
        }
        if (categoryId !== undefined) {
          await sql`UPDATE onboarding_task_types SET option_category_id = ${categoryId || null} WHERE id = ${id} AND org_id = ${orgId}`
        }
        return json({ success: true })
      }

      if (kind === 'category') {
        const { label, sortOrder, isActive } = body
        if (label !== undefined) {
          await sql`UPDATE onboarding_option_categories SET label = ${label} WHERE id = ${id} AND org_id = ${orgId}`
        }
        if (sortOrder !== undefined) {
          await sql`UPDATE onboarding_option_categories SET sort_order = ${sortOrder} WHERE id = ${id} AND org_id = ${orgId}`
        }
        if (isActive !== undefined) {
          await sql`UPDATE onboarding_option_categories SET is_active = ${isActive} WHERE id = ${id} AND org_id = ${orgId}`
        }
        return json({ success: true })
      }

      if (kind === 'option') {
        const { label, sortOrder, isActive } = body
        if (label !== undefined) {
          await sql`UPDATE onboarding_options SET label = ${label} WHERE id = ${id} AND org_id = ${orgId}`
        }
        if (sortOrder !== undefined) {
          await sql`UPDATE onboarding_options SET sort_order = ${sortOrder} WHERE id = ${id} AND org_id = ${orgId}`
        }
        if (isActive !== undefined) {
          await sql`UPDATE onboarding_options SET is_active = ${isActive} WHERE id = ${id} AND org_id = ${orgId}`
        }
        return json({ success: true })
      }

      if (kind === 'pos') {
        const { name, isActive } = body
        if (name !== undefined) {
          await sql`UPDATE onboarding_pos_systems SET name = ${name} WHERE id = ${id} AND org_id = ${orgId}`
        }
        if (isActive !== undefined) {
          await sql`UPDATE onboarding_pos_systems SET is_active = ${isActive} WHERE id = ${id} AND org_id = ${orgId}`
        }
        return json({ success: true })
      }

      return json({ error: 'Unknown kind' }, 400)
    } catch (e: any) {
      return json({ error: 'Failed to update ref item', details: e?.message }, 500)
    }
  }

  if (req.method === 'DELETE') {
    try {
      const kind = url.searchParams.get('kind')
      const id = url.searchParams.get('id')
      if (!kind || !id) return json({ error: 'kind and id are required' }, 400)

      if (kind === 'status') {
        const [{ count }] = await sql`
          SELECT COUNT(*)::int AS count FROM onboarding_tasks WHERE status_id = ${id} AND org_id = ${orgId}
        `
        if (count > 0) {
          await sql`UPDATE onboarding_statuses SET is_active = false WHERE id = ${id} AND org_id = ${orgId}`
          return json({ success: true, softDeleted: true })
        }
        await sql`DELETE FROM onboarding_statuses WHERE id = ${id} AND org_id = ${orgId}`
        return json({ success: true })
      }

      if (kind === 'taskType') {
        const [{ count }] = await sql`
          SELECT COUNT(*)::int AS count FROM onboarding_tasks WHERE task_type_id = ${id} AND org_id = ${orgId}
        `
        if (count > 0) {
          await sql`UPDATE onboarding_task_types SET is_active = false WHERE id = ${id} AND org_id = ${orgId}`
          return json({ success: true, softDeleted: true })
        }
        await sql`DELETE FROM onboarding_pos_task_map WHERE task_type_id = ${id} AND org_id = ${orgId}`
        await sql`DELETE FROM onboarding_task_types WHERE id = ${id} AND org_id = ${orgId}`
        return json({ success: true })
      }

      if (kind === 'pos') {
        const [{ count }] = await sql`
          SELECT COUNT(*)::int AS count FROM onboarding_brands WHERE pos_id = ${id} AND org_id = ${orgId}
        `
        if (count > 0) {
          await sql`UPDATE onboarding_pos_systems SET is_active = false WHERE id = ${id} AND org_id = ${orgId}`
          return json({ success: true, softDeleted: true })
        }
        await sql`DELETE FROM onboarding_pos_task_map WHERE pos_id = ${id} AND org_id = ${orgId}`
        await sql`DELETE FROM onboarding_pos_systems WHERE id = ${id} AND org_id = ${orgId}`
        return json({ success: true })
      }

      if (kind === 'category') {
        const [{ count }] = await sql`
          SELECT COUNT(*)::int AS count FROM onboarding_task_types
          WHERE option_category_id = ${id} AND org_id = ${orgId}
        `
        if (count > 0) {
          await sql`UPDATE onboarding_option_categories SET is_active = false WHERE id = ${id} AND org_id = ${orgId}`
          return json({ success: true, softDeleted: true })
        }
        await sql`DELETE FROM onboarding_options WHERE category_id = ${id} AND org_id = ${orgId}`
        await sql`DELETE FROM onboarding_option_categories WHERE id = ${id} AND org_id = ${orgId}`
        return json({ success: true })
      }

      if (kind === 'option') {
        const [{ count }] = await sql`
          SELECT COUNT(*)::int AS count FROM onboarding_tasks WHERE option_id = ${id} AND org_id = ${orgId}
        `
        if (count > 0) {
          await sql`UPDATE onboarding_options SET is_active = false WHERE id = ${id} AND org_id = ${orgId}`
          return json({ success: true, softDeleted: true })
        }
        await sql`DELETE FROM onboarding_options WHERE id = ${id} AND org_id = ${orgId}`
        return json({ success: true })
      }

      return json({ error: 'Unknown kind' }, 400)
    } catch (e: any) {
      return json({ error: 'Failed to delete ref item', details: e?.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
