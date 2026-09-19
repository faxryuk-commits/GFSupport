import { getSQL, json, corsHeaders, getOpenAIKey } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { CREATOR_OWNER_ID, ensureCreatorSchema, generateOne, regenerateDraft } from '../_lib/creator.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Черновики «Креатора». Доступ — ТОЛЬКО владелец (точный id): админов
 * в системе несколько, роль здесь не аргумент. Генерация — по одному
 * черновику на запрос: edge-функция обязана начать отвечать за 25 секунд,
 * три поста одним вызовом модели в лимит не влезают.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  const sql = getSQL()
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  if (ctx.agentId !== CREATOR_OWNER_ID) return json({ error: 'forbidden' }, 403)
  await ensureCreatorSchema(sql)

  if (req.method === 'GET') {
    const [drafts, corpus] = await Promise.all([
      sql`SELECT * FROM creator_drafts ORDER BY created_at DESC LIMIT 60`,
      sql`SELECT count(*)::int AS n FROM creator_corpus`,
    ])
    return json({ drafts, corpusCount: (corpus[0] as any)?.n ?? 0 })
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  let body: any = {}
  try { body = await req.json() } catch { /* пустое тело */ }

  if (body.action === 'generate') {
    const line = (['delever', 'delever_archive', 'gfsupport'] as const)
      .find(l => l === body.line) || 'delever'
    const key = await getOpenAIKey()
    if (!key) return json({ error: 'нет ключа OpenAI в настройках' }, 500)
    const batchKey = String(body.batchKey || new Date().toISOString().slice(0, 10))
    try {
      const row = await generateOne(sql, key, line, batchKey)
      return json({ draft: row })
    } catch (e: any) {
      return json({ error: e?.message || 'ошибка генерации' }, 502)
    }
  }

  if (body.action === 'regenerate') {
    const key = await getOpenAIKey()
    if (!key) return json({ error: 'нет ключа OpenAI в настройках' }, 500)
    try {
      const row = await regenerateDraft(sql, key, String(body.id))
      return json({ draft: row })
    } catch (e: any) {
      return json({ error: e?.message || 'ошибка перегенерации' }, 502)
    }
  }

  if (body.action === 'status') {
    const status = String(body.status || '')
    if (!['draft', 'approved', 'rejected', 'published'].includes(status)) {
      return json({ error: 'bad status' }, 400)
    }
    await sql`UPDATE creator_drafts SET status = ${status}, updated_at = now() WHERE id = ${String(body.id)}`
    return json({ ok: true })
  }

  if (body.action === 'edit') {
    const id = String(body.id)
    const ru = typeof body.body_ru === 'string' ? body.body_ru : null
    const en = typeof body.body_en === 'string' ? body.body_en : null
    await sql`
      UPDATE creator_drafts SET
        body_ru = COALESCE(${ru}, body_ru),
        body_en = COALESCE(${en}, body_en),
        updated_at = now()
      WHERE id = ${id}`
    return json({ ok: true })
  }

  if (body.action === 'delete') {
    await sql`DELETE FROM creator_drafts WHERE id = ${String(body.id)}`
    return json({ ok: true })
  }

  return json({ error: 'unknown action' }, 400)
}
