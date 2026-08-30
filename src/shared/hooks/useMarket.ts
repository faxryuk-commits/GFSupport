import { useState, useEffect, useCallback } from 'react'
import { apiGet } from '../services/api.service'

const MARKET_KEY = 'selected_market'
export const MARKET_CHANGED_EVENT = 'gfsupport:market-changed'

export interface Market {
  id: string
  name: string
  code: string
  country: string | null
  timezone: string
  isActive: boolean
  channelsCount: number
  agentsCount: number
}

/**
 * Список регионов один на всё приложение.
 *
 * Хук живёт в шапке, в фильтрах и на страницах разом — и каждый экземпляр
 * ходил за списком сам: три-четыре одинаковых запроса на каждую загрузку
 * страницы. Список меняется хорошо если раз в месяц, поэтому кэш модуля
 * с недолгим сроком, а одновременные запросы сливаются в один.
 */
let marketsCache: { data: Market[]; at: number } | null = null
let marketsInflight: Promise<Market[]> | null = null
const MARKETS_TTL = 5 * 60 * 1000

function loadMarkets(force = false): Promise<Market[]> {
  if (!force && marketsCache && Date.now() - marketsCache.at < MARKETS_TTL) {
    return Promise.resolve(marketsCache.data)
  }
  if (marketsInflight) return marketsInflight
  marketsInflight = apiGet<{ markets: Market[] }>('/markets')
    .then(d => {
      marketsCache = { data: d.markets || [], at: Date.now() }
      return marketsCache.data
    })
    .finally(() => { marketsInflight = null })
  return marketsInflight
}

export function useMarket() {
  const [markets, setMarkets] = useState<Market[]>(marketsCache?.data || [])
  const [selectedMarket, setSelectedMarketState] = useState<string | null>(() => {
    return localStorage.getItem(MARKET_KEY) || null
  })
  const [loading, setLoading] = useState(!marketsCache)

  const fetchMarkets = useCallback(async (force = false) => {
    try {
      setMarkets(await loadMarkets(force))
    } catch {
      setMarkets([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMarkets()
  }, [fetchMarkets])

  // Sync when another component (e.g. sidebar in MainLayout) changes the market.
  useEffect(() => {
    const syncFromStorage = () => {
      setSelectedMarketState(localStorage.getItem(MARKET_KEY) || null)
    }
    window.addEventListener(MARKET_CHANGED_EVENT, syncFromStorage)
    window.addEventListener('storage', (e) => {
      if (e.key === MARKET_KEY) syncFromStorage()
    })
    return () => {
      window.removeEventListener(MARKET_CHANGED_EVENT, syncFromStorage)
    }
  }, [])

  const setSelectedMarket = useCallback((marketId: string | null) => {
    setSelectedMarketState(marketId)
    if (marketId) {
      localStorage.setItem(MARKET_KEY, marketId)
    } else {
      localStorage.removeItem(MARKET_KEY)
    }
    window.dispatchEvent(new CustomEvent(MARKET_CHANGED_EVENT))
  }, [])

  const selectedMarketInfo = markets.find((m) => m.id === selectedMarket) ?? null

  return {
    markets,
    selectedMarket,
    selectedMarketInfo,
    setSelectedMarket,
    loading,
    refetch: fetchMarkets,
  }
}

export function getSelectedMarket(): string | null {
  return localStorage.getItem(MARKET_KEY) || null
}

export function formatMarketLabel(market: Market | null | undefined): string {
  if (!market) return 'Не назначен'
  return market.name
}
