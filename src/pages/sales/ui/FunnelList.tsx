import { useMemo, useState } from 'react'
import { apiPost } from '@/shared/services/api.service'
import { Chip, Modal, money, fmtDateTime } from './kit'

/**
 * Воронка списком: те же обращения и сделки, что на доске, но строками —
 * с чекбоксами и действиями над многими сразу.
 *
 * Доска отвечает на «где что стоит», список — на «сделать одно и то же
 * с двадцатью». Сменить ответственного, перевести этап, поставить задачу
 * по выделенным: на доске это двадцать перетаскиваний.
 *
 * Массовый перевод этапа уважает критерии выхода так же, как одиночный:
 * движок отказывает по каждой сделке отдельно, и итог показывается
 * поимённо — «переведено 17, не пустил движок: 3».
 */

interface Row {
  kind: 'lead' | 'deal'; id: string; title: string; sub: string | null
  stageKey: string; stageLabel: string; owner: string | null
  at: string | null; amount: string | null; currency: string
  next: string | null; nextAt: string | null; phone: string | null
}

interface Props {
  leads: any[]; deals: any[]
  leadColumns: Array<{ key: string; label: string; statuses?: string[] }>
  stages: Array<{ key: string; label: string }>
  owners: Array<{ id: string; name: string }>
  onOpenLead: (id: string) => void
  onOpenDeal: (id: string) => void
  onChanged: () => void
  onError: (msg: string) => void
}

type Act = 'owner' | 'stage' | 'task' | 'archive' | null

