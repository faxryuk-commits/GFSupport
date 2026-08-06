/**
 * Форматирование дат на бэкенде в единой рабочей таймзоне.
 *
 * Serverless-функции крутятся в UTC, а команды и клиенты живут по Ташкенту:
 * дата в уведомлении, собранная из локального времени процесса, после 19:00 UTC
 * показывала бы вчерашний день. Суточные границы в SQL уже считаются по Ташкенту
 * (архивный крон, аналитика) — здесь то же самое для текста, который видит человек.
 */
export const WORK_TZ = 'Asia/Tashkent'

/** Календарный день в рабочей tz: "2026-08-06". Для сравнения «тот же день?». */
export function workDayKey(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-CA', { timeZone: WORK_TZ })
}

/** "6 авг, 14:32" в рабочей tz. */
export function formatWorkDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: WORK_TZ,
  })
}

/** "6 августа" в рабочей tz. */
export function formatWorkDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: WORK_TZ })
}
