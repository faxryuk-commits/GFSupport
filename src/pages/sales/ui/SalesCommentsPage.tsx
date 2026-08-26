import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Chip, PageShell, Skeleton, Btn, fmtDateTime, useAutoRefresh } from './kit'
import { useRegion, RegionBadge } from './region'

/**
 * Комментарии под постами Instagram и Facebook.
 *
 * Отдельно от диалогов, потому что это другая работа. В личке отвечают
 * одному человеку, а под рекламным постом вопрос висит на виду у всех, кто
 * этот пост увидит, — и молчание там стоит дороже. Поэтому экран отвечает на
 * один вопрос: где мы ещё не ответили.
 */

interface Comment {
  id: string
  platform: string
  comment_id: string
  post_id: string | null
  permalink: string | null
  market_id: string | null
  author_name: string | null
  text: string
  is_hidden: boolean
  replied_at: string | null
  replied_by: string | null
  reply_text: string | null
  created_at: string
  /** Публикация, под которой написали: без неё ответ пишется вслепую. */
  post: {
    kind: string | null
    caption: string | null
    thumb_url: string | null
    permalink: string | null
    published_at: string | null
    fetch_error: string | null
  } | null
  ai_class?: string | null
  ai_draft?: string | null
  ai_reason?: string | null
  ai_auto?: boolean
}

/** Как агент разобрал комментарий — и что из этого следует. */
const AI_CLASS: Record<string, { label: string; tone: string }> = {
  praise: { label: 'похвала', tone: 'green' },
  question: { label: 'вопрос', tone: 'blue' },
  complaint: { label: 'жалоба', tone: 'red' },
  spam: { label: 'спам', tone: 'gray' },
  other: { label: 'прочее', tone: 'gray' },
}

interface Data {
  items: Comment[]
  stats: { open?: number; answered?: number; hidden?: number; total?: number }
  connected: Array<{ pageName: string | null; igUsername: string | null; marketId: string | null }>
}

const VIEWS: Array<[string, string]> = [
  ['open', 'Без ответа'],
  ['all', 'Все'],
  ['hidden', 'Скрытые'],
]

const PLATFORMS: Array<[string, string]> = [
  ['', 'Обе площадки'],
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
]

