import { useCallback, useEffect, useState } from 'react'

/**
 * Регион продаж — сквозной разделитель всех страниц модуля.
 *
 * У каждого рынка своя воронка со своими этапами, своя валюта и своё юрлицо,
 * поэтому смешанные списки из разных стран — каша, в которой сейлз не понимает,
 * чью сделку он видит. Выбор живёт в localStorage и переживает переходы между
 * страницами: ушёл в «Сделки» — остался в том же регионе.
 *
 * Это не то же самое, что рынок в шапке приложения: тот хранит id рынка
 * поддержки (market_1772…) и знает только про страны, где есть каналы. Регионов
 * продаж больше, поэтому у модуля свой переключатель. На бэке region главнее.
 */

const KEY = 'sales_region'
const EVT = 'gfsupport:sales-region'

export const REGIONS: Array<[string, string, string]> = [
  ['uz', 'Узбекистан', '🇺🇿'],
  ['kz', 'Казахстан', '🇰🇿'],
  ['az', 'Азербайджан', '🇦🇿'],
  ['ge', 'Грузия', '🇬🇪'],
  ['ae', 'ОАЭ', '🇦🇪'],
]

export function regionLabel(code: string): string {
  const r = REGIONS.find(x => x[0] === code)
  return r ? `${r[2]} ${r[1]}` : code
}

export function getRegion(): string {
  return localStorage.getItem(KEY) || ''
}

/** Добавляет регион к адресу запроса — один и тот же приём на всех страницах. */
export function withRegion(path: string): string {
  const region = getRegion()
  if (!region) return path
  return `${path}${path.includes('?') ? '&' : '?'}region=${region}`
}

export function useRegion(): [string, (v: string) => void] {
  const [region, setState] = useState(getRegion)

  useEffect(() => {
    const sync = () => setState(getRegion())
    window.addEventListener(EVT, sync)
    return () => window.removeEventListener(EVT, sync)
  }, [])

  const set = useCallback((v: string) => {
    if (v) localStorage.setItem(KEY, v)
    else localStorage.removeItem(KEY)
    setState(v)
    window.dispatchEvent(new CustomEvent(EVT))
  }, [])

  return [region, set]
}

/** Переключатель регионов в шапке страницы. */
export const RegionSwitch = ({ counts }: { counts?: Record<string, number> }) => {
  const [region, setRegion] = useRegion()
  return (
    <div className="inline-flex items-center rounded-lg border border-gray-300 overflow-hidden bg-white">
      {([['', 'Все регионы', '🌍'], ...REGIONS] as Array<[string, string, string]>).map(([code, name, flag]) => (
        <button
          key={code || 'all'}
          onClick={() => setRegion(code)}
          title={name}
          className={`text-[12px] px-2.5 py-1.5 border-r border-gray-200 last:border-r-0 whitespace-nowrap ${
            region === code ? 'bg-blue-600 text-white font-semibold' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <span className="mr-1">{flag}</span>
          {name}
          {counts?.[code] ? (
            <span className={`ml-1.5 text-[10.5px] px-1.5 py-0.5 rounded ${
              region === code ? 'bg-white/20' : 'bg-gray-100 text-gray-500'
            }`}>
              {counts[code]}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}
