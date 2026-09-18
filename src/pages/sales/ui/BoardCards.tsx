import { useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { CallPhone } from '@/shared/ui'
import { Chip, fmtDateTime, money, slaText, days, MarketFlag } from './kit'
import { parsePhone } from '@/shared/lib/phone'
import type { Lead, Deal, LastAct } from './SalesFunnelPage'

/**
 * Карточки на доске: одна сетка для обращения и сделки.
 *
 * Четыре строки в одном порядке — кто · что с ним сейчас · факты · кто ведёт
 * и что сделать. Высота фиксирована: раньше метки переносились на три
 * строки, текст заявки тянул карточку до двухсот пикселей, и соседние
 * карточки в колонке отличались по высоте вдвое — глаз не мог сканировать.
 *
 * Вместо россыпи меток — одна фраза состояния: последний звонок, ответ
 * клиента, следующий шаг, встреча или «шаг не назначен». Цвет фразы —
 * срочность. Красное всегда в одном месте: возраст справа вверху и эта
 * строка. Обрезанное целиком показывается по наведению.
 */

const KIND_LABEL: Record<string, string> = {
  message: 'мессенджер', form: 'форма', call: 'звонок', manual: 'вручную', other: 'другое',
}

type Tone = 'red' | 'amber' | 'blue' | 'green' | 'mute'
const TONE: Record<Tone, string> = {
  red: 'text-red-700', amber: 'text-amber-700', blue: 'text-blue-700',
  green: 'text-emerald-700', mute: 'text-gray-500 font-normal',
}

const shortDate = (iso: string | null | undefined) => (iso ? fmtDateTime(iso) : '')

/**
 * Ответственный — одним словом. Кружок с буквой рядом с именем читался как
 * два человека, а в тесноте от имени оставалась одна буква. Нет владельца —
 * красное «ничей»: это сигнал, а не пустота.
 */
function Owner({ name }: { name: string | null | undefined }) {
  if (!name) return <span className="text-[10.5px] font-medium text-red-600 flex-none">ничей</span>
  return (
    <span className="text-[10.5px] text-gray-500 truncate min-w-0" title={name}>{name.split(' ')[0]}</span>
  )
}

/**
 * Псевдоназвания, которые приёмник даёт клиенту без бренда: «Заявка с сайта:
 * Фахриддин», «Звонок 998…». Это не компания — показывать их заголовком
 * значит смешивать источник, человека и бренд в одной строке.
 */
const PSEUDO = /^(заявка с сайта|звонок|входящий|исходящий|сделка #|facebook №|instagram|обращение)/i
const isPseudo = (s: string | null | undefined) => !s || PSEUDO.test(s.trim())

/**
 * Как назвать обращение на доске: заведение, а не человек.
 *
 * Мы продаём заведению; сделка справа уже называется брендом, и карточка
 * должна узнаваться на всём пути от «Новых» до «Договора». Заведение —
 * из карточки клиента, иначе из названия обращения, если оно не совпадает
 * с именем контакта и не служебное («Звонок +998…»). Без заведения
 * заголовком остаётся контакт, а его отсутствие подписывается: это первый
 * вопрос квалификации.
 */
export function leadTitle(l: { name: string; contact_name?: string | null; account_name?: string | null; phone?: string | null }) {
  const venue = l.account_name
    || (l.contact_name && l.name !== l.contact_name && !isPseudo(l.name) ? l.name : null)
  const contact = l.contact_name || null
  // Название без отдельного контакта («Dönərlinski» из Баку) — заведение это
  // или человек, система не знает; заголовком идёт как есть, без упрёка
  const bare = !venue && !contact && !isPseudo(l.name) ? l.name : null
  const title = venue || contact || bare || l.phone || l.name
  // Заведение точно не указано, когда заголовок — человек или служебное имя
  const venueMissing = !venue && !bare
  return { venue, contact, title, venueMissing }
}

/** Кнопка звонка в подвале: одна трубка, номер — по наведению. */
function CallBtn({ phone, market, leadId }: { phone: string | null; market?: string | null; leadId?: string }) {
  if (!phone) return null
  return (
    <span className="text-[11px] w-6 h-6 rounded-md border border-gray-200 grid place-items-center hover:border-emerald-400">
      <CallPhone phone={phone} market={market} leadId={leadId} size="icon" />
    </span>
  )
}

const CARD = 'bg-white border border-gray-200 border-l-[3px] rounded-lg px-2.5 py-2 h-[146px] flex flex-col ' +
  'cursor-grab active:cursor-grabbing hover:shadow-md transition-all'

const ACT_ICON: Record<LastAct['kind'], string> = { note: '📝', message: '💬', call: '📞', repeat: '🔁' }
const ACT_LABEL: Record<LastAct['kind'], string> = {
  note: 'заметка', message: 'сообщение', call: 'звонок', repeat: 'повторное обращение',
}

/** «5 мин», «3 ч», «2 дн» — сколько прошло с действия. */
function since(iso: string): string {
  const ts = iso.includes('Z') || iso.includes('+') ? iso : `${iso}Z`
  const m = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 60000))
  if (m < 60) return `${m} мин`
  if (m < 60 * 24) return `${Math.floor(m / 60)} ч`
  return `${Math.floor(m / 1440)} дн`
}

