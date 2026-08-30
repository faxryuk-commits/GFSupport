import { getOpenAIKey } from './db.js'
import { tokenForPage } from './meta-config.js'
import { replyToComment } from './meta-comments.js'

/**
 * Комьюнити-менеджер под постами.
 *
 * Устроен не как «ИИ отвечает на комментарии», а как «сначала разобрать,
 * потом решить, кто отвечает». Ошибка тут публична: неудачную реплику под
 * рекламным постом видят все, кто увидит пост, и удалить её — уже событие.
 * Поэтому агент берёт на себя только то, где ошибиться невозможно, а всё
 * остальное готовит человеку.
 *
 *   похвала, эмодзи   → отвечает сам, коротко и тепло
 *   вопрос            → черновик, отправляет человек
 *   жалоба, негатив   → ничего не пишет, зовёт человека
 *   спам              → предлагает скрыть
 *
 * Каждое решение вместе с причиной ложится в карточку комментария: молчаливая
 * автоматика через неделю превращается в чёрный ящик, из которого не выбраться.
 */

export type CommentClass = 'praise' | 'question' | 'complaint' | 'spam' | 'other'

/** Что агент делает с каждым разбором. Хранится рядом, чтобы правило было видно. */
const POLICY: Record<CommentClass, 'auto' | 'draft' | 'human'> = {
  praise: 'auto',
  question: 'draft',
  complaint: 'human',
  spam: 'human',
  other: 'draft',
}

interface Verdict {
  klass: CommentClass
  reason: string
  reply: string | null
}

/**
 * Разбор и ответ одним обращением к модели.
 *
 * Двумя вызовами было бы чище, но комментарий короткий, и второй заход
 * удваивал бы задержку ради разделения, которое всё равно делает одна модель.
 */
async function think(
  key: string, orgName: string, comment: string, author: string,
  post: { kind?: string | null; caption?: string | null } | null,
): Promise<Verdict | null> {
  const system = [
    `Ты — комьюнити-менеджер ${orgName}, платформы доставки для ресторанов.`,
    'Отвечаешь под постами в Instagram и Facebook от имени компании.',
    'Тон: тёплый и короткий. Одна-две фразы, живая речь, без канцелярита.',
    'Эмодзи — не больше одного и только если он уместен.',
    'Никогда не называй цены, сроки, скидки и условия — этого ты не знаешь.',
    'Отвечай на языке комментария.',
    '',
    'Сначала определи вид комментария:',
    'praise — похвала, эмодзи, одобрение, поздравление; ответа по существу не требует',
    'question — спрашивают о продукте, цене, условиях, подключении',
    'complaint — недовольство, претензия, упоминание конкурента, негатив',
    'spam — реклама, накрутка, бессмыслица, ссылки',
    'other — всё прочее',
    '',
    'Верни строго JSON: {"class":"...","reason":"почему так решил, до 90 знаков",',
    '"reply":"текст ответа или null"}',
    'Для complaint и spam reply всегда null — с ними разбирается человек.',
  ].join('\n')

  const ctx = post?.caption
    ? `Публикация (${post.kind || 'пост'}): «${String(post.caption).slice(0, 220)}»`
    : 'Публикация неизвестна.'
  const user = `${ctx}\n\nКомментарий от ${author || 'гостя'}:\n«${comment.slice(0, 500)}»`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 220,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    })
    const data: any = await res.json()
    const raw = data?.choices?.[0]?.message?.content
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const klass: CommentClass =
      (['praise', 'question', 'complaint', 'spam', 'other'] as const)
        .find(k => k === parsed.class) || 'other'
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : ''
    return {
      klass,
      reason: String(parsed.reason || '').slice(0, 200),
      reply: reply && reply.toLowerCase() !== 'null' ? reply : null,
    }
  } catch {
    return null
  }
}

/**
 * Разобрать один комментарий и сделать то, что положено по его виду.
 *
 * Возвращает, что именно решено, — по этому в логах видно, работает агент
 * или молча простаивает.
 */
export async function handleCommentByAgent(
  sql: any, orgId: string, commentId: string,
  opts: { autoReply?: boolean; orgName?: string } = {},
): Promise<{ klass: CommentClass; action: string } | null> {
  const key = await getOpenAIKey()
  if (!key) return null

  const [c] = await sql`
    SELECT c.*, p.kind AS post_kind, p.caption AS post_caption
    FROM support_meta_comments c
    LEFT JOIN support_meta_posts p ON p.org_id = c.org_id AND p.post_id = c.post_id
    WHERE c.org_id = ${orgId} AND c.comment_id = ${commentId} LIMIT 1
  ` as any[]
  // Свои же ответы и уже разобранное трогать незачем
  if (!c || c.is_ours || c.ai_at || c.replied_at) return null

  const verdict = await think(
    key, opts.orgName || 'Delever', String(c.text || ''), String(c.author_name || ''),
    { kind: c.post_kind, caption: c.post_caption })
  if (!verdict) return null

  const want = POLICY[verdict.klass]
  // Автоответ только там, где ошибиться невозможно, и только если разрешён
  const auto = want === 'auto' && opts.autoReply !== false && Boolean(verdict.reply)
  let action: string = want

  if (auto) {
    const token = await tokenForPage(orgId, c.page_id)
    const sent = token
      ? await replyToComment(token, c.platform, commentId, verdict.reply as string)
      : { ok: false, error: 'страница не подключена' }
    if (sent.ok) {
      await sql`
        UPDATE support_meta_comments
        SET replied_at = NOW(), replied_by = 'Агент', reply_text = ${verdict.reply},
            ai_class = ${verdict.klass}, ai_reason = ${verdict.reason},
            ai_at = NOW(), ai_auto = true
        WHERE org_id = ${orgId} AND comment_id = ${commentId}
      `
      return { klass: verdict.klass, action: 'auto' }
    }
    // Meta не приняла — не теряем ответ, отдаём человеку черновиком
    action = 'draft'
  }

  await sql`
    UPDATE support_meta_comments
    SET ai_class = ${verdict.klass}, ai_reason = ${verdict.reason},
        ai_draft = ${action === 'human' ? null : verdict.reply},
        ai_at = NOW(), ai_auto = false
    WHERE org_id = ${orgId} AND comment_id = ${commentId}
  `
  return { klass: verdict.klass, action }
}
