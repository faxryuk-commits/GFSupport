import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { formatDateTimeShort, formatDateDMY, toDateInput, fromDateInput } from '@/shared/lib/time'

/** Общие мелочи страниц продаж: одни и те же чипы, карточки и форматы. */

export function money(v: any, currency = 'UZS') {
  if (v === null || v === undefined || v === '') return '—'
  return `${Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ${currency}`
}

/**
 * Суммы в нескольких валютах подряд.
 *
 * Складывать доллары с сумами нельзя, а показывать только одну валюту —
 * значит молча спрятать часть воронки. Пишем рядом, от большего к меньшему.
 */
export function moneyList(amounts: Record<string, any> | null | undefined, empty = 'сумма не указана') {
  const pairs = Object.entries(amounts || {})
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
  if (!pairs.length) return empty
  return pairs.map(([cur, v]) => money(v, cur)).join(' · ')
}

export function pct(part: number, total: number): string {
  if (!total) return '—'
  return `${Math.round((part / total) * 100)}%`
}

export function fmtDate(v: string | null) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit' })
}

export function days(iso: string | null): number {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

const TONES: Record<string, string> = {
  gray: 'bg-gray-100 text-gray-600',
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  violet: 'bg-violet-50 text-violet-700',
}

/**
 * Статус обращения — одним словарём на всю систему.
 *
 * Раньше подписи жили отдельно в списке и в карточке, и один и тот же лид
 * назывался по-разному: в списке «в работе», в карточке «Стало сделкой»,
 * «мусор» против «Отказ». Человек читал два экрана и не понимал, одно ли
 * это состояние.
 */
export const LEAD_STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: 'Новое', tone: 'amber' },
  assigned: { label: 'Назначено', tone: 'blue' },
  attempting: { label: 'Дозвон', tone: 'blue' },
  nurture: { label: 'На прогреве', tone: 'gray' },
  converted: { label: 'Стало сделкой', tone: 'green' },
  junk: { label: 'Отказ', tone: 'red' },
  duplicate: { label: 'Дубль', tone: 'gray' },
}

export const leadStatus = (key: string) =>
  LEAD_STATUS[key] || { label: key, tone: 'gray' }

export const Chip = ({ tone = 'gray', children, title }: { tone?: string; children: ReactNode; title?: string }) => (
  <span title={title}
    className={`inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap ${TONES[tone]}`}>
    {children}
  </span>
)

