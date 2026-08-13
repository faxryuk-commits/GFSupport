import { useCallback, useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Card, Chip, Empty, Kpis, Tabs, fmtDateTime, pct, Pager, PageShell, Th,
         Modal, Field, Btn, useAutoRefresh, slaTone, slaText, Skeleton , RangePicker, rangeOf } from './kit'
import { RegionBadge, useRegion } from './region'
import { useSalesRefs, optionsFor } from './refs'

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
  updated_at: string | null
  campaign: string | null
  text: string | null
  source: string | null
  source_key: string | null
  lead_kind: string | null
  account_id: string | null
  account_name: string | null
  account_created: string | null
  agent_name: string | null
}

interface LeadsData {
  leads: Lead[]
  hasMore: boolean
  total?: number | null
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
  ['nurture', 'На прогреве'],
  ['archived', 'Архив'],
]

/** Что человек сделал: форма, сообщение, комментарий, звонок. */
const KIND_LABEL: Record<string, string> = {
  form: 'заявка с формы', message: 'написал в мессенджер', comment: 'комментарий',
  call: 'звонок', manual: 'заведён вручную', other: 'обращение',
}
const KIND_TONE: Record<string, string> = {
  form: 'green', message: 'violet', comment: 'amber', call: 'blue', manual: 'gray', other: 'gray',
}

const STATUS_TONE: Record<string, string> = {
  assigned: 'blue', converted: 'green', new: 'amber', nurture: 'gray', junk: 'gray',
}
const STATUS_LABEL: Record<string, string> = {
  assigned: 'назначен', converted: 'в работе', new: 'в очереди', nurture: 'на прогреве', junk: 'мусор',
}

