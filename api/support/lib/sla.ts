import { getSQL } from './db.js'

export interface SlaConfig {
  // В минутах
  targetResponseTime: number // SLA первого ответа
  targetResolutionTime: number // SLA разрешения
  slaTarget: number // % целевой выполненности (99%)
  // Рабочие часы — часы в tz компании
  workingHoursStart: number // 0..23
  workingHoursEnd: number // 0..23 (exclusive)
  // Рабочие дни недели, 0=Sun..6=Sat
  workingDays: number[]
  // Минутный оффсет tz (например UTC+5 = +300). Используется для конвертации UTC→локальное время
  timezoneOffsetMin: number
}

const DEFAULTS: SlaConfig = {
  targetResponseTime: 5,
  targetResolutionTime: 60,
  slaTarget: 99,
  workingHoursStart: 9,
  workingHoursEnd: 18,
  workingDays: [1, 2, 3, 4, 5], // Mon..Fri
  timezoneOffsetMin: 5 * 60, // UTC+5 (Tashkent / Almaty)
}

const DAY_MAP: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  воскресенье: 0, понедельник: 1, вторник: 2, среда: 3, четверг: 4, пятница: 5, суббота: 6,
}

const slaCache = new Map<string, { cfg: SlaConfig; ts: number }>()
const CACHE_TTL = 30_000

export async function loadSla(orgId: string): Promise<SlaConfig> {
  const cached = slaCache.get(orgId)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.cfg

  const sql = getSQL()
  let rows: any[] = []
  try {
    rows = await sql`
      SELECT key, value FROM support_settings
      WHERE org_id = ${orgId}
        AND key IN (
          'targetResponseTime', 'targetResolutionTime', 'slaTarget',
          'workingHoursStart', 'workingHoursEnd', 'workingDays',
          'working_hours_start', 'working_hours_end',
          'timezone'
        )
    `
  } catch {
    rows = []
  }

  const raw: Record<string, string> = {}
  for (const r of rows) raw[r.key] = r.value

  const cfg: SlaConfig = {
    targetResponseTime: parseNumber(raw.targetResponseTime, DEFAULTS.targetResponseTime),
    targetResolutionTime: parseNumber(raw.targetResolutionTime, DEFAULTS.targetResolutionTime),
    slaTarget: parseNumber(raw.slaTarget, DEFAULTS.slaTarget),
    workingHoursStart: parseHour(raw.workingHoursStart ?? raw.working_hours_start, DEFAULTS.workingHoursStart),
    workingHoursEnd: parseHour(raw.workingHoursEnd ?? raw.working_hours_end, DEFAULTS.workingHoursEnd),
    workingDays: parseWorkingDays(raw.workingDays, DEFAULTS.workingDays),
    timezoneOffsetMin: parseTimezone(raw.timezone, DEFAULTS.timezoneOffsetMin),
  }

  // Sanity-check: если start >= end, дефолтимся
  if (cfg.workingHoursEnd <= cfg.workingHoursStart) {
    cfg.workingHoursStart = DEFAULTS.workingHoursStart
    cfg.workingHoursEnd = DEFAULTS.workingHoursEnd
  }
  if (cfg.workingDays.length === 0) cfg.workingDays = DEFAULTS.workingDays

  slaCache.set(orgId, { cfg, ts: Date.now() })
  return cfg
}

