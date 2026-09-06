import type { DragEvent } from 'react'
import { CallPhone } from '@/shared/ui'
import { Chip, fmtDateTime, money, slaText, days, MarketFlag } from './kit'
import { parsePhone } from '@/shared/lib/phone'
import type { Lead, Deal } from './SalesFunnelPage'

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

/** Кнопка звонка в подвале: одна трубка, номер — по наведению. */
function CallBtn({ phone, market, leadId }: { phone: string | null; market?: string | null; leadId?: string }) {
  if (!phone) return null
  return (
    <span className="text-[11px] w-6 h-6 rounded-md border border-gray-200 grid place-items-center hover:border-emerald-400">
      <CallPhone phone={phone} market={market} leadId={leadId} size="icon" />
    </span>
  )
}

const CARD = 'bg-white border border-gray-200 border-l-[3px] rounded-lg px-2.5 py-2 h-[108px] flex flex-col ' +
  'cursor-grab active:cursor-grabbing hover:shadow-md transition-all'

interface DragProps {
  dragging: boolean
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
}

export function LeadCard({
  l, showFlag, busy, dragging, onDragStart, onDragEnd, onOpen, onTake, onReturn,
}: DragProps & {
  l: Lead; showFlag: boolean; busy: boolean
  onOpen: () => void; onTake: () => void; onReturn: () => void
}) {
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

  // Заголовок — человек; бренд, если он есть и отличается, — первым в фактах.
  // Порядок фактов по ценности: с кем говорим → откуда → где
  const title = l.contact_name || l.name
  const brand = l.contact_name && l.name !== l.contact_name && !isPseudo(l.name) ? l.name : null
  const phone = parsePhone(l.phone, l.market_id)
  const facts = [brand, l.source, l.city].filter(Boolean).join(' · ')
  const hover = [phone.valid ? phone.pretty : l.phone, l.text ? `«${l.text}»` : '',
    KIND_LABEL[l.lead_kind || ''] ? `тип: ${KIND_LABEL[l.lead_kind || '']}` : '',
    `пришло ${shortDate(l.created_at)}`].filter(Boolean).join('\n')

  return (
    <article draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title={hover}
      className={`${CARD} ${overdue ? 'border-l-red-500' : 'border-l-violet-500'} ${dragging ? 'opacity-30' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <button onClick={onOpen}
          className="text-[12px] font-semibold text-gray-900 hover:text-violet-700 text-left truncate min-w-0 flex-1">
          {title}
        </button>
        <span className="flex items-center gap-1 flex-none">
          {showFlag && <MarketFlag market={l.market_id} />}
          <Chip tone={overdue ? 'red' : age >= 1 && !l.first_touch_at ? 'amber' : 'gray'}>{age} дн</Chip>
        </span>
      </div>
      <div className={`mt-1 text-[11.5px] font-medium truncate ${TONE[state.tone]}`}>{state.text}</div>
      <div className="mt-0.5 text-[11px] text-gray-400 truncate" title={facts}>{facts || '—'}</div>
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
            <button disabled={busy} onClick={onTake} title="В сделку на «Квалифицирован»"
              className="text-[10px] px-2 py-1 rounded-md bg-violet-600 text-white hover:brightness-110 disabled:opacity-50">
              Беру
            </button>
          )}
        </span>
      </div>
    </article>
  )
}

export function DealCard({
  d, showFlag, busy, dragging, onDragStart, onDragEnd, onOpen, onPlanStep,
}: DragProps & {
  d: Deal; showFlag: boolean; busy: boolean
  onOpen: () => void; onPlanStep: () => void
}) {
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
    contact, d.pos, d.points ? `${d.points} точ.` : null, d.orders_per_day ? `${d.orders_per_day} в день` : null, d.city,
  ].filter(Boolean).join(' · ')
  const hover = [d.phone || '', facts, d.doc_opens ? `КП открыто ${d.doc_opens}×` : '',
    d.last_call ? `звонок ${shortDate(d.last_call.at)}${d.last_call.ok === false ? ' · не дозвонились' : ''}` : '',
    `на этапе с ${shortDate(d.stage_since)} · изменена ${shortDate(d.updated_at || d.stage_since)}`]
    .filter(Boolean).join('\n')

  return (
    <article draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title={hover}
      className={`${CARD} ${stuck ? 'border-l-red-500' : 'border-l-blue-500'} ${dragging ? 'opacity-30' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <button onClick={onOpen}
          className="text-[12px] font-semibold text-gray-900 hover:text-blue-600 text-left truncate min-w-0 flex-1">
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
      <div className="mt-auto flex items-center justify-between gap-2">
        <Owner name={d.owner_name} />
        <span className="flex items-center gap-1 flex-none">
          <CallBtn phone={d.phone} market={d.market_id} />
          {!d.next_step_at ? (
            <button disabled={busy} onClick={onPlanStep} title="Поставить шаг «Позвонить» на завтра"
              className="text-[10px] px-2 py-1 rounded-md bg-blue-600 text-white hover:brightness-110 disabled:opacity-50">
              Шаг
            </button>
          ) : (
            <button onClick={onOpen}
              className="text-[10px] px-2 py-1 rounded-md border border-gray-200 text-gray-700 hover:border-blue-400">
              Открыть
            </button>
          )}
        </span>
      </div>
    </article>
  )
}
