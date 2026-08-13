import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiGet, apiPost, apiDelete } from '@/shared/services/api.service'
import { Card, Chip, Empty, Pager, PageShell, Th, money, Modal, Field, Btn,
         useAutoRefresh, fmtDateTime, Skeleton, BoardSkeleton , Drawer , RangePicker, rangeOf , slaTone } from './kit'
import { RegionBadge, useRegion } from './region'
import { SalesDealPage } from './SalesDealPage'
import { useSalesRefs, optionsFor } from './refs'

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
  created_at: string
  updated_at: string | null
  won_at: string | null
  lost_at: string | null
  lost_reason: string | null
  lost_comment: string | null
  owner_name: string | null
  source: string | null
  doc_opens: number | null
  points: number | null
  pos: string | null
  orders_per_day: string | null
  tariff: string | null
  deal_city: string | null
}

interface Summary {
  key: string
  label: string
  deals: number
  amount: string
  probability: number
  sla_hours: string | null
}

interface ClosedStage {
  key: string
  label: string
  kind: string
  deals: number
  amount: string
}

interface DealsData {
  deals: Deal[]
  summary: Summary[]
  closed: ClosedStage[]
  totals: {
    open_deals?: number
    pipeline_amount?: string
    stalled?: number
    no_next_step?: number
  }
  owners: Array<{ id: string; name: string }>
  hasMore: boolean
  closedWindow: { from: string | null; to: string | null } | null
}

const BLANK = {
  title: '', city: '', pos: '', ordersPerDay: '', points: '',
  tariff: '', monthlyAmount: '', dealType: 'new',
}

const VIEWS = [
  ['all', 'Все открытые'],
  ['mine', 'Мои'],
  ['attention', 'Требуют внимания'],
  ['won', 'Выигранные'],
  ['lost', 'Проигранные'],
  ['reactivation', 'Реактивация'],
] as const


function days(iso: string | null): number {
  if (!iso) return 0
  const ts = iso.includes('Z') || iso.includes('+') ? iso : iso + 'Z'
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
}

