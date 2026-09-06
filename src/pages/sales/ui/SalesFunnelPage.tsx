import { useCallback, useEffect, useRef, useState } from 'react'
import { CallPhone } from '@/shared/ui'
import { apiGet, apiPost, apiPatch } from '@/shared/services/api.service'
import { MeetingsPanel } from './MeetingsPanel'
import { Chip, PageShell, Skeleton, Modal, MultiPick, money, moneyList, fmtDateTime, slaTone, slaText,
         useAutoRefresh, Drawer, FilterBar , workMorningIn, MarketFlag, Seg } from './kit'
import { useSalesRefs, optionsFor } from './refs'
import { RegionBadge, useRegion } from './region'
import { parsePhone } from '@/shared/lib/phone'
import { SalesDealPage } from './SalesDealPage'
import { SalesLeadPage } from './SalesLeadPage'
import { FunnelList } from './FunnelList'
import { LeadCard, DealCard } from './BoardCards'

/**
 * Единая воронка: обращения и сделки на одном экране.
 *
 * Слева очередь реакции, справа процесс продажи, между ними — граница
 * квалификации. Разрезать этот путь на два раздела было нашим техническим
 * удобством: сейлз ведёт клиента от первого сообщения до денег и не должен
 * переключать экраны посреди дороги.
 *
 * Обращение и сделка остаются разными сущностями: у первого норматив в
 * 15 минут и решение «наш ли клиент», у второй — этапы, критерии и деньги.
 * Поэтому и карточки разные, и правила перетаскивания разные.
 */

/** ok: true — разговор был, false — не дозвонились, null — исход неизвестен. */
interface LastCall { dir: 'in' | 'out'; ok: boolean | null; at: string }

export interface Lead {
  id: string; name: string; contact_name: string | null; phone: string | null
  market_id: string | null
  city: string | null; status: string; icp_score: number | null
  sla_due_at: string | null; first_touch_at: string | null; created_at: string
  text: string | null; lead_kind: string | null; source: string | null
  agent_name: string | null; nurture_step: number | null; nurture_next_at: string | null
  /** Ассистенту есть куда писать: у клиента есть чат в Telegram или Meta. */
  assistant_can_write?: boolean
  last_call: LastCall | null
}

export interface Deal {
  id: string; title: string; account: string | null; monthly_amount: string | null
  currency: string; city: string | null; pos: string | null; points: number | null
  orders_per_day: string | null; tariff: string | null; next_step: string | null
  next_step_at: string | null; stage_since: string; stalled_at: string | null
  meeting_at: string | null
  updated_at: string | null; owner_name: string | null; phone: string | null
  doc_opens: number | null; stage_key: string; market_id?: string | null
  /** Основной контакт клиента — человек, которому звонят. */
  contact_name?: string | null
  won_at?: string | null; lost_at?: string | null; lost_reason?: string | null
  /** Срок возврата у причины отказа: есть — к клиенту ещё вернутся. */
  lost_return_days?: number | null
  last_call: LastCall | null
}

interface FunnelData {
  /** Колонка объединяет несколько статусов: на доске их меньше, чем в данных. */
  leadColumns: Array<{ key: string; label: string; hint: string; total: number; statuses: string[] }>
  leads: Lead[]
  stages: Array<{ key: string; label: string; description: string | null; sla_hours: string | null; total: number; amounts: Record<string, string> }>
  deals: Deal[]
  closed: Array<{
    key: string; label: string; kind: string; total: number; last30: number; amounts30: Record<string, string>
    /** У проигранного две колонки на один этап: stage — куда переносить, group — что показывать. */
    stage?: string; group?: 'return' | 'junk'
  }>
  totals: { open_deals?: number; pipeline_amounts?: Record<string, string>; no_next_step?: number }
  owners: Array<{ id: string; name: string }>
  sources?: Array<{ id: string; label: string }>
}

// «other» здесь нет намеренно: это не вид обращения, а его отсутствие.
// Плашка «канал неизвестен» висела на лидах из Messenger и холодного обзвона,
// у которых источник написан строкой ниже, — и читалась как поломка
const KIND_LABEL: Record<string, string> = {
  form: 'форма', message: 'мессенджер', comment: 'комментарий',
  call: 'звонок', email: 'письмо', manual: 'вручную',
}

/**
 * Трубка на карточке: был ли звонок и чем кончился — видно с доски, без
 * открытия. Зелёная — разговор состоялся, красная — «не ответили» на входящем
 * или «не дозвонились» на исходящем. Нет трубки — не звонили вовсе.
 */
