export interface Solution {
  id: string
  category: string
  subcategory?: string
  problemKeywords: string[]
  solutionText: string
  solutionSteps?: string[]
  successScore: number
  usedCount: number
  isVerified: boolean
  isActive: boolean
  createdBy?: string
  createdAt: string
  updatedAt?: string
}

export interface SolutionSearchResult {
  type: 'solution' | 'historical_case'
  id: string
  category: string
  subcategory?: string
  text?: string
  steps?: string[]
  title?: string
  resolution?: string
  rootCause?: string
  successScore?: number
  isVerified?: boolean
  relevanceScore: number
}

export const SOLUTION_CATEGORIES = [
  'technical',
  'integration',
  'billing',
  'delivery',
  'order',
  'menu',
  'app',
  'onboarding',
  'general'
] as const

export type SolutionCategory = typeof SOLUTION_CATEGORIES[number]

export const SOLUTION_CATEGORY_CONFIG: Record<SolutionCategory, { label: string; color: string }> = {
  technical: { label: 'Техническая', color: 'text-blue-600' },
  integration: { label: 'Интеграция', color: 'text-purple-600' },
  billing: { label: 'Биллинг', color: 'text-green-600' },
  delivery: { label: 'Доставка', color: 'text-orange-600' },
  order: { label: 'Заказы', color: 'text-yellow-600' },
  menu: { label: 'Меню', color: 'text-pink-600' },
  app: { label: 'Приложение', color: 'text-indigo-600' },
  onboarding: { label: 'Онбординг', color: 'text-teal-600' },
  general: { label: 'Общее', color: 'text-slate-600' },
}
