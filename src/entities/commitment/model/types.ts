export type CommitmentStatus = 'pending' | 'completed' | 'overdue' | 'cancelled'
export type CommitmentPriority = 'low' | 'medium' | 'high'

export interface Commitment {
  id: string
  channelId: string
  channelName?: string
  caseId?: string
  messageId?: string
  text: string
  dueDate: string
  status: CommitmentStatus
  assignedTo?: string
  assigneeName?: string
  priority: CommitmentPriority
  completedAt?: string
  notes?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export const COMMITMENT_STATUS_CONFIG: Record<CommitmentStatus, { 
  label: string
  color: string
  bgColor: string 
}> = {
  pending: { label: 'Ожидает', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  completed: { label: 'Выполнено', color: 'text-green-700', bgColor: 'bg-green-100' },
  overdue: { label: 'Просрочено', color: 'text-red-700', bgColor: 'bg-red-100' },
  cancelled: { label: 'Отменено', color: 'text-slate-600', bgColor: 'bg-slate-100' },
}

export const COMMITMENT_PRIORITY_CONFIG: Record<CommitmentPriority, { 
  label: string
  color: string
  bgColor: string 
}> = {
  low: { label: 'Низкий', color: 'text-slate-600', bgColor: 'bg-slate-100' },
  medium: { label: 'Средний', color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  high: { label: 'Высокий', color: 'text-red-700', bgColor: 'bg-red-100' },
}

/**
 * Проверяет, просрочено ли обязательство
 */
export function isCommitmentOverdue(commitment: Commitment): boolean {
  if (commitment.status === 'completed' || commitment.status === 'cancelled') {
    return false
  }
  return new Date(commitment.dueDate) < new Date()
}

/**
 * Возвращает количество дней до/после дедлайна
 */
export function getDaysUntilDue(dueDate: string): number {
  const now = new Date()
  const due = new Date(dueDate)
  const diffTime = due.getTime() - now.getTime()
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}