function CallChip({ c }: { c: LastCall | null }) {
  if (!c) return null
  const label = c.ok ? 'разговор был'
    : c.ok === false ? (c.dir === 'in' ? 'не ответили' : 'не дозвонились')
    : 'звонили'
  return (
    <Chip tone={c.ok ? 'green' : c.ok === false ? 'red' : 'gray'}
      title={`${c.dir === 'in' ? 'Входящий' : 'Исходящий'} · ${label} · ${fmtDateTime(c.at)}`}>
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor"
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6
                 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361
                 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1
                 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
      {c.dir === 'in' ? '↓' : '↑'} {label}
    </Chip>
  )
}

function days(iso: string | null): number {
  if (!iso) return 0
  const ts = iso.includes('Z') || iso.includes('+') ? iso : `${iso}Z`
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
}

export function SalesFunnelPage() {
  const [data, setData] = useState<FunnelData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refs = useSalesRefs()
  // Ручное заведение переехало сюда со страниц списков: воронка — единственное
  // место, где видно всю картину, и заводить оттуда логичнее, чем уходить
  // в отдельный экран ради двух полей
  const [creating, setCreating] = useState<'lead' | 'deal' | null>(null)
  const [cForm, setCForm] = useState({ name: '', phone: '', city: '', text: '' })
  const [cBusy, setCBusy] = useState(false)
  const [cErr, setCErr] = useState('')
  const [owner, setOwner] = useState('')
  const [q, setQ] = useState('')
  const [src, setSrc] = useState('')
  const [city, setCity] = useState('')
  const [noStep, setNoStep] = useState(false)
  const [overdue, setOverdue] = useState(false)
  // Перенесено со страницы сделок: она дублировала воронку списком, а срез
  // по POS, сегменту и тарифу был только там
  const [pos, setPos] = useState<string[]>([])
  const [segment, setSegment] = useState<string[]>([])
  const [tariff, setTariff] = useState<string[]>([])
  const [opd, setOpd] = useState<string[]>([])
  const [attention, setAttention] = useState(false)
  // Период и по чему его считать — по созданию карточки или по её изменению
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [dateBy, setDateBy] = useState<'created' | 'updated'>('created')
  // Этапы: ключи этапов сделок и колонки обращений (lead:new). На доске
  // остаются только выбранные колонки — пустые рамки ничего не говорят
  const [stagesF, setStagesF] = useState<string[]>([])
  const [openDeal, setOpenDeal] = useState<string | null>(null)
  const [openLead, setOpenLead] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const region = useRegion('funnel')

  // Тип воронки: обычные продажи или enterprise — этапы и темп у них разные.
  // Выбор липнет в localStorage, как и регион
  const [ptype, setPtype] = useState<'sales' | 'enterprise'>(
    () => (localStorage.getItem('sales_funnel_type') === 'enterprise' ? 'enterprise' : 'sales'))
  const switchType = (t: 'sales' | 'enterprise') => {
    setPtype(t)
    try { localStorage.setItem('sales_funnel_type', t) } catch { /* приватный режим */ }
  }

  // Что тащим: обращение или сделка — правила перехода у них разные
  // Сколько карточек показываем в колонке. Счётчик внизу был просто текстом:
  // «показано 15 из 142» — и посмотреть остальное было нельзя ничем
  const [perColumn, setPerColumn] = useState(15)
  // Доска или список: список — для действий над многими сразу. Выбор помнится
  const [view, setViewRaw] = useState<'board' | 'list'>(() => {
    try { return localStorage.getItem('funnel.view') === 'list' ? 'list' : 'board' } catch { return 'board' }
  })
  const setView = (v: 'board' | 'list') => {
    setViewRaw(v)
    try { localStorage.setItem('funnel.view', v) } catch { /* приватный режим */ }
  }
  const [drag, setDrag] = useState<{ kind: 'lead' | 'deal'; id: string; from: string } | null>(null)
  // Проигранное на доске свёрнуто, пока его не попросят — помним выбор
  const [lostOpen, setLostOpenRaw] = useState<boolean>(() => {
    try { return localStorage.getItem('funnel.lostOpen') === '1' } catch { return false }
  })
  const setLostOpen = (v: boolean) => {
    setLostOpenRaw(v)
    try { localStorage.setItem('funnel.lostOpen', v ? '1' : '0') } catch { /* приватный режим */ }
  }
  const [over, setOver] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const reqRef = useRef(0)

  const load = useCallback(() => {
    const p = new URLSearchParams({ perColumn: String(view === 'list' ? 300 : perColumn), region: region || 'all' })
    if (owner) p.set('owner', owner)
    if (src) p.set('src', src)
    if (city) p.set('city', city)
    if (noStep) p.set('nostep', '1')
    if (overdue) p.set('overdue', '1')
    if (q) p.set('q', q)
    if (pos.length) p.set('pos', pos.join(','))
    if (segment.length) p.set('segment', segment.join(','))
    if (tariff.length) p.set('tariff', tariff.join(','))
    if (opd.length) p.set('orders_per_day', opd.join(','))
    if (attention) p.set('attention', '1')
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    if ((from || to) && dateBy === 'updated') p.set('dateBy', 'updated')
    if (stagesF.length) p.set('stage', stagesF.join(','))
    if (ptype === 'enterprise') p.set('type', 'enterprise')
    const my = ++reqRef.current
    apiGet<FunnelData>(`/sales/funnel?${p.toString()}`, false)
      .then(d => { if (my === reqRef.current) { setData(d); setError(null) } })
      .catch(e => setError(e?.message || 'Не удалось загрузить воронку'))
  }, [owner, q, src, city, noStep, overdue, pos, segment, tariff, opd, attention, from, to, dateBy, stagesF, region, perColumn, ptype, view])

  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  useAutoRefresh(load, 30000)

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 6000)
    return () => clearTimeout(t)
  }, [error])

  /** Обращение внутри зоны входа: смена статуса, а не этапа. */
  const moveLead = async (leadId: string, to: string) => {
    setBusy(leadId)
    try {
      if (to === 'new') await apiPost('/sales/leads?action=restore', { leadId })
      else if (to === 'nurture') {
        await apiPost('/sales/leads?action=nurture', { leadId })
        // Человек должен понять, что произошло: карточка сменила колонку,
        // и без слов это выглядит как «ушла куда-то»
        setNotice('Передано ассистенту: он напишет клиенту сам — 4 сообщения за 10 дней. Карточка теперь в «Недозвоне» с меткой «прогрев»; ответ клиента вернёт её вам')
      }
      else if (to === 'attempting') await apiPost('/sales/leads?action=dial', { leadId })
      // keep: перетаскивание по доске — не «беру себе»: у назначенного лида
      // ответственный сохраняется, забирают только кнопкой «Беру» или передачей
      else await apiPost('/sales/leads?action=assign', { leadId, keep: true })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось перенести обращение')
    } finally { setBusy(null) }
  }

  /**
   * Пересечение границы: обращение становится сделкой на выбранном этапе.
   *
   * Если этап не пустил, сразу открываем карточку: читать список недостающих
   * полей в всплывашке, закрывать её, искать карточку и вспоминать, чего
   * не хватало, — дольше, чем заполнить. Всплывашка остаётся как объяснение,
   * но работа начинается там, где её делают.
   */
  const convert = async (leadId: string, toStage: string) => {
    setBusy(leadId)
    try {
      const res: any = await apiPost('/sales/funnel?action=convert', { leadId, toStage })
      load()
      if (res?.dealId) setOpenDeal(res.dealId)
    } catch (e: any) {
      // 422 движка — не поломка, а несоблюдённое условие этапа
      setError(e?.message || 'Переход заблокирован')
      setOpenLead(leadId)
    } finally { setBusy(null) }
  }

  const moveDeal = async (dealId: string, toStage: string) => {
    setBusy(dealId)
    try {
      await apiPost('/sales/stage', { dealId, toStage })
      load()
    } catch (e: any) {
      setError(e?.message || 'Переход заблокирован')
      setOpenDeal(dealId)
    } finally { setBusy(null) }
  }

  const planStep = async (dealId: string) => {
    setBusy(dealId)
    try {
      await apiPatch('/sales/deal', {
        id: dealId,
        fields: { next_step: 'Позвонить', next_step_at: workMorningIn(1) },
      })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось назначить шаг')
    } finally { setBusy(null) }
  }

  const drop = (target: string, zone: 'lead' | 'deal' | 'closed') => {
    if (!drag) return
    const { kind, id, from } = drag
    setDrag(null)
    setOver(null)
    if (from === target) return

    if (zone === 'lead') {
      if (kind === 'lead') moveLead(id, target)
      else setError('Сделку нельзя вернуть в обращения — закройте её отказом')
      return
    }
    if (zone === 'closed') {
      if (kind === 'deal') moveDeal(id, target)
      else setError('Сначала возьмите обращение в работу')
      return
    }
    if (kind === 'lead') convert(id, target)
    else moveDeal(id, target)
  }

  if (error && !data) return <div className="p-6 text-sm text-gray-900">{error}</div>
  if (!data) return <Skeleton rows={6} />

  const t = data.totals || {}
  const leadsIn = (col: { key: string; statuses?: string[] }) =>
    data.leads.filter(l => (col.statuses || [col.key]).includes(l.status))
  const dealsIn = (key: string) => data.deals.filter(d => d.stage_key === key)
  // Проигранное делится по справочнику причин: со сроком возврата — «вернуться»,
  // без срока — «не наш». Это не два этапа, а два среза одного
  const closedIn = (cl: { key: string; stage?: string; group?: string }) =>
    data.deals.filter(d => d.stage_key === (cl.stage || cl.key) && (
      !cl.group || (cl.group === 'return') === (d.lost_return_days != null)))
  const zoneCls = (active: boolean, tone: 'lead' | 'deal') =>
    active
      ? tone === 'lead' ? 'border-violet-400 ring-2 ring-violet-100' : 'border-blue-500 ring-2 ring-blue-100'
      : 'border-gray-200'

  // Переключатель воронки и регион закреплены справа и не переносятся: это
  // основная строка экрана, и она не должна прыгать с места на место, когда
  // слева меняется ширина сводки или полоски встреч
  return (
    <PageShell fill header={
      <div className="space-y-2">
      {/* Строка управления: заголовок, одинаковые серые переключатели и
          один цветной элемент — «Завести». Раньше здесь было четыре группы
          кнопок в четырёх цветах, и глаз не понимал, что главное */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <h1 className="text-[18px] font-semibold text-gray-900 tracking-tight mr-1">Воронка</h1>
          <Seg value={ptype} onChange={switchType}
            items={[{ key: 'sales', label: 'Продажи' }, { key: 'enterprise', label: 'Enterprise' }]} />
          <Seg value={view} onChange={setView} title="Канбан — где что стоит; список — действия над многими"
            items={[{ key: 'board', label: 'Канбан' }, { key: 'list', label: 'Список' }]} />
          <RegionBadge scope="funnel" />
        </div>
        <button onClick={() => { setCForm({ name: '', phone: '', city: '', text: '' }); setCErr(''); setCreating('lead') }}
          className="flex-none ml-auto px-3 py-1.5 text-[12px] font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700">
          + Завести
        </button>
      </div>

      {/* Строка данных: фильтры, счётчики фишками, встречи одной кнопкой.
          Подсказка «обновляется само» убрана — она ни на что не отвечала */}
      <div className="-mx-1">
        <FilterBar
          active={[
            q && `поиск: ${q}`, stagesF.length && `этапы: ${stagesF.length}`, owner && 'сейлз', src && 'источник',
            pos.length && `POS: ${pos.length}`, segment.length && `тип: ${segment.length}`,
            tariff.length && `тариф: ${tariff.length}`, opd.length && `заказов: ${opd.length}`,
            attention && 'требуют внимания',
            city && `город: ${city}`, noStep && 'без шага', overdue && 'просрочены',
            (from || to) && `${dateBy === 'updated' ? 'изменены' : 'созданы'}: ${from || '…'} — ${to || '…'}`,
          ].filter(Boolean) as string[]}
          right={<div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
            <span className="text-[11.5px] px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 tabular-nums whitespace-nowrap">
              обращений <b className="text-gray-900 font-semibold">{data.leadColumns.reduce((s, c) => s + c.total, 0)}</b>
            </span>
            <span className="text-[11.5px] px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 tabular-nums whitespace-nowrap">
              сделок <b className="text-gray-900 font-semibold">{t.open_deals ?? 0}</b>
            </span>
            <span className="text-[11.5px] px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 tabular-nums whitespace-nowrap hidden lg:inline">
              <b className="text-gray-900 font-semibold">{moneyList(t.pipeline_amounts, '—')}</b> в месяц
            </span>
            {t.no_next_step ? (
              <span className="text-[11.5px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 tabular-nums whitespace-nowrap">
                <b className="font-semibold">{t.no_next_step}</b> без шага
              </span>
            ) : null}
            <span className="w-1" />
            <MeetingsPanel compact />
          </div>}
        >
          {/* Строки по смыслу: что ищем и когда → где в воронке и у кого →
              какой клиент → признаки состояния. Раньше поля лежали в порядке
              появления в коде, и попап читался как беспорядок */}
          <div className="w-full flex gap-2 flex-wrap items-center">
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Бренд, имя, телефон, город, комментарий, ЛПР"
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-[12.5px] w-64" />
            <select value={dateBy} onChange={e => setDateBy(e.target.value as 'created' | 'updated')}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]">
              <option value="created">Созданы</option>
              <option value="updated">Изменены</option>
            </select>
            <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]" />
            <span className="text-gray-400 text-[12px]">—</span>
            <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]" />
          </div>
          <div className="w-full flex gap-2 flex-wrap items-center">
            <MultiPick label="Этап" values={stagesF} onChange={setStagesF}
              options={[
                ...data.leadColumns.map(c => ({ value: `lead:${c.key}`, label: `Обращения · ${c.label}` })),
                ...data.stages.map(s => ({ value: s.key, label: s.label })),
                { value: 'won', label: 'Выиграна' }, { value: 'lost', label: 'Проиграна' },
              ]} />
            <select value={owner} onChange={e => setOwner(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]">
              <option value="">Все сейлзы</option>
              {data.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <select value={src} onChange={e => setSrc(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]">
              <option value="">Все источники</option>
              {(data.sources || []).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <input value={city} onChange={e => setCity(e.target.value)} placeholder="Город"
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-[12.5px] w-32" />
          </div>
          <div className="w-full flex gap-2 flex-wrap items-center">
            <MultiPick label="Тип заведения" values={segment} onChange={setSegment}
              options={optionsFor(refs, 'segment')} />
            <MultiPick label="POS-система" values={pos} onChange={setPos}
              options={optionsFor(refs, 'pos')} />
            <MultiPick label="Заказов в день" values={opd} onChange={setOpd}
              options={optionsFor(refs, 'orders_per_day')} />
            <MultiPick label="Тариф" values={tariff} onChange={setTariff}
              options={optionsFor(refs, 'tariff')} />
          </div>
          <div className="w-full flex gap-4 flex-wrap items-center">
            <label className="flex items-center gap-1.5 text-[12px] text-gray-600 cursor-pointer select-none whitespace-nowrap"
              title="Сделки без назначенного следующего шага">
              <input type="checkbox" checked={noStep} onChange={e => setNoStep(e.target.checked)}
                className="accent-amber-500" />
              без шага
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-gray-600 cursor-pointer select-none whitespace-nowrap"
              title="Сделки, висящие на этапе дольше норматива">
              <input type="checkbox" checked={overdue} onChange={e => setOverdue(e.target.checked)}
                className="accent-red-500" />
              просрочены
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-gray-600 cursor-pointer select-none whitespace-nowrap"
              title="Застряли, без следующего шага или дольше норматива этапа">
              <input type="checkbox" checked={attention} onChange={e => setAttention(e.target.checked)}
                className="accent-red-500" />
              требуют внимания
            </label>
            {/* Boolean обязателен: «0» от пустого массива React рисует как текст */}
            {Boolean(q || owner || src || city || noStep || overdue || attention || from || to
              || stagesF.length || pos.length || segment.length || tariff.length || opd.length) && (
              <button
                onClick={() => {
                  setQ(''); setOwner(''); setSrc(''); setCity(''); setNoStep(false); setOverdue(false)
                  setPos([]); setSegment([]); setTariff([]); setOpd([]); setAttention(false)
                  setFrom(''); setTo(''); setDateBy('created'); setStagesF([])
                }}
                className="ml-auto text-[12px] text-gray-400 hover:text-red-600 whitespace-nowrap">
                сбросить ✕
              </button>
            )}
          </div>
        </FilterBar>
      </div>
      </div>
    }>

      {view === 'list' ? (
        <FunnelList
          leads={data.leads} deals={data.deals} leadColumns={data.leadColumns}
          stages={data.stages} reasons={refs?.reasons || []} owners={data.owners}
          onOpenLead={setOpenLead} onOpenDeal={setOpenDeal} onChanged={load} onError={setError}
        />
      ) : (
      <div className="flex-1 min-h-0 flex gap-2.5 overflow-x-auto items-stretch pb-2">
        {/* ─── Зона входа: обращения ─────────────────────────────── */}
        <div className="flex gap-2.5 p-2 rounded-xl bg-violet-50/60 border border-dashed border-violet-200 flex-none">
          {data.leadColumns.filter(col => !stagesF.length || stagesF.includes(`lead:${col.key}`)).map(col => (
            <section
              key={col.key}
              onDragOver={e => { e.preventDefault(); setOver(col.key) }}
              onDragLeave={() => setOver(o => (o === col.key ? null : o))}
              onDrop={e => { e.preventDefault(); drop(col.key, 'lead') }}
              className={`flex-none w-[232px] bg-white border rounded-lg flex flex-col
                          transition-colors ${zoneCls(over === col.key, 'lead')}`}
            >
              <header className="px-2.5 py-2 border-b border-gray-100">
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700">{col.label}</span>
                  <span className="text-[11.5px] text-gray-400 tabular-nums">{col.total}</span>
                </div>
                <div className="text-[10.5px] text-gray-400">{col.hint}</div>
              </header>
              <div className="p-2 flex flex-col gap-2 overflow-y-auto">
                {leadsIn(col).map(l => {
                  const phone = parsePhone(l.phone, l.market_id)
                  return (
                    <LeadCard key={l.id}
                      l={l}
                      showFlag={!region}
                      busy={busy === l.id}
                      dragging={drag?.id === l.id}
                      onDragStart={() => setDrag({ kind: 'lead', id: l.id, from: col.key })}
                      onDragEnd={() => { setDrag(null); setOver(null) }}
                      onOpen={() => setOpenLead(l.id)}
                      onTake={() => convert(l.id, 'qualified')}
                      onReturn={() => moveLead(l.id, 'attempting')}
                    />
                  )
                })}
                {leadsIn(col).length === 0 && (
                  <div className="text-[11px] text-gray-300 text-center py-3 border border-dashed border-gray-200 rounded-lg">
                    перетащите сюда
                  </div>
                )}
                {leadsIn(col).length < col.total && (
                  <button
                    onClick={() => setPerColumn(p => Math.min(300, p + 50))}
                    className="w-full text-[11px] text-blue-600 hover:text-blue-700 hover:bg-blue-50
                               text-center py-2 rounded-lg border border-dashed border-blue-200 transition-colors">
                    Показать ещё · {leadsIn(col).length} из {col.total}
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>

        {/* ─── Граница: здесь обращение становится сделкой ────────── */}
        <div className="flex-none w-9 flex flex-col items-center justify-center gap-2 text-gray-400">
          <div className="flex-1 w-px border-l border-dashed border-gray-300" />
          <span className="text-[9.5px] tracking-wide [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">
            здесь рождается сделка
          </span>
          <div className="flex-1 w-px border-l border-dashed border-gray-300" />
        </div>

        {/* ─── Зона работы: сделки ───────────────────────────────── */}
        <div className="flex gap-2.5 p-2 rounded-xl bg-blue-50/50 border border-dashed border-blue-200 flex-none">
          {data.stages.filter(st => !stagesF.length || stagesF.includes(st.key)).map(st => (
            <section
              key={st.key}
              onDragOver={e => { e.preventDefault(); setOver(st.key) }}
              onDragLeave={() => setOver(o => (o === st.key ? null : o))}
              onDrop={e => { e.preventDefault(); drop(st.key, 'deal') }}
              className={`flex-none w-[232px] bg-white border rounded-lg flex flex-col
                          transition-colors ${zoneCls(over === st.key, 'deal')}`}
            >
              <header className="px-2.5 py-2 border-b border-gray-100">
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-1">
                    {st.label}
                    {st.description && (
                      <span title={st.description}
                        className="w-3.5 h-3.5 rounded-full border border-gray-300 text-gray-400
                                   grid place-items-center text-[8px] font-bold cursor-help normal-case">?</span>
                    )}
                  </span>
                  <span className="text-[11.5px] text-gray-400 tabular-nums">{st.total}</span>
                </div>
                <div className="text-[10.5px] text-gray-400 tabular-nums">
                  {moneyList(st.amounts)}
                  {st.sla_hours ? ` · норматив ${Math.round(Number(st.sla_hours) / 24) || 1} дн` : ''}
                </div>
              </header>
              <div className="p-2 flex flex-col gap-2 overflow-y-auto">
                {dealsIn(st.key).map(d => {
                  const stuck = Boolean(d.stalled_at) || !d.next_step_at
                  return (
                    <DealCard key={d.id}
                      d={d}
                      showFlag={!region}
                      busy={busy === d.id}
                      dragging={drag?.id === d.id}
                      onDragStart={() => setDrag({ kind: 'deal', id: d.id, from: st.key })}
                      onDragEnd={() => { setDrag(null); setOver(null) }}
                      onOpen={() => setOpenDeal(d.id)}
                      onPlanStep={() => planStep(d.id)}
                    />
                  )
                })}
                {dealsIn(st.key).length === 0 && (
                  <div className="text-[11px] text-gray-300 text-center py-3 border border-dashed border-gray-200 rounded-lg">
                    перетащите сюда
                  </div>
                )}
                {dealsIn(st.key).length < st.total && (
                  <button
                    onClick={() => setPerColumn(p => Math.min(300, p + 50))}
                    className="w-full text-[11px] text-blue-600 hover:text-blue-700 hover:bg-blue-50
                               text-center py-2 rounded-lg border border-dashed border-blue-200 transition-colors">
                    Показать ещё · {dealsIn(st.key).length} из {st.total}
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>

        {/* ─── Закрытие ──────────────────────────────────────────── */}
        {/* Раньше здесь были узкие зоны со счётчиком: закрытое можно было
            только пополнить, но не посмотреть. Колонки такие же, как у
            этапов, — с карточками и «показать ещё» */}
        {data.closed.filter(cl => !stagesF.length || stagesF.includes(cl.stage || cl.key)).map(cl => {
          const won = cl.kind === 'won'
          const items = closedIn(cl)
          // Проигранное свёрнуто в узкую полосу: на доске оно нужно редко, а
          // две колонки съедали ширину у живых этапов. Раскрывается одним
          // кликом, состояние помнится
          if (!won && !lostOpen) {
            if (cl.group === 'junk') return null
            const lostTotal = data.closed.filter(c => c.kind === 'lost').reduce((s, c) => s + c.total, 0)
            return (
              <button
                key="lost_collapsed"
                onClick={() => setLostOpen(true)}
                onDragOver={e => { e.preventDefault(); setLostOpen(true) }}
                title="Показать проигранное"
                className="flex-none w-[36px] rounded-lg border-2 border-gray-200 bg-gray-50 hover:border-red-300
                           flex flex-col items-center py-2 gap-2 transition-colors"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-red-600
                                 [writing-mode:vertical-rl] rotate-180">Проиграно</span>
                <span className="text-[11.5px] text-gray-500 tabular-nums">{lostTotal}</span>
              </button>
            )
          }
          return (
            <section
              key={cl.key}
              onDragOver={e => { e.preventDefault(); setOver(cl.key) }}
              onDragLeave={() => setOver(o => (o === cl.key ? null : o))}
              onDrop={e => { e.preventDefault(); drop(cl.stage || cl.key, 'closed') }}
              className={`flex-none w-[232px] rounded-lg border-2 flex flex-col transition-colors ${
                over === cl.key
                  ? won ? 'border-emerald-500 bg-emerald-50' : 'border-red-400 bg-red-50'
                  : won ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-gray-50'}`}
            >
              <header className={`px-2.5 py-2 border-b ${won ? 'border-emerald-100' : 'border-gray-200'}`}>
                <div className="flex justify-between items-baseline gap-2">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${
                    won ? 'text-emerald-700' : 'text-red-600'}`}>{cl.label}</span>
                  <span className="text-[11.5px] text-gray-400 tabular-nums flex items-center gap-1.5">
                    {cl.total}
                    {cl.group === 'junk' && (
                      <button onClick={() => setLostOpen(false)} title="Свернуть проигранное"
                        className="text-gray-400 hover:text-gray-700 leading-none">«</button>
                    )}
                  </span>
                </div>
                <div className="text-[10.5px] text-gray-400 tabular-nums">
                  за 30 дней: {cl.last30}
                  {won && Object.keys(cl.amounts30 || {}).length ? ` · ${moneyList(cl.amounts30, '')}` : ''}
                </div>
              </header>
              <div className="p-2 flex flex-col gap-1.5 overflow-y-auto">
                {items.map(d => (
                  <button
                    key={d.id}
                    onClick={() => setOpenDeal(d.id)}
                    className="w-full text-left bg-white border border-gray-200 rounded-lg px-2 py-1.5
                               hover:border-blue-400 transition-colors"
                  >
                    <div className="text-[12px] font-medium text-gray-900 truncate">
                      {d.account || d.title}
                    </div>
                    <div className="text-[10.5px] text-gray-400 tabular-nums truncate">
                      {won
                        ? [Number(d.monthly_amount) ? money(d.monthly_amount, d.currency) : null,
                           d.won_at ? fmtDateTime(d.won_at).split(',')[0] : null].filter(Boolean).join(' · ')
                          || 'сумма не указана'
                        : [d.lost_reason || 'причина не указана',
                           d.lost_return_days != null ? `вернуться через ${d.lost_return_days} дн.` : null,
                           d.lost_at ? fmtDateTime(d.lost_at).split(',')[0] : null].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                ))}
                {items.length === 0 && (
                  <div className="text-[11px] text-gray-300 text-center py-3 border border-dashed
                                  border-gray-200 rounded-lg">
                    {won ? 'перетащите, чтобы закрыть' : 'перетащите — спросим причину'}
                  </div>
                )}
                {items.length > 0 && items.length < cl.total && (
                  <button
                    onClick={() => setPerColumn(p => Math.min(300, p + 50))}
                    className="w-full text-[11px] text-blue-600 hover:text-blue-700 hover:bg-blue-50
                               text-center py-2 rounded-lg border border-dashed border-blue-200 transition-colors">
                    Показать ещё · {items.length} из {cl.total}
                  </button>
                )}
              </div>
            </section>
          )
        })}
      </div>
      )}

      {error && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-red-600 text-white text-[12.5px]
                        px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-3 max-w-[560px]">
          {error}
          <button onClick={() => setError(null)} className="font-semibold flex-none">Понятно</button>
        </div>
      )}
      {notice && !error && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-gray-900 text-white text-[12.5px]
                        px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-3 max-w-[560px]">
          {notice}
          <button onClick={() => setNotice(null)} className="font-semibold flex-none">Понятно</button>
        </div>
      )}

      <Drawer
        open={!!openDeal}
        onClose={() => { setOpenDeal(null); load() }}
        title="Сделка"
        fullLink={openDeal ? `/sales/deals/${openDeal}` : undefined}
      >
        {openDeal && <SalesDealPage dealId={openDeal} />}
      </Drawer>

      <Drawer
        open={!!openLead}
        onClose={() => { setOpenLead(null); load() }}
        title="Обращение"
        fullLink={openLead ? `/sales/leads/${openLead}` : undefined}
      >
        {openLead && <SalesLeadPage leadId={openLead} />}
      </Drawer>
      {creating && (
        <Modal
          title={creating === 'lead' ? 'Новое обращение' : 'Новая сделка'}
          sub={creating === 'lead'
            ? 'клиент, с которым ещё не говорили — попадёт в очередь дня'
            : 'клиент уже квалифицирован, сделка сразу в работе'}
          onClose={() => setCreating(null)}
          footer={
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5 mr-auto">
                {([['lead', 'Обращение'], ['deal', 'Сделка']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setCreating(k)}
                    className={`px-2.5 py-1 rounded-md text-[11.5px] font-semibold ${
                      creating === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <button onClick={() => setCreating(null)}
                className="px-3 py-1.5 text-[12.5px] font-semibold rounded-lg border border-gray-300 text-gray-600">
                Отмена
              </button>
              <button
                disabled={cBusy}
                onClick={async () => {
                  const isLead = creating === 'lead'
                  if (isLead && !cForm.name.trim() && !cForm.phone.trim()) {
                    setCErr('Укажите бренд или телефон'); return
                  }
                  if (!isLead && !cForm.name.trim()) { setCErr('Укажите название сделки'); return }
                  setCBusy(true); setCErr('')
                  try {
                    if (isLead) {
                      await apiPost('/sales/leads?action=create', {
                        name: cForm.name, phone: cForm.phone, city: cForm.city,
                        text: cForm.text, source: 'manual', market: region || undefined,
                      })
                    } else {
                      await apiPost('/sales/deals', {
                        title: cForm.name, city: cForm.city, dealType: 'new',
                        market: region || undefined,
                      })
                    }
                    setCreating(null)
                    load()
                  } catch (e: any) {
                    setCErr(e?.message || 'Не удалось завести')
                  } finally { setCBusy(false) }
                }}
                className="px-3.5 py-1.5 text-[12.5px] font-semibold rounded-lg bg-violet-600 text-white disabled:opacity-50">
                {cBusy ? 'Заводим…' : 'Завести'}
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            {cErr && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[12.5px] text-red-700">{cErr}</div>
            )}
            <input value={cForm.name} onChange={e => setCForm(f => ({ ...f, name: e.target.value }))}
              placeholder={creating === 'lead' ? 'Бренд или имя' : 'Название сделки'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px]" />
            {creating === 'lead' && (
              <input value={cForm.phone} onChange={e => setCForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="Телефон" type="tel"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px]" />
            )}
            <input value={cForm.city} onChange={e => setCForm(f => ({ ...f, city: e.target.value }))}
              placeholder="Город"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px]" />
            {creating === 'lead' && (
              <textarea value={cForm.text} rows={2}
                onChange={e => setCForm(f => ({ ...f, text: e.target.value }))}
                placeholder="Что известно о клиенте (необязательно)"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] resize-none" />
            )}
          </div>
        </Modal>
      )}

    </PageShell>
  )
}

export default SalesFunnelPage
