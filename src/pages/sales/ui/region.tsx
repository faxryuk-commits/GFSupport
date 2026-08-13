import { useEffect, useRef, useState } from 'react'
import { useMarket, MARKET_CHANGED_EVENT } from '@/shared/hooks/useMarket'
import { clearCache } from '@/shared/services/api.service'

/**
 * Регион продаж берётся из общего переключателя рынка в шапке приложения.
 *
 * Свой фильтр на каждой странице был ошибкой: их получалось шесть, они не
 * договаривались между собой и сбрасывались при переходах. Управление одно —
 * в шапке; страницы модуля только показывают, в каком регионе идёт работа.
 *
 * Переключатель хранит id рынка (market_1772…), а продажи всюду работают кодом
 * страны — перевод делает и клиент (для подписи), и сервер (для фильтра).
 */

export const REGION_NAMES: Record<string, string> = {
  uz: 'Узбекистан', kz: 'Казахстан', kg: 'Кыргызстан', az: 'Азербайджан',
  ge: 'Грузия', cy: 'Кипр', ae: 'ОАЭ',
}

/** Код текущего региона ('uz') или '' для режима «все рынки». */
export function useRegion(): string {
  const { markets, selectedMarket } = useMarket()
  const [, force] = useState(0)

  // Переключение рынка в шапке — событие на window: списки должны перезапроситься
  useEffect(() => {
    const bump = () => force(n => n + 1)
    window.addEventListener(MARKET_CHANGED_EVENT, bump)
    return () => window.removeEventListener(MARKET_CHANGED_EVENT, bump)
  }, [])

  if (!selectedMarket) return ''
  const m = markets.find(x => x.id === selectedMarket)
  return (m?.code || '').toLowerCase()
}

/**
 * Переключатель региона на странице.
 *
 * Он не заводит своё состояние: выбор пишется в тот же общий рынок, что и в
 * шапке приложения. То есть орган управления один, а доступен он из двух мест —
 * искать его в свёрнутом меню не приходится.
 */
export const RegionBadge = () => {
  const { markets, selectedMarket, setSelectedMarket } = useMarket()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const region = useRegion()

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [])

  const label = region ? REGION_NAMES[region] || region.toUpperCase() : 'Все регионы'

  const choose = (id: string | null) => {
    setSelectedMarket(id)
    clearCache()
    setOpen(false)
  }

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Регион: тот же, что в шапке приложения"
        className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ${
          region ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-white text-gray-600 border-gray-300'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${region ? 'bg-blue-600' : 'bg-gray-400'}`} />
        {label}
        <span className="text-[9px] opacity-60">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 right-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          <button onClick={() => choose(null)}
            className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-blue-50 ${
              !selectedMarket ? 'text-blue-700 font-semibold' : 'text-gray-700'}`}>
            Все регионы
          </button>
          {markets.map(m => (
            <button key={m.id} onClick={() => choose(m.id)}
              className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-blue-50 ${
                selectedMarket === m.id ? 'text-blue-700 font-semibold' : 'text-gray-700'}`}>
              {m.name}
            </button>
          ))}
          {markets.length === 0 && (
            <div className="px-3 py-2 text-[11.5px] text-gray-400">
              Рынки не заведены — добавьте их в настройках
            </div>
          )}
        </div>
      )}
    </div>
  )
}