export const Card = ({ title, sub, right, children, fill }: {
  title: string; sub?: string; right?: ReactNode; children: ReactNode
  /** Растянуть на всю доступную высоту: для списков в режиме одного окна. */
  fill?: boolean
}) => (
  <section className={`bg-white border border-gray-200 rounded-xl overflow-hidden ${
    fill ? 'flex-1 min-h-0 flex flex-col' : ''}`}>
    {(title || sub || right) && (
    <header className="px-4 py-3 border-b border-gray-100 flex justify-between items-center gap-3 flex-wrap">
      <div>
        <h3 className="text-[13.5px] font-semibold text-gray-900">{title}</h3>
        {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
      </div>
      {right}
    </header>
    )}
    {children}
  </section>
)

export const Kpis = ({ items, compact }: {
  items: Array<[string, string, string?]>
  /** Плотный вид для списков: экран закреплён, и место нужно строкам, а не цифрам. */
  compact?: boolean
}) => (
  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-px bg-gray-200 border border-gray-200 rounded-xl overflow-hidden flex-none">
    {items.map(([k, v, d]) => (
      <div key={k} className={`bg-white ${compact ? 'px-3 py-1.5' : 'px-4 py-3'}`}>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{k}</div>
        <div className={`text-gray-900 tabular-nums tracking-tight ${
          compact ? 'text-[15px] leading-tight' : 'text-[20px] mt-1'}`}>{v}</div>
        {d && !compact && <div className="text-[11px] text-gray-500 mt-0.5">{d}</div>}
        {d && compact && <div className="text-[10.5px] text-gray-400 truncate" title={d}>{d}</div>}
      </div>
    ))}
  </div>
)

export const Tabs = ({ items, value, onChange, counts }: {
  items: Array<[string, string]>
  value: string
  onChange: (v: string) => void
  counts?: Record<string, number>
}) => (
  <div className="flex gap-1 px-4 border-b border-gray-100 overflow-x-auto bg-white rounded-t-xl">
    {items.map(([key, label]) => (
      <button key={key} onClick={() => onChange(key)}
        className={`text-[12.5px] px-3 py-2.5 border-b-2 whitespace-nowrap ${
          value === key ? 'border-blue-600 text-blue-600 font-semibold'
                        : 'border-transparent text-gray-500 hover:text-gray-900'}`}>
        {label}
        {counts?.[key] ? (
          <span className="ml-1.5 text-[10.5px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
            {counts[key]}
          </span>
        ) : null}
      </button>
    ))}
  </div>
)

/**
 * Одностраничный режим: шапка страницы закреплена, скроллится только рабочая
 * зона. Иначе на длинных списках теряются и заголовок, и панель фильтров —
 * ровно то, на что жаловались после первого боевого дня.
 *
 * MainLayout отдаёт нам блок с overflow-auto, поэтому берём его высоту и
 * гасим внешний скролл своим h-full + overflow-hidden.
 */
export const PageShell = ({ header, children, fill }: {
  header: ReactNode
  children: ReactNode
  /**
   * Режим одного окна: страница занимает высоту экрана целиком, а прокрутка
   * живёт внутри списка. Иначе шапка со сводкой и фильтрами уезжает наверх,
   * и человек листает страницу вместо того, чтобы листать данные.
   */
  fill?: boolean
}) => (
  <div className="h-full flex flex-col overflow-hidden">
    <div className="flex-none px-5 pt-3 pb-2.5 bg-[#f5f7fa] border-b border-gray-200">{header}</div>
    <div className={fill
      ? 'flex-1 min-h-0 flex flex-col gap-2.5 px-5 py-3 overflow-hidden'
      : 'flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4'}>
      {children}
    </div>
  </div>
)

/** Шапка таблицы, которая не уезжает при прокрутке длинного списка. */
export const Th = ({ children, align = 'left' }: { children?: ReactNode; align?: 'left' | 'right' }) => (
  <th className={`text-${align} font-semibold px-4 py-2.5 sticky top-0 bg-white z-10 border-b border-gray-100`}>
    {children}
  </th>
)

/** Постраничная навигация: списки в проде уже по сотне строк. */
export const Pager = ({ offset, limit, count, hasMore, total, onChange }: {
  offset: number; limit: number; count: number; hasMore: boolean
  /** Всего строк под фильтром — без него «Назад/Дальше» вслепую. */
  total?: number
  onChange: (o: number) => void
}) => (
  <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 bg-gray-50">
    <span className="text-[11.5px] text-gray-500">
      {count === 0 ? 'ничего не найдено' : (
        <>
          строки {offset + 1}–{offset + count}
          {total ? ` из ${total}` : ''}
          {total ? ` · страница ${Math.floor(offset / limit) + 1} из ${Math.max(1, Math.ceil(total / limit))}` : ''}
        </>
      )}
    </span>
    <div className="flex gap-2">
      <button
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
        className="text-[12px] px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40 hover:border-blue-500 hover:text-blue-600"
      >
        Назад
      </button>
      <button
        disabled={!hasMore}
        onClick={() => onChange(offset + limit)}
        className="text-[12px] px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40 hover:border-blue-500 hover:text-blue-600"
      >
        Дальше
      </button>
    </div>
  </div>
)

export const Empty = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
    <div className="text-[15px] font-medium text-gray-900">{title}</div>
    {hint && <p className="text-[13px] text-gray-500 mt-1">{hint}</p>}
  </div>
)

/**
 * Дата с временем в рабочей зоне. Раньше на карточках стояла только дата, и
 * «сегодня» невозможно было отличить от «сегодня утром» — а для SLA в 15 минут
 * это и есть вся информация.
 */
export { formatDateTimeShort as fmtDateTime, formatDateShort } from '@/shared/lib/time'

