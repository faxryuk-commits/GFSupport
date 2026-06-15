import { apiGet } from '../services/api.service'

export type ErrorFault = 'delever' | 'integration' | 'pos' | 'merchant' | 'customer' | 'aggregator' | 'unknown'

export interface ErrorSubcategory {
  key: string
  label: string
  count: number
  pct: number
  fault: ErrorFault
  faultLabel: string
  decode: string
  fixSteps: string[]
  owner: string
  topRestaurant: string | null
  topRestaurantShare: number
  concentrated: boolean
  restaurantsAffected: number
  restaurants: Array<{ name: string; count: number }>
  examples: string[]
}

export interface ErrorCategory {
  key: string
  label: string
  count: number
  pct: number
  subcategories: ErrorSubcategory[]
}

export interface ErrorFeedResponse {
  ok: boolean
  hasFeed: boolean
  feedName?: string
  period?: string
  total: number
  classifiedPct?: number
  unmatched?: number
  ourFault?: number
  ourFaultPct?: number
  byFault?: Array<{ fault: string; label: string; count: number; pct: number }>
  byService?: Array<{ name: string; count: number }>
  bySource?: Array<{ name: string; count: number }>
  topRestaurants?: Array<{ name: string; count: number }>
  categories?: ErrorCategory[]
}

export const fetchErrorFeed = (
  period: 'today' | '7d' | '30d' | '90d' = '7d',
): Promise<ErrorFeedResponse> =>
  apiGet<ErrorFeedResponse>(`/analytics/error-feed?period=${period}`)
