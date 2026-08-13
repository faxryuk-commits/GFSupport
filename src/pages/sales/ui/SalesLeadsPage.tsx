import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Card, Chip, Empty, Kpis, Tabs, fmtDate, pct, Pager, PageShell, Th } from './kit'

/**
 * Лиды — входящие обращения из всех каналов в одной таблице.
 *
 * Вкладка «Дубли и склейки» показывает не мусор, а работу системы: обращение
 * приклеено к существующему аккаунту, а не создало вторую карточку клиента.
 */

interface Lead {
  id: string
  name: string
  phone: string | null
  city: string | null
  pos?: string | null
  orders_per_day?: string | null
  points?: number | null
  icp_score: number | null
  icp_reasons: Array<{ label: string; points: number }> | null
  status: string
  sla_due_at: string | null
  first_touch_at: string | null
  created_at: string
  campaign: string | null
  text: string | null
  source: string | null
  source_key: string | null
  account_id: string | null
  account_name: string | null
  account_created: string | null
  agent_name: string | null
}

interface LeadsData {
  leads: Lead[]
  hasMore: boolean
  stats: {
    today?: number; waiting?: number; unassigned?: number
    nurture?: number; in_sla?: number; touched?: number
  }
  sources: Array<{ key: string; label: string; leads: number }>
}

const VIEWS: Array<[string, string]> = [
  ['inbox', 'Входящие'],
  ['queue', 'Ждут распределения'],
  ['dupes', 'Дубли и склейки'],
  ['nurture', 'Nurture'],
]

const STATUS_TONE: Record<string, string> = {
  assigned: 'blue', converted: 'green', new: 'amber', nurture: 'gray', junk: 'gray',
}
const STATUS_LABEL: Record<string, string> = {
  assigned: 'назначен', converted: 'в работе', new: 'в очереди', nurture: 'nurture', junk: 'мусор',
}

