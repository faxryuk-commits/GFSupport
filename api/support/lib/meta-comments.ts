import { salesId } from './sales-schema.js'
import { accountForIg, accountForPage, readMetaAccounts } from './meta-config.js'

/**
 * Комментарии под постами Instagram и Facebook.
 *
 * Директ и комментарии приходят на один и тот же адрес вебхука, но разными
 * ветками: сообщения лежат в entry.messaging, комментарии — в entry.changes.
 * Вторую ветку мы не разбирали вовсе, поэтому комментарии просто пропадали:
 * человек писал под рекламным постом и не получал ответа никогда.
 *
 * Комьюнити-менеджмент отличается от переписки: тут важно не «кто написал»,
 * а «под каким постом» и «ответили ли». Поэтому это отдельная таблица, а не
 * канал в общей ленте — иначе один пост с полусотней комментариев породил бы
 * полсотни диалогов.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'

/** Наши же ответы приходят обратно вебхуком — их нельзя считать обращениями. */
function isOurs(fromId: string, pageId: string | null, igId: string | null): boolean {
  const id = String(fromId || '')
  return Boolean(id && (id === String(pageId || '') || id === String(igId || '')))
}

/**
 * Разбор уведомления с комментариями. Возвращает, сколько принято, —
 * по этому числу в логах видно, живёт канал или молчит.
 */
export async function handleMetaComments(
  sql: any, orgId: string, body: any,
): Promise<string[]> {
  const isInstagram = body?.object === 'instagram'
  const platform = isInstagram ? 'instagram' : 'facebook'
  // Возвращаем не счётчик, а сами новые комментарии: их разбирает агент, и
  // ему нужно знать, какие именно появились, а не сколько
  const fresh: string[] = []

  for (const entry of body?.entry || []) {
    const acc = isInstagram
      ? await accountForIg(orgId, entry.id ? String(entry.id) : null)
      : await accountForPage(orgId, entry.id ? String(entry.id) : null)
    if (!(await pageIsLive(orgId, acc))) continue

    for (const ch of entry.changes || []) {
      // Instagram шлёт поле comments, страница — feed со множеством событий:
      // лайки, посты, реакции. Нужны только комментарии
      const v = ch?.value || {}
      if (isInstagram && ch.field !== 'comments') continue
      if (!isInstagram && (ch.field !== 'feed' || v.item !== 'comment')) continue
      // Удаление и правку не храним: строка уже есть, и подменять текст
      // задним числом значит потерять то, на что отвечали
      if (!isInstagram && v.verb && v.verb !== 'add') continue

      const commentId = String(v.comment_id || v.id || '')
      if (!commentId) continue
      const text = String(v.message ?? v.text ?? '').trim()
      const fromId = String(v.from?.id || '')
      const author = v.from?.username ? `@${v.from.username}` : (v.from?.name || null)

      const ours = isOurs(fromId, acc?.pageId || null, acc?.igUserId || null)
      const at = v.created_time
        ? new Date(Number(v.created_time) * 1000).toISOString()
        : new Date().toISOString()

      const done = await sql`
        INSERT INTO support_meta_comments (
          id, org_id, platform, comment_id, parent_id, post_id, page_id, market_id,
          author_id, author_name, text, is_ours, created_at
        )
        SELECT ${salesId('mcm')}, ${orgId}, ${platform}, ${commentId},
               ${v.parent_id ? String(v.parent_id) : null},
               ${String(v.post_id || v.media?.id || '') || null},
               ${acc?.pageId || null}, ${acc?.marketId || null},
               ${fromId || null}, ${author}, ${text || '[без текста]'}, ${ours}, ${at}::timestamptz
        WHERE NOT EXISTS (
          SELECT 1 FROM support_meta_comments
          WHERE org_id = ${orgId} AND comment_id = ${commentId}
        )
        RETURNING id
      ` as any[]
      if (done.length && !ours) fresh.push(commentId)

      // Наш ответ, пришедший обратно, закрывает родительский комментарий:
      // иначе он вечно висел бы в «без ответа», хотя ответ уже под ним
      if (ours && v.parent_id) {
        await sql`
          UPDATE support_meta_comments
          SET replied_at = COALESCE(replied_at, ${at}::timestamptz),
              reply_text = COALESCE(reply_text, ${text})
          WHERE org_id = ${orgId} AND comment_id = ${String(v.parent_id)}
        `
      }
    }
  }
  return fresh
}

