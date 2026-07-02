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

export function useMarket() {
  const [markets, setMarkets] = useState<Market[]>([])
  const [selectedMarket, setSelectedMarketState] = useState<string | null>(() => {
    return localStorage.getItem(MARKET_KEY) || null
  })
  const [loading, setLoading] = useState(true)

  const fetchMarkets = useCallback(async () => {
    try {
      const data = await apiGet<{ markets: Market[] }>('/markets')
      setMarkets(data.markets || [])
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
