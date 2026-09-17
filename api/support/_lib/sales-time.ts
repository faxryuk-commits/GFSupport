/**
 * Рабочее время команды по странам. Команда распределена: Ташкент и Алматы
 * живут в UTC+5, Баку и Тбилиси — в UTC+4, Бишкек — в UTC+6. «Утро» у
 * задачи и утренняя очередь в боте должны наступать по часам сотрудника,
 * а не Ташкента: у бакинца ташкентские 09:00 — это 08:00, до начала дня.
 */
const MARKET_UTC_OFFSET: Record<string, number> = {
  uz: 5, kz: 5, kg: 6, az: 4, ge: 4, ae: 4, cy: 3,
}

export function utcOffsetFor(market?: string | null): number {
  return MARKET_UTC_OFFSET[String(market || '').toLowerCase()] ?? 5
}

/** Следующее рабочее утро (10:00 по часам страны), не раньше чем завтра. */
export function nextWorkMorning(market?: string | null, from = new Date()): Date {
  const off = utcOffsetFor(market)
  const local = new Date(from.getTime() + off * 3600_000)
  const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1))
  // Воскресенье — не рабочее утро: задача встанет на понедельник
  if (day.getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1)
  return new Date(day.getTime() + (10 - off) * 3600_000)
}

/** Дата «сегодня» по часам страны — YYYY-MM-DD. */
export function localDate(market?: string | null, at = new Date()): string {
  return new Date(at.getTime() + utcOffsetFor(market) * 3600_000).toISOString().slice(0, 10)
}

/** Час по часам страны, 0–23. */
export function localHour(market?: string | null, at = new Date()): number {
  return new Date(at.getTime() + utcOffsetFor(market) * 3600_000).getUTCHours()
}