/**
 * Ответ под комментарием. У Instagram и Facebook разные адреса: у первого
 * это /replies, у второго — вложенный /comments.
 */
export async function replyToComment(
  token: string, platform: string, commentId: string, message: string,
): Promise<{ ok: boolean; error?: string }> {
  const path = platform === 'instagram' ? 'replies' : 'comments'
  try {
    const res = await fetch(`${GRAPH}/${commentId}/${path}?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    if (res.ok) return { ok: true }
    const detail = await res.text().catch(() => '')
    return { ok: false, error: detail.slice(0, 300) }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'нет связи с Meta' }
  }
}

/** Скрыть или вернуть комментарий: спам убираем, не удаляя чужие слова. */
export async function hideComment(
  token: string, commentId: string, hidden: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${GRAPH}/${commentId}?is_hidden=${hidden}&access_token=${token}`, { method: 'POST' })
    if (res.ok) return { ok: true }
    const detail = await res.text().catch(() => '')
    return { ok: false, error: detail.slice(0, 300) }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'нет связи с Meta' }
  }
}

/**
 * Разовая подгрузка комментариев под последними постами.
 *
 * Вебхук приносит только новое, а под рекламой уже висят вопросы, на которые
 * никто не ответил. Без этого раздел первое время выглядел бы пустым при
 * полусотне живых комментариев.
 */
export async function importMetaComments(
  sql: any, orgId: string, accounts: any[], postLimit = 25,
): Promise<{ comments: number; errors: string[] }> {
  const out = { comments: 0, errors: [] as string[] }

  for (const acc of accounts) {
    if (!acc.pageToken) continue
    const sources: Array<[string, string]> = [['facebook', `${acc.pageId}/posts`]]
    if (acc.igUserId) sources.push(['instagram', `${acc.igUserId}/media`])

    for (const [platform, path] of sources) {
      try {
        const pr = await fetch(
          `${GRAPH}/${path}?fields=id,permalink_url,permalink&limit=${postLimit}`
          + `&access_token=${acc.pageToken}`)
        const pd: any = await pr.json()
        if (pd?.error) { out.errors.push(`${acc.pageName} ${platform}: ${String(pd.error.message).slice(0, 120)}`); continue }

        for (const post of pd?.data || []) {
          const cr = await fetch(
            `${GRAPH}/${post.id}/comments?fields=id,text,message,from,parent,created_time,hidden`
            + `&limit=100&access_token=${acc.pageToken}`)
          const cd: any = await cr.json()
          if (cd?.error) continue

          for (const c of cd?.data || []) {
            const text = String(c.message ?? c.text ?? '').trim()
            const fromId = String(c.from?.id || '')
            const ours = isOurs(fromId, acc.pageId, acc.igUserId)
            const done = await sql`
              INSERT INTO support_meta_comments (
                id, org_id, platform, comment_id, parent_id, post_id, page_id, market_id,
                author_id, author_name, text, permalink, is_hidden, is_ours, created_at
              )
              SELECT ${salesId('mcm')}, ${orgId}, ${platform}, ${String(c.id)},
                     ${c.parent?.id ? String(c.parent.id) : null}, ${String(post.id)},
                     ${acc.pageId}, ${acc.marketId}, ${fromId || null},
                     ${c.from?.username ? `@${c.from.username}` : (c.from?.name || null)},
                     ${text || '[без текста]'},
                     ${post.permalink_url || post.permalink || null},
                     ${Boolean(c.hidden)}, ${ours},
                     ${c.created_time ? new Date(c.created_time).toISOString() : new Date().toISOString()}::timestamptz
              WHERE NOT EXISTS (
                SELECT 1 FROM support_meta_comments
                WHERE org_id = ${orgId} AND comment_id = ${String(c.id)}
              )
              RETURNING id
            ` as any[]
            out.comments += done.length
          }
        }
      } catch (e: any) {
        out.errors.push(`${acc.pageName} ${platform}: ${e?.message || 'нет связи'}`)
      }
    }
  }
  return out
}

/**
 * Что за публикация, под которой написали.
 *
 * Отвечать вслепую нельзя: «🔥🔥🔥» под праздничным поздравлением и под
 * прайсом требуют разного ответа, а по одному идентификатору поста человек
 * этого не поймёт. Тянем обложку, подпись и вид публикации и держим их
 * рядом — у поста комментариев много, и запрашивать одно и то же на каждый
 * из них было бы расточительно.
 */
