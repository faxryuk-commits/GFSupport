import { useState, useEffect, useCallback } from 'react'
import { apiGet } from '../services/api.service'

const MARKET_KEY = 'selected_market'

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

  const setSelectedMarket = useCallback((marketId: string | null) => {
    setSelectedMarketState(marketId)
    if (marketId) {
      localStorage.setItem(MARKET_KEY, marketId)
    } else {
      localStorage.removeItem(MARKET_KEY)
    }
  }, [])

  return {
    markets,
    selectedMarket,
    setSelectedMarket,
    loading,
    refetch: fetchMarkets,
  }
}

export function getSelectedMarket(): string | null {
  return localStorage.getItem(MARKET_KEY) || null
}
