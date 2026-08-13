import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMarket } from '@/shared/hooks/useMarket'

/**
 * Регион — фильтр самого раздела, а не всей системы.
 *
 * Общий переключатель в меню менял область сразу всему: стоя в сделках по
 * Узбекистану, нельзя было заглянуть в казахстанские лиды, не переключив
 * заодно чаты и аналитику. Теперь у каждого раздела свой выбор, он
 * запоминается отдельно и не тянет за собой соседей.
 */

export const REGION_NAMES: Record<string, string> = {
  uz: 'Узбекистан', kz: 'Казахстан', kg: 'Кыргызстан', az: 'Азербайджан',
  ge: 'Грузия', cy: 'Кипр', ae: 'ОАЭ',
}

const key = (scope: string) => `sales_region_${scope}`
const EVT = 'gfsupport:sales-region'

export function getRegion(scope: string): string {
  return localStorage.getItem(key(scope)) || ''
}

/** Код региона этого раздела ('uz') или '' — все регионы. */
export function useRegion(scope: string): string {
  const [region, setRegion] = useState(() => getRegion(scope))

  useEffect(() => {
    const sync = () => setRegion(getRegion(scope))
    window.addEventListener(EVT, sync)
    return () => window.removeEventListener(EVT, sync)
  }, [scope])

  return region
}

/** Переключатель региона в шапке раздела. */
export const RegionBadge = ({ scope }: { scope: string }) => {
  const { markets } = useMarket()
  const region = useRegion(scope)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<{ top: number; right: number } | null>(null)

  const place = useCallback(() => {
    const el = box.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
  }, [])

  // Список живёт в портале и физически лежит вне кнопки, поэтому в проверке
  // «клик мимо» его надо учитывать отдельно — иначе mousedown по пункту
  // считался кликом снаружи, меню закрывалось, и click по пункту уже некуда
  // было попасть: выбор региона просто не срабатывал
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const t = e.target as Node
      if (box.current?.contains(t) || menu.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
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

  const choose = (code: string) => {
    if (code) localStorage.setItem(key(scope), code)
    else localStorage.removeItem(key(scope))
    window.dispatchEvent(new CustomEvent(EVT))
    setOpen(false)
  }

  // Список регионов берём из общего реестра рынков, но выбор — местный
  const codes = markets.map(m => (m.code || '').toLowerCase()).filter(Boolean)
  const list = codes.length ? codes : Object.keys(REGION_NAMES)
  const label = region ? REGION_NAMES[region] || region.toUpperCase() : 'Все регионы'

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Регион этого раздела"
        className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ${
          region ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-white text-gray-600 border-gray-300'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${region ? 'bg-blue-600' : 'bg-gray-400'}`} />
        {label}
        <span className="text-[9px] opacity-60">▾</span>
      </button>
      {open && rect && createPortal(
        <div
          ref={menu}
          style={{ position: 'fixed', top: rect.top, right: rect.right, zIndex: 60 }}
          className="w-52 bg-white border border-gray-200 rounded-lg shadow-xl py-1"
        >
          <button onMouseDown={e => { e.preventDefault(); choose('') }}
            className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-blue-50 ${
              !region ? 'text-blue-700 font-semibold' : 'text-gray-700'}`}>
            Все регионы
          </button>
          {list.map(code => (
            <button key={code} onMouseDown={e => { e.preventDefault(); choose(code) }}
              className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-blue-50 ${
                region === code ? 'text-blue-700 font-semibold' : 'text-gray-700'}`}>
              {REGION_NAMES[code] || code.toUpperCase()}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