const POST_KIND: Record<string, string> = {
  IMAGE: 'фото', VIDEO: 'видео', CAROUSEL_ALBUM: 'карусель',
  REELS: 'рилс', STORY: 'сторис', AD: 'реклама', FEED: 'пост',
}

export async function ensurePostInfo(
  sql: any, orgId: string, accounts: any[],
  wanted: Array<{ postId: string; platform: string }>, budgetMs = 6000,
): Promise<Map<string, any>> {
  const known = new Map<string, any>()
  if (!wanted.length) return known

  const ids = wanted.map(w => w.postId)
  const rows = await sql`
    SELECT * FROM support_meta_posts
    WHERE org_id = ${orgId} AND post_id = ANY(${ids})
  ` as any[]
  for (const r of rows) known.set(r.post_id, r)

  // Заново не спрашиваем даже те, по которым раньше был отказ: обложка не
  // стоит того, чтобы долбить Meta на каждом открытии экрана
  const missing = wanted.filter(w => !known.has(w.postId))
  if (!missing.length || !accounts.length) return known

  // Наборы полей у площадок разные, и лишнее поле Graph не игнорирует, а
  // отвергает весь запрос: «message» у публикации инстаграма не существует,
  // и из-за него не приходило вообще ничего
  const FIELDS: Record<string, string> = {
    instagram: 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp',
    facebook: 'id,message,permalink_url,created_time,full_picture',
  }

  const until = Date.now() + budgetMs
  for (const { postId, platform } of missing) {
    if (Date.now() > until) break
    const order = platform === 'facebook' ? ['facebook', 'instagram'] : ['instagram', 'facebook']
    let saved: any = null

    outer:
    for (const kindOf of order) {
      for (const acc of accounts) {
        if (!acc.pageToken) continue
        try {
          const d: any = await (await fetch(
            `${GRAPH}/${postId}?fields=${FIELDS[kindOf]}&access_token=${acc.pageToken}`,
            { signal: AbortSignal.timeout(5000) })).json()
          if (d?.error) continue
          const kindKey = d.media_product_type === 'REELS' ? 'REELS'
            : d.media_product_type === 'STORY' ? 'STORY'
            : d.media_type || 'FEED'
          saved = {
            platform: kindOf,
            kind: POST_KIND[kindKey] || 'публикация',
            caption: String(d.caption ?? d.message ?? '').slice(0, 400) || null,
            thumb: d.thumbnail_url || d.media_url || d.full_picture || null,
            permalink: d.permalink || d.permalink_url || null,
            at: d.timestamp || d.created_time || null,
            pageId: acc.pageId,
          }
          break outer
        } catch { /* следующий токен: пост может принадлежать другой странице */ }
      }
    }

    await sql`
      INSERT INTO support_meta_posts (id, org_id, platform, post_id, page_id, kind,
                                      caption, thumb_url, permalink, published_at, fetch_error)
      VALUES (${salesId('mps')}, ${orgId}, ${saved?.platform || platform}, ${postId},
              ${saved?.pageId || null}, ${saved?.kind || null}, ${saved?.caption || null},
              ${saved?.thumb || null}, ${saved?.permalink || null},
              ${saved?.at ? new Date(saved.at).toISOString() : null},
              ${saved ? null : 'публикация недоступна'})
      ON CONFLICT (org_id, post_id) DO NOTHING
    `
    known.set(postId, {
      post_id: postId, kind: saved?.kind || null, caption: saved?.caption || null,
      thumb_url: saved?.thumb || null, permalink: saved?.permalink || null,
      published_at: saved?.at || null, fetch_error: saved ? null : 'публикация недоступна',
    })
  }
  return known
}

/**
 * Событие от страницы, которую у нас отключили, принимать нельзя.
 *
 * Подписку у Meta снять не всегда удаётся — сеть, отозванный токен, — и тогда
 * отключённая страница продолжает слать данные. Без этой проверки они молча
 * ложились в базу без региона и без страницы: «отключил» ничего не отключало.
 *
 * Если не подключено ни одного аккаунта, пропускаем всё: значит организация
 * ещё живёт на ключах из окружения, и ломать ей приём нельзя.
 */
async function pageIsLive(orgId: string, acc: any): Promise<boolean> {
  if (acc) return true
  const all = await readMetaAccounts(orgId)
  return all.length === 0
}
