import { useCallback, useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Card, Chip, Empty, Kpis, Tabs, fmtDateTime, pct, Pager, PageShell, Th,
         Modal, Field, Btn, useAutoRefresh, leadStatus, slaTone, slaText, Skeleton , RangePicker, rangeOf , PageNumbers, FilterBar, BulkBar } from './kit'
import { RegionBadge, useRegion } from './region'
import { useSalesRefs, optionsFor } from './refs'
import { parsePhone } from '@/shared/lib/phone'

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
  contact_name: string | null
  /** Поля, которые человек заполнил в форме: бренд, направление, точки и т.д. */
  details: Array<{ label: string; value: string }>
}

interface LeadsData {
  leads: Lead[]
  agents?: Array<{ id: string; name: string }>
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
  ['converted', 'Стали сделками'],
  ['archived', 'Архив'],
]

/** Что человек сделал: форма, сообщение, комментарий, звонок. */
const KIND_LABEL: Record<string, string> = {
  form: 'заявка с формы', message: 'написал в мессенджер', comment: 'комментарий',
  call: 'звонок', email: 'письмо', manual: 'заведён вручную',
}
const KIND_TONE: Record<string, string> = {
  form: 'green', message: 'violet', comment: 'amber', call: 'blue',
  email: 'blue', manual: 'gray', other: 'red',
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
  // Отметки для массовых действий
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
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

  /** Массовое действие: одно нажатие вместо двадцати одинаковых. */
  const bulk = async (op: string, agentId?: string) => {
    if (!picked.length) return
    const names: Record<string, string> = {
      assign: 'взять в работу', nurture: 'отправить на прогрев',
      archive: 'убрать в архив', delete: 'удалить насовсем',
    }
    if (op === 'delete' && !confirm(`Удалить ${picked.length} лидов насовсем? Те, из которых выросли сделки, будут пропущены.`)) return
    if (op !== 'delete' && !confirm(`${names[op] || op}: ${picked.length} лидов?`)) return
    setBusy('bulk')
    try {
      const res: any = await apiPost('/sales/leads?action=bulk', { op, ids: picked, agentId })
      if (res?.skipped) setError(`Пропущено ${res.skipped}: по ним уже есть сделки`)
      setPicked([])
      load()
    } catch (e: any) {
      setError(e?.message || 'Действие не выполнено')
    } finally { setBusy(null) }
  }

  const reassign = async (leadId: string, name: string) => {
    const list = (data?.agents || []).map((a, i) => `${i + 1}. ${a.name}`).join('\n')
    const pick = prompt(`Кому передать «${name}»?\n\n${list}\n\nНомер:`)
    const agent = (data?.agents || [])[Number(pick) - 1]
    if (!agent) return
    setBusy(leadId)
    try {
      await apiPost('/sales/leads?action=reassign', { leadId, agentId: agent.id })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось передать')
    } finally { setBusy(null) }
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
    <PageShell fill header={
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-[18px] font-semibold text-gray-900 tracking-tight">Лиды</h1>
          {/* Счётчики строкой, а не плитками: пять чисел не стоят четверти экрана */}
          <div className="flex items-center gap-3 text-[11.5px] text-gray-500 flex-wrap">
            <span title="новых обращений сегодня">
              сегодня <b className="text-gray-900">{s.today ?? 0}</b>
            </span>
            <span title="назначены, но не тронуты">
              ждут касания <b className={s.waiting ? 'text-amber-600' : 'text-gray-900'}>{s.waiting ?? 0}</b>
            </span>
            <span title="в общей очереди, без сейлза">
              без сейлза <b className={s.unassigned ? 'text-red-600' : 'text-gray-900'}>{s.unassigned ?? 0}</b>
            </span>
            <span title="греет ассистент, сейлз не занят">
              на прогреве <b className="text-gray-900">{s.nurture ?? 0}</b>
            </span>
            <span title="доля первых касаний в норматив 15 минут за 30 дней">
              касание за 15 мин <b className="text-gray-900">{pct(s.in_sla ?? 0, s.touched ?? 0)}</b>
            </span>
          </div>
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



      {/* Фильтры остаются на месте при прокрутке: искать их в конце списка —
          то же самое, что не иметь фильтров */}
      <div className="bg-white border border-gray-200 rounded-xl flex-none">
        <Tabs items={VIEWS} value={view} onChange={v => { setView(v); setOffset(0) }} />
        <FilterBar
          active={[
            q && `поиск: ${q}`,
            facets.kind && 'вид обращения',
            source && 'источник',
            range.key !== 'all' && 'период',
            facets.pos && `POS: ${facets.pos}`,
            facets.city && facets.city,
            facets.orders_per_day && `${facets.orders_per_day} зак/день`,
          ].filter(Boolean) as string[]}
          right={
            <span className="text-[11.5px] text-gray-400 ml-auto">
              показано {data.leads.length}{data.total ? ` из ${data.total}` : ''}
            </span>
          }
        >
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
            <option value="email">Письмо</option>
            <option value="manual">Заведён вручную</option>
            <option value="other">Источник не определён</option>
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
                </FilterBar>
      </div>

      {data.leads.length === 0 ? (
        <Empty
          title="Здесь пусто"
          hint={view === 'dupes'
            ? 'Склеек за период не было — каждое обращение пришло от нового клиента.'
            : view === 'nurture'
              ? 'На прогреве никого: все обращения либо в работе, либо ещё ждут первого касания.'
              : view === 'converted'
                ? 'Пока ни одно обращение не дошло до сделки за выбранный период.'
                : 'Под выбранный фильтр обращений нет.'}
        />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
        <Card fill title="" >
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full min-w-[820px] text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <Th>
                    <input type="checkbox"
                      checked={picked.length > 0 && picked.length === data.leads.length}
                      onChange={e => setPicked(e.target.checked ? data.leads.map(l => l.id) : [])} />
                  </Th>
                  <Th>№</Th>
                  <Th>Обращение</Th><Th align="right">ICP</Th><Th align="right"></Th>
                </tr>
              </thead>
              <tbody>
                {data.leads.map((l, idx) => {
                  const merged = l.account_created && new Date(l.account_created) < new Date(l.created_at)
                  const phone = parsePhone(l.phone)
                  return (
                    <tr key={l.id} className={`border-b border-gray-100 hover:bg-gray-50 align-top ${
                      picked.includes(l.id) ? 'bg-blue-50/50' : ''}`}>
                      <td className="px-4 py-2.5">
                        <input type="checkbox" checked={picked.includes(l.id)}
                          onChange={() => toggle(l.id)} />
                      </td>
                      {/* Номер строки: «сколько ещё осталось» видно без счёта пальцем */}
                      <td className="px-2 py-2.5 text-[11px] text-gray-400 tabular-nums">
                        {offset + idx + 1}
                      </td>
                      <td className="px-4 py-2.5">
                        {/* Порядок: кто написал → откуда компания → что сказал →
                            когда. Название и текст не повторяем: раньше одно и
                            то же значение стояло в трёх местах строки */}
                        {/* Имя ведёт в карточку самого обращения: строка — это
                            обращение, а не компания. Раньше клик уводил в
                            аккаунт, и «что это за заявка» оставалось без ответа.
                            Компания рядом остаётся ссылкой на аккаунт */}
                        <Link to={`/sales/leads/${l.id}`}
                          className="text-[13px] font-semibold text-blue-600 hover:underline">
                          {l.contact_name || l.name}
                        </Link>
                        {l.contact_name && l.name !== l.contact_name && (
                          l.account_id ? (
                            <Link to={`/sales/accounts/${l.account_id}`}
                              className="text-[12px] text-gray-600 hover:text-blue-600 hover:underline"> · {l.name}</Link>
                          ) : (
                            <span className="text-[12px] text-gray-600"> · {l.name}</span>
                          )
                        )}
                        <div className="flex gap-1 mt-1 flex-wrap items-center">
                          {KIND_LABEL[l.lead_kind || ''] && (
                            <Chip tone={KIND_TONE[l.lead_kind || ''] || 'gray'}>
                              {KIND_LABEL[l.lead_kind || '']}
                            </Chip>
                          )}
                          <Chip tone="blue">{l.source || 'источник не определён'}</Chip>
                          <Chip tone={leadStatus(l.status).tone}>{leadStatus(l.status).label}</Chip>
                          {l.sla_due_at && !l.first_touch_at && l.status !== 'nurture' && (
                            <Chip tone={slaTone(l.sla_due_at)}>
                              первое касание {slaText(l.sla_due_at)}
                            </Chip>
                          )}
                          {l.city && <Chip tone="gray">{l.city}</Chip>}
                          {l.phone && (
                            <Chip tone="gray">
                              {phone.valid ? phone.pretty : l.phone}
                              {phone.operator ? ` · ${phone.kind === 'landline' ? 'городской' : phone.operator}` : ''}
                            </Chip>
                          )}
                          {l.agent_name && <Chip tone="violet">{l.agent_name}</Chip>}
                        </div>

                        {/* Превью сообщения — то, ради чего сейлз вообще смотрит
                            в строку. Если текста нет, честно говорим об этом
                            коротко, а не абзацем */}
                        {l.text && l.text !== l.name ? (
                          <div className="text-[12px] text-gray-700 mt-1 max-w-[420px] line-clamp-2">
                            «{l.text}»
                          </div>
                        ) : l.lead_kind === 'message' ? (
                          <div className="text-[11.5px] text-gray-400 mt-1">текст сообщения не пришёл</div>
                        ) : null}

                        <div className="text-[11px] text-gray-400 mt-1">
                          {fmtDateTime(l.created_at)}
                        </div>

                        {(l.details || []).length > 0 && (
                          <div className="flex gap-1 mt-1.5 flex-wrap max-w-[420px]">
                            {l.details.map((d, i) => (
                              <span key={i}
                                className="text-[10.5px] bg-gray-50 border border-gray-200 rounded-md px-1.5 py-0.5">
                                <span className="text-gray-400">{d.label}:</span>{' '}
                                <span className="text-gray-700 font-medium">{d.value}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right align-top">
                        <Chip tone={(l.icp_score ?? 0) >= 50 ? 'green' : (l.icp_score ?? 0) >= 20 ? 'amber' : 'red'}>
                          {l.icp_score ?? 0}
                        </Chip>
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
                            <button disabled={busy === l.id} onClick={() => reassign(l.id, l.name)}
                              title="Передать другому сейлзу"
                              className="ml-1.5 text-[12px] px-2 py-1 border border-gray-300 rounded-lg disabled:opacity-50">
                              Передать
                            </button>
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
          <BulkBar count={picked.length} onClear={() => setPicked([])}>
            <Btn onClick={() => bulk('assign')}>Взять себе</Btn>
            <Btn onClick={() => {
              const list = (data.agents || []).map((a, i) => `${i + 1}. ${a.name}`).join('\n')
              const pick = prompt(`Кому передать ${picked.length} лидов?\n\n${list}\n\nНомер:`)
              const agent = (data.agents || [])[Number(pick) - 1]
              if (agent) bulk('assign', agent.id)
            }}>Передать</Btn>
            <Btn onClick={() => bulk('nurture')}>На прогрев</Btn>
            <Btn onClick={() => bulk('archive')}>В архив</Btn>
            <Btn kind="danger" onClick={() => bulk('delete')}>Удалить</Btn>
          </BulkBar>
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 bg-gray-50 flex-wrap">
            <span className="text-[11.5px] text-gray-500">
              строки {offset + 1}–{offset + data.leads.length}{data.total ? ` из ${data.total}` : ''}
            </span>
            <PageNumbers offset={offset} limit={LIMIT} total={data.total || data.leads.length}
              onChange={setOffset} />
          </div>
        </Card>
        </div>
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