export function SalesLeadsPage() {
  const [data, setData] = useState<LeadsData | null>(null)
  const [view, setView] = useState('inbox')
  const [source, setSource] = useState('')
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const LIMIT = 50
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    const p = new URLSearchParams({ view, limit: String(LIMIT), offset: String(offset) })
    if (source) p.set('source', source)
    if (q) p.set('q', q)
    apiGet<LeadsData>(`/sales/leads?${p.toString()}`, false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить лиды'))
  }, [view, source, q, offset])

  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  const act = async (action: string, leadId: string) => {
    setBusy(leadId)
    try {
      await apiPost(`/sales/leads?action=${action}`, { leadId })
      load()
    } catch (e: any) {
      setError(e?.message || 'Действие не выполнено')
    } finally {
      setBusy(null)
    }
  }

  if (error && !data) return <div className="p-6 text-sm text-gray-900">{error}</div>
  if (!data) return <div className="p-6 text-sm text-gray-400">Загружаем лиды…</div>

  const s = data.stats || {}

  return (
    <PageShell header={
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">Лиды</h1>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            Один вход для всех каналов: реклама, сайт, мессенджеры, звонки и ручной ввод
          </p>
        </div>
        <Link to="/sales/queue" className="text-[12.5px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600">
          Моя очередь
        </Link>
      </div>
    }>

      <Kpis items={[
        ['Сегодня', String(s.today ?? 0), 'новых обращений'],
        ['Ждут касания', String(s.waiting ?? 0), 'назначены, но не тронуты'],
        ['Без сейлза', String(s.unassigned ?? 0), 'в общей очереди'],
        ['В nurture', String(s.nurture ?? 0), 'без участия человека'],
        ['Касание за 15 мин', pct(s.in_sla ?? 0, s.touched ?? 0), 'за 30 дней'],
      ]} />

      <div className="bg-white border border-gray-200 rounded-xl">
        <Tabs items={VIEWS} value={view} onChange={v => { setView(v); setOffset(0) }} />
        <div className="p-3 flex gap-2 flex-wrap items-center">
          <input value={q} onChange={e => { setQ(e.target.value); setOffset(0) }} placeholder="Бренд или телефон"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-[12.5px] w-56" />
          <select value={source} onChange={e => { setSource(e.target.value); setOffset(0) }}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]">
            <option value="">Все источники</option>
            {data.sources.map(src => (
              <option key={src.key} value={src.key}>{src.label} · {src.leads}</option>
            ))}
          </select>
          <span className="text-[11.5px] text-gray-400 ml-auto">показано {data.leads.length}</span>
        </div>
      </div>

      {data.leads.length === 0 ? (
        <Empty
          title="Здесь пусто"
          hint={view === 'dupes'
            ? 'Склеек за период не было — каждое обращение пришло от нового клиента.'
            : 'Под выбранный фильтр обращений нет.'}
        />
      ) : (
        <Card title={VIEWS.find(v => v[0] === view)?.[1] || ''} sub="склейка по телефону выполняется на приёме">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <Th>Лид</Th><Th>Источник</Th><Th align="right">ICP</Th>
                  <Th>Статус</Th><Th>Аккаунт</Th><Th align="right"></Th>
                </tr>
              </thead>
              <tbody>
                {data.leads.map(l => {
                  const merged = l.account_created && new Date(l.account_created) < new Date(l.created_at)
                  return (
                    <tr key={l.id} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-gray-900">{l.name}</div>
                        <div className="text-[11px] text-gray-400">
                          {[l.city, l.phone, fmtDate(l.created_at)].filter(Boolean).join(' · ')}
                        </div>
                        {/* Качественные признаки лида: по ним сейлз решает,
                            брать ли, не открывая карточку */}
                        {(l.pos || l.orders_per_day || l.points) && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {l.pos && <Chip tone="violet">POS {l.pos}</Chip>}
                            {l.orders_per_day && <Chip tone="green">{l.orders_per_day} зак/день</Chip>}
                            {l.points ? <Chip tone="blue">{l.points} точек</Chip> : null}
                          </div>
                        )}
                        {l.text && (
                          <div className="text-[11px] text-gray-500 mt-1 max-w-[320px] line-clamp-2">
                            «{l.text.slice(0, 140)}»
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Chip tone="blue">{l.source || '—'}</Chip>
                        {l.campaign && <div className="text-[11px] text-gray-400 mt-1">{l.campaign}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Chip tone={(l.icp_score ?? 0) >= 50 ? 'green' : (l.icp_score ?? 0) >= 20 ? 'amber' : 'red'}>
                          {l.icp_score ?? 0}
                        </Chip>
                      </td>
                      <td className="px-4 py-2.5">
                        <Chip tone={STATUS_TONE[l.status] || 'gray'}>{STATUS_LABEL[l.status] || l.status}</Chip>
                        {l.agent_name && <div className="text-[11px] text-gray-400 mt-1">{l.agent_name}</div>}
                      </td>
                      <td className="px-4 py-2.5">
                        {l.account_id ? (
                          <Link to={`/sales/accounts/${l.account_id}`} className="text-blue-600 hover:underline">
                            {l.account_name}
                          </Link>
                        ) : <span className="text-gray-400">—</span>}
                        {merged && <div className="text-[11px] text-emerald-600 mt-0.5">приклеен к существующему</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {l.status !== 'converted' && (
                          <>
                            <button disabled={busy === l.id} onClick={() => act('assign', l.id)}
                              className="text-[12px] px-2.5 py-1 bg-blue-600 text-white rounded-lg disabled:opacity-50">
                              Беру
                            </button>
                            {l.status !== 'nurture' && (
                              <button disabled={busy === l.id} onClick={() => act('nurture', l.id)}
                                className="ml-1.5 text-[12px] px-2.5 py-1 border border-gray-300 rounded-lg disabled:opacity-50">
                                В nurture
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pager offset={offset} limit={LIMIT} count={data.leads.length} hasMore={data.hasMore}
            onChange={setOffset} />
        </Card>
      )}

      {error && <div className="text-[12.5px] text-red-600">{error}</div>}
    </PageShell>
  )
}

export default SalesLeadsPage
