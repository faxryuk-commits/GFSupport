import { getSQL, json, corsHeaders, getOpenAIKey } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import {
  CREATOR_OWNER_ID, ensureCreatorSchema, planCycle, weekKeyOf, generateSeriesDraft,
} from '../_lib/creator.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Недельные циклы «Креатора»: план серии предлагает модель, пишется серия
 * только после одобрения владельцем. Доступ — только владелец.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  const sql = getSQL()
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  if (ctx.agentId !== CREATOR_OWNER_ID) return json({ error: 'forbidden' }, 403)
  await ensureCreatorSchema(sql)

  if (req.method === 'GET') {
    const cycles = await sql`SELECT * FROM creator_cycles ORDER BY created_at DESC LIMIT 12`
    const counts = await sql`
      SELECT cycle_id, count(*)::int AS n FROM creator_drafts
      WHERE cycle_id IS NOT NULL GROUP BY cycle_id`
    const byId: Record<string, number> = {}
    for (const c of counts as any[]) byId[c.cycle_id] = c.n
    return json({ cycles, written: byId, thisWeek: weekKeyOf() })
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  let body: any = {}
  try { body = await req.json() } catch { /* пустое тело */ }

  if (body.action === 'plan') {
    const key = await getOpenAIKey()
    if (!key) return json({ error: 'нет ключа OpenAI' }, 500)
    // Перепланирование сносит только НЕначатый план этой недели
    await sql`
      DELETE FROM creator_cycles WHERE week_key = ${weekKeyOf()} AND status = 'proposed'`
    try {
      const cycle = await planCycle(sql, key, weekKeyOf())
      return json({ cycle })
    } catch (e: any) {
      return json({ error: e?.message || 'не удалось спланировать цикл' }, 502)
    }
  }

  if (body.action === 'approve') {
    await sql`
      UPDATE creator_cycles SET status = 'approved', updated_at = now()
      WHERE id = ${String(body.id)} AND status = 'proposed'`
    return json({ ok: true })
  }

  if (body.action === 'finish') {
    await sql`
      UPDATE creator_cycles SET status = 'done', updated_at = now() WHERE id = ${String(body.id)}`
    return json({ ok: true })
  }

  if (body.action === 'delete') {
    // Сносится только план, посты серии остаются черновиками
    await sql`DELETE FROM creator_cycles WHERE id = ${String(body.id)} AND status = 'proposed'`
    return json({ ok: true })
  }

  if (body.action === 'write_today') {
    const key = await getOpenAIKey()
    if (!key) return json({ error: 'нет ключа OpenAI' }, 500)
    const [cycle] = await sql`
      SELECT * FROM creator_cycles WHERE id = ${String(body.id)} AND status = 'approved' LIMIT 1`
    if (!cycle) return json({ error: 'цикл не найден или не одобрен' }, 404)
    const batchKey = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10)
    try {
      const row = await generateSeriesDraft(sql, key, cycle, batchKey)
      if (!row) return json({ error: 'серия уже дописана' }, 400)
      return json({ draft: row })
    } catch (e: any) {
      return json({ error: e?.message || 'ошибка генерации' }, 502)
    }
  }

  return json({ error: 'unknown action' }, 400)
}
