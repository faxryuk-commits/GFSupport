export type { Case, CaseStatus, CasePriority } from '@/shared/types'

import type { CaseStatus } from '@/shared/types'

export const ACTIVE_STATUSES: CaseStatus[] = ['detected', 'in_progress', 'waiting', 'blocked', 'recurring']
export const ARCHIVE_STATUSES: CaseStatus[] = ['resolved', 'closed', 'cancelled']

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

export const CASE_PRIORITY_CONFIG: Record<import('@/shared/types').CasePriority, { label: string; color: string; bgColor: string }> = {
  low: { label: 'Низкий', color: 'text-slate-600', bgColor: 'bg-slate-100' },
  medium: { label: 'Средний', color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  high: { label: 'Высокий', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  urgent: { label: 'Срочный', color: 'text-red-700', bgColor: 'bg-red-100' },
  critical: { label: 'Критический', color: 'text-red-800', bgColor: 'bg-red-200' },
}

// Legacy канбан (5 колонок) — оставлен для совместимости, новый UI использует UI_COLUMNS
export const KANBAN_STATUSES: CaseStatus[] = ['detected', 'in_progress', 'waiting', 'blocked', 'resolved']

// ===== Упрощённые UI-колонки (4 штуки) =====
// recurring / blocked перенесены в флаги на карточке, а не колонки.

export type UiColumn = 'new' | 'in_progress' | 'waiting' | 'done'

export const UI_ACTIVE_COLUMNS: UiColumn[] = ['new', 'in_progress', 'waiting']
export const UI_ALL_COLUMNS: UiColumn[] = ['new', 'in_progress', 'waiting', 'done']

export const UI_COLUMN_CONFIG: Record<UiColumn, { label: string; hint: string; color: string; bgColor: string }> = {
  new:         { label: 'Новые',    hint: 'Ещё никто не взял',        color: 'text-slate-700', bgColor: 'bg-slate-100' },
  in_progress: { label: 'В работе', hint: 'Агент занимается',         color: 'text-white',     bgColor: 'bg-blue-500' },
  waiting:     { label: 'Ожидание', hint: 'Ждём клиента/третью сторону', color: 'text-white',  bgColor: 'bg-yellow-500' },
  done:        { label: 'Закрыто',  hint: 'Решено / закрыто / отменено', color: 'text-green-800', bgColor: 'bg-green-100' },
}

// Маппинг: реальный статус БД → UI-колонка
const STATUS_TO_UI: Record<CaseStatus, UiColumn> = {
  detected:    'new',
  in_progress: 'in_progress',
  recurring:   'in_progress', // показываем флагом
  blocked:     'in_progress', // показываем флагом
  waiting:     'waiting',
  resolved:    'done',
  closed:      'done',
  cancelled:   'done',
}

export function getUiColumn(status: CaseStatus): UiColumn {
  return STATUS_TO_UI[status] ?? 'new'
}

// Дефолтный реальный статус для DnD в UI-колонку
export function uiColumnToDefaultStatus(col: UiColumn): CaseStatus {
  switch (col) {
    case 'new': return 'detected'
    case 'in_progress': return 'in_progress'
    case 'waiting': return 'waiting'
    case 'done': return 'resolved'
  }
}

export function isActiveCase(status: CaseStatus): boolean {
  return ACTIVE_STATUSES.includes(status)
}
