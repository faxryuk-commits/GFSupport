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

/**
 * Абсолютные даты показываем в рабочей таймзоне (Ташкент), а не в локали браузера —
 * иначе один и тот же тикет у разных сотрудников «создан» в разные дни.
 */
const WORK_TZ = 'Asia/Tashkent'

/** "06/08/2026". Невалидная/пустая дата → "—". */
export function formatDateDMY(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: WORK_TZ,
  })
}

/** "06/08/2026, 14:32". Невалидная/пустая дата → "—". */
export function formatDateTimeDMY(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: WORK_TZ,
  })
}

/** "14:32" в рабочей tz. Невалидная/пустая дата → "—". */
export function formatTimeHM(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: WORK_TZ })
}

/** Ключ календарного дня в рабочей tz: "2026-08-06". Для группировки событий по датам. */
export function workDayKey(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  // en-CA даёт ISO-подобный порядок yyyy-mm-dd
  return d.toLocaleDateString('en-CA', { timeZone: WORK_TZ })
}

/** Подпись разделителя дня в ленте: «Сегодня», «Вчера» или «6 августа 2026». */
export function formatDayLabel(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '—'
  const key = workDayKey(dateStr)
  const today = workDayKey(new Date().toISOString())
  const yesterday = workDayKey(new Date(Date.now() - 86400000).toISOString())
  if (key === today) return 'Сегодня'
  if (key === yesterday) return 'Вчера'
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: WORK_TZ,
  })
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