export function SalesLeadsPage() {
  const [data, setData] = useState<LeadsData | null>(null)
  const [view, setView] = useState('inbox')
  const [source, setSource] = useState('')
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const LIMIT = 50
  const region = useRegion('leads')
  const [busy, setBusy] = useState<string | null>(null)
  const [range, setRange] = useState(() => rangeOf('all'))
  const [facets, setFacets] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const refs = useSalesRefs()
  const blank = { name: '', phone: '', city: '', pos: '', orders_per_day: '', text: '', source: 'manual' }
  const [form, setForm] = useState(blank)

  // Номер запроса: при автообновлении и быстрой смене фильтров ответ старого
  // запроса приходил позже нового и перетирал список — со стороны это выглядит
  // как «фильтр не применился»
  const reqRef = useRef(0)

  const load = useCallback(() => {
    const p = new URLSearchParams({ view, limit: String(LIMIT), offset: String(offset) })
    p.set('region', region || 'all')
    if (source) p.set('source', source)
    if (range.from) p.set('from', range.from)
    if (range.to) p.set('to', range.to)
    for (const [k, v] of Object.entries(facets)) if (v) p.set(k, v)
    if (q) p.set('q', q)
    const my = ++reqRef.current
    apiGet<LeadsData>(`/sales/leads?${p.toString()}`, false)
      .then(d => { if (my !== reqRef.current) return; setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить лиды'))
  }, [view, source, q, offset, region, range, facets])

  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  useAutoRefresh(load)

  const create = async () => {
    if (!form.name && !form.phone) { setError('Укажите бренд или телефон'); return }
    setBusy('new')
    try {
      await apiPost('/sales/leads?action=create', { ...form, market: region || undefined })
      setCreating(false)
      setForm(blank)
      setError(null)
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось завести лид')
    } finally {
      setBusy(null)
    }
  }

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
  if (!data) return <Skeleton rows={8} />

  const s = data.stats || {}

  return (
    <PageShell header={
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">Лиды</h1>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            Обращение = один контакт от человека: заявка с формы, сообщение в директ,
            комментарий или звонок. Источник говорит откуда, вид — что именно человек сделал.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RegionBadge scope="leads" />
          <Btn kind="primary" onClick={() => setCreating(true)}>+ Лид</Btn>
          <Link to="/sales/queue" className="text-[12.5px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600">
            Моя очередь
          </Link>
        </div>
      </div>
    }>

      <Kpis items={[
        ['Сегодня', String(s.today ?? 0), 'новых обращений'],
        ['Ждут касания', String(s.waiting ?? 0), 'назначены, но не тронуты'],
        ['Без сейлза', String(s.unassigned ?? 0), 'в общей очереди'],
        ['На прогреве', String(s.nurture ?? 0), 'греет бот, сейлз не занят'],
        ['Касание за 15 мин', pct(s.in_sla ?? 0, s.touched ?? 0), 'за 30 дней'],
      ]} />

      {/* Фильтры остаются на месте при прокрутке: искать их в конце списка —
          то же самое, что не иметь фильтров */}
      <div className="bg-white border border-gray-200 rounded-xl sticky top-0 z-20 shadow-sm">
        <Tabs items={VIEWS} value={view} onChange={v => { setView(v); setOffset(0) }} />
        <div className="p-3 flex gap-2 flex-wrap items-center">
          <input value={q} onChange={e => { setQ(e.target.value); setOffset(0) }} placeholder="Бренд или телефон"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-[12.5px] w-56" />
          {/* Вид обращения важнее источника: заявку с формы можно звонить
              сразу, а комментарий сначала надо перевести в диалог */}
          <select value={facets.kind || ''} onChange={e => { setFacets({ ...facets, kind: e.target.value }); setOffset(0) }}
            className={`border rounded-lg px-2 py-1.5 text-[12.5px] ${
              facets.kind ? 'border-blue-400 text-blue-700' : 'border-gray-300'}`}>
            <option value="">Любое обращение</option>
            <option value="form">Заявка с формы</option>
            <option value="message">Написал в мессенджер</option>
            <option value="comment">Комментарий</option>
            <option value="call">Звонок</option>
            <option value="manual">Заведён вручную</option>
          </select>
          <select value={source} onChange={e => { setSource(e.target.value); setOffset(0) }}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]">
            <option value="">Все источники</option>
            {data.sources.map(src => (
              <option key={src.key} value={src.key}>{src.label} · {src.leads}</option>
            ))}
          </select>
          <RangePicker value={range} onChange={r => { setRange(r); setOffset(0) }} />
          {([
            ['pos', 'POS-система', optionsFor(refs, 'pos')],
            ['city', 'Город', optionsFor(refs, 'city', region)],
            ['orders_per_day', 'Заказов в день', optionsFor(refs, 'orders_per_day')],
          ] as Array<[string, string, string[]]>).map(([key, label, opts]) => (
            <select key={key} value={facets[key] || ''}
              onChange={e => { setFacets({ ...facets, [key]: e.target.value }); setOffset(0) }}
              className={`border rounded-lg px-2 py-1.5 text-[12.5px] ${
                facets[key] ? 'border-blue-400 text-blue-700' : 'border-gray-300'}`}>
              <option value="">{label}</option>
              {opts.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ))}
          {Object.values(facets).some(Boolean) && (
            <button onClick={() => setFacets({})}
              className="text-[11.5px] text-gray-400 hover:text-red-600">сбросить</button>
          )}
          <span className="text-[11.5px] text-gray-400 ml-auto">
            показано {data.leads.length}{data.total ? ` из ${data.total}` : ''}
          </span>
        </div>
      </div>

      {data.leads.length === 0 ? (
        <Empty
          title="Здесь пусто"
          hint={view === 'dupes'
            ? 'Склеек за период не было — каждое обращение пришло от нового клиента.'
            : view === 'nurture'
              ? 'На прогреве никого: все обращения либо в работе, либо ещё ждут первого касания.'
              : 'Под выбранный фильтр обращений нет.'}
        />
      ) : (
        <Card
          title={VIEWS.find(v => v[0] === view)?.[1] || ''}
          sub={view === 'nurture'
            ? 'лид сейчас не готов покупать: его греют бот и рассылка, сейлз вернётся по сигналу'
            : 'склейка по телефону выполняется на приёме'}
        >
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
                          {[l.city, l.phone, `создан ${fmtDateTime(l.created_at)}`,
                            l.updated_at && l.updated_at !== l.created_at
                              ? `изменён ${fmtDateTime(l.updated_at)}` : null]
                            .filter(Boolean).join(' · ')}
                        </div>
                        {/* Норматив первого касания — 15 минут: без срока рядом
                            со строкой он существует только в отчёте задним числом */}
                        {l.sla_due_at && !l.first_touch_at && l.status !== 'nurture' && (
                          <div className="mt-1">
                            <Chip tone={slaTone(l.sla_due_at)}>
                              первое касание {slaText(l.sla_due_at)}
                            </Chip>
                          </div>
                        )}
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
                        <Chip tone={KIND_TONE[l.lead_kind || ''] || 'gray'}>
                          {KIND_LABEL[l.lead_kind || ''] || 'обращение'}
                        </Chip>
                        <div className="mt-1"><Chip tone="blue">{l.source || '—'}</Chip></div>
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
                        {view === 'archived' ? (
                          <>
                            <button disabled={busy === l.id} onClick={() => act('restore', l.id)}
                              className="text-[12px] px-2.5 py-1 border border-gray-300 rounded-lg disabled:opacity-50">
                              Вернуть
                            </button>
                            <button disabled={busy === l.id}
                              onClick={() => {
                                if (confirm(`Удалить «${l.name}» насовсем? Отменить нельзя.`)) act('delete', l.id)
                              }}
                              className="ml-1.5 text-[12px] px-2 py-1 border border-gray-200 text-gray-400 rounded-lg hover:text-red-600 hover:border-red-200 disabled:opacity-50">
                              Удалить
                            </button>
                          </>
                        ) : l.status !== 'converted' && (
                          <>
                            <button disabled={busy === l.id} onClick={() => act('assign', l.id)}
                              className="text-[12px] px-2.5 py-1 bg-blue-600 text-white rounded-lg disabled:opacity-50">
                              Беру
                            </button>
                            {l.status !== 'nurture' && (
                              <button disabled={busy === l.id} onClick={() => act('nurture', l.id)}
                                className="ml-1.5 text-[12px] px-2.5 py-1 border border-gray-300 rounded-lg disabled:opacity-50">
                                На прогрев
                              </button>
                            )}
                            <button disabled={busy === l.id} onClick={() => act('archive', l.id)}
                              title="Убрать из списка, сохранив в истории"
                              className="ml-1.5 text-[12px] px-2 py-1 border border-gray-200 text-gray-400 rounded-lg hover:text-red-600 hover:border-red-200 disabled:opacity-50">
                              В архив
                            </button>
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
            total={data.total ?? undefined} onChange={setOffset} />
        </Card>
      )}

      {error && <div className="text-[12.5px] text-red-600">{error}</div>}

      {creating && (
        <Modal
          title="Новый лид"
          sub="звонок, выставка, рекомендация — всё, что пришло мимо рекламы"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Btn onClick={() => setCreating(false)}>Отмена</Btn>
              <Btn kind="primary" disabled={busy === 'new'} onClick={create}>
                {busy === 'new' ? 'Заводим…' : 'Завести и взять себе'}
              </Btn>
            </>
          }
        >
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Бренд" value={form.name} onChange={v => setForm({ ...form, name: v })}
              placeholder="Чайхана Хадия" />
            <Field label="Телефон" value={form.phone} onChange={v => setForm({ ...form, phone: v })}
              placeholder="+998 90 123 45 67" hint="по нему идёт склейка с существующим клиентом" />
            <Field label="Город" value={form.city} onChange={v => setForm({ ...form, city: v })}
              options={optionsFor(refs, 'city', region)} />
            <Field label="POS-система" value={form.pos} onChange={v => setForm({ ...form, pos: v })}
              options={optionsFor(refs, 'pos')} />
            <Field label="Заказов в день" value={form.orders_per_day}
              onChange={v => setForm({ ...form, orders_per_day: v })}
              options={optionsFor(refs, 'orders_per_day')} />
            <label className="block">
              <span className="text-[11.5px] font-medium text-gray-600">Источник</span>
              <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px]">
                {(refs?.sources || []).filter(x => x.is_active !== false).map(x => (
                  <option key={x.key} value={x.key}>{x.label}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-[11.5px] font-medium text-gray-600">Что просит</span>
            <textarea value={form.text} onChange={e => setForm({ ...form, text: e.target.value })}
              rows={2} placeholder="Своими словами: что нужно клиенту"
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px]" />
          </label>
        </Modal>
      )}
    </PageShell>
  )
}

export default SalesLeadsPage