export function FunnelList({ leads, deals, leadColumns, stages, owners, onOpenLead, onOpenDeal, onChanged, onError }: Props) {
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [act, setAct] = useState<Act>(null)
  const [pick, setPick] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDue, setTaskDue] = useState<'today' | 'tomorrow' | 'in3'>('tomorrow')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => {
    const colOf = (status: string) =>
      leadColumns.find(c => (c.statuses || [c.key]).includes(status))
    const stageLabel = (key: string) => stages.find(s => s.key === key)?.label || key
    const out: Row[] = []
    for (const l of leads) {
      const col = colOf(l.status)
      out.push({
        kind: 'lead', id: l.id, title: l.contact_name || l.name, sub: l.contact_name && l.name !== l.contact_name ? l.name : null,
        stageKey: `lead:${col?.key || l.status}`, stageLabel: col?.label || l.status,
        owner: l.agent_name, at: l.created_at, amount: null, currency: 'UZS',
        next: null, nextAt: null, phone: l.phone,
      })
    }
    for (const d of deals) {
      if (d.won_at || d.lost_at) continue
      out.push({
        kind: 'deal', id: d.id, title: d.account || d.title, sub: d.account && d.title !== d.account ? d.title : null,
        stageKey: d.stage_key, stageLabel: stageLabel(d.stage_key),
        owner: d.owner_name, at: d.updated_at || d.stage_since, amount: d.monthly_amount, currency: d.currency,
        next: d.next_step, nextAt: d.next_step_at, phone: d.phone,
      })
    }
    // Порядок как на доске: сначала обращения, потом этапы по порядку
    const order = new Map<string, number>()
    leadColumns.forEach((c, i) => order.set(`lead:${c.key}`, i))
    stages.forEach((s, i) => order.set(s.key, 100 + i))
    return out.sort((a, b) => (order.get(a.stageKey) ?? 999) - (order.get(b.stageKey) ?? 999)
      || String(b.at || '').localeCompare(String(a.at || '')))
  }, [leads, deals, leadColumns, stages])

  const selected = rows.filter(r => sel.has(`${r.kind}:${r.id}`))
  const selLeads = selected.filter(r => r.kind === 'lead')
  const selDeals = selected.filter(r => r.kind === 'deal')
  const allOn = rows.length > 0 && selected.length === rows.length
  const key = (r: Row) => `${r.kind}:${r.id}`
  const toggle = (r: Row) => setSel(s => { const n = new Set(s); n.has(key(r)) ? n.delete(key(r)) : n.add(key(r)); return n })
  const toggleAll = () => setSel(allOn ? new Set() : new Set(rows.map(key)))
  const close = () => { setAct(null); setPick(''); setTaskTitle(''); setReport(null) }

  /** По одному и до конца: отказ по одной карточке не должен ронять остальные. */
  const each = async (items: Row[], fn: (r: Row) => Promise<void>) => {
    const failed: string[] = []
    for (const r of items) {
      try { await fn(r) } catch (e: any) { failed.push(`${r.title} — ${String(e?.message || 'ошибка').slice(0, 80)}`) }
    }
    return failed
  }

  const run = async () => {
    if (!selected.length) return
    setBusy(true); setReport(null)
    try {
      let failed: string[] = []
      if (act === 'owner') {
        if (!pick) { onError('Выберите сотрудника'); return }
        if (selLeads.length) {
          await apiPost('/sales/leads?action=bulk', { ids: selLeads.map(r => r.id), op: 'assign', agentId: pick })
        }
        failed = await each(selDeals, r => apiPost('/sales/deal?action=owner', { id: r.id, agentId: pick }))
      } else if (act === 'stage') {
        if (!pick) { onError('Выберите этап'); return }
        failed = [
          ...await each(selDeals, r => apiPost('/sales/stage', { dealId: r.id, toStage: pick })),
          ...await each(selLeads, r => apiPost('/sales/funnel?action=convert', { leadId: r.id, toStage: pick })),
        ]
      } else if (act === 'task') {
        const title = taskTitle.trim()
        if (!title) { onError('Напишите, что сделать'); return }
        const at = new Date()
        if (taskDue === 'tomorrow') at.setDate(at.getDate() + 1)
        if (taskDue === 'in3') at.setDate(at.getDate() + 3)
        at.setHours(10, 0, 0, 0)
        failed = await each(selected, r => apiPost('/sales/tasks', {
          dealId: r.kind === 'deal' ? r.id : undefined,
          leadId: r.kind === 'lead' ? r.id : undefined,
          title, kind: 'task', dueAt: at.toISOString(),
        }))
      } else if (act === 'archive') {
        if (selLeads.length) {
          await apiPost('/sales/leads?action=bulk', { ids: selLeads.map(r => r.id), op: 'archive' })
        }
      }
      const done = selected.length - failed.length
      if (failed.length) {
        setReport(`Готово: ${done}. Не прошло: ${failed.length}\n${failed.join('\n')}`)
      } else {
        close()
        setSel(new Set())
      }
      onChanged()
    } finally { setBusy(false) }
  }

  const ACTIONS: Array<[Act, string, boolean]> = [
    ['owner', 'Сменить ответственного', true],
    ['stage', 'Перевести на этап', true],
    ['task', 'Поставить задачу', true],
    ['archive', 'Обращения — в отказ', selLeads.length > 0],
  ]

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Панель действий появляется, когда что-то выделено; иначе место не занимает */}
      <div className={`px-3 py-2 border-b flex items-center gap-2 flex-wrap text-[12.5px] ${
        selected.length ? 'bg-blue-50 border-blue-100' : 'border-gray-100 text-gray-400'}`}>
        <span className="font-medium text-gray-700 tabular-nums">
          {selected.length ? `Выбрано ${selected.length}` : `${rows.length} строк`}
          {selected.length ? <span className="text-gray-400 font-normal"> · обращений {selLeads.length}, сделок {selDeals.length}</span> : null}
        </span>
        {selected.length > 0 && ACTIONS.filter(a => a[2]).map(([k, label]) => (
          <button key={k} onClick={() => { setAct(k); setPick(''); setReport(null) }}
            className="px-2.5 py-1 rounded-md border border-blue-200 bg-white text-blue-700 hover:border-blue-400">
            {label}
          </button>
        ))}
        {selected.length > 0 && (
          <button onClick={() => setSel(new Set())} className="ml-auto text-gray-400 hover:text-gray-700">снять выделение</button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-gray-50 text-[10.5px] uppercase tracking-wider text-gray-400">
            <tr>
              <th className="px-3 py-2 w-8"><input type="checkbox" checked={allOn} onChange={toggleAll} /></th>
              <th className="text-left px-2 py-2 font-semibold">Этап</th>
              <th className="text-left px-2 py-2 font-semibold">Название</th>
              <th className="text-left px-2 py-2 font-semibold">Ответственный</th>
              <th className="text-left px-2 py-2 font-semibold">Телефон</th>
              <th className="text-right px-2 py-2 font-semibold">В месяц</th>
              <th className="text-left px-2 py-2 font-semibold">Следующий шаг</th>
              <th className="text-left px-3 py-2 font-semibold">Изменено</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={key(r)} className={`border-t border-gray-50 hover:bg-gray-50 ${sel.has(key(r)) ? 'bg-blue-50/50' : ''}`}>
                <td className="px-3 py-1.5"><input type="checkbox" checked={sel.has(key(r))} onChange={() => toggle(r)} /></td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <Chip tone={r.kind === 'lead' ? 'violet' : 'blue'}>{r.stageLabel}</Chip>
                </td>
                <td className="px-2 py-1.5 max-w-[320px]">
                  <button onClick={() => (r.kind === 'lead' ? onOpenLead(r.id) : onOpenDeal(r.id))}
                    className="text-left text-gray-900 font-medium hover:text-blue-600 truncate block max-w-full">
                    {r.title}
                  </button>
                  {r.sub && <div className="text-[11px] text-gray-400 truncate">{r.sub}</div>}
                </td>
                <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{r.owner || <span className="text-amber-600">ничей</span>}</td>
                <td className="px-2 py-1.5 text-gray-500 tabular-nums whitespace-nowrap">{r.phone || '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
                  {r.amount && Number(r.amount) ? money(r.amount, r.currency) : '—'}
                </td>
                <td className="px-2 py-1.5 text-gray-600 max-w-[260px]">
                  {r.kind === 'deal' ? (
                    r.next ? (
                      <span className="truncate block">
                        <span className={`tabular-nums mr-1.5 ${r.nextAt && new Date(r.nextAt) < new Date() ? 'text-red-600' : 'text-gray-400'}`}>
                          {r.nextAt ? fmtDateTime(r.nextAt) : ''}
                        </span>{r.next}
                      </span>
                    ) : <span className="text-amber-600">без шага</span>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-1.5 text-gray-400 tabular-nums whitespace-nowrap">{r.at ? fmtDateTime(r.at) : '—'}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">По этим фильтрам пусто.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {act && (
        <Modal
          title={ACTIONS.find(a => a[0] === act)?.[1] || ''}
          sub={`для ${selected.length} выбранных`}
          onClose={close}
          footer={
            <div className="flex items-center gap-2 justify-end">
              <button onClick={close} className="px-3 py-1.5 text-[12.5px] rounded-lg border border-gray-300 text-gray-600">Отмена</button>
              <button onClick={run} disabled={busy}
                className="px-3.5 py-1.5 text-[12.5px] font-semibold rounded-lg bg-blue-600 text-white disabled:opacity-50">
                {busy ? 'Выполняю…' : 'Применить'}
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-[12.5px]">
            {act === 'owner' && (
              <select value={pick} onChange={e => setPick(e.target.value)} autoFocus
                className="w-full border border-gray-300 rounded-lg px-2.5 py-2">
                <option value="">Кому передать…</option>
                {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            {act === 'stage' && (
              <>
                <select value={pick} onChange={e => setPick(e.target.value)} autoFocus
                  className="w-full border border-gray-300 rounded-lg px-2.5 py-2">
                  <option value="">На какой этап…</option>
                  {stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <p className="text-[11.5px] text-gray-400 leading-relaxed">
                  Критерии выхода проверяются по каждой карточке: кого движок не пустит —
                  покажу поимённо, остальные переведутся. Обращения станут сделками на этом этапе.
                </p>
              </>
            )}
            {act === 'task' && (
              <>
                <input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} autoFocus
                  placeholder="Что сделать — одной строкой"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                <div className="flex gap-1.5 items-center">
                  <span className="text-gray-400">Когда:</span>
                  {([['today', 'сегодня'], ['tomorrow', 'завтра'], ['in3', 'через 3 дня']] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setTaskDue(k)}
                      className={`px-2 py-0.5 rounded-md text-[11.5px] font-semibold border ${
                        taskDue === k ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-500 border-gray-200'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[11.5px] text-gray-400">Задача встанет каждому выбранному на его ответственного.</p>
              </>
            )}
            {act === 'archive' && (
              <p className="text-gray-700 leading-relaxed">
                {selLeads.length} обращений уйдут в отказ без причины. Сделки ({selDeals.length}) не трогаю —
                у проигрыша должна быть причина, её ставят из карточки.
              </p>
            )}
            {report && (
              <pre className="whitespace-pre-wrap text-[11.5px] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-900">
                {report}
              </pre>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