/** Цвет возраста считаем от норматива этапа: 3 дня на дозвоне и на договоре — разное. */
function ageTone(d: Deal, slaHours: string | null): string {
  const age = days(d.stage_since)
  const norm = slaHours ? Number(slaHours) / 24 : 0
  if (!norm) return 'gray'
  if (age > norm) return 'red'
  if (age >= norm - 1) return 'amber'
  return 'gray'
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
  const [range, setRange] = useState(() => rangeOf('all'))
  const [perStage, setPerStage] = useState(30)
  // Срезы по признакам: касса, город, тип заведения, тариф, нагрузка, источник
  const [facets, setFacets] = useState<Record<string, string>>({})
  const [offset, setOffset] = useState(0)
  const region = useRegion()
  const refs = useSalesRefs()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(BLANK)
  // Перетаскивание: что тащим и над какой колонкой висим
  // Карточка открывается панелью поверх списка: список остаётся прокрученным,
  // фильтры выставленными, возвращаться некуда
  const [openDeal, setOpenDeal] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<string | null>(null)
  // Отменяемый перенос: промахнуться мышью проще, чем попасть
  const [undo, setUndo] = useState<{ id: string; from: string; title: string; to: string } | null>(null)
  // Бросок в «Проиграна» открывает выбор причины: без неё закрывать нельзя —
  // от причины зависит, когда сделка вернётся в работу
  const [losing, setLosing] = useState<{ id: string; title: string; from: string } | null>(null)
  const [reasons, setReasons] = useState<Array<{ id: string; code: string; label: string; reactivate_days: number | null }>>([])
  const LIMIT = 50

  const load = useCallback(() => {
    const params = new URLSearchParams({ view, limit: String(LIMIT), offset: String(offset) })
    if (mode === 'kanban') params.set('perStage', String(perStage))
    for (const [k, v] of Object.entries(facets)) if (v) params.set(k, v)
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    if (owner) params.set('owner', owner)
    if (q) params.set('q', q)
    apiGet<DealsData>(`/sales/deals?${params.toString()}`, false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить сделки'))
  }, [view, owner, q, offset, region, mode, range, perStage, facets])

  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0)   // поиск не дёргает сервер на каждую букву
    return () => clearTimeout(t)
  }, [load, q])

  // Список живёт сам: раз в полминуты и при возврате на вкладку
  useAutoRefresh(load)

  useEffect(() => {
    apiGet<any>('/sales/refs', false)
      .then(r => setReasons((r.reasons || []).filter((x: any) => x.is_active !== false)))
      .catch(() => {})
  }, [])

  // Плашки не висят вечно: отмена переноса живёт 8 секунд, ошибка — 6
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 8000)
    return () => clearTimeout(t)
  }, [undo])
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 6000)
    return () => clearTimeout(t)
  }, [error])

  const create = async () => {
    if (!form.title.trim()) { setError('Укажите название сделки'); return }
    setSaving(true)
    try {
      const res: any = await apiPost('/sales/deals', {
        ...form,
        market: region || undefined,
        monthlyAmount: form.monthlyAmount ? Number(form.monthlyAmount.replace(/\s/g, '')) : null,
      })
      setCreating(false)
      setForm(BLANK)
      setError(null)
      load()
      if (res?.id) setOpenDeal(res.id)
    } catch (e: any) {
      setError(e?.message || 'Не удалось завести сделку')
    } finally {
      setSaving(false)
    }
  }

  /**
   * Перенос карточки в колонку — тот же переход этапа, что и кнопкой в карточке:
   * движок проверяет критерии выхода и объясняет отказ прямо здесь, а не после
   * захода внутрь сделки.
   */
  const move = async (dealId: string, toStage: string, silent = false) => {
    if (!data) return
    const deal = data.deals.find(x => x.id === dealId)
    if (!deal || deal.stage_key === toStage) return
    setOverStage(null)
    setDragId(null)

    // Карточка переезжает сразу, не дожидаясь ответа: сеть занимает доли
    // секунды, но за это время доска успевает моргнуть, и перенос выглядит
    // сорвавшимся. Если сервер откажет — вернём на место
    const snapshot = data
    const nextStage = data.summary.find(x => x.key === toStage)
    setData({
      ...data,
      deals: data.deals.map(x => x.id === dealId
        ? { ...x, stage_key: toStage, stage: nextStage?.label || x.stage, stage_since: new Date().toISOString(), stalled_at: null }
        : x),
      summary: data.summary.map(x =>
        x.key === toStage ? { ...x, deals: x.deals + 1 }
        : x.key === deal.stage_key ? { ...x, deals: Math.max(0, x.deals - 1) }
        : x),
    })

    try {
      await apiPost('/sales/stage', { dealId, toStage })
      setError(null)
      if (!silent) {
        setUndo({ id: dealId, from: deal.stage_key, to: toStage, title: deal.account || deal.title })
      }
      // Догоняем сервер спокойно: срез по этапам вернёт карточку на месте
      setTimeout(load, 400)
    } catch (e: any) {
      // 422 движка — не поломка, а несоблюдённое условие этапа
      setData(snapshot)
      setError(e?.message || 'Переход заблокирован')
    }
  }

  const drop = (toStage: string, kind?: string) => {
    if (!dragId) return
    if (kind === 'lost') {
      const deal = data?.deals.find(x => x.id === dragId)
      if (deal) setLosing({ id: deal.id, title: deal.account || deal.title, from: deal.stage_key })
      setDragId(null)
      setOverStage(null)
      return
    }
    move(dragId, toStage)
  }

  const lose = async (code: string) => {
    if (!losing) return
    const { id, title, from } = losing
    setLosing(null)
    try {
      await apiPost('/sales/stage', { dealId: id, toStage: 'lost', lostReasonCode: code })
      setUndo({ id, from, to: 'lost', title })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось закрыть сделку')
    }
  }

  const archive = async (id: string, title: string) => {
    if (!confirm(`Убрать «${title}» в архив? Сделка исчезнет из списков, но останется в истории аккаунта.`)) return
    try {
      await apiDelete(`/sales/deals?id=${id}`)
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось убрать в архив')
    }
  }

  if (error && !data) return <div className="p-6 text-sm text-gray-900">{error}</div>
  if (!data) return mode === 'kanban' ? <BoardSkeleton /> : <Skeleton rows={8} />

  const t = data.totals || {}
  const byStage = (key: string) => data.deals.filter(d => d.stage_key === key)
  const maxInStage = Math.max(1, ...data.summary.map(x => x.deals))

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
          <RegionBadge />
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            {(['kanban', 'table'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`text-[12.5px] px-3 py-1.5 ${mode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:text-blue-600'}`}>
                {m === 'kanban' ? 'Канбан' : 'Таблица'}
              </button>
            ))}
          </div>
          <Btn kind="primary" onClick={() => setCreating(true)}>+ Сделка</Btn>
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
          <RangePicker value={range} onChange={r => { setRange(r); setOffset(0) }} />
          {/* Срезы по признакам: «покажи всех с IIKO в Ташкенте» — вопрос,
              который сейлз задаёт каждый день, а раньше отвечал глазами */}
          {([
            ['pos', 'POS-система', optionsFor(refs, 'pos')],
            ['city', 'Город', optionsFor(refs, 'city', region)],
            ['segment', 'Тип заведения', optionsFor(refs, 'segment')],
            ['tariff', 'Тариф', optionsFor(refs, 'tariff')],
            ['orders_per_day', 'Заказов в день', optionsFor(refs, 'orders_per_day')],
            ['source', 'Источник', (refs?.sources || []).map(x => x.label)],
          ] as Array<[string, string, string[]]>).map(([key, label, opts]) => (
            <select key={key} value={facets[key] || ''}
              onChange={e => { setFacets({ ...facets, [key]: e.target.value }); setOffset(0) }}
              className={`border rounded-lg px-2 py-1.5 text-[12.5px] ${
                facets[key] ? 'border-blue-400 text-blue-700' : 'border-gray-300'}`}>
              <option value="">{label}</option>
              {opts.map(o => <option key={o} value={key === 'source'
                ? (refs?.sources || []).find(x => x.label === o)?.key || o : o}>{o}</option>)}
            </select>
          ))}
          {Object.values(facets).some(Boolean) && (
            <button onClick={() => setFacets({})}
              className="text-[11.5px] text-gray-400 hover:text-red-600">сбросить</button>
          )}
          <span className="text-[11.5px] text-gray-400 ml-auto">
            показано {data.deals.length}
            {mode === 'kanban' && t.open_deals ? ` из ${t.open_deals}` : data.hasMore ? '+' : ''}
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

      {mode === 'kanban' && view !== 'won' && view !== 'lost' && data.deals.length > 0 && (
        <div className="flex gap-3 overflow-x-auto items-start pb-2 -mx-1 px-1">
          {data.summary.map(st => (
            <section
              key={st.key}
              onDragOver={e => { e.preventDefault(); setOverStage(st.key) }}
              onDragLeave={() => setOverStage(o => (o === st.key ? null : o))}
              onDrop={e => { e.preventDefault(); drop(st.key) }}
              className={`flex-none w-[268px] bg-white border rounded-xl flex flex-col
                max-h-[calc(100vh-290px)] transition-colors duration-150 ${
                overStage === st.key ? 'border-blue-500 ring-2 ring-blue-100 bg-blue-50/40' : 'border-gray-200'}`}
            >
              <header className="px-3 py-2.5 border-b border-gray-100 sticky top-0 bg-white rounded-t-xl">
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-gray-600">{st.label}</span>
                  <span className="text-[11.5px] text-gray-400 tabular-nums">{st.deals}</span>
                </div>
                <div className="text-[11px] text-gray-400 tabular-nums mt-0.5">
                  {Number(st.amount) ? money(st.amount, 'UZS') : 'сумма не указана'}
                  {st.sla_hours ? ` · норматив ${Math.round(Number(st.sla_hours) / 24) || 1} дн` : ''}
                </div>
                <div className="mt-2 h-[3px] rounded bg-gray-100 overflow-hidden">
                  <span className="block h-full bg-blue-600"
                    style={{ width: `${Math.round((st.deals / maxInStage) * 100)}%` }} />
                </div>
              </header>

              <div className="p-2.5 flex flex-col gap-2 overflow-y-auto min-h-[76px]">
                {byStage(st.key).map(d => {
                  const problem = problemOf(d)
                  const tone = ageTone(d, st.sla_hours)
                  const facts = [
                    d.city || d.deal_city,
                    d.points ? `${d.points} точ.` : null,
                    d.pos,
                    d.orders_per_day ? `${d.orders_per_day} зак/день` : null,
                  ].filter(Boolean) as string[]
                  return (
                    <article
                      key={d.id}
                      draggable
                      onDragStart={() => setDragId(d.id)}
                      onDragEnd={() => { setDragId(null); setOverStage(null) }}
                      className={`bg-white border border-gray-200 rounded-lg p-2.5 border-l-[3px] cursor-grab
                        active:cursor-grabbing hover:shadow-md hover:-translate-y-px
                        transition-all duration-150 ease-out ${
                        dragId === d.id ? 'opacity-30 scale-[0.98]' : ''} ${
                        problem ? 'border-l-red-500' : d.doc_opens ? 'border-l-emerald-500' : 'border-l-blue-500'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => setOpenDeal(d.id)}
                          className="text-[12.5px] font-semibold text-gray-900 hover:text-blue-600 leading-tight text-left">
                          {d.account || d.title}
                        </button>
                        <Chip tone={tone}>{days(d.stage_since)} дн</Chip>
                      </div>

                      {/* Квалификация: по ней решают, брать ли сделку сегодня */}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {facts.length
                          ? facts.map(f => <Chip key={f} tone="gray">{f}</Chip>)
                          : <Chip tone="gray">не квалифицирован</Chip>}
                      </div>

                      <div className={`text-[11px] mt-1.5 tabular-nums ${
                        d.monthly_amount ? 'text-gray-600' : 'text-amber-600'}`}>
                        {d.monthly_amount
                          ? `${money(d.monthly_amount, d.currency)} в месяц${d.tariff ? ` · ${d.tariff}` : ''}`
                          : 'сумма не указана'}
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-1.5 pt-1.5 border-t border-gray-100">
                        <span className="text-[10.5px] text-gray-500 truncate">{d.owner_name || 'без сейлза'}</span>
                        {problem
                          ? <span className="text-[10.5px] font-semibold text-red-600 whitespace-nowrap">{problem}</span>
                          : d.next_step
                            ? <span className="text-[10.5px] text-gray-400 truncate max-w-[120px]" title={d.next_step}>
                                {d.next_step}
                              </span>
                            : <span className="text-[10.5px] font-semibold text-amber-600 whitespace-nowrap">
                                шаг не назначен
                              </span>}
                      </div>
                      {/* Когда пришла, откуда и когда следующий контакт —
                          без этого карточка не отвечает на «что с ней делать» */}
                      <div className="flex items-center justify-between gap-2 mt-1 text-[10.5px] text-gray-400">
                        <span className="truncate" title={`создана ${fmtDateTime(d.created_at)}`}>
                          {[d.source, `изм. ${fmtDateTime(d.updated_at || d.created_at)}`]
                            .filter(Boolean).join(' · ')}
                        </span>
                        {d.next_step_at && (
                          <span className={`whitespace-nowrap ${
                            slaTone(d.next_step_at) === 'red' ? 'text-red-600 font-semibold' : ''}`}>
                            {fmtDateTime(d.next_step_at)}
                          </span>
                        )}
                      </div>
                      {d.doc_opens ? (
                        <div className="text-[10.5px] text-emerald-600 mt-1">КП открыто {d.doc_opens}×</div>
                      ) : null}
                    </article>
                  )
                })}
                {byStage(st.key).length === 0 && (
                  <div className="text-[11.5px] text-gray-300 text-center py-3 border border-dashed border-gray-200 rounded-lg">
                    перетащите сюда
                  </div>
                )}
                {/* Колонка показывает срез, а не всё: честно говорим, сколько
                    скрыто, вместо молчаливой обрезки */}
                {byStage(st.key).length < st.deals && (
                  <button onClick={() => setPerStage(p => p + 30)}
                    className="text-[11.5px] text-blue-600 hover:underline py-1">
                    показано {byStage(st.key).length} из {st.deals} · показать ещё
                  </button>
                )}
              </div>
            </section>
          ))}

          {/* Закрытие — тоже перетаскиванием. Внутри не список сделок, а итог
              за 30 дней: тащить на доску 3400 проигранных карточек незачем */}
          {(data.closed || []).map(cl => (
            <section
              key={cl.key}
              onDragOver={e => { e.preventDefault(); setOverStage(cl.key) }}
              onDragLeave={() => setOverStage(o => (o === cl.key ? null : o))}
              onDrop={e => { e.preventDefault(); drop(cl.key, cl.kind) }}
              onClick={() => { setView(cl.kind === 'won' ? 'won' : 'lost'); setMode('table'); setOffset(0) }}
              title="Открыть список закрытых сделок"
              className={`flex-none w-[168px] rounded-xl border-2 border-dashed flex flex-col cursor-pointer
                transition-colors duration-150 ${
                overStage === cl.key
                  ? cl.kind === 'won' ? 'border-emerald-500 bg-emerald-50' : 'border-red-400 bg-red-50'
                  : 'border-gray-200 bg-gray-50'}`}
            >
              <header className="px-3 py-2.5">
                <span className={`text-[10.5px] font-bold uppercase tracking-wider ${
                  cl.kind === 'won' ? 'text-emerald-700' : 'text-red-600'}`}>
                  {cl.label}
                </span>
                <div className="text-[11px] text-gray-400 mt-0.5 tabular-nums">
                  {cl.deals} {data.closedWindow
                    ? `за период ${data.closedWindow.from || '…'} — ${data.closedWindow.to || '…'}`
                    : 'за 30 дней'}
                </div>
                {cl.kind === 'won' && Number(cl.amount) ? (
                  <div className="text-[11px] text-emerald-700 tabular-nums">
                    {money(cl.amount, 'UZS')} в месяц
                  </div>
                ) : null}
              </header>
              <div className="flex-1 grid place-items-center px-3 pb-4 text-center">
                <span className="text-[11px] text-gray-400">
                  {cl.kind === 'won'
                    ? 'перетащите, чтобы закрыть победой'
                    : 'перетащите — спросим причину'}
                  <span className="block mt-1 text-blue-600">нажмите, чтобы открыть список</span>
                </span>
              </div>
            </section>
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
                  <Th align="right"></Th>
                </tr>
              </thead>
              <tbody>
                {data.deals.map(d => {
                  const problem = problemOf(d)
                  return (
                    <tr key={d.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <button onClick={() => setOpenDeal(d.id)}
                          className="font-semibold text-gray-900 hover:text-blue-600 text-left">
                          {d.account || d.title}
                        </button>
                        <div className="text-[11px] text-gray-400 whitespace-nowrap">
                          {[d.city, d.source, `создана ${fmtDateTime(d.created_at)}`,
                            d.updated_at ? `изменена ${fmtDateTime(d.updated_at)}` : null]
                            .filter(Boolean).join(' · ')}
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
                        {d.won_at ? (
                          <span className="text-emerald-700">выиграна {fmtDateTime(d.won_at)}</span>
                        ) : d.lost_at ? (
                          <>
                            <span className="text-red-600">{d.lost_reason || 'причина не указана'}</span>
                            <div className="text-[11px] text-gray-400">
                              {[d.lost_comment, fmtDateTime(d.lost_at)].filter(Boolean).join(' · ')}
                            </div>
                          </>
                        ) : problem ? (
                          <span className="text-[11px] text-red-600">{problem}</span>
                        ) : (
                          <>
                            <span className="text-gray-600">{d.next_step || '—'}</span>
                            {d.next_step_at && (
                              <div className="text-[11px] text-gray-400">{fmtDateTime(d.next_step_at)}</div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={() => archive(d.id, d.account || d.title)}
                          title="Убрать в архив"
                          className="text-[11.5px] px-2 py-1 border border-gray-200 text-gray-400 rounded-lg hover:text-red-600 hover:border-red-200">
                          В архив
                        </button>
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



      {error && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-red-600 text-white text-[12.5px]
                        px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-3">
          {error}
          <button onClick={() => setError(null)} className="font-semibold">Понятно</button>
        </div>
      )}

      {undo && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-gray-900 text-white text-[12.5px]
                        px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-3">
          «{undo.title}» → {data.summary.find(x => x.key === undo.to)?.label || undo.to}
          <button
            onClick={() => { move(undo.id, undo.from, true); setUndo(null) }}
            className="font-semibold text-blue-300 hover:text-blue-200"
          >
            Отменить
          </button>
          <button onClick={() => setUndo(null)} className="text-gray-400 hover:text-white">×</button>
        </div>
      )}

      {losing && (
        <Modal
          title={`Почему «${losing.title}» не купили?`}
          sub="от причины зависит, когда сделка вернётся в работу"
          onClose={() => setLosing(null)}
          footer={<Btn onClick={() => setLosing(null)}>Отмена</Btn>}
        >
          <div className="-mx-5 -mt-2 max-h-[50vh] overflow-y-auto">
            {reasons.map(r => (
              <button key={r.id} onClick={() => lose(r.code)}
                className="w-full text-left px-5 py-2.5 border-b border-gray-100 hover:bg-gray-50">
                <div className="text-[13px] text-gray-900">{r.label}</div>
                <div className="text-[11px] text-gray-400">
                  {r.reactivate_days ? `вернётся через ${r.reactivate_days} дней` : 'не возвращаемся'}
                </div>
              </button>
            ))}
            {reasons.length === 0 && (
              <div className="px-5 py-4 text-[12.5px] text-gray-400">
                Справочник причин пуст — заполните его в «Справочниках продаж».
              </div>
            )}
          </div>
        </Modal>
      )}

      <Drawer
        open={!!openDeal}
        onClose={() => { setOpenDeal(null); load() }}
        title="Сделка"
        fullLink={openDeal ? `/sales/deals/${openDeal}` : undefined}
      >
        {openDeal && <SalesDealPage dealId={openDeal} />}
      </Drawer>

      {creating && (
        <Modal
          title="Новая сделка"
          sub="допродажа, рекомендация, разговор на выставке — то, что пришло без лида"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Btn onClick={() => setCreating(false)}>Отмена</Btn>
              <Btn kind="primary" disabled={saving} onClick={create}>
                {saving ? 'Заводим…' : 'Завести и открыть'}
              </Btn>
            </>
          }
        >
          <Field label="Название" value={form.title} onChange={v => setForm({ ...form, title: v })}
            placeholder="Чайхана Хадия" hint="аккаунт с таким названием создастся автоматически" />
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Город" value={form.city} onChange={v => setForm({ ...form, city: v })}
              options={optionsFor(refs, 'city', region)} />
            <Field label="POS-система" value={form.pos} onChange={v => setForm({ ...form, pos: v })}
              options={optionsFor(refs, 'pos')} />
            <Field label="Точек" value={form.points} onChange={v => setForm({ ...form, points: v })} />
            <Field label="Заказов в день" value={form.ordersPerDay}
              onChange={v => setForm({ ...form, ordersPerDay: v })}
              options={optionsFor(refs, 'orders_per_day')} />
            <Field label="Тариф" value={form.tariff} onChange={v => setForm({ ...form, tariff: v })}
              options={optionsFor(refs, 'tariff')} />
            <Field label="Подписка в месяц" value={form.monthlyAmount}
              onChange={v => setForm({ ...form, monthlyAmount: v })} placeholder="1 300 000" />
          </div>
          <label className="block">
            <span className="text-[11.5px] font-medium text-gray-600">Тип</span>
            <select value={form.dealType} onChange={e => setForm({ ...form, dealType: e.target.value })}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px]">
              <option value="new">Новый клиент</option>
              <option value="upsell">Допродажа</option>
              <option value="renewal">Продление</option>
            </select>
          </label>
        </Modal>
      )}
    </PageShell>
  )
}

export default SalesDealsPage
