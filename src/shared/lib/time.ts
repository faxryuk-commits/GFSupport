/**
 * Общие форматтеры времени и длительностей.
 *
 * Длительности (FRT, время решения) приходят с бэкенда уже в МИНУТАХ,
 * посчитанные в SQL (EXTRACT(EPOCH ...) / 60). Это tz-инвариантно, поэтому
 * здесь просто форматируем число — никаких Date-парсингов наивных UTC-строк.
 */

/** "12 мин" / "1 ч 20 мин" / "2 д 3 ч". null/undefined → "—". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes)) return '—'
  if (minutes < 1) return '< 1 мин'
  if (minutes < 60) return `${Math.round(minutes)} мин`
  const hours = minutes / 60
  if (hours < 24) {
    const h = Math.floor(hours)
    const m = Math.round(minutes % 60)
    return m > 0 ? `${h} ч ${m} мин` : `${h} ч`
  }
  const days = Math.floor(hours / 24)
  const remH = Math.round(hours % 24)
  return remH > 0 ? `${days} д ${remH} ч` : `${days} д`
}

/** "yyyy-mm-dd hh:mm:ss". null/undefined → "—". */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const normalized = /Z|[+-]\d{2}:?\d{2}$/.test(dateStr)
    ? dateStr
    : dateStr.replace(' ', 'T')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return dateStr
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Относительное «N назад» от текущего момента. Пустая строка недопустима → "—". */
export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const diffMs = Date.now() - new Date(dateStr).getTime()
  if (Number.isNaN(diffMs)) return '—'
  const minutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}д назад`
  if (hours > 0) return `${hours}ч назад`
  if (minutes > 0) return `${minutes}м назад`
  return 'только что'
}
