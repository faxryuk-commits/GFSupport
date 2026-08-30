import { getRequestOrgId } from '../lib/org.js'
import { extractAgentContext } from '../lib/auth.js'
import { getSQL, json } from '../lib/db.js'
import { ensureOnboardingSchema, obId, resolveAgentName, addParticipant } from '../lib/onboarding-schema.js'
import { sendNotification } from '../lib/notifications.js'

export const config = {
  runtime: 'edge', regions: ['fra1'],
}

/**
 * Карточка бренда: комментарии и мини-задачи (todos).
 *
 * GET    - ?brandId= → { comments, todos }
 * POST   - { brandId, comment } | { brandId, todo: { text, assigneeId?, dueAt? } }
 * PUT    - { todoId, done } | { todoId, text/assigneeId/dueAt }
 * DELETE - ?commentId= | ?todoId=
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
      if (!brandId) return json({ error: 'brandId is required' }, 400)

      const [comments, todos] = await Promise.all([
        sql`
          SELECT * FROM onboarding_comments
          WHERE org_id = ${orgId} AND brand_id = ${brandId}
          ORDER BY created_at DESC LIMIT 200
        `,
        sql`
          SELECT * FROM onboarding_todos
          WHERE org_id = ${orgId} AND brand_id = ${brandId}
          ORDER BY done_at NULLS FIRST, created_at DESC LIMIT 200
        `,
      ])
      return json({
        comments: comments.map((c: any) => ({
          id: c.id,
          authorId: c.author_id,
          authorName: c.author_name,
          text: c.text,
          createdAt: c.created_at,
        })),
        todos: todos.map((t: any) => ({
          id: t.id,
          text: t.text,
          assigneeId: t.assignee_id,
          assigneeName: t.assignee_name,
          dueAt: t.due_at,
          doneAt: t.done_at,
          createdBy: t.created_by,
          createdAt: t.created_at,
        })),
      })
    } catch (e: any) {
      return json({ error: 'Failed to fetch card', details: e?.message }, 500)
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { brandId } = body
      if (!brandId) return json({ error: 'brandId is required' }, 400)

      const authorName = await resolveAgentName(sql, ctx.agentId)
      await addParticipant(sql, orgId, brandId, ctx.agentId, authorName)

      if (body.participant?.agentId) {
        const pName = await resolveAgentName(sql, body.participant.agentId)
        await addParticipant(sql, orgId, brandId, body.participant.agentId, pName, 'manual')
        return json({ success: true })
      }

      if (body.comment) {
        const id = obId('obcm')
        await sql`
          INSERT INTO onboarding_comments (id, org_id, brand_id, author_id, author_name, text)
          VALUES (${id}, ${orgId}, ${brandId}, ${ctx.agentId}, ${authorName}, ${String(body.comment).trim()})
        `
        return json({ success: true, id })
      }

      if (body.todo?.text) {
        const { text, assigneeId, dueAt } = body.todo
        const assigneeName = assigneeId ? await resolveAgentName(sql, assigneeId) : null
        if (assigneeId) await addParticipant(sql, orgId, brandId, assigneeId, assigneeName)
        const id = obId('obtd')
        await sql`
          INSERT INTO onboarding_todos (id, org_id, brand_id, text, assignee_id, assignee_name, due_at, created_by)
          VALUES (${id}, ${orgId}, ${brandId}, ${String(text).trim()},
                  ${assigneeId || null}, ${assigneeName}, ${dueAt || null}, ${authorName})
        `
        await notifyAssignee(sql, orgId, brandId, assigneeId, ctx.agentId, authorName, String(text))
        return json({ success: true, id })
      }

      return json({ error: 'comment or todo is required' }, 400)
    } catch (e: any) {
      return json({ error: 'Failed to create', details: e?.message }, 500)
    }
  }

  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { todoId, done, text, assigneeId, dueAt } = body
      if (!todoId) return json({ error: 'todoId is required' }, 400)

      if (done !== undefined) {
        if (done) {
          await sql`UPDATE onboarding_todos SET done_at = NOW() WHERE id = ${todoId} AND org_id = ${orgId}`
        } else {
          await sql`UPDATE onboarding_todos SET done_at = NULL WHERE id = ${todoId} AND org_id = ${orgId}`
        }
      }
      if (text !== undefined) {
        await sql`UPDATE onboarding_todos SET text = ${text} WHERE id = ${todoId} AND org_id = ${orgId}`
      }
      if (assigneeId !== undefined) {
        const name = assigneeId ? await resolveAgentName(sql, assigneeId) : null
        await sql`UPDATE onboarding_todos SET assignee_id = ${assigneeId || null}, assignee_name = ${name} WHERE id = ${todoId} AND org_id = ${orgId}`
        const [td] = await sql`SELECT brand_id, text FROM onboarding_todos WHERE id = ${todoId} AND org_id = ${orgId} LIMIT 1` as any[]
        if (td) await notifyAssignee(sql, orgId, td.brand_id, assigneeId, ctx.agentId, await resolveAgentName(sql, ctx.agentId), String(td.text || ''))
      }
      if (dueAt !== undefined) {
        await sql`UPDATE onboarding_todos SET due_at = ${dueAt || null} WHERE id = ${todoId} AND org_id = ${orgId}`
      }
      return json({ success: true })
    } catch (e: any) {
      return json({ error: 'Failed to update todo', details: e?.message }, 500)
    }
  }

  if (req.method === 'DELETE') {
    try {
      const commentId = url.searchParams.get('commentId')
      const todoId = url.searchParams.get('todoId')
      if (commentId) {
        await sql`DELETE FROM onboarding_comments WHERE id = ${commentId} AND org_id = ${orgId}`
        return json({ success: true })
      }
      if (todoId) {
        await sql`DELETE FROM onboarding_todos WHERE id = ${todoId} AND org_id = ${orgId}`
        return json({ success: true })
      }
      return json({ error: 'commentId or todoId is required' }, 400)
    } catch (e: any) {
      return json({ error: 'Failed to delete', details: e?.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}

/**
 * Назначили мини-задачу — человек должен узнать об этом, не открывая карточку
 * бренда. Раньше задача просто ложилась в базу и ждала, пока исполнитель
 * случайно откроет тот же экран.
 *
 * Себе задачу ставят как напоминание — дёргать человека уведомлением о его же
 * действии незачем, поэтому такой случай пропускаем. В «Моём» она всё равно
 * появится: этот список читается по исполнителю, а не по уведомлениям.
 */
async function notifyAssignee(
  sql: any, orgId: string, brandId: string,
  assigneeId: string | null | undefined, actorId: string | null,
  actorName: string | null, text: string,
): Promise<void> {
  if (!assigneeId || assigneeId === actorId) return
  try {
    const [b] = await sql`SELECT name FROM onboarding_brands WHERE id = ${brandId} LIMIT 1` as any[]
    await sendNotification({
      orgId, type: 'assignment', priority: 'high',
      title: `Задача по подключению: ${b?.name || 'бренд'}`,
      body: `${actorName || 'Коллега'}: ${text.trim().slice(0, 140)}`,
      link: '/onboarding',
      targetAgentIds: [assigneeId],
    })
  } catch { /* уведомление не должно ронять создание задачи */ }
}