/**
 * Тон срока: сколько осталось до дедлайна. Считаем в минутах, потому что у
 * первого касания норматив 15 минут, а у этапа — дни; одна шкала на оба случая.
 */
export function slaTone(due: string | null | undefined): 'gray' | 'green' | 'amber' | 'red' {
  if (!due) return 'gray'
  const left = (new Date(due.includes('Z') || due.includes('+') ? due : due + 'Z').getTime() - Date.now()) / 60000
  if (left < 0) return 'red'
  if (left < 60) return 'amber'
  return 'green'
}

/** «через 12 мин» / «просрочено на 2 ч» — человеку понятнее, чем таймстамп. */
export function slaText(due: string | null | undefined): string {
  if (!due) return '—'
  const left = (new Date(due.includes('Z') || due.includes('+') ? due : due + 'Z').getTime() - Date.now()) / 60000
  const abs = Math.abs(left)
  const unit = abs < 60 ? `${Math.round(abs)} мин`
    : abs < 1440 ? `${Math.round(abs / 60)} ч`
    : `${Math.round(abs / 1440)} дн`
  return left < 0 ? `просрочено на ${unit}` : `через ${unit}`
}

/**
 * Списки обновляются сами: раз в 30 секунд и при возврате на вкладку.
 * Кнопка «Обновить» — просьба к человеку делать работу машины, поэтому её нет.
 */
export function useAutoRefresh(load: () => void, ms = 30000) {
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, ms)
    const onFocus = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [load, ms])
}

/** Модальное окно для форм заведения и подтверждений. */
export const Modal = ({ title, sub, onClose, children, footer }: {
  title: string; sub?: string; onClose: () => void; children: ReactNode; footer?: ReactNode
}) => (
  <div className="fixed inset-0 z-50 flex items-start justify-center bg-gray-900/40 p-4 overflow-y-auto"
       onClick={onClose}>
    <div className="bg-white rounded-xl w-full max-w-lg mt-16 shadow-xl" onClick={e => e.stopPropagation()}>
      <header className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-[15px] font-semibold text-gray-900">{title}</h3>
        {sub && <p className="text-[12px] text-gray-500 mt-0.5">{sub}</p>}
      </header>
      <div className="px-5 py-4 space-y-3">{children}</div>
      <footer className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">{footer}</footer>
    </div>
  </div>
)


/**
 * Выбор из справочника.
 *
 * Раньше здесь был datalist: список открывался только после того, как человек
 * начинал печатать, — снаружи это выглядело как обычное неактивное поле, и
 * выбора будто не было вовсе. Теперь список раскрывается по клику, ищет по
 * подстроке и разрешает своё значение: справочник задаёт норму, но не запрещает
 * жизнь.
 */
