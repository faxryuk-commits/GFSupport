import { getRequestOrgId } from '../_lib/org.js'
import { extractAgentContext } from '../_lib/auth.js'
import { getSQL, json } from '../_lib/db.js'
import { ensureOnboardingSchema, obId, addParticipant } from '../_lib/onboarding-schema.js'
import { sendNotification } from '../_lib/notifications.js'

export const config = {
  runtime: 'edge', regions: ['fra1'],
}

/**
 * Подключения (онбординг брендов) — бренды и матрица задач.
 *
 * GET    - матрица: справочники + бренды с задачами (+время в статусах)
 * POST   - создать бренд (задачи создаются из шаблона его POS-системы)
 * PUT    - обновить бренд (имя, POS, ответственный, заметки, архив)
 * DELETE - удалить бренд с задачами и историей
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

  // Доска подключений — это список клиентов, кто их ведёт и что о них написано
  // в комментариях. Ручка отдавала всё это без токена любому, кто знает адрес
  // (найдено 22.08.2026)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  await ensureOnboardingSchema(sql, orgId)

  // Регион из переключателя в шапке раздела: api.service дописывает market=
  // ко всем запросам, но эндпоинт его игнорировал — фильтр был декоративным.
  // Пустая строка = «Все регионы», бренды без региона видны всегда
  const market = (url.searchParams.get('market') || '').trim()

  if (req.method === 'GET') {
    try {
      const includeArchived = url.searchParams.get('archived') === 'true'

      const [statuses, taskTypes, posSystems, posTaskMap, categories, options, commentCounts] = await Promise.all([
        sql`SELECT * FROM onboarding_statuses WHERE org_id = ${orgId} ORDER BY sort_order`,
        sql`SELECT * FROM onboarding_task_types WHERE org_id = ${orgId} ORDER BY sort_order`,
        sql`SELECT * FROM onboarding_pos_systems WHERE org_id = ${orgId} ORDER BY name`,
        sql`SELECT pos_id, task_type_id FROM onboarding_pos_task_map WHERE org_id = ${orgId}`,
        sql`SELECT * FROM onboarding_option_categories WHERE org_id = ${orgId} ORDER BY sort_order`,
        sql`SELECT * FROM onboarding_options WHERE org_id = ${orgId} ORDER BY sort_order`,
        sql`SELECT brand_id, COUNT(*)::int AS count FROM onboarding_comments WHERE org_id = ${orgId} GROUP BY brand_id`,
      ])
      const commentsByBrand: Record<string, number> = Object.fromEntries(
        commentCounts.map((c: any) => [c.brand_id, c.count]),
      )
      const participantRows = await sql`
        SELECT brand_id, agent_id, name FROM onboarding_participants
        WHERE org_id = ${orgId} ORDER BY added_at
      `
      const participantsByBrand: Record<string, { agentId: string | null; name: string }[]> = {}
      for (const pr of participantRows) {
        ;(participantsByBrand[pr.brand_id] = participantsByBrand[pr.brand_id] || []).push({
          agentId: pr.agent_id, name: pr.name,
        })
      }

      const openTodos = await sql`
        SELECT brand_id, COUNT(*)::int AS count FROM onboarding_todos
        WHERE org_id = ${orgId} AND done_at IS NULL GROUP BY brand_id
      `
      const todosByBrand: Record<string, number> = Object.fromEntries(
        openTodos.map((c: any) => [c.brand_id, c.count]),
      )

      const brands = includeArchived
        ? await sql`SELECT * FROM onboarding_brands WHERE org_id = ${orgId}
            AND (${market} = '' OR market_id IS NULL OR market_id = ${market})
            ORDER BY archived_at NULLS FIRST, created_at`
        : await sql`SELECT * FROM onboarding_brands WHERE org_id = ${orgId} AND archived_at IS NULL
            AND (${market} = '' OR market_id IS NULL OR market_id = ${market})
            ORDER BY created_at`

      const tasks = includeArchived
        ? await sql`
            SELECT t.* FROM onboarding_tasks t
            JOIN onboarding_brands b ON b.id = t.brand_id
            WHERE t.org_id = ${orgId}
              AND (${market} = '' OR b.market_id IS NULL OR b.market_id = ${market})
          `
        : await sql`
            SELECT t.* FROM onboarding_tasks t
            JOIN onboarding_brands b ON b.id = t.brand_id
            WHERE t.org_id = ${orgId} AND b.archived_at IS NULL
              AND (${market} = '' OR b.market_id IS NULL OR b.market_id = ${market})
          `

      // Имена всех брендов (вкл. архив) — родитель апсейла может быть запущен
      const allNames = await sql`SELECT id, name FROM onboarding_brands WHERE org_id = ${orgId}`
      const brandNameById: Record<string, string> = Object.fromEntries(
        (allNames as any[]).map((b: any) => [b.id, b.name]),
      )

      // Накопленное время по kind статусов из журнала (для тултипов/метрик).
      // Интервал = от события до следующего события той же задачи (или до NOW()).
      const durations = await sql`
        WITH ev AS (
          SELECT brand_id, task_type_id, option_id, new_status_id, changed_at,
                 LEAD(changed_at) OVER (PARTITION BY brand_id, task_type_id, COALESCE(option_id, '') ORDER BY changed_at) AS next_at
          FROM onboarding_task_events
          WHERE org_id = ${orgId}
        )
        SELECT ev.brand_id, ev.task_type_id, COALESCE(ev.option_id, '') AS option_key, s.kind,
               SUM(EXTRACT(EPOCH FROM (COALESCE(ev.next_at, NOW()) - ev.changed_at)))::bigint AS seconds
        FROM ev
        JOIN onboarding_statuses s ON s.id = ev.new_status_id
        WHERE s.kind IN ('active', 'waiting')
        GROUP BY ev.brand_id, ev.task_type_id, COALESCE(ev.option_id, ''), s.kind
      `
      const durMap: Record<string, { active?: number; waiting?: number }> = {}
      for (const d of durations) {
        const key = `${d.brand_id}|${d.task_type_id}|${d.option_key || ''}`
        durMap[key] = durMap[key] || {}
        durMap[key][d.kind as 'active' | 'waiting'] = Number(d.seconds)
      }

      const tasksByBrand: Record<string, any[]> = {}
      for (const t of tasks) {
        const dur = durMap[`${t.brand_id}|${t.task_type_id}|${t.option_id || ''}`] || {}
        ;(tasksByBrand[t.brand_id] = tasksByBrand[t.brand_id] || []).push({
          id: t.id,
          taskTypeId: t.task_type_id,
          statusId: t.status_id,
          assigneeId: t.assignee_id,
          assigneeName: t.assignee_name,
          optionId: t.option_id,
          waitingOn: t.waiting_on,
          statusSince: t.status_since,
          activeSeconds: dur.active || 0,
          waitingSeconds: dur.waiting || 0,
        })
      }

      return json({
        statuses: statuses.map((s: any) => ({
          id: s.id, label: s.label, kind: s.kind, color: s.color,
          sortOrder: s.sort_order, isActive: s.is_active,
        })),
        taskTypes: taskTypes.map((t: any) => ({
          id: t.id, label: t.label, sortOrder: t.sort_order, isActive: t.is_active,
          optionCategoryId: t.option_category_id,
          groupLabel: t.group_label,
          targetDays: t.target_days,
          ownerAgentId: t.owner_agent_id,
          ownerName: t.owner_name,
          guideUrl: t.guide_url || null,
        })),
        posSystems: posSystems.map((p: any) => ({
          id: p.id, name: p.name, isActive: p.is_active,
        })),
        posTaskMap: posTaskMap.map((m: any) => ({ posId: m.pos_id, taskTypeId: m.task_type_id })),
        optionCategories: categories.map((c: any) => ({
          id: c.id, label: c.label, sortOrder: c.sort_order, isActive: c.is_active,
        })),
        options: options.map((o: any) => ({
          id: o.id, categoryId: o.category_id, label: o.label,
          sortOrder: o.sort_order, isActive: o.is_active,
          markets: o.markets || null,
          guideUrl: o.guide_url || null,
        })),
        brands: brands.map((b: any) => ({
          id: b.id,
          name: b.name,
          posId: b.pos_id,
          channelId: b.channel_id,
          ownerName: b.owner_name,
          assigneeId: b.assignee_id,
          assigneeName: b.assignee_name,
          nextStep: b.next_step,
          tariff: b.tariff,
          launchDue: b.launch_due,
          marketId: b.market_id,
          connectionType: b.connection_type,
          parentBrandId: b.parent_brand_id,
          parentName: b.parent_brand_id ? (brandNameById[b.parent_brand_id] || null) : null,
          dependsOn: b.depends_on,
          blockers: b.blockers,
          notes: b.notes,
          participants: participantsByBrand[b.id] || [],
          commentsCount: commentsByBrand[b.id] || 0,
          openTodosCount: todosByBrand[b.id] || 0,
          startedAt: b.started_at,
          archivedAt: b.archived_at,
          createdAt: b.created_at,
          tasks: tasksByBrand[b.id] || [],
        })),
      })
    } catch (e: any) {
      return json({ error: 'Failed to fetch onboarding board', details: e?.message }, 500)
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { name, posId, ownerName, channelId, notes } = body
      if (!name || !String(name).trim()) {
        return json({ error: 'name is required' }, 400)
      }

      const brandId = obId('obbr')
      // Регион нового бренда: явный из формы, иначе — выбранный в шапке раздела
      const brandMarket = (body.marketId || market || '').trim() || null
      await sql`
        INSERT INTO onboarding_brands (id, org_id, name, pos_id, channel_id, owner_name, notes, market_id)
        VALUES (${brandId}, ${orgId}, ${String(name).trim()}, ${posId || null},
                ${channelId || null}, ${ownerName || null}, ${notes || null}, ${brandMarket})
      `

      // Задачи из шаблона POS-системы; без POS — полный чек-лист.
      const [defaultStatus] = await sql`
        SELECT id FROM onboarding_statuses
        WHERE org_id = ${orgId} AND kind = 'todo' AND is_active = true
        ORDER BY sort_order LIMIT 1
      `
      let taskTypes = posId
        ? await sql`
            SELECT t.id FROM onboarding_task_types t
            JOIN onboarding_pos_task_map m ON m.task_type_id = t.id AND m.pos_id = ${posId}
            WHERE t.org_id = ${orgId} AND t.is_active = true
            ORDER BY t.sort_order
          `
        : await sql`
            SELECT id FROM onboarding_task_types
            WHERE org_id = ${orgId} AND is_active = true ORDER BY sort_order
          `
      // POS без строк в шаблоне — полный чек-лист, а не пустой проект
      if (posId && (taskTypes as any[]).length === 0) {
        taskTypes = await sql`
          SELECT id FROM onboarding_task_types
          WHERE org_id = ${orgId} AND is_active = true ORDER BY sort_order
        `
      }
      for (const t of taskTypes) {
        await sql`
          INSERT INTO onboarding_tasks (id, org_id, brand_id, task_type_id, status_id)
          VALUES (${obId('obtk')}, ${orgId}, ${brandId}, ${t.id}, ${defaultStatus?.id || null})
          ON CONFLICT (brand_id, task_type_id, (COALESCE(option_id, ''))) DO NOTHING
        `
      }

      // Выбранная POS — сразу поставщиком в ячейку «POS-интеграция»
      if (posId) {
        await sql`
          UPDATE onboarding_tasks t SET option_id = o.id
          FROM onboarding_task_types tt
          JOIN onboarding_option_categories c ON c.id = tt.option_category_id AND c.label = 'POS'
          JOIN onboarding_options o ON o.category_id = c.id
            AND LOWER(o.label) = LOWER((SELECT name FROM onboarding_pos_systems WHERE id = ${posId}))
          WHERE t.brand_id = ${brandId} AND t.task_type_id = tt.id AND t.option_id IS NULL
        `.catch(() => {})
      }

      return json({ success: true, id: brandId })
    } catch (e: any) {
      return json({ error: 'Failed to create brand', details: e?.message }, 500)
    }
  }

  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { id, name, posId, ownerName, channelId, notes, archived,
              assigneeId, assigneeName, nextStep, dependsOn, blockers } = body
      if (!id) return json({ error: 'id is required' }, 400)

      if (assigneeId !== undefined) {
        await sql`UPDATE onboarding_brands SET assignee_id = ${assigneeId} WHERE id = ${id} AND org_id = ${orgId}`
      }
      if (assigneeName !== undefined) {
        await sql`UPDATE onboarding_brands SET assignee_name = ${assigneeName} WHERE id = ${id} AND org_id = ${orgId}`
        if (assigneeName) await addParticipant(sql, orgId, id, (assigneeId as string) || null, assigneeName)
        // назначили ведущего проекта — адресное уведомление в систему
        if (assigneeId) {
          try {
            const [b] = await sql`SELECT name FROM onboarding_brands WHERE id = ${id} LIMIT 1` as any[]
            await sendNotification({
              orgId, type: 'assignment', priority: 'high',
              title: `Вы ведёте проект: ${b?.name || ''}`,
              body: `Вас назначили ведущим проекта «${b?.name || ''}» в Подключениях.`,
              link: '/onboarding',
              targetAgentIds: [assigneeId as string],
            })
          } catch {}
        }
      }
      if (nextStep !== undefined) {
        await sql`UPDATE onboarding_brands SET next_step = ${nextStep} WHERE id = ${id} AND org_id = ${orgId}`
      }
      if (body.tariff !== undefined) {
        await sql`UPDATE onboarding_brands SET tariff = ${body.tariff || null} WHERE id = ${id} AND org_id = ${orgId}`
      }
      if (body.launchDue !== undefined) {
        await sql`UPDATE onboarding_brands SET launch_due = ${body.launchDue || null} WHERE id = ${id} AND org_id = ${orgId}`
      }
      if (body.marketId !== undefined) {
        await sql`UPDATE onboarding_brands SET market_id = ${body.marketId || null} WHERE id = ${id} AND org_id = ${orgId}`
      }
      if (body.connectionType !== undefined) {
        await sql`UPDATE onboarding_brands SET connection_type = ${body.connectionType || null} WHERE id = ${id} AND org_id = ${orgId}`
      }
      if (body.parentBrandId !== undefined) {
        await sql`UPDATE onboarding_brands SET parent_brand_id = ${body.parentBrandId || null} WHERE id = ${id} AND org_id = ${orgId}`
      }
      if (dependsOn !== undefined) {
        await sql`UPDATE onboarding_brands SET depends_on = ${dependsOn} WHERE id = ${id} AND org_id = ${orgId}`
      }
      if (blockers !== undefined) {
        await sql`UPDATE onboarding_brands SET blockers = ${blockers} WHERE id = ${id} AND org_id = ${orgId}`
      }

      if (name !== undefined) {
        await sql`UPDATE onboarding_brands SET name = ${name} WHERE id = ${id} AND org_id = ${orgId}`
      }
      if (posId !== undefined) {
        await sql`UPDATE onboarding_brands SET pos_id = ${posId} WHERE id = ${id} AND org_id = ${orgId}`
        // Дозаводим недостающие задачи из шаблона новой POS (существующие не трогаем).
        if (posId) {
          const [defaultStatus] = await sql`
            SELECT id FROM onboarding_statuses
            WHERE org_id = ${orgId} AND kind = 'todo' AND is_active = true
            ORDER BY sort_order LIMIT 1
          `
          const missing = await sql`
            SELECT t.id FROM onboarding_task_types t
            JOIN onboarding_pos_task_map m ON m.task_type_id = t.id AND m.pos_id = ${posId}
            WHERE t.org_id = ${orgId} AND t.is_active = true
              AND NOT EXISTS (
                SELECT 1 FROM onboarding_tasks x
                WHERE x.brand_id = ${id} AND x.task_type_id = t.id
              )
          `
          for (const t of missing) {
            await sql`
              INSERT INTO onboarding_tasks (id, org_id, brand_id, task_type_id, status_id)
              VALUES (${obId('obtk')}, ${orgId}, ${id}, ${t.id}, ${defaultStatus?.id || null})
              ON CONFLICT (brand_id, task_type_id, (COALESCE(option_id, ''))) DO NOTHING
            `
          }
        }
      }
      if (ownerName !== undefined) {
        await sql`UPDATE onboarding_brands SET owner_name = ${ownerName} WHERE id = ${id} AND org_id = ${orgId}`
      }
      if (channelId !== undefined) {
        await sql`UPDATE onboarding_brands SET channel_id = ${channelId} WHERE id = ${id} AND org_id = ${orgId}`
      }
      if (notes !== undefined) {
        await sql`UPDATE onboarding_brands SET notes = ${notes} WHERE id = ${id} AND org_id = ${orgId}`
      }
      if (archived !== undefined) {
        if (archived) {
          await sql`UPDATE onboarding_brands SET archived_at = NOW() WHERE id = ${id} AND org_id = ${orgId}`
        } else {
          await sql`UPDATE onboarding_brands SET archived_at = NULL WHERE id = ${id} AND org_id = ${orgId}`
        }
      }

      return json({ success: true })
    } catch (e: any) {
      return json({ error: 'Failed to update brand', details: e?.message }, 500)
    }
  }

  if (req.method === 'DELETE') {
    try {
      const id = url.searchParams.get('id')
      if (!id) return json({ error: 'id is required' }, 400)

      await sql`DELETE FROM onboarding_task_events WHERE brand_id = ${id} AND org_id = ${orgId}`
      await sql`DELETE FROM onboarding_tasks WHERE brand_id = ${id} AND org_id = ${orgId}`
      await sql`DELETE FROM onboarding_comments WHERE brand_id = ${id} AND org_id = ${orgId}`
      await sql`DELETE FROM onboarding_todos WHERE brand_id = ${id} AND org_id = ${orgId}`
      await sql`DELETE FROM onboarding_participants WHERE brand_id = ${id} AND org_id = ${orgId}`
      await sql`DELETE FROM onboarding_brands WHERE id = ${id} AND org_id = ${orgId}`
      return json({ success: true })
    } catch (e: any) {
      return json({ error: 'Failed to delete brand', details: e?.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
