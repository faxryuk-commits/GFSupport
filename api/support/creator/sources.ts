import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { RELEASES } from '../_lib/release-notes.js'
import {
  CREATOR_OWNER_ID, ensureCreatorSchema, fetchDeleverRelease,
  refreshCorpus, tgHandle,
} from '../_lib/creator.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

function sourceId(): string {
  return `crs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Каналы сбора и обогащения «Креатора». Системные источники (релизы Delever,
 * выпуски GFSupport, корпус стиля) вшиты и не отключаются; свои — телеграм-
 * каналы, RSS и страницы — радар подмешивает в генерацию как контекст рынка.
 * Доступ — только владелец, как и у черновиков.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  const sql = getSQL()
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  if (ctx.agentId !== CREATOR_OWNER_ID) return json({ error: 'forbidden' }, 403)
  await ensureCreatorSchema(sql)

  if (req.method === 'GET') {
    const [rows, corpus] = await Promise.all([
      sql`SELECT * FROM creator_sources ORDER BY added_at`,
      sql`SELECT count(*)::int AS n, max(posted_at) AS latest FROM creator_corpus`,
    ])
    // Свежий релиз Delever — коротким таймаутом: GitBook лежит → блок просто без даты
    let deleverLatest: string | null = null
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), 4000)
      const rel = await fetchDeleverRelease()
      clearTimeout(t)
      deleverLatest = rel?.title || null
    } catch { /* необязательная витрина */ }
    return json({
      sources: rows,
      builtin: {
        delever: { latest: deleverLatest },
        gfsupport: { latest: `${RELEASES[0]?.date} — ${RELEASES[0]?.title}` },
        corpus: { count: (corpus[0] as any)?.n ?? 0, latest: (corpus[0] as any)?.latest ?? null },
      },
    })
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  let body: any = {}
  try { body = await req.json() } catch { /* пустое тело */ }

  if (body.action === 'add') {
    const url = String(body.url || '').trim()
    const title = String(body.title || '').trim() || url
    let kind = String(body.kind || 'url')
    if (!url) return json({ error: 'нужна ссылка' }, 400)
    if (/t\.me\/|^@/.test(url)) kind = 'telegram'
    if (kind === 'telegram' && !tgHandle(url)) return json({ error: 'не похоже на ссылку телеграм-канала' }, 400)
    if (!['telegram', 'rss', 'url'].includes(kind)) kind = 'url'
    const id = sourceId()
    await sql`
      INSERT INTO creator_sources (id, kind, title, url)
      VALUES (${id}, ${kind}, ${title.slice(0, 120)}, ${url.slice(0, 500)})`
    const [row] = await sql`SELECT * FROM creator_sources WHERE id = ${id}`
    return json({ source: row })
  }

  if (body.action === 'toggle') {
    await sql`UPDATE creator_sources SET active = NOT active WHERE id = ${String(body.id)}`
    return json({ ok: true })
  }

  if (body.action === 'delete') {
    await sql`DELETE FROM creator_sources WHERE id = ${String(body.id)}`
    return json({ ok: true })
  }

  if (body.action === 'refresh_corpus') {
    const added = await refreshCorpus(sql)
    const [c] = await sql`SELECT count(*)::int AS n FROM creator_corpus`
    return json({ added, count: (c as any)?.n ?? 0 })
  }

  return json({ error: 'unknown action' }, 400)
}
