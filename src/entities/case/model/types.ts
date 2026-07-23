export type { Case, CaseStatus, CasePriority } from '@/shared/types'

import type { CaseStatus } from '@/shared/types'

// «Рабочие» статусы (требуют внимания). resolved — особый случай: решённый СЕГОДНЯ
// (Ташкент) кейс остаётся на активной доске в колонке «Решено», ночной крон
// archive-resolved переводит вчерашние resolved → closed. См. isResolvedTodayTashkent.
export const ACTIVE_STATUSES: CaseStatus[] = ['detected', 'in_progress', 'waiting', 'blocked', 'recurring']
export const ARCHIVE_STATUSES: CaseStatus[] = ['closed', 'cancelled']

/** Решён ли кейс сегодня по Ташкенту (UTC+5, без DST). resolvedAt — наивный UTC из БД. */
export function isResolvedTodayTashkent(resolvedAt: string | null | undefined): boolean {
  if (!resolvedAt) return false
  const TZ_OFFSET_MS = 5 * 60 * 60 * 1000
  // Наивные UTC-строки без 'Z' парсим как UTC явно
  const iso = /Z|[+-]\d{2}:?\d{2}$/.test(resolvedAt) ? resolvedAt : resolvedAt.replace(' ', 'T') + 'Z'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  const dayOf = (ms: number) => Math.floor((ms + TZ_OFFSET_MS) / 86400000)
  return dayOf(t) === dayOf(Date.now())
}

/** Кейс на активной доске: рабочий статус ИЛИ решён сегодня. */
export function isOnActiveBoard(status: CaseStatus, resolvedAt?: string | null): boolean {
  if (ACTIVE_STATUSES.includes(status)) return true
  return status === 'resolved' && isResolvedTodayTashkent(resolvedAt)
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

export const CASE_PRIORITY_CONFIG: Record<import('@/shared/types').CasePriority, { label: string; color: string; bgColor: string }> = {
  low: { label: 'Низкий', color: 'text-slate-600', bgColor: 'bg-slate-100' },
  medium: { label: 'Средний', color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  high: { label: 'Высокий', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  urgent: { label: 'Срочный', color: 'text-red-700', bgColor: 'bg-red-100' },
  critical: { label: 'Критический', color: 'text-red-800', bgColor: 'bg-red-200' },
}

// Legacy канбан (5 колонок) — оставлен для совместимости, новый UI использует UI_COLUMNS
export const KANBAN_STATUSES: CaseStatus[] = ['detected', 'in_progress', 'waiting', 'blocked', 'resolved']

// ===== UI-колонки канбана =====
// Blocked — отдельная колонка (важно, чтобы блокеры не терялись).
// Recurring — флаг на карточке (см. isRecurring).

export type UiColumn = 'new' | 'in_progress' | 'waiting' | 'blocked' | 'done'

// Активная доска включает «Решено» — решённые сегодня видны до ночного архивирования.
export const UI_ACTIVE_COLUMNS: UiColumn[] = ['new', 'in_progress', 'waiting', 'blocked', 'done']
export const UI_ALL_COLUMNS: UiColumn[] = ['new', 'in_progress', 'waiting', 'blocked', 'done']

export const UI_COLUMN_CONFIG: Record<UiColumn, { label: string; hint: string; color: string; bgColor: string }> = {
  new:         { label: 'Новые',    hint: 'Ещё никто не взял',           color: 'text-slate-700', bgColor: 'bg-slate-100' },
  in_progress: { label: 'В работе', hint: 'Агент занимается',            color: 'text-white',     bgColor: 'bg-blue-500' },
  waiting:     { label: 'Ожидание', hint: 'Ждём клиента/третью сторону', color: 'text-white',     bgColor: 'bg-yellow-500' },
  blocked:     { label: 'Блокеры',  hint: 'Требуется эскалация',         color: 'text-white',     bgColor: 'bg-red-500' },
  done:        { label: 'Решено',   hint: 'Решено сегодня · завтра уйдёт в архив', color: 'text-green-800', bgColor: 'bg-green-100' },
}

// Маппинг: реальный статус БД → UI-колонка
const STATUS_TO_UI: Record<CaseStatus, UiColumn> = {
  detected:    'new',
  in_progress: 'in_progress',
  recurring:   'in_progress', // показываем флагом «Повтор» на карточке
  blocked:     'blocked',
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
    case 'blocked': return 'blocked'
    case 'done': return 'resolved'
  }
}

export function isActiveCase(status: CaseStatus): boolean {
  return ACTIVE_STATUSES.includes(status)
}