function parseNumber(v: string | null | undefined, fallback: number): number {
  if (!v) return fallback
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function parseHour(v: string | null | undefined, fallback: number): number {
  if (!v) return fallback
  // '09:00' или '9' или 9
  const str = String(v).trim()
  if (/^\d{1,2}$/.test(str)) {
    const n = parseInt(str, 10)
    return n >= 0 && n <= 23 ? n : fallback
  }
  const m = str.match(/^(\d{1,2}):(\d{2})$/)
  if (m) {
    const h = parseInt(m[1], 10)
    return h >= 0 && h <= 23 ? h : fallback
  }
  return fallback
}

function parseWorkingDays(v: string | null | undefined, fallback: number[]): number[] {
  if (!v) return fallback
  let arr: unknown
  try {
    arr = JSON.parse(v)
  } catch {
    arr = String(v).split(/[\s,]+/).filter(Boolean)
  }
  if (!Array.isArray(arr)) return fallback
  const out: number[] = []
  for (const item of arr) {
    if (typeof item === 'number' && item >= 0 && item <= 6) {
      out.push(item)
    } else if (typeof item === 'string') {
      const key = item.trim().toLowerCase()
      if (key in DAY_MAP) out.push(DAY_MAP[key])
    }
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

function parseTimezone(v: string | null | undefined, fallback: number): number {
  if (!v) return fallback
  // 'UTC+5', 'UTC-3:30', '+5', '5'
  const s = String(v).trim().replace(/^utc/i, '')
  const m = s.match(/^([+-]?\d{1,2})(?::(\d{2}))?$/)
  if (!m) return fallback
  const hours = parseInt(m[1], 10)
  const minutes = m[2] ? parseInt(m[2], 10) : 0
  const sign = hours < 0 ? -1 : 1
  return sign * (Math.abs(hours) * 60 + minutes)
}

/**
 * Считает рабочие минуты между двумя timestamp'ами.
 * from / to — ISO строки или Date в UTC.
 * Рабочие часы и дни берутся из cfg, привязка к tz компании через timezoneOffsetMin.
 *
 * Алгоритм: итерируемся по дням от from до to, для каждого дня пересекаем
 * рабочее окно в локальном времени с отрезком [from, to]. Шаг — сутки.
 * Для диапазонов до года — достаточно быстро.
 */
export function businessMinutesBetween(
  from: Date | string,
  to: Date | string,
  cfg: SlaConfig,
): number {
  const fromDate = typeof from === 'string' ? new Date(from) : from
  const toDate = typeof to === 'string' ? new Date(to) : to
  if (!(fromDate instanceof Date) || isNaN(fromDate.getTime())) return 0
  if (!(toDate instanceof Date) || isNaN(toDate.getTime())) return 0
  if (toDate.getTime() <= fromDate.getTime()) return 0

  const offsetMs = cfg.timezoneOffsetMin * 60_000

  // Переводим в локальное время: "смещённый UTC"
  const fromLocal = new Date(fromDate.getTime() + offsetMs)
  const toLocal = new Date(toDate.getTime() + offsetMs)

  const dayMs = 86_400_000

  // Итерация от начала дня fromLocal до toLocal
  let cursor = Date.UTC(
    fromLocal.getUTCFullYear(),
    fromLocal.getUTCMonth(),
    fromLocal.getUTCDate(),
  )
  const stop = Date.UTC(
    toLocal.getUTCFullYear(),
    toLocal.getUTCMonth(),
    toLocal.getUTCDate(),
  )

  // Safety cap: не более 366 дней
  let safety = 366
  let totalMinutes = 0

  while (cursor <= stop && safety-- > 0) {
    const dayStart = new Date(cursor)
    const dayOfWeek = dayStart.getUTCDay()
    if (cfg.workingDays.includes(dayOfWeek)) {
      const windowStart = cursor + cfg.workingHoursStart * 3_600_000
      const windowEnd = cursor + cfg.workingHoursEnd * 3_600_000
      const interStart = Math.max(windowStart, fromLocal.getTime())
      const interEnd = Math.min(windowEnd, toLocal.getTime())
      if (interEnd > interStart) {
        totalMinutes += (interEnd - interStart) / 60_000
      }
    }
    cursor += dayMs
  }

  return Math.round(totalMinutes * 100) / 100
}

/**
 * true, если timestamp находится в рабочем окне (сейчас обычно использование = "в данный момент").
 */
export function isWithinWorkingHours(at: Date | string, cfg: SlaConfig): boolean {
  const d = typeof at === 'string' ? new Date(at) : at
  if (!(d instanceof Date) || isNaN(d.getTime())) return false
  const local = new Date(d.getTime() + cfg.timezoneOffsetMin * 60_000)
  const dow = local.getUTCDay()
  if (!cfg.workingDays.includes(dow)) return false
  const h = local.getUTCHours()
  return h >= cfg.workingHoursStart && h < cfg.workingHoursEnd
}

export function invalidateSlaCache(orgId?: string) {
  if (orgId) slaCache.delete(orgId)
  else slaCache.clear()
}
