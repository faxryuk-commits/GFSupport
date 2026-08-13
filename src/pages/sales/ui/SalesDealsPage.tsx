import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '@/shared/services/api.service'
import { Card, Chip, Empty, Pager, PageShell, Th, money } from './kit'
import { RegionSwitch, useRegion } from './region'

/**
 * Список сделок: канбан и таблица над одними данными.
 *
 * Вид «требуют внимания» — не отдельный фильтр по вкусу, а те же признаки, по
 * которым крон помечает сделку проблемной: застряла на этапе дольше норматива,
 * нет следующего шага, сорвана каденция.
 */

interface Deal {
  id: string
  title: string
  account: string | null
  city: string | null
  monthly_amount: string | null
  currency: string
  stage: string
  stage_key: string
  probability: number
  stage_since: string
  stalled_at: string | null
  next_step: string | null
  next_step_at: string | null
  owner_name: string | null
  source: string | null
  doc_opens: number | null
}

interface Summary {
  key: string
  label: string
  deals: number
  amount: string
  probability: number
}

interface DealsData {
  deals: Deal[]
  summary: Summary[]
  totals: {
    open_deals?: number
    pipeline_amount?: string
    stalled?: number
    no_next_step?: number
  }
  owners: Array<{ id: string; name: string }>
  hasMore: boolean
}

const VIEWS = [
  ['all', 'Все открытые'],
  ['mine', 'Мои'],
  ['attention', 'Требуют внимания'],
  ['reactivation', 'Реактивация'],
  ['archive', 'Архив'],
] as const


