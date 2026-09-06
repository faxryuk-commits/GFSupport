import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPatch } from '@/shared/services/api.service'
import { Chip, PageShell, Skeleton, fmtDateTime, useAutoRefresh } from './kit'

/**
 * Раздел «Задачи»: всё, что поставлено команде, одним экраном.
 *
 * Задачи жили внутри карточек и в очереди дня, и вопрос «что у команды
 * на завтра» не имел ответа без обхода карточек. Здесь — срезы по сроку
 * (мои / просроченные / сегодня / завтра / выполненные), фильтры по человеку,
 * типу, этапу сделки и периоду, и два вида: список и колонки по этапам —
 * последнее отвечает на «на каком шаге воронки застревает работа».
 */

interface Task {
  id: string; title: string; kind: string; status: string; status_note: string | null
  due_at: string | null; done_at: string | null; done_result: string | null; created_at: string
  auto: boolean; deal_id: string | null; lead_id: string | null; account_id: string | null
  assignee_agent_id: string | null; created_by_agent_id: string | null
  assignee_name: string | null; created_by_name: string | null; about: string | null
  stage_key: string | null; stage_label: string | null; obj: 'deal' | 'lead' | 'account'
}
interface Data {
  tasks: Task[]
  stages: Array<{ key: string; label: string; pipeline: string; sort_order: number }>
  people: Array<{ id: string; name: string }>
}

const SCOPES = [
  ['mine', 'Мои'], ['overdue', 'Просроченные'], ['today', 'Сегодня'], ['tomorrow', 'Завтра'],
  ['open', 'Все открытые'], ['done', 'Выполненные'],
] as const
const KINDS: Record<string, string> = {
  call: 'звонок', meeting: 'встреча', message: 'написать', task: 'задача',
  cadence: 'по регламенту', followup: 'дожать', manual: 'задача',
}

const linkOf = (t: Task) =>
  t.deal_id ? `/sales/deals/${t.deal_id}` : t.lead_id ? `/sales/leads/${t.lead_id}`
    : t.account_id ? `/sales/accounts/${t.account_id}` : null

