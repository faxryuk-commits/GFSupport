/**
 * Шапка колонки этапа. Две строки одинаковой формы у всех колонок:
 *
 *   ЭТАП                          117  1 дн
 *   MRR 7,15 млн     CF 13 млн UZS
 *
 * Суммы сокращены до миллионов: «39 410 000 · 497 620 000» в колонке
 * шириной 236px растягивало строку и у каждого этапа она была своей длины,
 * доска смотрелась хаотично. Две ячейки сетки одинаковой ширины дают
 * ровный ряд независимо от числа знаков. Точные цифры — по наведению.
 */

/** 7 150 000 → «7,15 млн», 497 620 000 → «498 млн», 1 405 → «1 405». */
export function compactMoney(v: unknown): string {
  const n = Number(v)
  if (!n) return '—'
  const abs = Math.abs(n)
  const fmt = (x: number, unit: string) => {
    const s = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)
    return s.replace(/\.?0+$/, '').replace('.', ',') + ' ' + unit
  }
  if (abs >= 1e9) return fmt(n / 1e9, 'млрд')
  if (abs >= 1e6) return fmt(n / 1e6, 'млн')
  if (abs >= 1e4) return fmt(n / 1e3, 'тыс')
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
}

const exact = (v: unknown) => Number(v)
  ? Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 })
  : '—'

export function StageHeader({ label, description, total, slaHours, amounts, cashflow, cur }: {
  label: string
  description?: string | null
  total: number
  slaHours?: string | number | null
  /** Суммы по валютам: показываем валюту страны, остальное — в подсказке. */
  amounts?: Record<string, unknown> | null
  cashflow?: Record<string, unknown> | null
  cur: string
}) {
  const days = slaHours ? Math.round(Number(slaHours) / 24) || 1 : null
  const mrr = amounts?.[cur]
  const cf = cashflow?.[cur]
  const others = Object.entries(amounts || {})
    .filter(([c, v]) => c !== cur && Number(v) > 0)
    .map(([c, v]) => `${exact(v)} ${c}`)
  const hint = [
    `MRR ${exact(mrr)} ${cur} — ежемесячные платежи по сделкам этапа.`,
    `CF ${exact(cf)} ${cur} — деньги на входе при заключении: единоразовые платежи по сделкам этапа.`,
    others.length ? `Не в шапке, другие валюты: MRR ${others.join(', ')}.` : '',
  ].filter(Boolean).join('\n')

  return (
    <header className="px-2.5 py-2 border-b border-gray-100 h-[52px] flex flex-col justify-center gap-0.5">
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600
                         flex items-center gap-1 min-w-0">
          <span className="truncate">{label}</span>
          {description && (
            <span title={description}
              className="flex-none w-3.5 h-3.5 rounded-full border border-gray-300 text-gray-400
                         grid place-items-center text-[8px] font-bold cursor-help normal-case">?</span>
          )}
        </span>
        <span className="ml-auto flex-none text-[11.5px] font-semibold text-gray-700 tabular-nums">{total}</span>
        {days !== null && (
          <span className="flex-none text-[10px] text-gray-400 tabular-nums" title="норматив этапа">{days} дн</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10.5px] text-gray-500 tabular-nums" title={hint}>
        <span className="truncate">
          <span className="font-semibold text-gray-400">MRR</span> {compactMoney(mrr)}
        </span>
        <span className="truncate">
          <span className="font-semibold text-gray-400">CF</span> {compactMoney(cf)}
          <span className="text-gray-400"> {cur}</span>
        </span>
      </div>
    </header>
  )
}
