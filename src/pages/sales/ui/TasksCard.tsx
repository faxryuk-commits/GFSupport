import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost, apiPatch, apiDelete } from '@/shared/services/api.service'
import { Card, Btn, Combo, workMorningIn } from './kit'
import { toDateInput, fromDateInput, formatDateTimeShort } from '@/shared/lib/time'

/**
 * Задачи по сделке, лиду или клиенту — с возможностью поставить их руками.
 *
 * До этого блок был только на чтение с подписью «создаются автоматически при
 * смене этапа»: поставить себе «перезвонить в четверг» было нечем, и план
 * работы команда держала в Amo. Один и тот же блок стоит в трёх карточках,
 * поэтому он сам грузит и перезагружает свой список.
 */

type Task = {
  id: string; title: string; kind: string; channel: string | null
  due_at: string | null; done_at: string | null; done_result: string | null
  assignee_agent_id: string | null; assignee_name: string | null; auto: boolean
}

/** Виды задач: подпись для человека и то, что уходит на сервер. */
const KINDS: Array<[string, string]> = [
  ['call', 'Позвонить'],
  ['meeting', 'Встреча'],
  ['message', 'Написать'],
  ['task', 'Дело'],
]

const WHEN: Array<[string, number]> = [
  ['Сегодня', 0], ['Завтра', 1], ['Через 3 дня', 3], ['Через неделю', 7],
]

const KIND_LABEL: Record<string, string> = {
  call: 'звонок', meeting: 'встреча', message: 'сообщение', task: 'дело',
  cadence: 'каденция', followup: 'возврат', manual: 'задача',
}

export function TasksCard({ dealId, leadId, accountId, initial }: {
  dealId?: string; leadId?: string; accountId?: string
  initial?: Task[]
}) {
  const [tasks, setTasks] = useState<Task[]>(initial || [])
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('call')
  const [due, setDue] = useState<string | null>(null)
  const [assignee, setAssignee] = useState('')
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const query = dealId ? `dealId=${dealId}` : leadId ? `leadId=${leadId}` : `accountId=${accountId}`

  const load = useCallback(() => {
    if (!dealId && !leadId && !accountId) return
    apiGet<{ tasks: Task[] }>(`/sales/tasks?${query}`, false)
      .then(r => setTasks(r.tasks || []))
      .catch(() => {})
  }, [query, dealId, leadId, accountId])

  // Список сотрудников нужен только когда форму открыли: в карточке, которую
  // просто листают, лишний запрос ни к чему
  useEffect(() => {
    if (!open || agents.length) return
    apiGet<{ agents: Array<{ id: string; name: string }> }>('/agents', true)
      .then(r => setAgents((r.agents || []).filter(a => a.name)))
      .catch(() => {})
  }, [open, agents.length])

  const create = async () => {
    const t = title.trim()
    if (!t) return
    setBusy(true); setError(null)
    try {
      await apiPost('/sales/tasks', {
        dealId, leadId, accountId, title: t, kind, dueAt: due,
        assigneeAgentId: agents.find(a => a.name === assignee)?.id || undefined,
      })
      setTitle(''); setDue(null); setAssignee(''); setOpen(false)
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось поставить задачу')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (task: Task) => {
    // Снятие галочки возвращает задачу в работу — закрыли не ту, поправимо
    setTasks(ts => ts.map(x => x.id === task.id
      ? { ...x, done_at: task.done_at ? null : new Date().toISOString() } : x))
    try {
      await apiPatch('/sales/tasks', { id: task.id, done: !task.done_at })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось изменить задачу')
      load()
    }
  }

  const remove = async (task: Task) => {
    if (!confirm(`Удалить задачу «${task.title}»?`)) return
    try {
      await apiDelete(`/sales/tasks?id=${task.id}`)
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось удалить')
    }
  }

  const active = tasks.filter(t => !t.done_at)
  const done = tasks.filter(t => t.done_at)

  return (
    <Card
      title="Задачи"
      sub={active.length ? `${active.length} в работе` : 'что дальше по этой сделке'}
      right={
        <Btn kind={open ? 'ghost' : 'primary'} onClick={() => setOpen(o => !o)}>
          {open ? 'Отмена' : '+ Задача'}
        </Btn>
      }
    >
      {open && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60 space-y-2.5">
          <input
            autoFocus value={title} onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setOpen(false) }}
            placeholder="Что нужно сделать? Например: перезвонить, уточнить бюджет"
            className="w-full text-[13px] px-3 py-2 border border-gray-200 rounded-lg
                       focus:outline-none focus:border-blue-400"
          />
          <div className="flex gap-1.5 flex-wrap">
            {KINDS.map(([k, label]) => (
              <button key={k} onClick={() => setKind(k)}
                className={`text-[11.5px] px-2.5 py-1 rounded-full border ${
                  kind === k ? 'bg-blue-600 border-blue-600 text-white'
                             : 'border-gray-200 text-gray-600 hover:border-blue-300'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 flex-wrap items-center">
            {WHEN.map(([label, d]) => {
              const value = workMorningIn(d)
              const on = due === value
              return (
                <button key={label} onClick={() => setDue(on ? null : value)}
                  className={`text-[11.5px] px-2.5 py-1 rounded-full border ${
                    on ? 'bg-gray-900 border-gray-900 text-white'
                       : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                  {label}
                </button>
              )
            })}
            <input type="date" value={toDateInput(due)} onChange={e =>
              setDue(e.target.value ? fromDateInput(`${e.target.value}T09:00`, true) : null)}
              className="text-[11.5px] px-2 py-1 border border-gray-200 rounded-lg text-gray-600" />
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-[11.5px] text-gray-400">Кому:</span>
            <div className="min-w-[180px]">
              <Combo value={assignee} options={agents.map(a => a.name)} onChange={setAssignee}
                placeholder="себе" />
            </div>
            <Btn kind="primary" onClick={create} disabled={busy || !title.trim()}>
              {busy ? '…' : 'Поставить'}
            </Btn>
          </div>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[12px] text-red-700">
          {error}
        </div>
      )}

      {!active.length && !done.length && !open && (
        <div className="px-4 py-4 text-[12.5px] text-gray-400">
          Задач нет. Поставьте следующий шаг — он попадёт в очередь дня и напомнит о себе.
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {[...active, ...done].map(t => (
          <div key={t.id} className="px-4 py-2.5 flex items-start gap-2.5 group">
            <button onClick={() => toggle(t)} title={t.done_at ? 'Вернуть в работу' : 'Закрыть задачу'}
              className={`mt-0.5 flex-none w-[15px] h-[15px] rounded border transition ${
                t.done_at ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 hover:border-blue-500'}`}>
              {t.done_at && (
                <svg viewBox="0 0 12 12" className="w-full h-full text-white"><path
                  d="M3 6.2l2 2L9 4" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div className={`text-[12.5px] ${t.done_at ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                {t.title}
              </div>
              <div className="text-[11px] text-gray-400">
                {t.due_at ? formatDateTimeShort(t.due_at) : 'без срока'}
                {' · '}{KIND_LABEL[t.kind] || t.kind}
                {t.auto ? ' · авто' : ''}
                {t.assignee_name ? ` · ${t.assignee_name}` : ''}
              </div>
            </div>
            <button onClick={() => remove(t)} title="Удалить задачу"
              className="opacity-0 group-hover:opacity-100 text-[11px] text-gray-300 hover:text-red-600 flex-none">
              удалить
            </button>
          </div>
        ))}
      </div>
    </Card>
  )
}
