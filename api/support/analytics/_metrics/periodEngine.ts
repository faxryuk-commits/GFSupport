/**
 * Единый разрешатель периодов для всей аналитики.
 *
 * До этого 4+ файлов независимо парсили `period=today|week|...` с разной
 * семантикой («сегодня» иногда rolling 24h, иногда календарные сутки), часть
 * запросов жила в UTC, часть в Asia/Tashkent. Это приводило к тому, что один
 * «период 7d» давал разные числа на разных страницах.
 *
 * Здесь всё нормализуется в [from, to] в Asia/Tashkent.
 * Календарные единицы («сегодня», «вчера», «эта неделя», «этот месяц») рисуют
 * границу по полуночи Tashkent. Rolling-окна («7d», «30d») рисуют от now.
 */

import type { ResolvedPeriod } from './types.js'

const TZ = 'Asia/Tashkent'
const TZ_OFFSET_MIN = 5 * 60 // UTC+5, без DST

/** Сырой инпут периода: строка-пресет или явные границы. */
export type PeriodInput =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | '7d'
  | '30d'
  | '90d'
  | { from: string | Date; to: string | Date; granularity?: 'daily' | 'weekly' | 'monthly' }

/** Текущее «сейчас» в Tashkent — как локальное Date, представляющее Tashkent-время. */
function nowInTashkent(): Date {
  const utc = new Date()
  return new Date(utc.getTime() + TZ_OFFSET_MIN * 60 * 1000)
}

/** Календарная полночь в Tashkent для даты (которая интерпретируется как Tashkent-локальная). */
function startOfDayTashkent(d: Date): Date {
  const t = new Date(d)
  t.setUTCHours(0, 0, 0, 0)
  // d уже в Tashkent-локали (offset уже прибавлен). startOfDay тоже в Tashkent.
  return t
}

/** Конец дня в Tashkent — 23:59:59.999. */
function endOfDayTashkent(d: Date): Date {
  const t = new Date(d)
  t.setUTCHours(23, 59, 59, 999)
  return t
}

/** Прибавить дни (без учёта DST, что для +05 без DST безопасно). */
function addDays(d: Date, n: number): Date {
  const t = new Date(d)
  t.setUTCDate(t.getUTCDate() + n)
  return t
}

/** День недели по Tashkent: 0=Вс, 1=Пн, ..., 6=Сб. */
function dowTashkent(d: Date): number {
  return d.getUTCDay()
}

/** Перевести Tashkent-локальное Date обратно в UTC (для SQL `::timestamptz`). */
function tashkentToUtc(d: Date): Date {
  return new Date(d.getTime() - TZ_OFFSET_MIN * 60 * 1000)
}

/** Russian short label для месяца. */
const MONTHS_RU = [
  'Янв',
  'Фев',
  'Мар',
  'Апр',
  'Май',
  'Июн',
  'Июл',
  'Авг',
  'Сен',
  'Окт',
  'Ноя',
  'Дек',
]

export function resolvePeriod(input: PeriodInput): ResolvedPeriod {
  const nowTz = nowInTashkent()

  if (typeof input === 'object') {
    const from = typeof input.from === 'string' ? new Date(input.from) : input.from
    const to = typeof input.to === 'string' ? new Date(input.to) : input.to
    return {
      from,
      to,
      granularity: input.granularity || 'daily',
      label: 'Произвольный период',
    }
  }

  switch (input) {
    case 'today': {
      const from = startOfDayTashkent(nowTz)
      const to = endOfDayTashkent(nowTz)
      return {
        from: tashkentToUtc(from),
        to: tashkentToUtc(to),
        granularity: 'daily',
        label: 'Сегодня',
      }
    }
    case 'yesterday': {
      const y = addDays(nowTz, -1)
      const from = startOfDayTashkent(y)
      const to = endOfDayTashkent(y)
      return {
        from: tashkentToUtc(from),
        to: tashkentToUtc(to),
        granularity: 'daily',
        label: 'Вчера',
      }
    }
    case 'this_week': {
      // Понедельник этой недели в Tashkent.
      const dow = dowTashkent(nowTz) // 0=Вс
      const daysSinceMon = (dow + 6) % 7 // 0 если Пн, 6 если Вс
      const monday = startOfDayTashkent(addDays(nowTz, -daysSinceMon))
      const to = endOfDayTashkent(nowTz)
      return {
        from: tashkentToUtc(monday),
        to: tashkentToUtc(to),
        granularity: 'weekly',
        label: 'Эта неделя',
      }
    }
    case 'last_week': {
      const dow = dowTashkent(nowTz)
      const daysSinceMon = (dow + 6) % 7
      const thisMon = startOfDayTashkent(addDays(nowTz, -daysSinceMon))
      const lastMon = addDays(thisMon, -7)
      const lastSun = endOfDayTashkent(addDays(thisMon, -1))
      return {
        from: tashkentToUtc(lastMon),
        to: tashkentToUtc(lastSun),
        granularity: 'weekly',
        label: 'Прошлая неделя',
      }
    }
    case 'this_month': {
      const from = new Date(nowTz)
      from.setUTCDate(1)
      const fromStart = startOfDayTashkent(from)
      const to = endOfDayTashkent(nowTz)
      return {
        from: tashkentToUtc(fromStart),
        to: tashkentToUtc(to),
        granularity: 'monthly',
        label: `${MONTHS_RU[nowTz.getUTCMonth()]} ${nowTz.getUTCFullYear()}`,
      }
    }
    case 'last_month': {
      const firstOfThis = new Date(nowTz)
      firstOfThis.setUTCDate(1)
      const lastMonthEnd = endOfDayTashkent(addDays(firstOfThis, -1))
      const lastMonthStart = new Date(lastMonthEnd)
      lastMonthStart.setUTCDate(1)
      const lastMonthStartZeroed = startOfDayTashkent(lastMonthStart)
      return {
        from: tashkentToUtc(lastMonthStartZeroed),
        to: tashkentToUtc(lastMonthEnd),
        granularity: 'monthly',
        label: `${MONTHS_RU[lastMonthEnd.getUTCMonth()]} ${lastMonthEnd.getUTCFullYear()}`,
      }
    }
    case '7d':
    case '30d':
    case '90d': {
      const days = input === '7d' ? 7 : input === '30d' ? 30 : 90
      const to = nowTz
      const from = addDays(nowTz, -days)
      return {
        from: tashkentToUtc(from),
        to: tashkentToUtc(to),
        granularity: days <= 7 ? 'daily' : days <= 30 ? 'weekly' : 'monthly',
        label: `За ${days} дней`,
      }
    }
  }
}

/** Удобный сериализатор в ISO-строку для SQL `::timestamptz`. */
export function periodToSqlBounds(p: ResolvedPeriod): { fromISO: string; toISO: string } {
  return {
    fromISO: p.from.toISOString(),
    toISO: p.to.toISOString(),
  }
}

/** Парс query-параметра `?period=...`. Принимает старые алиасы (`week`, `month`). */
export function parsePeriodParam(raw: string | null | undefined): PeriodInput {
  if (!raw) return '30d'
  const v = raw.toLowerCase().trim()
  if (v === 'today' || v === 'yesterday') return v
  if (v === 'this_week' || v === 'week') return 'this_week'
  if (v === 'last_week') return 'last_week'
  if (v === 'this_month' || v === 'month') return 'this_month'
  if (v === 'last_month') return 'last_month'
  if (v === '7d' || v === '30d' || v === '90d') return v
  return '30d'
}
