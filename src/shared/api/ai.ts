import { apiGet, apiPost } from '../services/api.service'

// Типы для AI анализа
export interface AIAnalysis {
  category: string
  sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated'
  intent: string
  urgency: number
  isProblem: boolean
  needsResponse: boolean
  summary: string
  entities: Record<string, string>
}

export interface AISearchResult {
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

export interface AISearchResponse {
  query: string
  results: AISearchResult[]
  aiSummary: string | null
  stats: {
    solutionsSearched: number
    casesSearched: number
    embeddingsUsed: number
    matchesFound: number
  }
}

export interface AIContextResponse {
  channelId: string
  context: {
    channelInfo: any
    recentMessages: any[]
    relatedCases: any[]
    suggestedSolutions: any[]
    clientHistory: any
  }
  aiRecommendation?: string
}

/**
 * Анализирует сообщение с помощью AI
 */
export async function analyzeMessage(
  messageId: string,
  text: string,
  channelId?: string
): Promise<{ success: boolean; analysis: AIAnalysis; messageId: string }> {
  return apiPost('/ai/analyze', { messageId, text, channelId })
}

/**
 * Анализирует текст без сохранения (preview)
 */
export async function analyzeText(text: string): Promise<{ analysis: AIAnalysis }> {
  return apiGet(`/ai/analyze?text=${encodeURIComponent(text)}`)
}

/**
 * Семантический поиск решений и кейсов
 */
export async function searchSolutions(
  query: string,
  options?: { category?: string; limit?: number }
): Promise<AISearchResponse> {
  const params = new URLSearchParams({ query })
  if (options?.category) params.append('category', options.category)
  if (options?.limit) params.append('limit', String(options.limit))
  return apiGet(`/ai/search?${params}`)
}

/**
 * Индексация решений для семантического поиска
 */
export async function indexSolutions(): Promise<{ success: boolean; indexed: number; total: number }> {
  return apiPost('/ai/search', { action: 'index_solutions' })
}

/**
 * Индексация кейсов для семантического поиска
 */
export async function indexCases(): Promise<{ success: boolean; indexed: number; total: number }> {
  return apiPost('/ai/search', { action: 'index_cases' })
}

/**
 * Получить AI-контекст для канала (история, рекомендации)
 */
export async function getAIContext(channelId: string): Promise<AIContextResponse> {
  return apiGet(`/ai/context?channelId=${channelId}`)
}

/**
 * Генерировать embedding для текста
 */
export async function generateEmbedding(
  text: string,
  sourceType: 'message' | 'solution' | 'case',
  sourceId: string
): Promise<{ success: boolean; embeddingId: string }> {
  return apiPost('/ai/embed', { text, sourceType, sourceId })
}
