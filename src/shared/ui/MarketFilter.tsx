import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMarket, MARKET_CHANGED_EVENT } from '@/shared/hooks/useMarket'
import { clearCache } from '@/shared/services/api.service'

/**
 * Фильтр региона в шапке раздела.
 *
 * Раньше переключатель был один на всю систему и менял область сразу всему:
 * из сделок по Узбекистану нельзя было заглянуть в казахстанские лиды, не
 * переключив заодно чаты и аналитику. Теперь выбор свой у каждого раздела и
 * запоминается отдельно.
 *
 * Пока раздел открыт, его выбор становится действующим и для запросов, которые
 * подставляют рынок сами (api.service). Так новые фильтры работают со старыми
 * экранами, не требуя переписывать каждый запрос в системе.
 */

const scopeKey = (scope: string) => `market_scope_${scope}`
const ACTIVE_KEY = 'selected_market'

export function getScopeMarket(scope: string): string {
  return localStorage.getItem(scopeKey(scope)) || ''
}

/** Применяет выбор раздела как действующий рынок и сообщает об этом системе. */
function apply(marketId: string) {
  const before = localStorage.getItem(ACTIVE_KEY) || ''
  if (marketId) localStorage.setItem(ACTIVE_KEY, marketId)
  else localStorage.removeItem(ACTIVE_KEY)
  if (before !== marketId) {
    clearCache()
    window.dispatchEvent(new CustomEvent(MARKET_CHANGED_EVENT))
  }
}

/**
 * Экраны старых разделов запрашивают данные один раз при открытии и не следят
 * за сменой рынка. Чтобы фильтр не выглядел неработающим, после выбора
 * перезагружаем страницу — грубо, но честно: показанное совпадает с выбранным.
 * Разделы продаж перезапрашивают сами, им перезагрузка не нужна.
 */
function reloadIfNeeded(scope: string) {
  const LIVE = ['deals', 'leads', 'accounts', 'reports', 'dashboard']
  if (LIVE.includes(scope)) return
  setTimeout(() => window.location.reload(), 80)
}

/** Выбранный рынок этого раздела: id и код страны. */
export function useScopeMarket(scope: string): { id: string; code: string } {
  const { markets } = useMarket()
  const [id, setId] = useState(() => getScopeMarket(scope))

  // Пока раздел открыт, его выбор — действующий: иначе экраны, которые берут
  // рынок из общего места, показывали бы не то, что написано в шапке
  useEffect(() => {
    apply(getScopeMarket(scope))
    const sync = () => setId(getScopeMarket(scope))
    window.addEventListener(MARKET_CHANGED_EVENT, sync)
    return () => window.removeEventListener(MARKET_CHANGED_EVENT, sync)
  }, [scope])

  const code = (markets.find(m => m.id === id)?.code || '').toLowerCase()
  return { id, code }
}

export const MarketFilter = ({ scope }: { scope: string }) => {
  const { markets } = useMarket()
  const { id } = useScopeMarket(scope)
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

  // Список рисуется в портале и лежит вне кнопки: без этой проверки нажатие по
  // пункту считалось кликом снаружи, меню закрывалось, и выбор не срабатывал
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

  const choose = (marketId: string) => {
    if (marketId) localStorage.setItem(scopeKey(scope), marketId)
    else localStorage.removeItem(scopeKey(scope))
    apply(marketId)
    setOpen(false)
    reloadIfNeeded(scope)
  }

  const label = markets.find(m => m.id === id)?.name || 'Все регионы'

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Регион этого раздела"
        className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ${
          id ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-white text-gray-600 border-gray-300'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${id ? 'bg-blue-600' : 'bg-gray-400'}`} />
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
              !id ? 'text-blue-700 font-semibold' : 'text-gray-700'}`}>
            Все регионы
          </button>
          {markets.map(m => (
            <button key={m.id} onMouseDown={e => { e.preventDefault(); choose(m.id) }}
              className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-blue-50 ${
                id === m.id ? 'text-blue-700 font-semibold' : 'text-gray-700'}`}>
              {m.name}
            </button>
          ))}
          {!markets.length && (
            <div className="px-3 py-2 text-[11.5px] text-gray-400">Рынки не заведены</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
