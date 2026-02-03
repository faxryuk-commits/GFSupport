export interface Doc {
  id: string
  title: string
  content: string
  category: string
  subcategory?: string
  tags: string[]
  isPublic: boolean
  isInternal: boolean
  viewCount: number
  helpfulCount: number
  notHelpfulCount: number
  relatedDocs?: string[]
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export interface DocSearchResult {
  id: string
  title: string
  content: string
  category: string
  relevanceScore: number
  snippet: string
}

export const DOC_CATEGORIES = [
  'getting_started',
  'integrations',
  'features',
  'troubleshooting',
  'billing',
  'api',
  'faq',
  'announcements',
] as const

export type DocCategory = typeof DOC_CATEGORIES[number]

export const DOC_CATEGORY_CONFIG: Record<DocCategory, { label: string; icon: string }> = {
  getting_started: { label: 'Начало работы', icon: '🚀' },
  integrations: { label: 'Интеграции', icon: '🔗' },
  features: { label: 'Функции', icon: '✨' },
  troubleshooting: { label: 'Решение проблем', icon: '🔧' },
  billing: { label: 'Оплата', icon: '💳' },
  api: { label: 'API', icon: '⚙️' },
  faq: { label: 'FAQ', icon: '❓' },
  announcements: { label: 'Объявления', icon: '📢' },
}

/**
 * Вычисляет рейтинг полезности документа
 */
export function getDocHelpfulnessRatio(doc: Doc): number {
  const total = doc.helpfulCount + doc.notHelpfulCount
  if (total === 0) return 0
  return Math.round((doc.helpfulCount / total) * 100)
}
