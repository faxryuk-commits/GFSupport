import { apiGet } from '../services/api.service'

export interface AISuggestion {
  id: string
  label: string
  text: string
  source: 'ai' | 'template' | 'docs' | 'rag'
  confidence?: number
}

export interface AIContext {
  suggestedResponse: string | null
  suggestions: AISuggestion[]
  sentiment: 'positive' | 'neutral' | 'negative' | 'escalating'
  urgencyLevel: number
  mainIssues: string[]
  keyTopics: string[]
  knowledgeBaseArticles: Array<{
    title: string
    url: string
    excerpt: string
  }>
}

// Fetch AI context for a channel
export async function fetchAIContext(channelId: string): Promise<AIContext | null> {
  try {
    const data = await apiGet<any>(`/ai/context?channelId=${channelId}`)
    
    // Build suggestions list
    const suggestions: AISuggestion[] = []
    
    // Add AI suggested response
    if (data.suggestedResponse) {
      suggestions.push({
        id: 'ai-main',
        label: 'AI рекомендация',
        text: data.suggestedResponse,
        source: 'ai',
        confidence: 0.9,
      })
    }
    
    // Add suggestions from recent messages
    if (data.recentSuggestions?.length) {
      data.recentSuggestions.slice(0, 3).forEach((s: any, i: number) => {
        suggestions.push({
          id: `recent-${i}`,
          label: s.label || `Подсказка ${i + 1}`,
          text: s.text,
          source: 'template',
        })
      })
    }
    
    // Add RAG suggestions
    if (data.similarDialogs?.length) {
      data.similarDialogs.slice(0, 2).forEach((d: any, i: number) => {
        suggestions.push({
          id: `rag-${i}`,
          label: `Похожий ответ`,
          text: d.answerText,
          source: 'rag',
          confidence: d.confidence,
        })
      })
    }
    
    return {
      suggestedResponse: data.suggestedResponse || null,
      suggestions,
      sentiment: data.sentiment || 'neutral',
      urgencyLevel: data.urgencyLevel || 0,
      mainIssues: data.mainIssues || [],
      keyTopics: data.keyTopics || [],
      knowledgeBaseArticles: data.knowledgeBaseArticles || [],
    }
    
  } catch (e) {
    console.error('[AI Context] Error:', e)
    return null
  }
}

// Get quick suggestions based on message category
export function getQuickSuggestions(category?: string): AISuggestion[] {
  const templates: Record<string, AISuggestion[]> = {
    technical: [
      { id: 't1', label: 'Уточнить проблему', text: 'Подскажите, пожалуйста, когда именно появилась эта проблема и какие действия вы выполняли перед этим?', source: 'template' },
      { id: 't2', label: 'Запрос скриншота', text: 'Можете прислать скриншот ошибки? Это поможет быстрее разобраться.', source: 'template' },
      { id: 't3', label: 'Проверим', text: 'Спасибо за информацию. Передал команде разработки, скоро вернусь с ответом.', source: 'template' },
    ],
    integration: [
      { id: 'i1', label: 'Проверка настроек', text: 'Давайте проверим настройки интеграции. Можете зайти в Настройки → Интеграции и прислать скриншот?', source: 'template' },
      { id: 'i2', label: 'API ключи', text: 'Проверьте, пожалуйста, актуальность API ключей в настройках интеграции.', source: 'template' },
    ],
    billing: [
      { id: 'b1', label: 'Проверю оплату', text: 'Сейчас проверю информацию по вашему аккаунту и платежам.', source: 'template' },
      { id: 'b2', label: 'Тарифы', text: 'Подробную информацию о тарифах можете найти в разделе Настройки → Тариф или на сайте delever.uz/pricing', source: 'template' },
    ],
    order: [
      { id: 'o1', label: 'Проверю заказ', text: 'Сейчас проверю статус заказа. Подскажите номер заказа?', source: 'template' },
      { id: 'o2', label: 'Статус заказа', text: 'Заказ находится в обработке. Курьер выйдет в ближайшее время.', source: 'template' },
    ],
    default: [
      { id: 'd1', label: 'Приветствие', text: 'Здравствуйте! Спасибо за обращение. Чем могу помочь?', source: 'template' },
      { id: 'd2', label: 'Уточнение', text: 'Подскажите, пожалуйста, подробнее о вашем вопросе.', source: 'template' },
      { id: 'd3', label: 'Завершение', text: 'Рад был помочь! Если возникнут вопросы - обращайтесь.', source: 'template' },
    ],
  }
  
  return templates[category || 'default'] || templates.default
}