export function SalesTasksPage() {
  const [scope, setScope] = useState<typeof SCOPES[number][0]>('mine')
  const [view, setViewRaw] = useState<'list' | 'stages'>(() => {
    try { return localStorage.getItem('tasks.view') === 'stages' ? 'stages' : 'list' } catch { return 'list' }
  })
  const setView = (v: 'list' | 'stages') => {
    setViewRaw(v)
    try { localStorage.setItem('tasks.view', v) } catch { /* приватный режим */ }
  }
  const [q, setQ] = useState('')
  const [assignee, setAssignee] = useState('')
  const [author, setAuthor] = useState('')
  const [kind, setKind] = useState('')
  const [stage, setStage] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const reqRef = useRef(0)

  const load = useCallback(() => {
    const p = new URLSearchParams({ view: 'list', scope })
    if (q) p.set('q', q)
    if (assignee) p.set('assignee', assignee)
    if (author) p.set('author', author)
    if (kind) p.set('kind', kind)
    if (stage) p.set('stage', stage)
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    const my = ++reqRef.current
    apiGet<Data>(`/sales/tasks?${p.toString()}`, false)
      .then(d => { if (my === reqRef.current) { setData(d); setError(null) } })
      .catch(e => setError(e?.message || 'Не удалось загрузить задачи'))
  }, [scope, q, assignee, author, kind, stage, from, to])

  useEffect(() => { load() }, [load])
  useAutoRefresh(load, 60000)

  const toggleDone = async (t: Task) => {
    setBusy(t.id)
    try {
      await apiPatch('/sales/tasks', { id: t.id, done: !t.done_at })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось изменить задачу')
    } finally { setBusy(null) }
  }

  // Колонки по этапам: обращения → этапы по порядку → без сделки
  const columns = useMemo(() => {
    if (!data) return []
    const cols: Array<{ key: string; label: string; items: Task[] }> = [
      { key: 'lead', label: 'Обращения', items: [] },
      ...data.stages.map(s => ({ key: s.key, label: s.label, items: [] as Task[] })),
      { key: 'none', label: 'Без сделки', items: [] },
    ]
    const byKey = new Map(cols.map(c => [c.key, c]))
    for (const t of data.tasks) {
      const k = t.obj === 'lead' ? 'lead' : (t.stage_key && byKey.has(t.stage_key) ? t.stage_key : 'none')
      byKey.get(k)!.items.push(t)
    }
    return cols.filter(c => c.items.length)
  }, [data])

  const now = Date.now()
  const overdueOf = (t: Task) => !t.done_at && !!t.due_at && new Date(t.due_at).getTime() < now
  const anyFilter = q || assignee || author || kind || stage || from || to

  const Row = ({ t }: { t: Task }) => {
    const late = overdueOf(t)
    const href = linkOf(t)
    return (
      <div className={`px-3 py-2 flex items-start gap-2.5 ${t.done_at ? 'opacity-60' : ''}`}>
        <input type="checkbox" checked={!!t.done_at} disabled={busy === t.id}
          onChange={() => toggleDone(t)} title={t.done_at ? 'Вернуть в работу' : 'Выполнено'}
          className="mt-1 accent-emerald-600" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-[12.5px] ${t.done_at ? 'line-through text-gray-500' : 'text-gray-900'}`}>{t.title}</span>
            <Chip tone="gray">{KINDS[t.kind] || t.kind}</Chip>
            {t.auto && <span className="text-[10px] text-gray-400">авто</span>}
            {t.status === 'in_progress' && !t.done_at && <Chip tone="blue">в работе</Chip>}
            {t.done_result === 'rejected' && <Chip tone="red">отклонена</Chip>}
          </div>
          <div className="mt-0.5 text-[11.5px] text-gray-400 flex items-center gap-2 flex-wrap">
            {t.due_at && (
              <span className={`tabular-nums ${late ? 'text-red-600 font-medium' : ''}`}>
                {late ? 'просрочено · ' : ''}{fmtDateTime(t.due_at)}
              </span>
            )}
            {t.about && (href
              ? <Link to={href} className="text-blue-600 hover:underline truncate max-w-[240px]">{t.about}</Link>
              : <span className="truncate max-w-[240px]">{t.about}</span>)}
            {t.stage_label && <span>· {t.stage_label}</span>}
            <span>· {t.assignee_name || 'ничей'}</span>
            {t.created_by_name && t.created_by_name !== t.assignee_name && <span>от {t.created_by_name}</span>}
            {t.status_note && <span className="text-gray-500">«{t.status_note}»</span>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <PageShell fill header={
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[18px] font-semibold text-gray-900 tracking-tight">Задачи</h1>
            {data && (
              <span className="text-[11.5px] text-gray-500">
                {data.tasks.length} · просрочено <b className="text-red-600">{data.tasks.filter(overdueOf).length}</b>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {([['list', 'Список'], ['stages', 'По этапам']] as const).map(([v, label]) => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium ${
                    view === v ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            {SCOPES.map(([k, label], i) => (
              <button key={k} onClick={() => setScope(k)}
                className={`text-[12px] px-2.5 py-1.5 ${i ? 'border-l border-gray-300' : ''} ${
                  scope === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Задача, клиент, сделка"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-[12.5px] w-52" />
          <select value={assignee} onChange={e => setAssignee(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]">
            <option value="">Ответственный</option>
            {(data?.people || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={author} onChange={e => setAuthor(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]">
            <option value="">Автор</option>
            {(data?.people || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={kind} onChange={e => setKind(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]">
            <option value="">Все типы</option>
            {Object.entries(KINDS).filter(([k]) => k !== 'manual').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select value={stage} onChange={e => setStage(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]">
            <option value="">Все этапы</option>
            {(data?.stages || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]" title="Срок с" />
          <span className="text-gray-400 text-[12px]">—</span>
          <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]" title="Срок по" />
          {anyFilter && (
            <button onClick={() => { setQ(''); setAssignee(''); setAuthor(''); setKind(''); setStage(''); setFrom(''); setTo('') }}
              className="text-[12px] text-gray-400 hover:text-red-600">сбросить ✕</button>
          )}
        </div>
      </div>
    }>
      {error && <div className="mb-2 text-[12.5px] text-red-600">{error}</div>}
      {!data && !error && <Skeleton rows={8} kpis={false} />}

      {data && view === 'list' && (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50 overflow-y-auto max-h-full">
          {!data.tasks.length && (
            <div className="px-4 py-10 text-center text-[12.5px] text-gray-400">
              {scope === 'mine' ? 'У вас нет открытых задач.' : 'По этому срезу задач нет.'}
            </div>
          )}
          {data.tasks.map(t => <Row key={t.id} t={t} />)}
        </div>
      )}

      {data && view === 'stages' && (
        <div className="flex gap-2.5 overflow-x-auto items-start pb-2 h-full">
          {!columns.length && (
            <div className="px-4 py-10 text-[12.5px] text-gray-400">По этому срезу задач нет.</div>
          )}
          {columns.map(c => (
            <section key={c.key} className="flex-none w-[300px] bg-white border border-gray-200 rounded-lg flex flex-col max-h-full">
              <header className="px-3 py-2 border-b border-gray-100 flex justify-between items-baseline">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${
                  c.key === 'lead' ? 'text-violet-700' : c.key === 'none' ? 'text-gray-500' : 'text-blue-700'}`}>{c.label}</span>
                <span className="text-[11.5px] text-gray-400 tabular-nums">
                  {c.items.length}
                  {c.items.filter(overdueOf).length ? <span className="text-red-600"> · {c.items.filter(overdueOf).length} горит</span> : null}
                </span>
              </header>
              <div className="divide-y divide-gray-50 overflow-y-auto">
                {c.items.map(t => <Row key={t.id} t={t} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageShell>
  )
}

export default SalesTasksPage
