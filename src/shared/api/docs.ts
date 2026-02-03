import { apiGet, apiPost, apiPut, apiDelete } from '../services/api.service'

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

export interface DocsResponse {
  docs: Doc[]
  total: number
  categories: string[]
}

export interface DocSearchResult {
  id: string
  title: string
  content: string
  category: string
  relevanceScore: number
  snippet: string
}

/**
 * Получить список документов
 */
export async function fetchDocs(options?: {
  category?: string
  tags?: string[]
  search?: string
  isPublic?: boolean
  limit?: number
  offset?: number
}): Promise<DocsResponse> {
  const params = new URLSearchParams()
  if (options?.category) params.append('category', options.category)
  if (options?.tags?.length) params.append('tags', options.tags.join(','))
  if (options?.search) params.append('search', options.search)
  if (options?.isPublic !== undefined) params.append('isPublic', String(options.isPublic))
  if (options?.limit) params.append('limit', String(options.limit))
  if (options?.offset) params.append('offset', String(options.offset))
  
  return apiGet(`/docs?${params}`)
}

/**
 * Получить документ по ID
 */
export async function fetchDoc(id: string): Promise<{ doc: Doc }> {
  return apiGet(`/docs?id=${id}`)
}

/**
 * Создать документ
 */
export async function createDoc(data: {
  title: string
  content: string
  category: string
  subcategory?: string
  tags?: string[]
  isPublic?: boolean
  isInternal?: boolean
}): Promise<{ success: boolean; doc: Doc }> {
  return apiPost('/docs', data)
}

/**
 * Обновить документ
 */
export async function updateDoc(
  id: string,
  data: Partial<{
    title: string
    content: string
    category: string
    subcategory: string
    tags: string[]
    isPublic: boolean
    isInternal: boolean
  }>
): Promise<{ success: boolean; doc: Doc }> {
  return apiPut(`/docs?id=${id}`, data)
}

/**
 * Удалить документ
 */
export async function deleteDoc(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/docs?id=${id}`)
}

/**
 * Семантический поиск в документации
 */
export async function searchDocs(
  query: string,
  options?: { category?: string; limit?: number }
): Promise<{ results: DocSearchResult[]; aiSummary?: string }> {
  const params = new URLSearchParams({ query })
  if (options?.category) params.append('category', options.category)
  if (options?.limit) params.append('limit', String(options.limit))
  return apiGet(`/docs/search?${params}`)
}

/**
 * Синхронизация документов (например из Notion)
 */
export async function syncDocs(source: 'notion' | 'confluence'): Promise<{
  success: boolean
  synced: number
  errors: string[]
}> {
  return apiPost('/docs/sync', { source })
}

/**
 * Отметить документ как полезный/неполезный
 */
export async function rateDoc(
  id: string,
  helpful: boolean
): Promise<{ success: boolean }> {
  return apiPost(`/docs?id=${id}&action=rate`, { helpful })
}
