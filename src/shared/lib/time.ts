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

/**
 * Абсолютные даты показываем в ОДНОЙ рабочей таймзоне, а не в локали браузера:
 * команды заходят из разных регионов, и локальное форматирование означало бы,
 * что двое обсуждают один тикет, называя разные числа, а суточные границы в UI
 * расходятся с бэкендом (архив, крон 00:15, аналитика — всё считается по Ташкенту).
 */
export const WORK_TZ = 'Asia/Tashkent'
/** Подпись зоны для тултипов — чтобы дата не читалась как «моё местное время». */
export const WORK_TZ_LABEL = 'Ташкент, UTC+5'

/**
 * Наивный таймстамп из БД ("2026-08-06 09:32:00", без tz) по конвенции хранится в UTC.
 * Без явного маркера зоны JS распарсил бы его как локальное время браузера — поэтому
 * дописываем Z. Строки с Z или ±hh:mm отдаём как есть.
 */
function parseTs(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(dateStr)
  const d = new Date(hasZone ? dateStr : `${dateStr.replace(' ', 'T')}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "06.08.2026, 14:32" в рабочей tz. null/undefined/мусор → "—". */
export function formatDateTime(dateStr: string | null | undefined): string {
  const d = parseTs(dateStr)
  if (!d) return '—'
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: WORK_TZ,
  })
}

/** "06.08.2026, 14:32 (Ташкент, UTC+5)" — для тултипов, где зона должна быть явной. */
export function formatDateTimeWithTz(dateStr: string | null | undefined): string {
  const formatted = formatDateTime(dateStr)
  return formatted === '—' ? formatted : `${formatted} (${WORK_TZ_LABEL})`
}

/** "06.08.2026" в рабочей tz. */
export function formatDateDMY(dateStr: string | null | undefined): string {
  const d = parseTs(dateStr)
  if (!d) return '—'
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: WORK_TZ,
  })
}

/** "14:32" в рабочей tz. */
export function formatTimeHM(dateStr: string | null | undefined): string {
  const d = parseTs(dateStr)
  if (!d) return '—'
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: WORK_TZ })
}

/** "6 авг" в рабочей tz — компактная дата для таблиц, осей графиков, бейджей. */
export function formatDateShort(dateStr: string | null | undefined): string {
  const d = parseTs(dateStr)
  if (!d) return '—'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: WORK_TZ })
}

/** "6 авг, 14:32" в рабочей tz — компактные дата+время. */
export function formatDateTimeShort(dateStr: string | null | undefined): string {
  const d = parseTs(dateStr)
  if (!d) return '—'
  return d.toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: WORK_TZ,
  })
}

/** "6 августа 2026" в рабочей tz. */
export function formatDateFull(dateStr: string | null | undefined): string {
  const d = parseTs(dateStr)
  if (!d) return '—'
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: WORK_TZ,
  })
}

/** Ключ календарного дня в рабочей tz: "2026-08-06". Для группировки событий по датам. */
export function workDayKey(dateStr: string | null | undefined): string | null {
  const d = parseTs(dateStr)
  if (!d) return null
  // en-CA даёт ISO-подобный порядок yyyy-mm-dd
  return d.toLocaleDateString('en-CA', { timeZone: WORK_TZ })
}

/** Сегодняшний календарный день в рабочей tz: "2026-08-06". */
export function todayWorkDayKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: WORK_TZ })
}

/** "пн" — короткий день недели в рабочей tz. */
export function formatWeekdayShort(dateStr: string | null | undefined): string {
  const d = parseTs(dateStr)
  if (!d) return '—'
  return d.toLocaleDateString('ru-RU', { weekday: 'short', timeZone: WORK_TZ })
}

/** "пн, 6 авг 2026" — дата с днём недели, для тултипов графиков. */
export function formatDateWithWeekday(dateStr: string | null | undefined): string {
  const d = parseTs(dateStr)
  if (!d) return '—'
  return d.toLocaleDateString('ru-RU', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: WORK_TZ,
  })
}

/** Подпись разделителя дня в ленте: «Сегодня», «Вчера» или «6 августа 2026». */
export function formatDayLabel(dateStr: string | null | undefined): string {
  const d = parseTs(dateStr)
  if (!d) return '—'
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

/**
 * ──────────────────────────────────────────────────────────────────────────
 * Ввод дат: календарь браузера работает со «стенным временем», а мы храним
 * моменты. Обе функции ниже переводят одно в другое строго через рабочую
 * зону — иначе сейлз в Ташкенте ставит демо на 15:00, а в базу уезжает 10:00.
 */

/** Смещение рабочей зоны в минутах на конкретный момент. */
function workOffsetMinutes(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: WORK_TZ, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).map(p => [p.type, p.value]),
  ) as Record<string, string>
  // «Который час в Ташкенте» минус «который час по UTC» = смещение
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
    +parts.hour === 24 ? 0 : +parts.hour, +parts.minute, +parts.second)
  return Math.round((asUtc - at.getTime()) / 60000)
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Значение из БД → значение для <input type="date|datetime-local">.
 * Пустое или нераспознанное отдаём пустой строкой: календарь молча
 * игнорирует мусор, и поле выглядит сломанным без объяснения.
 */
export function toDateInput(value: string | null | undefined, withTime = false): string {
  const d = parseTs(value)
  if (!d) return ''
  const shifted = new Date(d.getTime() + workOffsetMinutes(d) * 60000)
  const date = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
  return withTime ? `${date}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}` : date
}

/**
 * Значение из календаря → значение для API.
 *
 * Дата остаётся датой: у «Срока действия КП» времени нет и быть не должно.
 * Дата со временем уезжает с явным смещением рабочей зоны, чтобы момент
 * сохранился тем же, каким его выбрал человек.
 */
export function fromDateInput(value: string, withTime = false): string {
  if (!value) return ''
  if (!withTime) return value.slice(0, 10)
  const [datePart, timePart = '00:00'] = value.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  // Смещение берём на выбранный момент, а не на сегодня: страны с переводом
  // часов ещё появятся в списке регионов
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm))
  const off = workOffsetMinutes(new Date(guess.getTime() - workOffsetMinutes(guess) * 60000))
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return `${datePart}T${pad(hh)}:${pad(mm)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}
