import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPost } from '@/shared/services/api.service'

/**
 * Очередь дня — главный экран сейлза.
 *
 * Порядок секций задаёт система: горит по SLA → деньги в шаге от закрытия →
 * плановые касания → вернулись из реактивации. Сейлз не решает, с чего начать,
 * и в каждой строке написано следующее действие, а не только название бренда.
 */

interface Lead {
  id: string
  name: string
  icp_score: number | null
  city: string | null
  phone: string | null
  sla_due_at: string | null
  source: string | null
}

interface HotDeal {
  id: string
  title: string
  monthly_amount: string | null
  currency: string
  stage: string
  account: string | null
  stage_since: string
  doc_opens: number | null
}

interface Task {
  id: string
  title: string
  kind: string
  due_at: string
  channel: string | null
  deal_id: string | null
  deal_title: string | null
}

interface Revival {
  id: string
  title: string
  reason: string | null
  account: string | null
  lost_at: string
}

interface QueueData {
  sla: Lead[]
  hot: HotDeal[]
  tasks: Task[]
  revival: Revival[]
  stats: {
    active_deals?: number
    pipeline_amount?: string
    overdue_tasks?: number
    won_this_month?: number
  }
  total: number
}

function minutesLeft(iso: string | null): number | null {
  if (!iso) return null
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000)
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

function money(v: string | number | null | undefined, currency = 'UZS') {
  if (v === null || v === undefined) return '—'
  return `${Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ${currency}`
}

const Chip = ({ tone = 'gray', children }: { tone?: string; children: React.ReactNode }) => {
  const tones: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-600',
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  )
}

const SectionHead = ({ title, count }: { title: string; count: number }) => (
  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
    <span className="text-[10.5px] font-bold uppercase tracking-wider text-gray-500">{title}</span>
    <span className="text-[11px] text-gray-400 tabular-nums">{count}</span>
  </div>
)

