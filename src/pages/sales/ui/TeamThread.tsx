import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPost, apiUpload } from '@/shared/services/api.service'
import { fmtDateTime } from './kit'
import { useAuth } from '@/shared/hooks/useAuth'

/**
 * Ветка команды при карточке: разговор о клиенте между сотрудниками.
 *
 * Клиент этого не видит — в отличие от ленты, где есть переписка с ним.
 * «@Имя» зовёт коллегу уведомлением со ссылкой сюда; «как задачу» превращает
 * сообщение в задачу с исполнителем и сроком; файл остаётся при карточке.
 */

interface Att { url: string; name: string; size: number; type: string | null }
interface Comment {
  id: string; text: string; mentions: string[]; attachments: Att[]; task_id: string | null
  created_at: string; author_agent_id: string | null; author_name: string | null
  task_done_at: string | null; task_due_at: string | null; task_assignee: string | null
}
interface Props {
  dealId?: string; leadId?: string; accountId?: string | null
  team: Array<{ id: string; name: string }>
  /** Внутри свёртки «Команда»: своя шапка не нужна — она уже есть у свёртки. */
  embedded?: boolean
}

const fmtSize = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1048576).toFixed(1)} МБ`

/** Текст с подсветкой упоминаний: «@Имя» — жирным. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(@[^\s@,.!?:;]+(?: [А-ЯA-Z][^\s@,.!?:;]*)?)/g)
  return <>{parts.map((p, i) => p.startsWith('@')
    ? <b key={i} className="text-blue-700 font-semibold">{p}</b>
    : <span key={i}>{p}</span>)}</>
}

export function TeamThread({ dealId, leadId, accountId, team, embedded = false }: Props) {
  const { agent } = useAuth()
  const [items, setItems] = useState<Comment[] | null>(null)
  const [text, setText] = useState('')
  const [mentions, setMentions] = useState<Set<string>>(new Set())
  const [pickDown, setPickDown] = useState(false)
  const [files, setFiles] = useState<Att[]>([])
  const [asTask, setAsTask] = useState(false)
  const [due, setDue] = useState<'today' | 'tomorrow' | 'in3'>('tomorrow')
  const [assignee, setAssignee] = useState('')
  const [pick, setPick] = useState<{ q: string; at: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const q = dealId ? `dealId=${dealId}` : leadId ? `leadId=${leadId}` : accountId ? `accountId=${accountId}` : ''
  const load = useCallback(() => {
    if (!q) return
    apiGet<{ comments: Comment[] }>(`/sales/comments?${q}`, false)
      .then(r => setItems(r.comments || []))
      .catch(() => setItems([]))
  }, [q])
  useEffect(() => { load() }, [load])
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'nearest' }) }, [items?.length])

  // Упоминание: после «@» подсказываем команду и подставляем имя целиком
  const onChange = (v: string) => {
    setText(v)
    const caret = taRef.current?.selectionStart ?? v.length
    const before = v.slice(0, caret)
    const m = before.match(/@([^\s@]*)$/)
    setPick(m ? { q: m[1].toLowerCase(), at: caret - m[0].length } : null)
    // Куда раскрывать подсказку: вверх, если над полем есть место, иначе вниз —
    // у верхнего края экрана список уезжал за пределы окна
    if (m && taRef.current) setPickDown(taRef.current.getBoundingClientRect().top < 260)
  }
  const choose = (t: { id: string; name: string }) => {
    if (!pick) return
    const caret = taRef.current?.selectionStart ?? text.length
    const next = `${text.slice(0, pick.at)}@${t.name} ${text.slice(caret)}`
    setText(next)
    setMentions(s => new Set(s).add(t.id))
    setPick(null)
    if (asTask && !assignee) setAssignee(t.id)
    setTimeout(() => taRef.current?.focus(), 0)
  }
  // Все подходящие, а не первые шесть: список прокручивается, а человек,
  // которого «нет в списке», — это не подсказка, а обман
  const candidates = pick ? team.filter(t => t.id !== agent?.id && t.name.toLowerCase().includes(pick.q)) : []

  const upload = async (list: FileList | null) => {
    if (!list?.length) return
    setUploading(true); setErr('')
    try {
      for (const f of Array.from(list).slice(0, 5)) {
        const fd = new FormData(); fd.append('file', f)
        const r = await apiUpload<Att & { ok: boolean }>('/sales/comments?action=upload', fd)
        setFiles(fs => [...fs, { url: r.url, name: r.name, size: r.size, type: r.type }])
      }
    } catch (e: any) {
      setErr(e?.message || 'Не удалось загрузить файл')
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const submit = async () => {
    const body = text.trim()
    if (!body && !files.length) return
    setBusy(true); setErr('')
    try {
      // Упоминания — только те, чьё имя осталось в тексте: «@Имя» могли стереть
      const kept = [...mentions].filter(id => {
        const t = team.find(x => x.id === id); return t && body.includes(`@${t.name}`)
      })
      const at = new Date()
      if (due === 'tomorrow') at.setDate(at.getDate() + 1)
      if (due === 'in3') at.setDate(at.getDate() + 3)
      at.setHours(10, 0, 0, 0)
      await apiPost('/sales/comments', {
        dealId, leadId, accountId: accountId || undefined,
        text: body, mentions: kept, attachments: files,
        task: asTask ? { dueAt: at.toISOString(), assigneeAgentId: assignee || kept[0] || agent?.id } : undefined,
      })
      setText(''); setMentions(new Set()); setFiles([]); setAsTask(false); setAssignee('')
      load()
    } catch (e: any) {
      setErr(e?.message || 'Не удалось отправить')
    } finally { setBusy(false) }
  }

  return (
    <div className={`bg-white flex flex-col max-h-[60vh] ${embedded ? '' : 'border border-gray-200 rounded-xl'}`}>
      {!embedded && <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-2">
        <h3 className="text-[12.5px] font-semibold text-gray-900">Команда</h3>
        <span className="text-[11px] text-gray-400">внутреннее — клиент не видит · @имя зовёт коллегу</span>
      </div>}

      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {items === null && <p className="px-4 py-6 text-center text-[12px] text-gray-400">загружаю…</p>}
        {items && !items.length && (
          <p className="px-4 py-6 text-center text-[12.5px] text-gray-400">
            Пока тихо. Напишите коллеге здесь — через месяц это найдётся в карточке, а не в чатах.
          </p>
        )}
        {items?.map(c => (
          <div key={c.id} className="px-4 py-2.5">
            <div className="flex items-baseline gap-2">
              <span className={`text-[11.5px] font-semibold ${c.author_agent_id === agent?.id ? 'text-blue-700' : 'text-gray-700'}`}>
                {c.author_name || 'Сотрудник'}
              </span>
              <span className="text-[10.5px] text-gray-400 ml-auto whitespace-nowrap">{fmtDateTime(c.created_at)}</span>
            </div>
            {c.text && <div className="text-[12.5px] text-gray-800 mt-0.5 whitespace-pre-wrap"><Rich text={c.text} /></div>}
            {c.attachments?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {c.attachments.map((a, i) => (
                  <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] px-2 py-1 rounded-md border border-gray-200 text-blue-700 hover:border-blue-400 truncate max-w-[220px]">
                    📎 {a.name}{a.size ? <span className="text-gray-400"> · {fmtSize(a.size)}</span> : null}
                  </a>
                ))}
              </div>
            )}
            {c.task_id && (
              <div className={`mt-1 text-[11px] ${c.task_done_at ? 'text-emerald-700' : 'text-amber-700'}`}>
                {c.task_done_at ? '✓ задача выполнена' : '⏳ задача'}
                {c.task_assignee ? ` · ${c.task_assignee}` : ''}{c.task_due_at ? ` · до ${fmtDateTime(c.task_due_at)}` : ''}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-gray-100 p-3 relative">
        {err && <div className="mb-2 text-[11.5px] text-red-600">{err}</div>}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {files.map((f, i) => (
              <span key={i} className="text-[11px] px-2 py-1 rounded-md bg-gray-100 text-gray-700 flex items-center gap-1">
                📎 {f.name}
                <button onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600">✕</button>
              </span>
            ))}
          </div>
        )}
        {candidates.length > 0 && (
          <div className={`absolute left-3 bg-white border border-gray-200 rounded-lg shadow-lg z-30 w-60 py-1 max-h-56 overflow-y-auto ${
            pickDown ? 'top-full mt-1' : 'bottom-full mb-1'}`}>
            {candidates.map(t => (
              <button key={t.id} onMouseDown={e => { e.preventDefault(); choose(t) }}
                className="w-full text-left px-3 py-1.5 text-[12.5px] text-gray-800 hover:bg-blue-50">@{t.name}</button>
            ))}
          </div>
        )}
        <textarea ref={taRef} value={text} rows={2}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') setPick(null)
            if (e.key === 'Enter' && !e.shiftKey && !candidates.length) { e.preventDefault(); submit() }
            if (e.key === 'Enter' && candidates.length) { e.preventDefault(); choose(candidates[0]) }
          }}
          placeholder="Коллегам: @имя — позвать, Enter — отправить, Shift+Enter — перенос"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[12.5px] resize-none" />
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <input ref={fileRef} type="file" multiple hidden onChange={e => upload(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="text-[11.5px] px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:border-gray-400 disabled:opacity-50">
            {uploading ? 'загружаю…' : '📎 Файл'}
          </button>
          <label className="flex items-center gap-1.5 text-[11.5px] text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={asTask} onChange={e => setAsTask(e.target.checked)} className="accent-blue-600" />
            как задачу
          </label>
          {asTask && (
            <>
              <select value={assignee} onChange={e => setAssignee(e.target.value)}
                className="text-[11.5px] border border-gray-200 rounded-md px-1.5 py-1">
                <option value="">{[...mentions].length ? 'упомянутому' : 'мне'}</option>
                {team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {([['today', 'сегодня'], ['tomorrow', 'завтра'], ['in3', '+3 дня']] as const).map(([k, label]) => (
                <button key={k} onClick={() => setDue(k)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                    due === k ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-500 border-gray-200'}`}>
                  {label}
                </button>
              ))}
            </>
          )}
          <button onClick={submit} disabled={busy || uploading || (!text.trim() && !files.length)}
            className="ml-auto px-3 py-1.5 text-[12.5px] font-semibold rounded-lg bg-blue-500 text-white disabled:opacity-40">
            {busy ? '…' : asTask ? 'Поставить' : 'Отправить'}
          </button>
        </div>
      </div>
    </div>
  )
}
