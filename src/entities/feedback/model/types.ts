export interface Feedback {
  id: string
  channelId: string
  channelName?: string
  caseId?: string
  agentId?: string
  agentName?: string
  rating: number  // 1-5
  comment?: string
  tags?: string[]  // quick feedback tags like "fast", "helpful", "knowledgeable"
  respondedAt?: string
  createdAt: string
}

export interface FeedbackStats {
  averageRating: number
  totalFeedback: number
  ratingDistribution: Record<number, number>  // { 1: 5, 2: 3, 3: 10, ... }
  commonTags: Array<{ tag: string; count: number }>
  byAgent: Array<{
    agentId: string
    agentName: string
    averageRating: number
    feedbackCount: number
  }>
  trend: Array<{
    date: string
    averageRating: number
    count: number
  }>
}

// Предустановленные теги для быстрой оценки
export const FEEDBACK_QUICK_TAGS = [
  'fast',
  'helpful',
  'knowledgeable',
  'friendly',
  'professional',
  'slow',
  'unhelpful',
  'rude',
] as const

export type FeedbackQuickTag = typeof FEEDBACK_QUICK_TAGS[number]

export const FEEDBACK_TAG_CONFIG: Record<FeedbackQuickTag, { 
  label: string
  emoji: string
  isPositive: boolean 
}> = {
  fast: { label: 'Быстро', emoji: '⚡', isPositive: true },
  helpful: { label: 'Помогли', emoji: '✅', isPositive: true },
  knowledgeable: { label: 'Компетентно', emoji: '🧠', isPositive: true },
  friendly: { label: 'Дружелюбно', emoji: '😊', isPositive: true },
  professional: { label: 'Профессионально', emoji: '👔', isPositive: true },
  slow: { label: 'Медленно', emoji: '🐢', isPositive: false },
  unhelpful: { label: 'Не помогли', emoji: '❌', isPositive: false },
  rude: { label: 'Грубо', emoji: '😠', isPositive: false },
}

export const RATING_CONFIG: Record<number, { label: string; emoji: string; color: string }> = {
  1: { label: 'Очень плохо', emoji: '😡', color: 'text-red-600' },
  2: { label: 'Плохо', emoji: '😞', color: 'text-orange-600' },
  3: { label: 'Нормально', emoji: '😐', color: 'text-yellow-600' },
  4: { label: 'Хорошо', emoji: '😊', color: 'text-green-500' },
  5: { label: 'Отлично', emoji: '🤩', color: 'text-green-600' },
}

/**
 * Возвращает конфигурацию для рейтинга
 */
export function getRatingConfig(rating: number) {
  return RATING_CONFIG[Math.min(5, Math.max(1, Math.round(rating)))] || RATING_CONFIG[3]
}

/**
 * Форматирует средний рейтинг
 */
export function formatAverageRating(rating: number): string {
  return rating.toFixed(1)
}
