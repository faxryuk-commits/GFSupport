import type { AnalyticsData, DashboardMetrics } from '@/shared/api'
import type { Channel } from '@/entities/channel'
import type { Agent } from '@/entities/agent'

export interface AIRecommendation {
  id: string
  type: 'warning' | 'success' | 'info' | 'action'
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  action?: { label: string; link: string }
}

export interface ResponseTimeModalData {
  bucket: string
  bucketLabel: string
  count: number
  avgMinutes: number
  color: string
}

export interface AttentionItem {
  id: string
  name: string
  avatar?: string
  waitTime: string
  issue: string
  priority: 'normal' | 'high' | 'urgent'
  type: 'chat' | 'case'
  source?: 'telegram' | 'whatsapp'
}

export interface RecentActivity {
  id: string
  type: 'message' | 'case_resolved' | 'case_created' | 'assignment'
  title: string
  description: string
  time: string
  user?: string
}

export interface DashboardData {
  metrics: DashboardMetrics | null
  analytics: AnalyticsData | null
  channels: Channel[]
  agents: Agent[]
  needsAttention: AttentionItem[]
  recentActivity: RecentActivity[]
  dateRange: string
}

export const categoryLabels: Record<string, string> = {
  technical: 'Техническая проблема',
  integration: 'Интеграция',
  general: 'Общие вопросы',
  complaint: 'Жалоба',
  billing: 'Оплата и биллинг',
  feature_request: 'Запрос функции',
  onboarding: 'Подключение',
  question: 'Вопрос',
  feedback: 'Обратная связь',
  order: 'Заказы',
  delivery: 'Доставка',
  payment: 'Платежи',
  menu: 'Меню',
  app: 'Приложение',
  website: 'Сайт',
  pos: 'POS система',
  aggregator: 'Агрегаторы',
}

export function getCategoryLabel(name: string): string {
  if (!name) return 'Без категории'
  return categoryLabels[name.toLowerCase()] || name
}

export function formatWaitTime(lastMessageAt?: string): string {
  if (!lastMessageAt) return '-'
  const diff = Date.now() - new Date(lastMessageAt).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes}м`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}ч`
  return `${Math.floor(hours / 24)}д`
}