/** Шестая строка карточки — последнее действие и как давно. Целиком — в общей подсказке карточки. */
function LastActLine({ act }: { act: LastAct | null | undefined }) {
  if (!act) return <div className="mt-0.5 text-[11px] text-gray-300 truncate">действий пока не было</div>
  const text = String(act.text || '').replace(/\s+/g, ' ').trim()
  const arrow = act.kind === 'message' || act.kind === 'call' ? (act.dir === 'in' ? '↓ ' : '↑ ') : ''
  return (
    <div className="mt-0.5 text-[11px] text-gray-500 truncate">
      <span className="text-gray-400">{ACT_ICON[act.kind]} {since(act.at)} · </span>
      <span className="text-gray-700">{arrow}{text || ACT_LABEL[act.kind]}</span>
    </div>
  )
}

type Row = [string, string | null | undefined]

/**
 * Текст заявки из Meta-формы приходит одной строкой из пар «вопрос?: ответ»
 * с подчёркиваниями вместо пробелов. В подсказке раскладываем по строкам,
 * обычный текст возвращаем как есть.
 */
function leadText(raw: string | null | undefined): string | null {
  const t = String(raw || '').replace(/\s+/g, ' ').trim().replace(/^«|»$/g, '')
  if (!t) return null
  if (!/\w\?:\s/.test(t)) return `«${t}»`
  const parts = t.split(/\s(?=[a-z0-9_'’‘`]+\?:\s)/i)
  return parts.map(p => {
    const m = p.match(/^([a-z0-9_'’‘`]+)\?:\s*(.*)$/i)
    return m ? `${m[1].replace(/_/g, ' ')}: ${m[2].replace(/_/g, ' ')}` : p
  }).join('\n')
}

/**
 * Единая подсказка карточки — вместо двух: системной (title) и превью
 * последнего действия, которые ложились друг на друга. Открывается по
 * наведению на карточку с задержкой, чтобы не мигать при пролёте мыши
 * по колонке; рисуется порталом в body — колонка режет всё за своим
 * краем; живёт, пока курсор на карточке или на самой панели, текст
 * выделяется. Сверху — кто и где в воронке, дальше факты, внизу —
 * последнее действие целиком.
 */
function useHoverPanel() {
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  const place = () => {
    const r = anchor.current?.getBoundingClientRect()
    if (!r) return
    const W = 340
    // Справа от карточки, если есть место; иначе слева; по вертикали — от верха карточки
    const right = r.right + 8
    const left = right + W <= window.innerWidth - 8 ? right : Math.max(8, r.left - W - 8)
    const up = window.innerHeight - r.top < 260
    setPos({ left, top: up ? r.bottom : r.top, up })
  }
  const enter = () => { clear(); timer.current = setTimeout(place, 350) }
  const stay = () => { clear() }
  const leave = () => { clear(); timer.current = setTimeout(() => setPos(null), 160) }
  const close = () => { clear(); setPos(null) }
  return { pos, anchor, enter, stay, leave, close }
}

function HoverPanel({ pos, onEnter, onLeave, title, where, rows, act }: {
  pos: { left: number; top: number; up: boolean } | null
  onEnter: () => void; onLeave: () => void
  title: string; where: string | null; rows: Row[]; act: LastAct | null | undefined
}) {
  if (!pos) return null
  const filled = rows.filter(([, v]) => v)
  const text = act ? String(act.text || '').replace(/\s+/g, ' ').trim() : ''
  const who = act ? (act.dir === 'in' ? (act.who || 'клиент') : (act.who || 'мы')) : ''
  return createPortal(
    <div
      onMouseEnter={onEnter} onMouseLeave={onLeave}
      onMouseDown={e => e.stopPropagation()}
      style={{ position: 'fixed', left: pos.left, top: pos.top, width: 340,
               transform: pos.up ? 'translateY(-100%)' : undefined }}
      className="z-[60] rounded-[10px] border border-gray-200 bg-white shadow-2xl text-[11.5px] leading-[1.4]
                 overflow-hidden cursor-default select-text"
    >
      <div className="px-3 pt-2.5 pb-2 border-b border-gray-100">
        <span className="text-[12.5px] font-semibold text-gray-900">{title}</span>
        {where && <span className="text-gray-400"> · {where}</span>}
      </div>
      {filled.length > 0 && (
        <div className="grid grid-cols-[78px_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 px-3 py-2 border-b border-gray-100">
          {filled.map(([k, v]) => (
            <span key={k} className="contents">
              <span className="text-gray-400">{k}</span>
              <span className="text-gray-800 min-w-0 whitespace-pre-line [overflow-wrap:anywhere] max-h-[140px] overflow-y-auto">{v}</span>
            </span>
          ))}
        </div>
      )}
      <div className="px-3 pt-2 pb-2.5 bg-gray-50/80">
        {act ? (
          <>
            <div className="flex justify-between gap-2 text-[10.5px] text-gray-400">
              <span className="truncate">{ACT_ICON[act.kind]} {ACT_LABEL[act.kind]}{act.channel && act.channel !== 'phone' ? ` · ${act.channel}` : ''}
                {(act.kind === 'message' || act.kind === 'call') && act.dir ? (act.dir === 'in' ? ' · входящее' : ' · исходящее') : ''} · {who}</span>
              <span className="tabular-nums flex-none">{since(act.at)} назад · {fmtDateTime(act.at)}</span>
            </div>
            <div className="mt-1 text-gray-800 whitespace-pre-wrap [overflow-wrap:anywhere] max-h-[200px] overflow-y-auto">{text || '—'}</div>
          </>
        ) : <div className="text-gray-400">действий пока не было</div>}
      </div>
    </div>,
    document.body,
  )
}

interface DragProps {
  dragging: boolean
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
}

export function LeadCard({
  l, showFlag, busy, dragging, onDragStart, onDragEnd, onOpen, onTake, onReturn, where,
}: DragProps & {
  l: Lead; showFlag: boolean; busy: boolean
  onOpen: () => void; onTake: () => void; onReturn: () => void
  /** Колонка, в которой стоит карточка, — для шапки подсказки. */
  where?: string | null
}) {
  const hp = useHoverPanel()
  const overdue = Boolean(l.sla_due_at && !l.first_touch_at && new Date(l.sla_due_at).getTime() < Date.now())
  const age = days(l.created_at)

  // Одна фраза о состоянии: что последнее случилось с этим человеком
  let state: { text: string; tone: Tone }
  if (l.status === 'nurture') {
    state = { text: `прогрев · ассистент, шаг ${l.nurture_step ?? 0} из 4${l.nurture_next_at ? ` · след. ${shortDate(l.nurture_next_at)}` : ''}`, tone: 'mute' }
  } else if (l.last_call) {
    const c = l.last_call
    state = c.ok === false
      ? { text: `${c.dir === 'in' ? '↓' : '↑'} не дозвонились · ${shortDate(c.at)}`, tone: 'red' }
      : c.ok === true
        ? { text: `${c.dir === 'in' ? '↓' : '↑'} разговор состоялся · ${shortDate(c.at)}`, tone: 'green' }
        : { text: `${c.dir === 'in' ? '↓ входящий' : '↑ исходящий'} звонок · ${shortDate(c.at)}`, tone: 'mute' }
  } else if (l.sla_due_at && !l.first_touch_at) {
    state = overdue
      ? { text: `${slaText(l.sla_due_at)} · касания не было`, tone: 'red' }
      : { text: `ждёт касания · ${slaText(l.sla_due_at)}`, tone: 'amber' }
  } else if (l.first_touch_at) {
    state = { text: `касание ${shortDate(l.first_touch_at)}`, tone: 'mute' }
  } else {
    state = { text: 'касаний не было', tone: 'mute' }
  }

  // Заголовок — заведение; человек и телефон — строкой под ним.
  // Порядок фактов по ценности: откуда → где
  const { venue, contact, title, venueMissing } = leadTitle(l)
  const phone = parsePhone(l.phone, l.market_id)
  const prettyPhone = l.phone ? (phone.valid ? phone.pretty : l.phone) : null
  const facts = [l.source, l.city].filter(Boolean).join(' · ')
  const rows: Row[] = [
    ['Заведение', venue],
    ['Контакт', [contact, prettyPhone].filter(Boolean).join(' · ')],
    ['Источник', [l.source, KIND_LABEL[l.lead_kind || ''] && !String(l.source || '').toLowerCase().includes(KIND_LABEL[l.lead_kind || ''].toLowerCase())
      ? KIND_LABEL[l.lead_kind || ''] : null].filter(Boolean).join(' · ')],
    ['Город', l.city],
    ['Заявка', leadText(l.text)],
    ['Пришло', shortDate(l.created_at)],
    ['Касание', l.first_touch_at ? shortDate(l.first_touch_at) : (l.sla_due_at ? slaText(l.sla_due_at) : null)],
    ['Звонок', l.last_call ? `${l.last_call.dir === 'in' ? '↓' : '↑'} ${shortDate(l.last_call.at)}${
      l.last_call.ok === false ? ' · не дозвонились' : l.last_call.ok ? ' · разговор состоялся' : ''}` : null],
    ['Ведёт', l.agent_name || 'ничей'],
  ]

  return (
    <article draggable onDragStart={e => { hp.close(); onDragStart(e) }} onDragEnd={onDragEnd}
      ref={el => { hp.anchor.current = el }}
      onMouseEnter={hp.enter} onMouseLeave={hp.leave}
      className={`${CARD} ${overdue ? 'border-l-red-500' : 'border-l-violet-500'} ${dragging ? 'opacity-30' : ''}`}>
      <HoverPanel pos={hp.pos} onEnter={hp.stay} onLeave={hp.leave}
        title={title} where={where || null} rows={rows} act={l.last_act} />
      <div className="flex items-baseline justify-between gap-2">
        <button onClick={onOpen}
          className="text-[12px] font-semibold text-gray-900 hover:text-violet-700 text-left truncate min-w-[50%] flex-1">
          {title}
        </button>
        <span className="flex items-center gap-1 flex-none">
          {showFlag && <MarketFlag market={l.market_id} />}
          <Chip tone={overdue ? 'red' : age >= 1 && !l.first_touch_at ? 'amber' : 'gray'}>{age} дн</Chip>
        </span>
      </div>
      <div className={`mt-1 text-[11.5px] font-medium truncate ${TONE[state.tone]}`}>{state.text}</div>
      {/* У клиента уже есть сделка — «К сделке» прикрепит обращение к ней,
          а не заведёт вторую. Об этом надо сказать до нажатия — но в строке
          фактов, а не в заголовке: метка в заголовке выдавливала имя */}
      {/* Кто и как: контакт и телефон цифрами. Если заголовок — контакт
          (заведение неизвестно), имя не повторяется, а пустота подписана */}
      <div className="mt-0.5 text-[11px] text-gray-500 truncate">
        {venue && contact ? <span className="text-gray-700">{contact} · </span> : null}
        {l.phone ? <span className="tabular-nums text-gray-700">{prettyPhone}</span> : <span className="text-gray-300">без телефона</span>}
        {venueMissing && <span className="text-gray-300"> · заведение не указано</span>}
      </div>
      <div className="mt-0.5 text-[11px] text-gray-400 truncate" title={facts}>
        {l.open_deal_stage && <span className="text-blue-700 font-medium">сделка · {l.open_deal_stage} · </span>}
        {facts || '—'}
        {l.text ? <span> · «{String(l.text).replace(/\s+/g, ' ')}»</span> : null}
      </div>
      <LastActLine act={l.last_act} />
      <div className="mt-auto flex items-center justify-between gap-2">
        <Owner name={l.agent_name} />
        <span className="flex items-center gap-1 flex-none">
          <CallBtn phone={l.phone} market={l.market_id} leadId={l.id} />
          {l.status === 'nurture' ? (
            <button disabled={busy} onClick={onReturn} title="Забрать у ассистента и дозваниваться самому"
              className="text-[10px] px-2 py-1 rounded-md border border-gray-200 text-gray-700 hover:border-gray-400 disabled:opacity-50">
              Вернуть
            </button>
          ) : (
            <button disabled={busy} onClick={onTake}
              title={l.open_deal_stage ? 'Прикрепить к открытой сделке клиента' : 'В сделку на «Квалифицирован»'}
              className="text-[10px] px-2 py-1 rounded-md bg-violet-600 text-white hover:brightness-110 disabled:opacity-50">
              {l.open_deal_stage ? 'К сделке' : 'Беру'}
            </button>
          )}
        </span>
      </div>
    </article>
  )
}

export function DealCard({
  d, showFlag, busy, dragging, onDragStart, onDragEnd, onOpen, onPlanStep, where,
}: DragProps & {
  d: Deal; showFlag: boolean; busy: boolean
  onOpen: () => void; onPlanStep: () => void
  /** Этап, на котором стоит карточка, — для шапки подсказки. */
  where?: string | null
}) {
  const hp = useHoverPanel()
  const age = days(d.stage_since)
  const stuck = Boolean(d.stalled_at) || age > 14
  const now = Date.now()
  const meetingSoon = d.meeting_at && new Date(d.meeting_at).getTime() > now - 3600_000
  const stepLate = d.next_step_at && new Date(d.next_step_at).getTime() < now

  let state: { text: string; tone: Tone }
  if (meetingSoon) state = { text: `📅 встреча ${shortDate(d.meeting_at)}`, tone: 'blue' }
  else if (d.next_step) state = {
    text: `${d.next_step}${d.next_step_at ? ` · ${shortDate(d.next_step_at)}` : ''}`,
    tone: stepLate ? 'red' : 'amber',
  }
  else state = { text: `шаг не назначен${d.monthly_amount ? '' : ' · сумма не указана'}`, tone: 'red' }

  // Заголовок — бренд. Когда приёмник дал клиенту псевдоимя («Заявка с
  // сайта: Фахриддин»), заголовком идёт контакт, а не источник
  const title = !isPseudo(d.account) ? d.account! : (d.contact_name || d.title)
  const contact = d.contact_name && d.contact_name !== title ? d.contact_name : null
  // Порядок фактов по ценности: деньги → с кем говорим → чем пользуется → масштаб → где
  const facts = [
    d.monthly_amount ? `${money(d.monthly_amount, d.currency)}${d.tariff ? ` · ${d.tariff}` : ''}` : null,
    d.pos, d.points ? `${d.points} точ.` : null, d.orders_per_day ? `${d.orders_per_day} в день` : null, d.city,
  ].filter(Boolean).join(' · ')
  const dPhone = parsePhone(d.phone, d.market_id)
  const rows: Row[] = [
    ['Контакт', [contact, d.phone ? (dPhone.valid ? dPhone.pretty : d.phone) : null].filter(Boolean).join(' · ')],
    ['Сделка', [d.monthly_amount ? `${money(d.monthly_amount, d.currency)} в месяц` : null, d.tariff, d.pos,
      d.points ? `${d.points} точ.` : null, d.orders_per_day ? `${d.orders_per_day} в день` : null, d.city]
      .filter(Boolean).join(' · ') || 'сумма не указана'],
    ['Шаг', d.next_step ? `${d.next_step}${d.next_step_at ? ` · ${shortDate(d.next_step_at)}` : ''}` : 'не назначен'],
    ['Встреча', d.meeting_at ? shortDate(d.meeting_at) : null],
    ['Этап', `с ${shortDate(d.stage_since)} · изменена ${shortDate(d.updated_at || d.stage_since)}`],
    ['КП', d.doc_opens ? `открыто ${d.doc_opens}×` : null],
    ['Звонок', d.last_call ? `${d.last_call.dir === 'in' ? '↓' : '↑'} ${shortDate(d.last_call.at)}${
      d.last_call.ok === false ? ' · не дозвонились' : d.last_call.ok ? ' · разговор состоялся' : ''}` : null],
    ['Ведёт', d.owner_name || 'ничей'],
  ]

  return (
    <article draggable onDragStart={e => { hp.close(); onDragStart(e) }} onDragEnd={onDragEnd}
      ref={el => { hp.anchor.current = el }}
      onMouseEnter={hp.enter} onMouseLeave={hp.leave}
      className={`${CARD} ${stuck ? 'border-l-red-500' : 'border-l-blue-500'} ${dragging ? 'opacity-30' : ''}`}>
      <HoverPanel pos={hp.pos} onEnter={hp.stay} onLeave={hp.leave}
        title={title} where={where || null} rows={rows} act={d.last_act} />
      <div className="flex items-baseline justify-between gap-2">
        <button onClick={onOpen}
          className="text-[12px] font-semibold text-gray-900 hover:text-blue-600 text-left truncate min-w-[50%] flex-1">
          {title}
        </button>
        <span className="flex items-center gap-1 flex-none">
          {showFlag && <MarketFlag market={d.market_id} />}
          {d.doc_opens ? <Chip tone="green">КП {d.doc_opens}×</Chip> : null}
          <Chip tone={stuck ? 'red' : 'gray'}>{age} дн</Chip>
        </span>
      </div>
      <div className={`mt-1 text-[11.5px] font-medium truncate ${TONE[state.tone]}`}>{state.text}</div>
      <div className="mt-0.5 text-[11px] text-gray-400 truncate" title={facts}>
        {facts || <span className="text-amber-600">сумма не указана</span>}
      </div>
      <div className="mt-0.5 text-[11px] text-gray-500 truncate">
        {contact ? <span className="text-gray-700">{contact}</span> : null}
        {contact && d.phone ? ' · ' : ''}
        {d.phone ? <span className="tabular-nums text-gray-700">{parsePhone(d.phone, d.market_id).valid ? parsePhone(d.phone, d.market_id).pretty : d.phone}</span> : null}
        {!contact && !d.phone ? <span className="text-gray-300">контакт не указан</span> : null}
      </div>
      <LastActLine act={d.last_act} />
      <div className="mt-auto flex items-center justify-between gap-2">
        <Owner name={d.owner_name} />
        <span className="flex items-center gap-1 flex-none">
          <CallBtn phone={d.phone} market={d.market_id} />
          {/* «Открыть» убрана: заголовок и так открывает карточку. Остаётся
              только то, что экономит открытие — шаг на завтра, когда его нет */}
          {!d.next_step_at && (
            <button disabled={busy} onClick={onPlanStep} title="Поставить шаг «Позвонить» на завтра"
              className="text-[10px] px-2 py-1 rounded-md bg-blue-600 text-white hover:brightness-110 disabled:opacity-50">
              Шаг
            </button>
          )}
        </span>
      </div>
    </article>
  )
}
