import { getRequestOrgId } from '../lib/org.js'
import { extractAgentContext } from '../lib/auth.js'
import { getSQL, json } from '../lib/db.js'
import { ensureOnboardingSchema, obId, resolveAgentName } from '../lib/onboarding-schema.js'

export const config = {
  runtime: 'edge',
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

      const ctx = await extractAgentContext(req)
      const authorName = await resolveAgentName(sql, ctx.agentId)

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
        const id = obId('obtd')
        await sql`
          INSERT INTO onboarding_todos (id, org_id, brand_id, text, assignee_id, assignee_name, due_at, created_by)
          VALUES (${id}, ${orgId}, ${brandId}, ${String(text).trim()},
                  ${assigneeId || null}, ${assigneeName}, ${dueAt || null}, ${authorName})
        `
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