export function SalesCommentsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [view, setView] = useState('open')
  const [platform, setPlatform] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [answering, setAnswering] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const region = useRegion('comments')

  const load = useCallback(() => {
    apiGet<Data>(`/integrations/meta-comments-api?view=${view}&platform=${platform}`, false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить комментарии'))
  }, [view, platform, region])

  useEffect(() => { load() }, [load])
  useAutoRefresh(load, 60000)

  // Текст можно передать явно: при отправке черновика состояние обновится
  // только к следующей отрисовке, и ответ ушёл бы пустым
  const reply = async (c: Comment, override?: string) => {
    const text = (override ?? draft).trim()
    if (!text) return
    setBusy(c.comment_id)
    try {
      await apiPost('/integrations/meta-comments-api?action=reply', { commentId: c.comment_id, text })
      setAnswering(null); setDraft('')
      load()
    } catch (e: any) {
      setError(e?.message || 'Ответ не ушёл')
    } finally { setBusy(null) }
  }

  const toggleHidden = async (c: Comment) => {
    setBusy(c.comment_id)
    try {
      await apiPost('/integrations/meta-comments-api?action=hide',
        { commentId: c.comment_id, hidden: !c.is_hidden })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось изменить')
    } finally { setBusy(null) }
  }

  const importOld = async () => {
    setBusy('import')
    try {
      const r = await apiPost<{ comments: number; errors: string[] }>(
        '/integrations/meta-comments-api?action=import', {})
      setError(r.comments
        ? `Загружено комментариев: ${r.comments}${r.errors?.length ? ` · ${r.errors[0]}` : ''}`
        : (r.errors?.[0] || 'Новых комментариев не нашлось'))
      load()
    } catch (e: any) {
      setError(e?.message || 'Подгрузка не удалась')
    } finally { setBusy(null) }
  }

  if (!data && !error) return <Skeleton rows={6} />

  const s = data?.stats || {}
  return (
    <PageShell
      header={
        <div className="space-y-2">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-[17px] font-semibold text-gray-900 tracking-tight">Комментарии</h1>
            <span className="text-[12.5px] text-gray-500">
              без ответа <b className="text-gray-900">{s.open ?? 0}</b>
              {' · '}отвечено {s.answered ?? 0}
              {s.hidden ? ` · скрыто ${s.hidden}` : ''}
            </span>
            <RegionBadge scope="comments" />
            <div className="ml-auto flex gap-2">
              <Btn onClick={importOld} disabled={busy === 'import'}>
                {busy === 'import' ? 'Гружу…' : 'Подгрузить старые'}
              </Btn>
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap items-center">
            {VIEWS.map(([k, label]) => (
              <button key={k} onClick={() => setView(k)}
                className={`text-[11.5px] px-2.5 py-1 rounded-full border ${
                  view === k ? 'bg-gray-900 border-gray-900 text-white'
                             : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                {label}
              </button>
            ))}
            <span className="w-px h-4 bg-gray-200 mx-1" />
            {PLATFORMS.map(([k, label]) => (
              <button key={k || 'all'} onClick={() => setPlatform(k)}
                className={`text-[11.5px] px-2.5 py-1 rounded-full border ${
                  platform === k ? 'bg-blue-600 border-blue-600 text-white'
                                 : 'border-gray-200 text-gray-600 hover:border-blue-300'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {error && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] text-amber-800
                        flex items-center gap-3">
          <span className="min-w-0">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto flex-none font-semibold">Понятно</button>
        </div>
      )}

      {!data?.connected?.length && (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-[13px] text-gray-500">
          Аккаунты Meta не подключены. Подключите страницу в настройках интеграций —
          комментарии начнут приходить сами.
        </div>
      )}

      {data?.items.length === 0 && data.connected.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-[13px] text-gray-400">
          {view === 'open' ? 'Всё разобрано — ни одного комментария без ответа.' : 'Пусто.'}
        </div>
      )}

      <div className="space-y-2">
        {(data?.items || []).map(c => (
          <article key={c.id} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            {/* Публикация идёт первой строкой: сначала «под чем», потом «что
                написали». В обратном порядке человек читает реплику без
                контекста и додумывает его сам */}
            <div className="flex gap-3">
              {c.post?.thumb_url ? (
                <a href={c.post.permalink || undefined} target="_blank" rel="noreferrer"
                  className="flex-none block w-14 h-14 rounded-lg overflow-hidden bg-gray-100
                             border border-gray-200 hover:border-blue-400 transition-colors">
                  <img src={c.post.thumb_url} alt="" className="w-full h-full object-cover" />
                </a>
              ) : (
                <div className="flex-none w-14 h-14 rounded-lg bg-gray-50 border border-dashed
                                border-gray-200 grid place-items-center text-[10px] text-gray-300 text-center px-1">
                  {c.post?.fetch_error ? 'нет доступа' : 'без обложки'}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5 flex-wrap text-[11.5px] text-gray-400">
                  <span className="font-medium text-gray-600">
                    {c.post?.kind || (c.platform === 'instagram' ? 'публикация' : 'пост')}
                  </span>
                  {c.post?.published_at && (
                    <span className="tabular-nums">от {fmtDateTime(c.post.published_at)}</span>
                  )}
                  {(c.post?.permalink || c.permalink) && (
                    <a href={c.post?.permalink || c.permalink || undefined} target="_blank" rel="noreferrer"
                      className="text-blue-600 hover:underline">открыть</a>
                  )}
                </div>
                {c.post?.caption && (
                  <p className="text-[12px] text-gray-500 mt-0.5 line-clamp-2">{c.post.caption}</p>
                )}
              </div>
            </div>

            <div className="flex items-baseline gap-2 flex-wrap mt-2.5 pt-2.5 border-t border-gray-100">
              <span className="text-[13px] font-medium text-gray-900">
                {c.author_name || 'Без имени'}
              </span>
              <Chip tone={c.platform === 'instagram' ? 'violet' : 'blue'}>
                {c.platform === 'instagram' ? 'Instagram' : 'Facebook'}
              </Chip>
              {c.is_hidden && <Chip tone="gray">скрыт</Chip>}
              {c.replied_at
                ? <Chip tone="green">отвечено</Chip>
                : <Chip tone="amber">без ответа</Chip>}
              {c.ai_class && (
                <span title={c.ai_reason || undefined}>
                  <Chip tone={AI_CLASS[c.ai_class]?.tone || 'gray'}>
                    {AI_CLASS[c.ai_class]?.label || c.ai_class}
                  </Chip>
                </span>
              )}
              {c.ai_auto && <Chip tone="violet">ответил агент</Chip>}
              <span className="text-[11.5px] text-gray-400 tabular-nums">{fmtDateTime(c.created_at)}</span>
            </div>

            <p className="text-[13px] text-gray-900 mt-1.5 whitespace-pre-wrap">{c.text}</p>

            {c.reply_text && (
              <div className="mt-2 pl-3 border-l-2 border-emerald-200">
                <div className="text-[12.5px] text-gray-700 whitespace-pre-wrap">{c.reply_text}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  {c.replied_by || 'Команда'}
                  {c.replied_at ? ` · ${fmtDateTime(c.replied_at)}` : ''}
                </div>
              </div>
            )}

            {/* Черновик агента: он не отправлен и не отправится сам — там,
                где цена ошибки высокая, последнее слово за человеком */}
            {!c.replied_at && c.ai_draft && answering !== c.comment_id && (
              <div className="mt-2 rounded-lg bg-violet-50/60 border border-violet-100 px-3 py-2">
                <div className="text-[11px] text-violet-700 font-medium mb-0.5">
                  Черновик агента{c.ai_reason ? ` · ${c.ai_reason}` : ''}
                </div>
                <div className="text-[12.5px] text-gray-800 whitespace-pre-wrap">{c.ai_draft}</div>
                <div className="flex gap-1.5 mt-2">
                  <button
                    onClick={() => reply(c, c.ai_draft || '')}
                    disabled={busy === c.comment_id}
                    className="text-[11.5px] px-2.5 py-1 rounded border border-violet-300 text-violet-700
                               hover:bg-violet-100 disabled:opacity-50">
                    Отправить как есть
                  </button>
                  <button
                    onClick={() => { setAnswering(c.comment_id); setDraft(c.ai_draft || '') }}
                    className="text-[11.5px] px-2.5 py-1 rounded border border-gray-200 text-gray-600
                               hover:border-blue-300">
                    Поправить
                  </button>
                </div>
              </div>
            )}

            {answering === c.comment_id ? (
              <div className="mt-2 flex gap-2 items-start">
                <textarea
                  autoFocus rows={2} value={draft} onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) reply(c)
                    if (e.key === 'Escape') { setAnswering(null); setDraft('') }
                  }}
                  placeholder="Ответ появится под постом от имени страницы"
                  className="flex-1 text-[13px] px-3 py-2 border border-gray-200 rounded-lg
                             focus:outline-none focus:border-blue-400 resize-y"
                />
                <div className="flex flex-col gap-1.5">
                  <Btn kind="primary" onClick={() => reply(c)} disabled={busy === c.comment_id || !draft.trim()}>
                    {busy === c.comment_id ? '…' : 'Ответить'}
                  </Btn>
                  <Btn onClick={() => { setAnswering(null); setDraft('') }}>Отмена</Btn>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <Btn onClick={() => { setAnswering(c.comment_id); setDraft('') }}>
                  {c.replied_at ? 'Ответить ещё' : 'Ответить'}
                </Btn>
                <Btn kind={c.is_hidden ? 'ghost' : 'danger'}
                  onClick={() => toggleHidden(c)} disabled={busy === c.comment_id}>
                  {c.is_hidden ? 'Показать' : 'Скрыть'}
                </Btn>
              </div>
            )}
          </article>
        ))}
      </div>
    </PageShell>
  )
}

export default SalesCommentsPage
