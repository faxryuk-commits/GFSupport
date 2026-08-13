import { useEffect, useState } from 'react'
import { apiGet } from '@/shared/services/api.service'

/**
 * Справочники продаж на клиенте: этапы, источники, причины отказа и — главное —
 * готовые значения полей (город, касса, тип доставки, тариф).
 *
 * Держим один общий кэш на модуль: справочники меняются раз в месяц, а страниц,
 * которым они нужны, много. Перезагружаем по refreshRefs() после правки.
 */

export interface FieldOption {
  id: string
  field: string
  value: string
  label: string
  market_id: string | null
  is_active: boolean
}

export interface SalesRefs {
  stages: any[]
  reasons: any[]
  sources: Array<{ key: string; label: string; kind: string; is_active: boolean }>
  markets: Array<{ market_id: string; currency: string; legal_entity: string; deals: number }>
  options: FieldOption[]
}

let cache: SalesRefs | null = null
let inflight: Promise<SalesRefs> | null = null
const listeners = new Set<(r: SalesRefs) => void>()

/**
 * Один сбой запроса не должен оставлять поля без списков до конца сессии:
 * пустой справочник молча превращает выбор в обычный ввод — ровно так выглядел
 * модуль во время простоя, и со стороны это читалось как «списков нет вовсе».
 */
function fetchRefs(attempt = 0): Promise<SalesRefs> {
  if (inflight) return inflight
  inflight = apiGet<SalesRefs>('/sales/refs', false)
    .then(r => {
      cache = r
      listeners.forEach(l => l(r))
      return r
    })
    .catch(e => {
      inflight = null
      if (attempt < 2) {
        return new Promise<SalesRefs>(resolve => {
          setTimeout(() => resolve(fetchRefs(attempt + 1)), 2000 * (attempt + 1))
        })
      }
      throw e
    })
    .finally(() => { inflight = null })
  return inflight
}

/** Сбросить кэш после правки справочника. */
export function refreshRefs(): Promise<SalesRefs> {
  cache = null
  return fetchRefs()
}

export function useSalesRefs(): SalesRefs | null {
  const [refs, setRefs] = useState<SalesRefs | null>(cache)

  useEffect(() => {
    listeners.add(setRefs)
    if (!cache) fetchRefs().catch(() => {})
    else setRefs(cache)
    return () => { listeners.delete(setRefs) }
  }, [])

  return refs
}

/**
 * Значения одного поля. Город зависит от региона: в списке Узбекистана нет
 * смысла показывать Алматы. Значения без региона общие для всех.
 */
export function optionsFor(refs: SalesRefs | null, field: string, market?: string | null): string[] {
  if (!refs?.options) return []
  return refs.options
    .filter(o => o.field === field && o.is_active !== false)
    .filter(o => !o.market_id || !market || o.market_id === market)
    .map(o => o.label || o.value)
}
