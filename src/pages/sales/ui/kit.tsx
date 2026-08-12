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
