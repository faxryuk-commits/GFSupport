import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import {
  Sparkles, Copy, Check, X, Pencil, Trash2, RefreshCw, Rss, Radar,
  Send, BookOpen, Wrench, MessageCircle, Plus, Power,
} from 'lucide-react'

/**
 * «Креатор» — личный модуль владельца: черновики постов для LinkedIn (англ.)
 * и Telegram-канала на фактах релизов Delever (GitBook) и GFSupport.
 *
 * Русский и английский всегда видны рядом: владелец сверяет смысл по-русски,
 * копирует английский для LinkedIn. Ничего не публикуется автоматически.
 * Вкладка «Источники» — каналы сбора и обогащения: системные плюс свои
 * (телеграм-каналы, RSS, страницы), радар подмешивает их в генерацию.
 */

interface Draft {
  id: string
  created_at: string
  batch_key: string
  line: 'delever' | 'delever_archive' | 'gfsupport' | 'cycle'
  cycle_role?: string | null
  title: string
  body_ru: string
  body_en: string
  status: 'draft' | 'approved' | 'rejected' | 'published'
  source?: { url?: string | null } | null
}

interface Source {
  id: string
  kind: 'telegram' | 'rss' | 'url'
  title: string
  url: string
  active: boolean
  added_at: string
}

interface Builtin {
  delever: { latest: string | null }
  gfsupport: { latest: string | null }
  corpus: { count: number; latest: string | null }
}

const LINE_LABEL: Record<Draft['line'], { label: string; cls: string }> = {
  delever: { label: 'Delever', cls: 'bg-blue-50 text-blue-700' },
  delever_archive: { label: 'Delever · вечнозелёный', cls: 'bg-sky-50 text-sky-700' },
  gfsupport: { label: 'как мы строим', cls: 'bg-violet-50 text-violet-700' },
  cycle: { label: 'серия', cls: 'bg-amber-50 text-amber-700' },
}

const GOAL_LABEL: Record<string, { label: string; cls: string }> = {
  warmup: { label: 'прогрев', cls: 'bg-emerald-50 text-emerald-700' },
  brand: { label: 'бренд', cls: 'bg-violet-50 text-violet-700' },
  desire: { label: 'желание', cls: 'bg-rose-50 text-rose-700' },
}

interface Cycle {
  id: string
  week_key: string
  goal: string
  theme: string
  rationale: string
  plan: Array<{ role: string; brief: string }>
  status: 'proposed' | 'approved' | 'done'
}

const STATUS_LABEL: Record<Draft['status'], { label: string; cls: string }> = {
  draft: { label: 'черновик', cls: 'bg-amber-50 text-amber-700' },
  approved: { label: 'одобрен', cls: 'bg-emerald-50 text-emerald-700' },
  rejected: { label: 'отклонён', cls: 'bg-red-50 text-red-600' },
  published: { label: 'опубликован', cls: 'bg-blue-600 text-white' },
}

const SOURCE_KIND: Record<Source['kind'], string> = {
  telegram: 'Telegram', rss: 'RSS', url: 'Страница',
}

type Tab = 'drafts' | 'approved' | 'archive' | 'cycles' | 'sources'

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
      className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
    >
      {done ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
      {done ? 'Скопировано' : label}
    </button>
  )
}

