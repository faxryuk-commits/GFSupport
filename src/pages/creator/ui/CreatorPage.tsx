import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Sparkles, Copy, Check, X, Pencil, Trash2, RefreshCw } from 'lucide-react'

/**
 * «Креатор» — личный модуль владельца: черновики постов для LinkedIn (англ.)
 * и Telegram-канала на фактах релизов Delever (GitBook) и GFSupport.
 *
 * Формат — «бутерброд»: сцена с рынка → обезличенный кейс → апдейт двумя
 * строками → мысль фаундера. Ничего не публикуется автоматически: только
 * черновики, только ручное одобрение и копирование.
 */

interface Draft {
  id: string
  created_at: string
  batch_key: string
  line: 'delever' | 'gfsupport'
  title: string
  body_ru: string
  body_en: string
  status: 'draft' | 'approved' | 'rejected' | 'published'
  source?: { url?: string | null } | null
}

const LINE_LABEL: Record<Draft['line'], { label: string; cls: string }> = {
  delever: { label: 'Delever', cls: 'bg-blue-50 text-blue-700' },
  gfsupport: { label: 'как мы строим', cls: 'bg-violet-50 text-violet-700' },
}

const STATUS_LABEL: Record<Draft['status'], { label: string; cls: string }> = {
  draft: { label: 'черновик', cls: 'bg-gray-100 text-gray-600' },
  approved: { label: 'одобрен', cls: 'bg-emerald-50 text-emerald-700' },
  rejected: { label: 'отклонён', cls: 'bg-red-50 text-red-600' },
  published: { label: 'опубликован', cls: 'bg-blue-600 text-white' },
}

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

function DraftCard({ d, onChanged }: { d: Draft; onChanged: () => void }) {
  const [tab, setTab] = useState<'ru' | 'en'>('ru')
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const body = tab === 'ru' ? d.body_ru : d.body_en

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    await apiPost('/creator/drafts', { action, id: d.id, ...extra })
    onChanged()
  }

  return (
    <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <header className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2 flex-wrap">
        <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md ${LINE_LABEL[d.line].cls}`}>
          {LINE_LABEL[d.line].label}
        </span>
        <h2 className="text-[13.5px] font-semibold text-gray-900 flex-1 min-w-0 truncate">{d.title || 'Без названия'}</h2>
        <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md ${STATUS_LABEL[d.status].cls}`}>
          {STATUS_LABEL[d.status].label}
        </span>
        <span className="text-[11px] text-gray-400 tabular-nums">{d.batch_key}</span>
      </header>

      <div className="px-4 pt-2.5 flex items-center gap-1.5">
        {(['ru', 'en'] as const).map(l => (
          <button
            key={l}
            onClick={() => { setTab(l); setEditing(false) }}
            className={`text-[11.5px] font-semibold px-2.5 py-1 rounded-md ${tab === l ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
          >
            {l === 'ru' ? 'Русский (канал)' : 'English (LinkedIn)'}
          </button>
        ))}
      </div>

      <div className="px-4 py-3">
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={12}
              className="w-full text-[13px] leading-relaxed border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  await act('edit', tab === 'ru' ? { body_ru: text } : { body_en: text })
                  setEditing(false)
                }}
                className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-gray-900 text-white"
              >Сохранить</button>
              <button onClick={() => setEditing(false)} className="text-[12px] px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100">Отмена</button>
            </div>
          </div>
        ) : (
          <div className="text-[13px] text-gray-800 leading-relaxed whitespace-pre-wrap">{body}</div>
        )}
      </div>

      {!editing && (
        <footer className="px-4 py-2.5 border-t border-gray-100 flex items-center gap-2 flex-wrap">
          <CopyBtn text={body} label={tab === 'ru' ? 'Копировать для канала' : 'Copy for LinkedIn'} />
          <button
            onClick={() => { setText(body); setEditing(true) }}
            className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
          ><Pencil size={12} /> Править</button>
          <div className="flex-1" />
          {d.status !== 'approved' && (
            <button onClick={() => act('status', { status: 'approved' })}
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700">
              <Check size={12} /> Одобрить
            </button>
          )}
          {d.status === 'approved' && (
            <button onClick={() => act('status', { status: 'published' })}
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700">
              <Check size={12} /> Опубликован
            </button>
          )}
          {d.status !== 'rejected' && d.status !== 'published' && (
            <button onClick={() => act('status', { status: 'rejected' })}
              className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2.5 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50">
              <X size={12} /> Отклонить
            </button>
          )}
          <button onClick={() => { if (confirm('Удалить черновик?')) act('delete') }}
            className="inline-flex items-center gap-1 text-[11.5px] px-2 py-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50">
            <Trash2 size={12} />
          </button>
        </footer>
      )}
    </section>
  )
}

export function CreatorPage() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [corpusCount, setCorpusCount] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = () => {
    apiGet<{ drafts: Draft[]; corpusCount: number }>('/creator/drafts', false)
      .then(r => { setDrafts(r.drafts || []); setCorpusCount(r.corpusCount || 0) })
      .catch(e => setError(e?.message || 'Не удалось загрузить'))
  }
  useEffect(load, [])

  // Выпуск = 3 поста: два Delever + один «как мы строим».
  // По одному запросу на пост: edge-функция не успевает три за 25 секунд.
  const generateBatch = async () => {
    const batchKey = new Date().toISOString().slice(0, 10)
    const plan: Array<'delever' | 'gfsupport'> = ['delever', 'delever', 'gfsupport']
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

  const groups = useMemo(() => {
    const map = new Map<string, Draft[]>()
    for (const d of drafts || []) {
      const arr = map.get(d.batch_key) || []
      arr.push(d)
      map.set(d.batch_key, arr)
    }
    return [...map.entries()]
  }, [drafts])

  return (
    <div className="max-w-[860px] mx-auto px-6 py-5 space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h1 className="text-[19px] font-semibold text-gray-900 tracking-tight flex items-center gap-2">
            <Sparkles size={18} className="text-violet-600" /> Креатор
          </h1>
          <p className="text-[12.5px] text-gray-500">
            Черновики «бутербродов» на фактах релизов Delever и GFSupport. Ничего не публикуется само:
            одобряешь и копируешь руками. Тон — по {corpusCount} постам канала.
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

      {error && <div className="text-[12.5px] text-red-600">{error}</div>}
      {!drafts && !error && <div className="text-[12.5px] text-gray-400">Загружаю…</div>}
      {drafts && drafts.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl px-6 py-10 text-center text-[13px] text-gray-500">
          Черновиков пока нет. Нажми «Собрать выпуск» — креатор прочитает свежий релиз Delever
          из GitBook и выпуски GFSupport и напишет три поста в твоём тоне.
        </div>
      )}

      {groups.map(([batch, items]) => (
        <div key={batch} className="space-y-3">
          <div className="text-[11.5px] font-semibold text-gray-400 uppercase tracking-wide">Выпуск {batch}</div>
          {items.map(d => <DraftCard key={d.id} d={d} onChanged={load} />)}
        </div>
      ))}
    </div>
  )
}

export default CreatorPage