export function Combo({ value, options, onChange, placeholder, autoFocus, onDone, align = 'left', multiple }: {
  value: string
  options: string[]
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  onDone?: () => void
  align?: 'left' | 'right'
  /** Несколько значений через запятую: агрегаторы, модули, услуги. */
  multiple?: boolean
}) {
  // Поле, открытое по клику «заполнить», уже сфокусировано — второго клика
  // никто не делает, поэтому список раскрываем сразу вместе с полем
  const [open, setOpen] = useState(!!autoFocus)
  const [draft, setDraft] = useState(value ?? '')
  const box = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  // Координаты списка считаем от поля и рисуем его в body: карточки в модуле
  // скруглённые и с overflow-hidden, из-за чего выпадающий список обрезался
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null)

  const place = useCallback(() => {
    const el = box.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 220) })
  }, [])

  useEffect(() => {
    if (!open) return
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  useEffect(() => { setDraft(value ?? '') }, [value])

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const t = e.target as Node
      if (box.current?.contains(t)) return
      // Список рисуется в body, а не внутри поля, — иначе его обрезали бы
      // скруглённые карточки. Но тогда клик по пункту считался кликом «мимо»,
      // и при множественном выборе поповер закрывался после первой галочки
      if (pop.current?.contains(t)) return
      setOpen(false); onDone?.()
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [onDone])

  // При множественном выборе печатаем только последнюю часть после запятой
  const parts = multiple ? draft.split(',').map(x => x.trim()).filter(Boolean) : []
  const tail = multiple ? (draft.split(',').pop() || '').trim().toLowerCase() : draft.trim().toLowerCase()
  const typed = tail
  // Справочник может содержать одно значение дважды — тогда пункт рисовался
  // двумя строками с одинаковым ключом
  const opts = [...new Set(options)]
  // После выбора хвост строки совпадает с только что отмеченным значением.
  // Это не ввод, и фильтровать по нему нельзя: список схлопывался до одного
  // пункта, и добавить второго поставщика было уже нечем
  const typing = multiple
    ? !parts.some(x => x.toLowerCase() === typed)
    : typed !== (value || '').toLowerCase()
  const shown = typed && typing
    ? opts.filter(o => o.toLowerCase().includes(typed))
    : opts

  const pick = (v: string) => {
    if (multiple) {
      // Уже выбранное — снимаем: список работает как набор галочек
      const next = parts.includes(v) ? parts.filter(x => x !== v) : [...parts.filter(x => x), v]
      const joined = next.join(', ')
      setDraft(joined)
      onChange(joined)
      place()
      return
    }
    setDraft(v)
    onChange(v)
    setOpen(false)
    onDone?.()
  }

  return (
    <div ref={box} className="relative">
      <input
        autoFocus={autoFocus}
        value={draft}
        placeholder={placeholder || 'выберите или впишите'}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={e => { setDraft(e.target.value); setOpen(true) }}
        onKeyDown={e => {
          if (e.key === 'Enter') { onChange(draft); setOpen(false); onDone?.() }
          if (e.key === 'Escape') { setOpen(false); onDone?.() }
        }}
        className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px] pr-7 ${
          align === 'right' ? 'text-right' : ''}`}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-[10px]">▾</span>
      {open && rect && createPortal(
        <div
          ref={pop}
          style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 60 }}
          className="max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-xl"
          onMouseDown={e => e.preventDefault()}
        >
          {shown.map(o => {
            const chosen = multiple ? parts.includes(o) : o === value
            return (
              <button key={o} type="button" onMouseDown={e => { e.preventDefault(); pick(o) }}
                className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-blue-50 flex items-center gap-2 ${
                  chosen ? 'text-blue-700 font-semibold' : 'text-gray-700'}`}>
                {multiple && (
                  <span className={`w-3.5 h-3.5 rounded border flex-none grid place-items-center text-[9px] ${
                    chosen ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300'}`}>
                    {chosen ? '✓' : ''}
                  </span>
                )}
                {o}
              </button>
            )
          })}
          {typed && typing && !opts.some(o => o.toLowerCase() === typed) && (
            <button type="button" onMouseDown={e => { e.preventDefault(); pick(draft.trim()) }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] text-gray-500 border-t border-gray-100">
              Своё значение: «{draft.trim()}»
            </button>
          )}
          {!shown.length && !typed && (
            <div className="px-3 py-2 text-[11.5px] text-gray-400">
              Список пуст — впишите значение, оно сохранится в сделке
            </div>
          )}
          {multiple && (
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-100 px-3 py-1.5 flex justify-between">
              <span className="text-[11px] text-gray-400">выбрано: {parts.length}</span>
              <button type="button" onMouseDown={e => { e.preventDefault(); setOpen(false); onDone?.() }}
                className="text-[11.5px] font-semibold text-blue-600">Готово</button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

/** Поле формы: либо свободный ввод, либо список значений из справочника. */
export const Field = ({ label, value, onChange, options, placeholder, hint, type = 'text' }: {
  label: string
  value: string
  onChange: (v: string) => void
  options?: string[]
  placeholder?: string
  hint?: string
  type?: string
}) => (
  <label className="block">
    <span className="text-[11.5px] font-medium text-gray-600">{label}</span>
    {options?.length ? (
      <div className="mt-1">
        <Combo value={value} options={options} onChange={onChange} placeholder={placeholder} />
      </div>
    ) : (
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px]" />
    )}
    {hint && <span className="text-[11px] text-gray-400 mt-0.5 block">{hint}</span>}
  </label>
)

/**
 * Круглый флажок рынка. В режиме «Все регионы» колонки перемешаны, и без
 * него не понять, чья карточка — а звонить в Алматы по узбекскому скрипту
 * неловко. Флаги нарисованы градиентами, а не эмодзи: на Windows эмодзи
 * флагов рендерятся буквами. Название страны — в подсказке при наведении.
 */
const FLAG_BG: Record<string, string> = {
  uz: 'linear-gradient(180deg,#0099b5 0 31%,#ce1126 31% 36%,#ffffff 36% 64%,#ce1126 64% 69%,#1eb53a 69%)',
  kz: 'radial-gradient(circle at 50% 44%,#fec50c 0 29%,#00afca 30%)',
  az: 'linear-gradient(180deg,#0092bc 0 33%,#e4002b 33% 66%,#00af66 66%)',
  kg: 'radial-gradient(circle at 50% 44%,#ffd700 0 29%,#e8112d 30%)',
  ge: 'linear-gradient(90deg,transparent 0 41%,#dA291c 41% 59%,transparent 59%),' +
      'linear-gradient(180deg,transparent 0 41%,#da291c 41% 59%,transparent 59%),' +
      'linear-gradient(#ffffff,#ffffff)',
  cy: 'radial-gradient(circle at 50% 42%,#d57800 0 22%,transparent 23%),linear-gradient(#ffffff,#ffffff)',
  ae: 'linear-gradient(90deg,#ce1126 0 30%,transparent 30%),' +
      'linear-gradient(180deg,#00732f 0 33%,#ffffff 33% 66%,#000000 66%)',
}
const FLAG_NAME: Record<string, string> = {
  uz: 'Узбекистан', kz: 'Казахстан', az: 'Азербайджан', kg: 'Кыргызстан',
  ge: 'Грузия', cy: 'Кипр', ae: 'ОАЭ',
}

export function MarketFlag({ market }: { market?: string | null }) {
  const key = (market || '').toLowerCase()
  if (!FLAG_BG[key]) return null
  return (
    <span
      title={FLAG_NAME[key] || key.toUpperCase()}
      aria-label={FLAG_NAME[key] || key}
      className="inline-block w-[14px] h-[14px] rounded-full flex-none self-center
                 border border-black/10 shadow-sm"
      style={{ background: FLAG_BG[key] }}
    />
  )
}

export const Btn = ({ kind = 'ghost', children, ...rest }: any) => (
  <button {...rest}
    className={`text-[12.5px] px-3 py-1.5 rounded-lg disabled:opacity-50 ${
      kind === 'primary' ? 'bg-blue-600 text-white hover:bg-blue-700'
      : kind === 'danger' ? 'border border-red-200 text-red-600 hover:bg-red-50'
      : 'border border-gray-300 text-gray-700 hover:border-blue-500 hover:text-blue-600'}`}>
    {children}
  </button>
)

/**
 * Поле правится по месту: клик — ввод — Enter. Отдельная форма тут лишняя.
 *
 * Если у поля есть справочник (город, касса, тариф), ввод превращается в список
 * с подсказкой: свободный текст расходится в написании и ломает отчёты, но
 * запрещать своё значение нельзя — жизнь богаче справочника.
 */
export function InlineField({ label, value, onSave, placeholder, money: isMoney, options, multiple, when }: {
  label: string; value: any; onSave: (v: string) => void; placeholder?: string
  money?: boolean; options?: string[]; multiple?: boolean
  /** Поле с датой: 'date' — только день, 'datetime' — день и время. */
  when?: 'date' | 'datetime'
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const empty = value === null || value === undefined || value === ''
  const withTime = when === 'datetime'

  // Дату вводят календарём, а не строкой: «дата демо» в свободном поле
  // превращается в «завтра в 3», и по такой записи не построить ни
  // напоминание, ни отчёт
  if (editing && when) {
    return (
      <div className="flex items-center gap-2 py-2 px-4 border-b border-dashed border-gray-100">
        <span className="text-[12.5px] text-gray-500 flex-1">{label}</span>
        <input
          autoFocus
          type={withTime ? 'datetime-local' : 'date'}
          className="border border-blue-400 rounded-md px-2 py-1 text-[12.5px]"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { onSave(fromDateInput(draft, withTime)); setEditing(false) }
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={() => { if (draft) onSave(fromDateInput(draft, withTime)); setEditing(false) }}
        />
      </div>
    )
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 py-2 px-4 border-b border-dashed border-gray-100">
        <span className="text-[12.5px] text-gray-500 flex-1">{label}</span>
        {options?.length ? (
          <div className="w-52">
            <Combo
              value={draft}
              options={options}
              autoFocus
              align="right"
              multiple={multiple}
              onChange={v => { setDraft(v); onSave(v) }}
              onDone={() => setEditing(false)}
            />
          </div>
        ) : (
          <input
            autoFocus
            className="border border-blue-400 rounded-md px-2 py-1 text-[12.5px] w-44"
            value={draft}
            placeholder={placeholder}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { onSave(draft); setEditing(false) }
              if (e.key === 'Escape') setEditing(false)
            }}
            onBlur={() => { if (draft) onSave(draft); setEditing(false) }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 py-2 px-4 border-b border-dashed border-gray-100 hover:bg-gray-50">
      <span className="text-[12.5px] text-gray-500 flex-1">{label}</span>
      <button
        onClick={() => {
          setDraft(when ? toDateInput(value, withTime) : empty ? '' : String(value))
          setEditing(true)
        }}
        className={`text-[12.5px] text-right ${empty ? 'text-blue-600 hover:underline' : 'text-gray-900'}`}
      >
        {/* У поля со справочником видно, что это выбор, а не свободный ввод —
            иначе про список узнаёшь, только ткнув наугад */}
        {empty
          ? (when ? 'выбрать дату 🗓' : options?.length ? 'выбрать ▾' : 'заполнить')
          : when ? (withTime ? formatDateTimeShort(value) : formatDateDMY(value))
          : isMoney ? Number(value).toLocaleString('ru-RU') : String(value)}
      </button>
    </div>
  )
}


/**
 * Скелетон вместо надписи «Загружаем…».
 *
 * Пустой экран с текстом читается как «ничего нет», а мигание при каждом
 * автообновлении — как подвисание. Скелетон держит форму страницы, поэтому
 * ожидание выглядит короче, чем оно есть.
 */
export const Skeleton = ({ rows = 6, kpis = true }: { rows?: number; kpis?: boolean }) => (
  <div className="p-5 space-y-4 animate-pulse">
    <div className="space-y-2">
      <div className="h-5 w-48 bg-gray-200 rounded" />
      <div className="h-3 w-72 bg-gray-100 rounded" />
    </div>
    {kpis && (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-px bg-gray-200 border border-gray-200 rounded-xl overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white px-4 py-4 space-y-2">
            <div className="h-2.5 w-16 bg-gray-100 rounded" />
            <div className="h-5 w-12 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    )}
    <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex items-center gap-3">
          <div className="h-3 bg-gray-200 rounded flex-1" style={{ maxWidth: `${180 - i * 12}px` }} />
          <div className="h-3 w-16 bg-gray-100 rounded" />
          <div className="h-3 w-24 bg-gray-100 rounded ml-auto" />
        </div>
      ))}
    </div>
  </div>
)

/** Скелетон доски: те же колонки, что появятся после загрузки. */
export const BoardSkeleton = () => (
  <div className="p-5 flex gap-3 overflow-hidden animate-pulse">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="flex-none w-[268px] bg-white border border-gray-200 rounded-xl p-3 space-y-2">
        <div className="h-2.5 w-24 bg-gray-200 rounded" />
        <div className="h-2 w-16 bg-gray-100 rounded" />
        {Array.from({ length: 3 - (i % 2) }).map((__, j) => (
          <div key={j} className="border border-gray-100 rounded-lg p-2.5 space-y-2">
            <div className="h-3 w-28 bg-gray-200 rounded" />
            <div className="h-2.5 w-40 bg-gray-100 rounded" />
            <div className="h-2.5 w-20 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    ))}
  </div>
)

/**
 * Боковая панель для карточек.
 *
 * Переход на отдельную страницу выбивает из работы: список прокручен, фильтры
 * выставлены, а после «назад» всё это надо восстанавливать заново. Панель
 * держит список на месте — сделку посмотрели, поправили, закрыли.
 *
 * Esc закрывает, клик по затемнению — тоже, адрес не меняется.
 */
export const Drawer = ({ open, onClose, title, fullLink, children }: {
  open: boolean
  onClose: () => void
  title?: string
  fullLink?: string
  children: ReactNode
}) => {
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-gray-900/30" onClick={onClose} />
      <aside
        className="relative h-full w-full max-w-[880px] bg-[#f5f7fa] shadow-2xl flex flex-col
                   animate-[slideIn_.16s_ease-out]"
        style={{ animationName: 'none' }}
      >
        <header className="flex-none flex items-center justify-between gap-3 px-4 py-2.5 bg-white border-b border-gray-200">
          <span className="text-[12.5px] text-gray-500 truncate">{title || 'Карточка'}</span>
          <div className="flex items-center gap-2">
            {fullLink && (
              <a href={fullLink} className="text-[12px] text-gray-500 hover:text-blue-600">
                Открыть страницей
              </a>
            )}
            <button onClick={onClose} title="Закрыть (Esc)"
              className="text-[12.5px] px-2.5 py-1 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600">
              Закрыть
            </button>
          </div>
        </header>
        {/* Скроллится только эта область: внутренняя страница своей прокрутки
            не заводит, иначе получаются два ползунка друг в друге */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
      </aside>
    </div>
  )
}

/**
 * Выбор периода: пресеты плюс свои даты.
 *
 * Списки продаж без периода — это «всё за два года» одной кучей: сейлз ищет
 * сегодняшние обращения, а видит историю целиком.
 */
export type Range = { from: string; to: string; key: string }

// Считаем в рабочей зоне: «сегодня» у команды из разных стран должно
// означать один и тот же день, а не местную полночь каждого
const dayKey = (d: Date) => toDateInput(d.toISOString())

/**
 * «Завтра в девять» и прочие быстрые сроки — по рабочей зоне.
 * Час собирался руками через setUTCHours сразу на трёх экранах, и всюду
 * одинаково мимо: обещанное утро приходилось на послеобеденное время.
 */
export function workMorningIn(days: number): string {
  const day = toDateInput(new Date(Date.now() + days * 86400000).toISOString())
  return fromDateInput(`${day}T09:00`, true)
}

export function rangeOf(key: string): Range {
  const now = new Date()
  const day = 86400000
  const to = dayKey(now)
  switch (key) {
    case 'today': return { key, from: to, to }
    case 'yesterday': {
      const y = dayKey(new Date(now.getTime() - day))
      return { key, from: y, to: y }
    }
    case 'week': return { key, from: dayKey(new Date(now.getTime() - 7 * day)), to }
    case 'month': return { key, from: dayKey(new Date(now.getTime() - 30 * day)), to }
    case 'quarter': return { key, from: dayKey(new Date(now.getTime() - 90 * day)), to }
    case 'year': return { key, from: dayKey(new Date(now.getTime() - 365 * day)), to }
    default: return { key: 'all', from: '', to: '' }
  }
}

const RANGE_PRESETS: Array<[string, string]> = [
  ['all', 'Всё время'], ['today', 'Сегодня'], ['yesterday', 'Вчера'],
  ['week', 'Неделя'], ['month', 'Месяц'], ['quarter', 'Квартал'], ['year', 'Год'],
]

export const RangePicker = ({ value, onChange }: { value: Range; onChange: (r: Range) => void }) => {
  const [custom, setCustom] = useState(value.key === 'custom')
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <select
        value={custom ? 'custom' : value.key}
        onChange={e => {
          const k = e.target.value
          if (k === 'custom') { setCustom(true); onChange({ ...value, key: 'custom' }) }
          else { setCustom(false); onChange(rangeOf(k)) }
        }}
        className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]"
      >
        {RANGE_PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        <option value="custom">Свой период</option>
      </select>
      {custom && (
        <>
          <input type="date" value={value.from}
            onChange={e => onChange({ ...value, key: 'custom', from: e.target.value })}
            className="border border-gray-300 rounded-lg px-2 py-1 text-[12px]" />
          <span className="text-[12px] text-gray-400">—</span>
          <input type="date" value={value.to}
            onChange={e => onChange({ ...value, key: 'custom', to: e.target.value })}
            className="border border-gray-300 rounded-lg px-2 py-1 text-[12px]" />
        </>
      )}
    </div>
  )
}

/**
 * Постраничная навигация с номерами.
 *
 * «Назад / Дальше» не отвечают на вопрос «сколько ещё» и не дают прыгнуть в
 * конец. Номера отвечают: видно, где ты и сколько всего.
 */
export const PageNumbers = ({ offset, limit, total, onChange }: {
  offset: number; limit: number; total: number; onChange: (o: number) => void
}) => {
  const pages = Math.max(1, Math.ceil(total / limit))
  const current = Math.floor(offset / limit) + 1
  if (pages <= 1) return null

  // Показываем края и окно вокруг текущей: 1 … 7 8 [9] 10 11 … 99
  const nums: Array<number | '…'> = []
  const push = (n: number) => { if (!nums.includes(n)) nums.push(n) }
  push(1)
  if (current > 4) nums.push('…')
  for (let i = Math.max(2, current - 2); i <= Math.min(pages - 1, current + 2); i++) push(i)
  if (current < pages - 3) nums.push('…')
  if (pages > 1) push(pages)

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <button disabled={current === 1} onClick={() => onChange((current - 2) * limit)}
        className="text-[12px] px-2 py-1 border border-gray-300 rounded-md disabled:opacity-40">‹</button>
      {nums.map((n, i) => n === '…' ? (
        <span key={`d${i}`} className="text-[12px] text-gray-400 px-1">…</span>
      ) : (
        <button key={n} onClick={() => onChange((n - 1) * limit)}
          className={`text-[12px] min-w-[26px] px-1.5 py-1 rounded-md border ${
            n === current ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                          : 'border-gray-300 text-gray-600 hover:border-blue-400'}`}>
          {n}
        </button>
      ))}
      <button disabled={current === pages} onClick={() => onChange(current * limit)}
        className="text-[12px] px-2 py-1 border border-gray-300 rounded-md disabled:opacity-40">›</button>
    </div>
  )
}

/**
 * Панель фильтров, свёрнутая по умолчанию.
 *
 * Развёрнутые фильтры занимают две строки и отодвигают сам список — а нужны
 * они пару раз в день. В свёрнутом виде показываем, что уже выбрано: иначе
 * человек не поймёт, почему список короткий.
 */
export const FilterBar = ({ active, children, right }: {
  active: string[]; children: ReactNode; right?: ReactNode
}) => {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-gray-100">
      <div className="px-4 py-2 flex items-center gap-2 flex-wrap">
        <button onClick={() => setOpen(o => !o)}
          className={`text-[12px] px-2.5 py-1.5 rounded-lg border ${
            active.length ? 'border-blue-400 text-blue-700 bg-blue-50' : 'border-gray-300 text-gray-600'}`}>
          Фильтры{active.length ? ` · ${active.length}` : ''} {open ? '▴' : '▾'}
        </button>
        {!open && active.map(a => (
          <span key={a} className="text-[11.5px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md">{a}</span>
        ))}
        {right}
      </div>
      {open && <div className="px-4 pb-3 flex gap-2 flex-wrap items-center">{children}</div>}
    </div>
  )
}

/**
 * Панель массовых действий: появляется, когда что-то отмечено.
 * Отмечать по одному и повторять действие двадцать раз — не работа.
 */
export const BulkBar = ({ count, onClear, children }: {
  count: number; onClear: () => void; children: ReactNode
}) => {
  if (!count) return null
  return (
    <div className="sticky bottom-0 z-20 bg-gray-900 text-white px-4 py-2.5 flex items-center gap-2 flex-wrap">
      <span className="text-[12.5px] font-semibold">Выбрано: {count}</span>
      <div className="flex gap-1.5 flex-wrap ml-2">{children}</div>
      <button onClick={onClear} className="ml-auto text-[12px] text-gray-300 hover:text-white">снять выделение</button>
    </div>
  )
}
