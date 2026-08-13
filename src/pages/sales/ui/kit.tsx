import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/** Общие мелочи страниц продаж: одни и те же чипы, карточки и форматы. */

export function money(v: any, currency = 'UZS') {
  if (v === null || v === undefined || v === '') return '—'
  return `${Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ${currency}`
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

export const Chip = ({ tone = 'gray', children }: { tone?: string; children: ReactNode }) => (
  <span className={`inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap ${TONES[tone]}`}>
    {children}
  </span>
)

export const Card = ({ title, sub, right, children }: {
  title: string; sub?: string; right?: ReactNode; children: ReactNode
}) => (
  <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
    <header className="px-4 py-3 border-b border-gray-100 flex justify-between items-center gap-3 flex-wrap">
      <div>
        <h3 className="text-[13.5px] font-semibold text-gray-900">{title}</h3>
        {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
      </div>
      {right}
    </header>
    {children}
  </section>
)

export const Kpis = ({ items }: { items: Array<[string, string, string?]> }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-px bg-gray-200 border border-gray-200 rounded-xl overflow-hidden">
    {items.map(([k, v, d]) => (
      <div key={k} className="bg-white px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{k}</div>
        <div className="text-[20px] text-gray-900 tabular-nums mt-1 tracking-tight">{v}</div>
        {d && <div className="text-[11px] text-gray-500 mt-0.5">{d}</div>}
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
export const PageShell = ({ header, children }: { header: ReactNode; children: ReactNode }) => (
  <div className="h-full flex flex-col overflow-hidden">
    <div className="flex-none px-5 pt-5 pb-3 bg-[#f5f7fa] border-b border-gray-200">{header}</div>
    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
  </div>
)

/** Шапка таблицы, которая не уезжает при прокрутке длинного списка. */
export const Th = ({ children, align = 'left' }: { children?: ReactNode; align?: 'left' | 'right' }) => (
  <th className={`text-${align} font-semibold px-4 py-2.5 sticky top-0 bg-white z-10 border-b border-gray-100`}>
    {children}
  </th>
)

/** Постраничная навигация: списки в проде уже по сотне строк. */
export const Pager = ({ offset, limit, count, hasMore, onChange }: {
  offset: number; limit: number; count: number; hasMore: boolean; onChange: (o: number) => void
}) => (
  <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 bg-gray-50">
    <span className="text-[11.5px] text-gray-500">
      {count === 0 ? 'ничего не найдено' : `строки ${offset + 1}–${offset + count}`}
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
export function Combo({ value, options, onChange, placeholder, autoFocus, onDone, align = 'left' }: {
  value: string
  options: string[]
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  onDone?: () => void
  align?: 'left' | 'right'
}) {
  // Поле, открытое по клику «заполнить», уже сфокусировано — второго клика
  // никто не делает, поэтому список раскрываем сразу вместе с полем
  const [open, setOpen] = useState(!!autoFocus)
  const [draft, setDraft] = useState(value ?? '')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => { setDraft(value ?? '') }, [value])

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); onDone?.() }
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [onDone])

  const typed = draft.trim().toLowerCase()
  const shown = typed && typed !== (value || '').toLowerCase()
    ? options.filter(o => o.toLowerCase().includes(typed))
    : options

  const pick = (v: string) => { setDraft(v); onChange(v); setOpen(false); onDone?.() }

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
      {open && shown.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-white border border-gray-200
                        rounded-lg shadow-lg">
          {shown.map(o => (
            <button key={o} type="button" onMouseDown={e => { e.preventDefault(); pick(o) }}
              className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-blue-50 ${
                o === value ? 'text-blue-700 font-semibold' : 'text-gray-700'}`}>
              {o}
            </button>
          ))}
          {typed && !options.some(o => o.toLowerCase() === typed) && (
            <button type="button" onMouseDown={e => { e.preventDefault(); pick(draft.trim()) }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] text-gray-500 border-t border-gray-100">
              Своё значение: «{draft.trim()}»
            </button>
          )}
        </div>
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
export function InlineField({ label, value, onSave, placeholder, money: isMoney, options }: {
  label: string; value: any; onSave: (v: string) => void; placeholder?: string
  money?: boolean; options?: string[]
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const empty = value === null || value === undefined || value === ''

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
        onClick={() => { setDraft(empty ? '' : String(value)); setEditing(true) }}
        className={`text-[12.5px] text-right ${empty ? 'text-blue-600 hover:underline' : 'text-gray-900'}`}
      >
        {empty ? 'заполнить' : isMoney ? Number(value).toLocaleString('ru-RU') : String(value)}
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
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </aside>
    </div>
  )
}