/** Колонка одного языка: текст, копирование, правка на месте. */
function LangCol({ lang, body, onSave }: { lang: 'ru' | 'en'; body: string; onSave: (t: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  return (
    <div className="min-w-0 flex flex-col">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10.5px] font-bold uppercase tracking-wide text-gray-400">
          {lang === 'ru' ? 'Русский — канал' : 'English — LinkedIn'}
        </span>
        <div className="flex-1" />
        {!editing && <CopyBtn text={body} label="Копировать" />}
        {!editing && (
          <button
            onClick={() => { setText(body); setEditing(true) }}
            className="inline-flex items-center gap-1 text-[11.5px] px-2 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50"
          ><Pencil size={11} /> Править</button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2 flex-1">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={14}
            className="w-full h-full min-h-[220px] text-[12.5px] leading-relaxed border border-gray-300 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          <div className="flex gap-2">
            <button
              onClick={async () => { await onSave(text); setEditing(false) }}
              className="text-[11.5px] font-semibold px-2.5 py-1 rounded-md bg-gray-900 text-white"
            >Сохранить</button>
            <button onClick={() => setEditing(false)} className="text-[11.5px] px-2.5 py-1 rounded-md text-gray-500 hover:bg-gray-100">Отмена</button>
          </div>
        </div>
      ) : (
        <div className="text-[12.5px] text-gray-800 leading-relaxed whitespace-pre-wrap bg-gray-50/60 border border-gray-100 rounded-lg p-3 flex-1">
          {body}
        </div>
      )}
    </div>
  )
}

function DraftCard({ d, onChanged }: { d: Draft; onChanged: () => void }) {
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    await apiPost('/creator/drafts', { action, id: d.id, ...extra })
    onChanged()
  }
  return (
    <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <header className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2 flex-wrap">
        <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md ${(LINE_LABEL[d.line] || LINE_LABEL.delever).cls}`}>
          {(LINE_LABEL[d.line] || LINE_LABEL.delever).label}
        </span>
        {d.cycle_role && (
          <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500">{d.cycle_role}</span>
        )}
        <h2 className="text-[13.5px] font-semibold text-gray-900 flex-1 min-w-0 truncate">{d.title || 'Без названия'}</h2>
        <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md ${STATUS_LABEL[d.status].cls}`}>
          {STATUS_LABEL[d.status].label}
        </span>
      </header>

      {/* Русский всегда рядом с английским: смысл сверяется по-русски */}
      <div className="px-4 py-3 grid gap-4 lg:grid-cols-2">
        <LangCol lang="ru" body={d.body_ru} onSave={t => act('edit', { body_ru: t })} />
        <LangCol lang="en" body={d.body_en} onSave={t => act('edit', { body_en: t })} />
      </div>

      <footer className="px-4 py-2.5 border-t border-gray-100 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-gray-400 tabular-nums">выпуск {d.batch_key}</span>
        <div className="flex-1" />
        {d.status !== 'approved' && d.status !== 'published' && (
          <button onClick={() => act('status', { status: 'approved' })}
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700">
            <Check size={12} /> Одобрить
          </button>
        )}
        {d.status === 'approved' && (
          <button onClick={() => act('status', { status: 'published' })}
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700">
            <Send size={12} /> Отметить опубликованным
          </button>
        )}
        {d.status !== 'rejected' && d.status !== 'published' && (
          <button onClick={() => act('status', { status: 'rejected' })}
            className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2.5 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50">
            <X size={12} /> Отклонить
          </button>
        )}
        {d.status === 'rejected' && (
          <button onClick={() => act('status', { status: 'draft' })}
            className="inline-flex items-center gap-1 text-[11.5px] px-2.5 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50">
            Вернуть в черновики
          </button>
        )}
        <button onClick={() => { if (confirm('Удалить черновик?')) act('delete') }}
          className="inline-flex items-center gap-1 text-[11.5px] px-2 py-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50">
          <Trash2 size={12} />
        </button>
      </footer>
    </section>
  )
}

/**
 * Недельные циклы: серия постов — одна арка с целью. План предлагает модель
 * (понедельничный крон или кнопка), пишется серия только после одобрения.
 */
