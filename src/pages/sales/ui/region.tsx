import { useEffect, useState } from 'react'
import { useMarket, MARKET_CHANGED_EVENT } from '@/shared/hooks/useMarket'

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
  uz: 'Узбекистан', kz: 'Казахстан', az: 'Азербайджан', ge: 'Грузия', ae: 'ОАЭ',
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
 * Подпись, а не второй орган управления: показывает, в каком регионе вы
 * работаете, и отправляет менять его туда, где переключатель один.
 */
export const RegionBadge = () => {
  const region = useRegion()
  const label = region ? REGION_NAMES[region] || region.toUpperCase() : 'Все регионы'
  return (
    <span
      title="Регион переключается в шапке слева — один на всю систему"
      className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg ${
        region ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${region ? 'bg-blue-600' : 'bg-gray-400'}`} />
      {label}
    </span>
  )
}