function days(iso: string | null): number {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

/** Почему сделка в списке проблемных — человеческим языком, а не флагом в базе. */
function problemOf(d: Deal): string | null {
  if (!d.next_step_at) return 'нет следующего шага'
  if (d.stalled_at) return `застряла ${days(d.stage_since)} дн`
  return null
}

export function SalesDealsPage() {
  const [data, setData] = useState<DealsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<string>('all')
  const [mode, setMode] = useState<'kanban' | 'table'>('kanban')
  const [owner, setOwner] = useState('')
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [region] = useRegion()
  const LIMIT = 50

  const load = useCallback(() => {
    const params = new URLSearchParams({ view, limit: String(LIMIT), offset: String(offset) })
    if (owner) params.set('owner', owner)
    if (q) params.set('q', q)
    if (region) params.set('region', region)
    apiGet<DealsData>(`/sales/deals?${params.toString()}`, false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить сделки'))
  }, [view, owner, q, offset, region])

  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0)   // поиск не дёргает сервер на каждую букву
    return () => clearTimeout(t)
  }, [load, q])

  if (error && !data) return <div className="p-6 text-sm text-gray-900">{error}</div>
  if (!data) return <div className="p-6 text-sm text-gray-400">Загружаем сделки…</div>

  const t = data.totals || {}
  const byStage = (key: string) => data.deals.filter(d => d.stage_key === key)

  return (
    <PageShell header={
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">Сделки</h1>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            {t.open_deals ?? 0} в работе на {money(t.pipeline_amount, 'UZS')} в месяц
            {t.stalled ? ` · ${t.stalled} застряло` : ''}
            {t.no_next_step ? ` · ${t.no_next_step} без следующего шага` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RegionSwitch />
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            {(['kanban', 'table'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`text-[12.5px] px-3 py-1.5 ${mode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:text-blue-600'}`}>
                {m === 'kanban' ? 'Канбан' : 'Таблица'}
              </button>
            ))}
          </div>
          <button onClick={load} className="text-[12.5px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600">
            Обновить
          </button>
        </div>
      </div>
    }>

      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="flex gap-1 px-4 border-b border-gray-100 overflow-x-auto">
          {VIEWS.map(([key, label]) => (
            <button key={key} onClick={() => { setView(key); setOffset(0) }}
              className={`text-[12.5px] px-3 py-2.5 border-b-2 whitespace-nowrap ${
                view === key ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>
              {label}
              {key === 'attention' && (t.stalled || t.no_next_step)
                ? <span className="ml-1.5 text-[10.5px] bg-red-50 text-red-700 px-1.5 py-0.5 rounded">
                    {(t.stalled || 0) + (t.no_next_step || 0)}
                  </span>
                : null}
            </button>
          ))}
        </div>
        <div className="p-3 flex gap-2 flex-wrap items-center">
          <input
            value={q}
            onChange={e => { setQ(e.target.value); setOffset(0) }}
            placeholder="Поиск по бренду"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-[12.5px] w-56"
          />
          <select value={owner} onChange={e => { setOwner(e.target.value); setOffset(0) }}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]">
            <option value="">Все сейлзы</option>
            {data.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <span className="text-[11.5px] text-gray-400 ml-auto">
            показано {data.deals.length}{data.hasMore ? '+' : ''}
          </span>
        </div>
      </div>

      {data.deals.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
          <div className="text-[15px] font-medium text-gray-900">Здесь пусто</div>
          <p className="text-[13px] text-gray-500 mt-1">
            {view === 'attention'
              ? 'Ни одна сделка не застряла и у всех назначен следующий шаг — так и должно быть.'
              : 'Под выбранный фильтр сделок нет.'}
          </p>
        </div>
      )}

      {mode === 'kanban' && data.deals.length > 0 && (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${data.summary.length}, minmax(190px, 1fr))`, overflowX: 'auto' }}>
          {data.summary.map(s => (
            <div key={s.key} className="bg-gray-50 border border-gray-100 rounded-xl p-2 space-y-2">
              <div className="flex justify-between items-baseline px-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-gray-500">{s.label}</span>
                <span className="text-[11px] text-gray-400 tabular-nums">{s.deals}</span>
              </div>
              <div className="text-[11px] text-gray-400 px-1 -mt-1">{money(s.amount, 'UZS')}</div>
              {byStage(s.key).map(d => {
                const problem = problemOf(d)
                return (
                  <Link key={d.id} to={`/sales/deals/${d.id}`}
                    className={`block bg-white border border-gray-200 rounded-lg p-2.5 border-l-[3px] hover:shadow-sm ${
                      problem ? 'border-l-red-500' : d.doc_opens ? 'border-l-amber-500' : 'border-l-blue-500'}`}>
                    <div className="text-[12px] font-semibold text-gray-900">{d.account || d.title}</div>
                    <div className="text-[10.5px] text-gray-400 mt-0.5">
                      {money(d.monthly_amount, d.currency)} · {days(d.stage_since)} дн
                    </div>
                    {problem && <div className="text-[10.5px] text-red-600 mt-1">{problem}</div>}
                    {!problem && d.doc_opens ? (
                      <div className="text-[10.5px] text-amber-600 mt-1">КП открыто {d.doc_opens}×</div>
                    ) : null}
                  </Link>
                )
              })}
              {byStage(s.key).length === 0 && (
                <div className="text-[11px] text-gray-300 text-center py-3">пусто</div>
              )}
            </div>
          ))}
        </div>
      )}

      {mode === 'table' && data.deals.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400">
                  <Th>Сделка</Th><Th>Этап</Th><Th>Сейлз</Th>
                  <Th align="right">В месяц</Th><Th align="right">На этапе</Th><Th>Следующий шаг</Th>
                </tr>
              </thead>
              <tbody>
                {data.deals.map(d => {
                  const problem = problemOf(d)
                  return (
                    <tr key={d.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <Link to={`/sales/deals/${d.id}`} className="font-semibold text-gray-900 hover:text-blue-600">
                          {d.account || d.title}
                        </Link>
                        <div className="text-[11px] text-gray-400 whitespace-nowrap">
                          {[d.city, d.source].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-600">
                          {d.stage}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{d.owner_name || '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
                        {money(d.monthly_amount, d.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{days(d.stage_since)} дн</td>
                      <td className="px-4 py-2.5">
                        {problem
                          ? <span className="text-[11px] text-red-600">{problem}</span>
                          : <span className="text-gray-600">{d.next_step || '—'}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pager offset={offset} limit={LIMIT} count={data.deals.length} hasMore={data.hasMore}
            onChange={setOffset} />
        </div>
      )}

      {mode === 'kanban' && data.deals.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl">
          <Pager offset={offset} limit={LIMIT} count={data.deals.length} hasMore={data.hasMore}
            onChange={setOffset} />
        </div>
      )}

      {error && <div className="text-[12.5px] text-red-600">{error}</div>}
    </PageShell>
  )
}

export default SalesDealsPage