function CyclesTab({ onDraftsChanged }: { onDraftsChanged: () => void }) {
  const [cycles, setCycles] = useState<Cycle[] | null>(null)
  const [written, setWritten] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = () => {
    apiGet<{ cycles: Cycle[]; written: Record<string, number> }>('/creator/cycles', false)
      .then(r => { setCycles(r.cycles || []); setWritten(r.written || {}) })
      .catch(e => setError(e?.message || 'Не удалось загрузить'))
  }
  useEffect(load, [])

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setError('')
    setBusy(action)
    try {
      await apiPost('/creator/cycles', { action, ...extra })
      load()
      // Серийный пост падает в «Черновики» — список должен узнать об этом
      // без перезагрузки страницы
      if (action === 'write_today') onDraftsChanged()
    } catch (e: any) { setError(e?.message || 'Ошибка') }
    setBusy('')
  }

  const current = (cycles || []).find(c => c.status !== 'done')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-[12.5px] text-gray-500 flex-1">
          Серия постов на неделю — одна арка с целью, как сериал: у каждого дня своя роль,
          посты помнят предыдущие. Цели чередуются: прогрев → бренд → желание. Пока план
          не одобрен, пишутся обычные выпуски. Готовый пост дня падает в «Черновики»
          с меткой «серия» и ролью.
        </p>
        {!current && (
          <button
            onClick={() => act('plan')}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-60"
          >
            <RefreshCw size={12} className={busy === 'plan' ? 'animate-spin' : ''} />
            {busy === 'plan' ? 'Планирую…' : 'Спланировать цикл'}
          </button>
        )}
      </div>
      {error && <div className="text-[12.5px] text-red-600">{error}</div>}
      {!cycles && !error && <div className="text-[12.5px] text-gray-400">Загружаю…</div>}
      {cycles && cycles.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl px-6 py-8 text-center text-[13px] text-gray-500">
          Циклов пока нет. Нажми «Спланировать цикл» — креатор предложит тему и арку недели,
          или дождись понедельника: он предложит сам.
        </div>
      )}

      {cycles?.map(c => {
        const n = written[c.id] || 0
        return (
          <section key={c.id} className={`bg-white border rounded-xl overflow-hidden ${c.status === 'done' ? 'border-gray-100 opacity-60' : 'border-gray-200'}`}>
            <header className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2 flex-wrap">
              <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md ${(GOAL_LABEL[c.goal] || GOAL_LABEL.warmup).cls}`}>
                {(GOAL_LABEL[c.goal] || GOAL_LABEL.warmup).label}
              </span>
              <h2 className="text-[13.5px] font-semibold text-gray-900 flex-1 min-w-0">{c.theme}</h2>
              <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500">
                {c.status === 'proposed' ? 'ждёт одобрения' : c.status === 'approved' ? `идёт · ${n}/${c.plan.length}` : 'завершён'}
              </span>
              <span className="text-[11px] text-gray-400 tabular-nums">неделя {c.week_key}</span>
            </header>
            {c.rationale && <p className="px-4 pt-2.5 text-[12px] text-gray-500">{c.rationale}</p>}
            <ol className="px-4 py-3 space-y-1.5">
              {c.plan.map((d, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[12.5px]">
                  <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10.5px] font-bold shrink-0 ${
                    i < n ? 'bg-emerald-100 text-emerald-700' : i === n && c.status === 'approved' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-400'}`}>
                    {i < n ? '✓' : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="font-semibold text-gray-800">{d.role}.</span>{' '}
                    <span className="text-gray-500">{d.brief}</span>
                  </span>
                </li>
              ))}
            </ol>
            {c.status !== 'done' && (
              <footer className="px-4 py-2.5 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                {c.status === 'proposed' && (
                  <>
                    <button onClick={() => act('approve', { id: c.id })}
                      className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700">
                      <Check size={12} /> Одобрить план
                    </button>
                    <button onClick={() => act('plan')}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1 text-[11.5px] px-2.5 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50">
                      <RefreshCw size={12} className={busy === 'plan' ? 'animate-spin' : ''} /> Предложить другую тему
                    </button>
                  </>
                )}
                {c.status === 'approved' && (
                  <>
                    <button onClick={() => act('write_today', { id: c.id })}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1 rounded-md bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-60">
                      <RefreshCw size={12} className={busy === 'write_today' ? 'animate-spin' : ''} />
                      {busy === 'write_today' ? 'Пишу…' : 'Написать пост дня сейчас'}
                    </button>
                    <div className="flex-1" />
                    <button onClick={() => { if (confirm('Завершить арку досрочно?')) act('finish', { id: c.id }) }}
                      className="text-[11.5px] px-2.5 py-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50">
                      Завершить досрочно
                    </button>
                  </>
                )}
              </footer>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Системный источник: вшит, не отключается — только витрина состояния. */
function BuiltinCard({ icon: Icon, title, note, accent }: { icon: typeof Rss; title: string; note: string; accent: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-start gap-3">
      <div className={`p-1.5 rounded-lg ${accent}`}><Icon size={15} /></div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-gray-900 flex items-center gap-2">
          {title}
          <span className="text-[10px] font-semibold px-1.5 py-px rounded bg-gray-100 text-gray-500">системный</span>
        </div>
        <div className="text-[11.5px] text-gray-500 mt-0.5 truncate">{note}</div>
      </div>
    </div>
  )
}

function SourcesTab() {
  const [sources, setSources] = useState<Source[] | null>(null)
  const [builtin, setBuiltin] = useState<Builtin | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState('')

  const load = () => {
    apiGet<{ sources: Source[]; builtin: Builtin }>('/creator/sources', false)
      .then(r => { setSources(r.sources || []); setBuiltin(r.builtin) })
      .catch(e => setError(e?.message || 'Не удалось загрузить'))
  }
  useEffect(load, [])

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setError('')
    try {
      await apiPost('/creator/sources', { action, ...extra })
      load()
    } catch (e: any) { setError(e?.message || 'Ошибка') }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11.5px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Факты — из чего рождаются посты</div>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <BuiltinCard icon={BookOpen} accent="bg-blue-50 text-blue-600" title="Релизы Delever"
            note={builtin?.delever.latest || 'GitBook, еженедельные отчёты'} />
          <BuiltinCard icon={Wrench} accent="bg-violet-50 text-violet-600" title="Выпуски GFSupport"
            note={builtin?.gfsupport.latest || '«Что нового», линия «как мы строим»'} />
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600"><MessageCircle size={15} /></div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-gray-900 flex items-center gap-2">
                Корпус стиля
                <span className="text-[10px] font-semibold px-1.5 py-px rounded bg-gray-100 text-gray-500">системный</span>
              </div>
              <div className="text-[11.5px] text-gray-500 mt-0.5">
                {builtin ? `${builtin.corpus.count} постов @deleverme` : '@deleverme'}
              </div>
            </div>
            <button
              onClick={async () => {
                setBusy('corpus')
                await act('refresh_corpus')
                setBusy('')
              }}
              disabled={busy === 'corpus'}
              title="Дозабрать свежие посты канала"
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-50"
            ><RefreshCw size={13} className={busy === 'corpus' ? 'animate-spin' : ''} /></button>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="text-[11.5px] font-semibold text-gray-400 uppercase tracking-wide">Радар рынка — обогащение контекстом</div>
          <div className="flex-1" />
          <button
            onClick={() => setAdding(a => !a)}
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1 rounded-md bg-gray-900 text-white hover:bg-gray-800"
          ><Plus size={12} /> Добавить источник</button>
        </div>
        <p className="text-[11.5px] text-gray-500 mb-2.5">
          Телеграм-каналы, RSS и страницы про HoReCa и фудтех. Свежий контент активных источников
          креатор читает перед каждой генерацией и использует как фон для сцены и мысли — не пересказывая.
        </p>

        {adding && (
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-2.5 flex flex-col sm:flex-row gap-2">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Название (например: Restoranchi uz)"
              className="flex-1 text-[12.5px] border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200" />
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="@канал, t.me/…, RSS или ссылка на страницу"
              className="flex-1 text-[12.5px] border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200" />
            <button
              onClick={async () => {
                if (!url.trim()) return
                await act('add', { title, url })
                setTitle(''); setUrl(''); setAdding(false)
              }}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-gray-900 text-white"
            >Сохранить</button>
          </div>
        )}

        {!sources && !error && <div className="text-[12.5px] text-gray-400">Загружаю…</div>}
        {sources && sources.length === 0 && !adding && (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl px-5 py-6 text-center text-[12.5px] text-gray-500">
            <Radar size={18} className="mx-auto mb-1.5 text-gray-300" />
            Своих источников пока нет. Добавь телеграм-канал или сайт про рынок —
            и посты начнут опираться на то, что обсуждает отрасль.
          </div>
        )}
        <div className="space-y-2">
          {sources?.map(s => (
            <div key={s.id} className={`bg-white border rounded-xl px-4 py-2.5 flex items-center gap-3 ${s.active ? 'border-gray-200' : 'border-gray-100 opacity-55'}`}>
              <span className="text-[10px] font-semibold px-1.5 py-px rounded bg-gray-100 text-gray-500 whitespace-nowrap">{SOURCE_KIND[s.kind]}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-gray-900 truncate">{s.title}</div>
                <div className="text-[11px] text-gray-400 truncate">{s.url}</div>
              </div>
              <button onClick={() => act('toggle', { id: s.id })}
                title={s.active ? 'Выключить' : 'Включить'}
                className={`p-1.5 rounded-md ${s.active ? 'text-emerald-600 hover:bg-emerald-50' : 'text-gray-300 hover:bg-gray-50'}`}>
                <Power size={13} />
              </button>
              <button onClick={() => { if (confirm('Удалить источник?')) act('delete', { id: s.id }) }}
                className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
      {error && <div className="text-[12.5px] text-red-600">{error}</div>}
    </div>
  )
}

export function CreatorPage() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [tab, setTab] = useState<Tab>('drafts')
  const [lineFilter, setLineFilter] = useState<'all' | Draft['line']>('all')

  const load = () => {
    apiGet<{ drafts: Draft[] }>('/creator/drafts', false)
      .then(r => setDrafts(r.drafts || []))
      .catch(e => setError(e?.message || 'Не удалось загрузить'))
  }
  useEffect(load, [])

  // Выпуск = 3 поста: два Delever + один «как мы строим».
  // По одному запросу на пост: edge-функция не успевает три за 25 секунд.
  const generateBatch = async () => {
    const batchKey = new Date().toISOString().slice(0, 10)
    const plan: Array<Draft['line']> = ['delever', 'delever_archive', 'gfsupport']
    setError('')
    for (let i = 0; i < plan.length; i++) {
      setBusy(`Пишу пост ${i + 1} из ${plan.length}…`)
      try {
        await apiPost('/creator/drafts', { action: 'generate', line: plan[i], batchKey })
        load()
      } catch (e: any) {
        setError(e?.message || 'Ошибка генерации')
        break
      }
    }
    setBusy('')
    load()
  }

  const counts = useMemo(() => ({
    drafts: (drafts || []).filter(d => d.status === 'draft').length,
    approved: (drafts || []).filter(d => d.status === 'approved').length,
    archive: (drafts || []).filter(d => d.status === 'rejected' || d.status === 'published').length,
  }), [drafts])

  const visible = useMemo(() => {
    let list = drafts || []
    if (tab === 'drafts') list = list.filter(d => d.status === 'draft')
    if (tab === 'approved') list = list.filter(d => d.status === 'approved')
    if (tab === 'archive') list = list.filter(d => d.status === 'rejected' || d.status === 'published')
    if (lineFilter !== 'all') list = list.filter(d => d.line === lineFilter)
    return list
  }, [drafts, tab, lineFilter])

  const groups = useMemo(() => {
    const map = new Map<string, Draft[]>()
    for (const d of visible) {
      const arr = map.get(d.batch_key) || []
      arr.push(d)
      map.set(d.batch_key, arr)
    }
    return [...map.entries()]
  }, [visible])

  const TABS: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'drafts', label: 'Черновики', count: counts.drafts },
    { key: 'approved', label: 'Одобренные', count: counts.approved },
    { key: 'archive', label: 'Архив', count: counts.archive },
    { key: 'cycles', label: 'Циклы' },
    { key: 'sources', label: 'Источники' },
  ]

  return (
    <div className="max-w-[1060px] mx-auto px-6 py-5 space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <h1 className="text-[19px] font-semibold text-gray-900 tracking-tight flex items-center gap-2">
            <Sparkles size={18} className="text-violet-600" /> Креатор
          </h1>
          <p className="text-[12.5px] text-gray-500">
            «Бутерброды» на фактах релизов Delever и GFSupport. Ничего не публикуется само:
            одобряешь и копируешь руками.
          </p>
        </div>
        <button
          onClick={generateBatch}
          disabled={!!busy}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-60"
        >
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
          {busy || 'Собрать выпуск'}
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-[12.5px] font-semibold px-3 py-2 -mb-px border-b-2 transition-colors ${
              tab === t.key ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            {t.label}
            {typeof t.count === 'number' && t.count > 0 && (
              <span className="ml-1.5 text-[10.5px] font-bold px-1.5 py-px rounded-full bg-gray-100 text-gray-500">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {error && <div className="text-[12.5px] text-red-600">{error}</div>}

      {tab === 'sources' ? (
        <SourcesTab />
      ) : tab === 'cycles' ? (
        <CyclesTab onDraftsChanged={load} />
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            {([['all', 'Все'], ['delever', 'Delever'], ['gfsupport', 'как мы строим']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setLineFilter(k)}
                className={`text-[11.5px] font-semibold px-2.5 py-1 rounded-full ${
                  lineFilter === k ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                {l}
              </button>
            ))}
          </div>

          {!drafts && !error && <div className="text-[12.5px] text-gray-400">Загружаю…</div>}
          {drafts && visible.length === 0 && (
            <div className="bg-white border border-dashed border-gray-300 rounded-xl px-6 py-10 text-center text-[13px] text-gray-500">
              {tab === 'drafts'
                ? 'Черновиков нет. Нажми «Собрать выпуск» — креатор прочитает свежий релиз Delever, выпуски GFSupport и источники радара и напишет три поста в твоём тоне.'
                : 'Здесь пока пусто.'}
            </div>
          )}

          {groups.map(([batch, items]) => (
            <div key={batch} className="space-y-3">
              <div className="text-[11.5px] font-semibold text-gray-400 uppercase tracking-wide">Выпуск {batch}</div>
              {items.map(d => <DraftCard key={d.id} d={d} onChanged={load} />)}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

export default CreatorPage