export function SalesQueuePage() {
  const [data, setData] = useState<QueueData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    apiGet<QueueData>('/sales/queue')
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить очередь'))
  }, [])

  useEffect(() => { load() }, [load])

  const takeLead = async (leadId: string) => {
    setBusy(leadId)
    try {
      await apiPost('/sales/queue?action=take', { leadId })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось взять лид')
    } finally {
      setBusy(null)
    }
  }

  const closeTask = async (taskId: string) => {
    setBusy(taskId)
    try {
      await apiPost('/sales/queue?action=done', { taskId })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось закрыть задачу')
    } finally {
      setBusy(null)
    }
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
          <div className="text-sm text-gray-900 font-medium">{error}</div>
          <button onClick={load} className="mt-3 text-[13px] text-blue-600 hover:underline">
            Попробовать снова
          </button>
        </div>
      </div>
    )
  }

  if (!data) {
    return <div className="p-6 text-sm text-gray-400">Загружаем очередь…</div>
  }

  const s = data.stats || {}
  const empty = data.total === 0

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">Очередь дня</h1>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            Порядок задаёт система: сначала горящее по SLA, затем сделки ближе всего к закрытию
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/sales/deals" className="text-[12.5px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600">
            Все сделки
          </Link>
          <button onClick={load} className="text-[12.5px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600">
            Обновить
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-gray-200 border border-gray-200 rounded-xl overflow-hidden">
        {[
          ['В очереди', String(data.total), `${data.sla.length} горит по SLA`],
          ['Сделок в работе', String(s.active_deals ?? 0), money(s.pipeline_amount, 'UZS') + ' в месяц'],
          ['Просрочено задач', String(s.overdue_tasks ?? 0), 'попадут в пятничный разбор'],
          ['Закрыто в этом месяце', String(s.won_this_month ?? 0), 'выигранных сделок'],
        ].map(([k, v, d]) => (
          <div key={k} className="bg-white px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{k}</div>
            <div className="text-[21px] text-gray-900 tabular-nums mt-1 tracking-tight">{v}</div>
            <div className="text-[11px] text-gray-500 mt-0.5">{d}</div>
          </div>
        ))}
      </div>

      {empty && (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
          <div className="text-[15px] font-medium text-gray-900">Очередь пуста</div>
          <p className="text-[13px] text-gray-500 mt-1">
            Все касания сделаны, новых лидов нет. Хорошее время для холодных звонков.
          </p>
        </div>
      )}

      {!empty && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {data.sla.length > 0 && (
            <>
              <SectionHead title="Горит SLA — система переназначит сама" count={data.sla.length} />
              {data.sla.map(l => {
                const left = minutesLeft(l.sla_due_at)
                return (
                  <div key={l.id} className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap hover:bg-gray-50">
                    <span className="w-2 h-2 rounded-full bg-red-500 flex-none" />
                    <div className="min-w-[180px] flex-1">
                      <div className="text-[13px] font-semibold text-gray-900">{l.name}</div>
                      <div className="text-[11px] text-gray-400">
                        {[l.city, l.source, l.phone].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <Chip tone={l.icp_score && l.icp_score >= 50 ? 'green' : 'gray'}>ICP {l.icp_score ?? 0}</Chip>
                    <Chip tone={left !== null && left <= 0 ? 'red' : 'amber'}>
                      {left === null ? 'без срока' : left > 0 ? `${left} мин осталось` : 'просрочено'}
                    </Chip>
                    <button
                      disabled={busy === l.id}
                      onClick={() => takeLead(l.id)}
                      className="text-[12px] px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:brightness-110 disabled:opacity-50"
                    >
                      {busy === l.id ? '…' : 'Беру'}
                    </button>
                  </div>
                )
              })}
            </>
          )}

          {data.hot.length > 0 && (
            <>
              <SectionHead title="Деньги в одном шаге" count={data.hot.length} />
              {data.hot.map(d => (
                <div key={d.id} className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap hover:bg-gray-50">
                  <span className="w-2 h-2 rounded-full bg-amber-500 flex-none" />
                  <div className="min-w-[180px] flex-1">
                    <div className="text-[13px] font-semibold text-gray-900">{d.account || d.title}</div>
                    <div className="text-[11px] text-gray-400">
                      {d.stage} · {money(d.monthly_amount, d.currency)} в месяц · {daysSince(d.stage_since)} дн на этапе
                    </div>
                  </div>
                  {d.doc_opens ? <Chip tone="blue">КП открыто {d.doc_opens}×</Chip> : null}
                  <Link to={`/sales/deals/${d.id}`} className="text-[12px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600">
                    Открыть
                  </Link>
                </div>
              ))}
            </>
          )}

          {data.tasks.length > 0 && (
            <>
              <SectionHead title="Касания на сегодня" count={data.tasks.length} />
              {data.tasks.map(t => {
                const overdue = new Date(t.due_at).getTime() < Date.now()
                return (
                  <div key={t.id} className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap hover:bg-gray-50">
                    <span className={`w-2 h-2 rounded-full flex-none ${overdue ? 'bg-red-500' : 'bg-blue-500'}`} />
                    <div className="min-w-[180px] flex-1">
                      <div className="text-[13px] text-gray-900">
                        {t.deal_title && <span className="font-semibold">{t.deal_title}: </span>}
                        {t.title}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        {t.kind === 'cadence' ? 'каденция' : t.kind === 'followup' ? 'follow-up' : 'задача'}
                        {t.channel ? ` · ${t.channel}` : ''}
                      </div>
                    </div>
                    {overdue && <Chip tone="red">просрочена</Chip>}
                    <button
                      disabled={busy === t.id}
                      onClick={() => closeTask(t.id)}
                      className="text-[12px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-emerald-500 hover:text-emerald-600 disabled:opacity-50"
                    >
                      {busy === t.id ? '…' : 'Выполнено'}
                    </button>
                  </div>
                )
              })}
            </>
          )}

          {data.revival.length > 0 && (
            <>
              <SectionHead title="Вернулись из реактивации" count={data.revival.length} />
              {data.revival.map(r => (
                <div key={r.id} className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap hover:bg-gray-50">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 flex-none" />
                  <div className="min-w-[180px] flex-1">
                    <div className="text-[13px] font-semibold text-gray-900">{r.account || r.title}</div>
                    <div className="text-[11px] text-gray-400">
                      Отказ «{r.reason || 'без причины'}» · {daysSince(r.lost_at)} дн назад — причина могла устареть
                    </div>
                  </div>
                  <Link to={`/sales/deals/${r.id}`} className="text-[12px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600">
                    Открыть
                  </Link>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {error && (
        <div className="text-[12.5px] text-red-600">{error}</div>
      )}
    </div>
  )
}

export default SalesQueuePage
