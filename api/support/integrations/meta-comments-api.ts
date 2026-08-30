import { getRequestOrgId } from '../_lib/org.js'
import { extractAgentContext } from '../_lib/auth.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { ensureMetaSchema, readMetaAccounts, tokenForPage } from '../_lib/meta-config.js'
import { ensurePostInfo, hideComment, importMetaComments, replyToComment } from '../_lib/meta-comments.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Комьюнити-менеджмент: комментарии под постами Instagram и Facebook.
 *
 * Смотрим не «кто написал», а «на что не ответили»: под рекламным постом
 * вопрос от живого человека висит на виду у всех остальных, и молчание там
 * стоит дороже, чем в личке.
 *
 * GET    ?view=open|all|hidden&platform=&market=  → список и сводка
 * POST   ?action=reply   { commentId, text }
 *        ?action=hide    { commentId, hidden }
 *        ?action=import  { posts? }
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureMetaSchema(sql)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  if (req.method === 'POST') {
    const action = url.searchParams.get('action') || ''
    const body = await req.json().catch(() => null)

    if (action === 'import') {
      const accounts = await readMetaAccounts(orgId)
      if (!accounts.length) return json({ error: 'Нет подключённых аккаунтов Meta' }, 400)
      const res = await importMetaComments(sql, orgId, accounts, Math.min(50, body?.posts || 25))
      return json({ ok: true, ...res })
    }

    const commentId = String(body?.commentId || '')
    if (!commentId) return json({ error: 'commentId is required' }, 400)
    const [row] = await sql`
      SELECT * FROM support_meta_comments
      WHERE org_id = ${orgId} AND comment_id = ${commentId} LIMIT 1
    ` as any[]
    if (!row) return json({ error: 'Комментарий не найден' }, 404)

    const token = await tokenForPage(orgId, row.page_id)
    if (!token) return json({ error: 'Страница не подключена — подключите её в настройках' }, 400)

    if (action === 'reply') {
      const text = String(body?.text || '').trim()
      if (!text) return json({ error: 'Пустой ответ отправлять некуда' }, 400)
      const res = await replyToComment(token, row.platform, commentId, text)
      if (!res.ok) return json({ error: 'Meta не приняла ответ', details: res.error }, 502)

      const [me] = await sql`SELECT name FROM support_agents WHERE id = ${ctx.agentId} LIMIT 1` as any[]
      await sql`
        UPDATE support_meta_comments
        SET replied_at = NOW(), replied_by = ${me?.name || 'Команда'}, reply_text = ${text}
        WHERE org_id = ${orgId} AND comment_id = ${commentId}
      `
      return json({ ok: true })
    }

    if (action === 'hide') {
      const hidden = Boolean(body?.hidden)
      const res = await hideComment(token, row.platform, commentId, hidden)
      if (!res.ok) return json({ error: 'Meta не приняла изменение', details: res.error }, 502)
      await sql`
        UPDATE support_meta_comments SET is_hidden = ${hidden}
        WHERE org_id = ${orgId} AND comment_id = ${commentId}
      `
      return json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const view = url.searchParams.get('view') || 'open'
  const platform = url.searchParams.get('platform') || ''
  const market = url.searchParams.get('market') || ''
  const limit = Math.min(300, Math.max(1, parseInt(url.searchParams.get('limit') || '100')))

  const [items, stats] = await sql.transaction([
    sql`
      SELECT * FROM support_meta_comments
      WHERE org_id = ${orgId}
        -- Свои же ответы в списке не нужны: это не обращения, а наша работа
        AND is_ours = false
        AND (${platform} = '' OR platform = ${platform})
        AND (${market} = '' OR market_id = ${market})
        AND (${view} <> 'open' OR (replied_at IS NULL AND is_hidden = false))
        AND (${view} <> 'hidden' OR is_hidden = true)
      ORDER BY created_at DESC
      LIMIT ${limit}
    `,
    sql`
      SELECT
        COUNT(*) FILTER (WHERE replied_at IS NULL AND is_hidden = false)::int AS open,
        COUNT(*) FILTER (WHERE replied_at IS NOT NULL)::int AS answered,
        COUNT(*) FILTER (WHERE is_hidden = true)::int AS hidden,
        COUNT(*)::int AS total
      FROM support_meta_comments
      WHERE org_id = ${orgId} AND is_ours = false
        AND (${platform} = '' OR platform = ${platform})
        AND (${market} = '' OR market_id = ${market})
    `,
  ]) as any[]

  const accounts = await readMetaAccounts(orgId)

  // Публикация, под которой написали: обложка, подпись и вид. Без них человек
  // отвечает вслепую — «огонёк» под поздравлением и под прайсом требуют
  // разного ответа. Тянем только для показанной страницы и с запасом времени
  const seen = new Map<string, string>()
  for (const c of items as any[]) if (c.post_id && !seen.has(c.post_id)) seen.set(c.post_id, c.platform)
  const posts = await ensurePostInfo(sql, orgId, accounts,
    [...seen].map(([postId, platform]) => ({ postId, platform })))

  return json({
    items: (items as any[]).map(c => ({ ...c, post: posts.get(c.post_id) || null })),
    stats: (stats as any[])[0] || {},
    connected: accounts.map(a => ({ pageName: a.pageName, igUsername: a.igUsername, marketId: a.marketId })),
  })
}
