export type CaseStatus = 'detected' | 'in_progress' | 'waiting' | 'blocked' | 'resolved'
export type CasePriority = 'low' | 'medium' | 'high' | 'critical'

export interface Case {
  id: string
  ticketNumber?: number
  channelId: string
  channelName: string
  companyId: string
  companyName: string
  title: string
  description: string
  status: CaseStatus
  category: string
  priority: CasePriority
  severity: string
  assignedTo: string
  assigneeName: string
  messagesCount: number
  createdAt: string
  updatedAt?: string
  updatedBy?: string
  updatedByName?: string
  resolvedAt: string | null
  sourceMessageId?: string
}

export const CASE_STATUS_CONFIG: Record<CaseStatus, { label: string; color: string; bgColor: string }> = {
  detected: { label: 'Обнаружено', color: 'text-slate-700', bgColor: 'bg-slate-100' },
  in_progress: { label: 'В работе', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  waiting: { label: 'Ожидание', color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  blocked: { label: 'Заблокировано', color: 'text-red-700', bgColor: 'bg-red-100' },
  resolved: { label: 'Решено', color: 'text-green-700', bgColor: 'bg-green-100' },
}

export const CASE_PRIORITY_CONFIG: Record<CasePriority, { label: string; color: string; bgColor: string }> = {
  low: { label: 'Низкий', color: 'text-slate-600', bgColor: 'bg-slate-100' },
  medium: { label: 'Средний', color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  high: { label: 'Высокий', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  critical: { label: 'Критический', color: 'text-red-700', bgColor: 'bg-red-100' },
}

export const KANBAN_STATUSES: CaseStatus[] = ['detected', 'in_progress', 'waiting', 'blocked', 'resolved']
