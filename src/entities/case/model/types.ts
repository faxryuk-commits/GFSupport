export type CaseStatus = 'detected' | 'in_progress' | 'waiting' | 'blocked' | 'resolved' | 'closed' | 'cancelled' | 'recurring'
export type CasePriority = 'low' | 'medium' | 'high' | 'urgent' | 'critical'

// Активные статусы для канбана
export const ACTIVE_STATUSES: CaseStatus[] = ['detected', 'in_progress', 'waiting', 'blocked']
// Архивные статусы
export const ARCHIVE_STATUSES: CaseStatus[] = ['resolved', 'closed', 'cancelled']

export interface Case {
  id: string
  ticketNumber?: number
  channelId: string
  channelName?: string
  telegramChatId?: number
  companyId?: string
  companyName: string
  leadId?: string
  title: string
  description: string
  status: CaseStatus
  category: string
  subcategory?: string
  rootCause?: string
  priority: CasePriority
  severity?: string
  assignedTo?: string
  assigneeName?: string
  firstResponseAt?: string
  resolvedAt?: string | null
  resolutionTimeMinutes?: number
  resolutionNotes?: string
  impactMrr?: number
  churnRiskScore?: number
  isRecurring?: boolean
  relatedCaseId?: string
  tags?: string[]
  messagesCount: number
  messageId?: string
  createdAt: string
  updatedAt?: string
  updatedBy?: string
  updatedByName?: string
  sourceMessageId?: string
}

export const CASE_STATUS_CONFIG: Record<CaseStatus, { label: string; color: string; bgColor: string }> = {
  detected: { label: 'Обнаружено', color: 'text-white', bgColor: 'bg-slate-500' },
  in_progress: { label: 'В работе', color: 'text-white', bgColor: 'bg-blue-500' },
  waiting: { label: 'Ожидание', color: 'text-white', bgColor: 'bg-yellow-500' },
  blocked: { label: 'Заблокировано', color: 'text-white', bgColor: 'bg-red-500' },
  resolved: { label: 'Решено', color: 'text-green-800', bgColor: 'bg-green-100' },
  closed: { label: 'Закрыто', color: 'text-slate-600', bgColor: 'bg-slate-200' },
  cancelled: { label: 'Отменено', color: 'text-slate-500', bgColor: 'bg-slate-100' },
  recurring: { label: 'Повторяется', color: 'text-white', bgColor: 'bg-purple-500' },
}

export const CASE_PRIORITY_CONFIG: Record<CasePriority, { label: string; color: string; bgColor: string }> = {
  low: { label: 'Низкий', color: 'text-slate-600', bgColor: 'bg-slate-100' },
  medium: { label: 'Средний', color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  high: { label: 'Высокий', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  urgent: { label: 'Срочный', color: 'text-red-700', bgColor: 'bg-red-100' },
  critical: { label: 'Критический', color: 'text-red-800', bgColor: 'bg-red-200' },
}

export const KANBAN_STATUSES: CaseStatus[] = ['detected', 'in_progress', 'waiting', 'blocked', 'resolved']
