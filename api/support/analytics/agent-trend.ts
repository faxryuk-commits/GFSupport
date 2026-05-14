/**
 * Per-agent trend — динамика метрики у конкретного агента по неделям/месяцам.
 *
 * GET /api/support/analytics/agent-trend?agentId=<id>&key=<metric>[&granularity=weekly|monthly][&periods=8][&source=]
 *
 * Что делает:
 *   1. Делит последние N временных окон (8 недель или 6 месяцев) на отрезки.
 *   2. Для каждого окна вызывает entry.compute({orgId, agentId, source}, window).
 *   3. Параллельно по всем окнам (Promise.all) — иначе ~8 SQL запросов
 *      последовательно ≈ 8-15с.
 *   4. Считает trend direction: сравниваем последнюю половину окон со
 *      средним предыдущей половины. Для lower_better/higher_better — разное
 *      направление.
 *   5. Возвращает {descriptor, benchmarks, points, trend, change}.
 *
 * Поддерживается только metric_key для которых perAgent=true (FRT, SLA Compliance).
 */

import { getRequestOrgId } from '../lib/org.js'
import { json } from '../lib/db.js'
import { METRIC_REGISTRY } from './metrics/index.js'
import type { MetricResult, ResolvedPeriod } from './metrics/index.js'

export const config = {
  runtime: 'edge',
  maxDuration: 60,
}

type Granularity = 'weekly' | 'monthly'

interface TrendPoint {
  periodStart: string
  periodEnd: string
  label: string
  value: number | null
  sampleSize: number
  status: MetricResult['status']
}

function buildPeriods(granularity: Granularity, count: number, now: Date): Array<{ from: Date; to: Date; label: string }> {
  const periods: Array<{ from: Date; to: Date; label: string }> = []
  if (granularity === 'weekly') {
    // Последние N полных недель, ПЛЮС текущая (неполная). Окна по 7 дней.
    for (let i = count - 1; i >= 0; i--) {
      const to = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000)
      const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000)
      periods.push({
        from,
        to,
        label: `${from.toISOString().slice(5, 10)}–${to.toISOString().slice(5, 10)}`,
      })
    }
  } else {
    // Последние N календарных месяцев. Каждое окно — с 1-го по 1-е.
    for (let i = count - 1; i >= 0; i--) {
      const ref = new Date(now)
      ref.setUTCMonth(ref.getUTCMonth() - i)
      ref.setUTCDate(1)
      ref.setUTCHours(0, 0, 0, 0)
      const from = new Date(ref)
      const to = new Date(ref)
      to.setUTCMonth(to.getUTCMonth() + 1)
      const monthsRu = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
      periods.push({
        from,
        to,
        label: `${monthsRu[from.getUTCMonth()]} ${from.getUTCFullYear()}`,
      })
    }
  }
  return periods
}

function computeTrend(
  points: TrendPoint[],
  direction: 'higher_better' | 'lower_better',
): { trend: 'improving' | 'stable' | 'declining' | 'insufficient_data'; changePct: number | null } {
  const valid = points.filter((p) => p.value !== null) as Array<TrendPoint & { value: number }>
  if (valid.length < 4) return { trend: 'insufficient_data', changePct: null }

  const half = Math.floor(valid.length / 2)
  const earlier = valid.slice(0, half)
  const later = valid.slice(half)
  const avg = (arr: typeof valid) => arr.reduce((s, p) => s + p.value, 0) / arr.length
  const a = avg(earlier)
  const b = avg(later)
  if (a === 0) return { trend: 'stable', changePct: null }
  const changePct = Math.round(((b - a) / a) * 1000) / 10

  // Порог 10% — изменение в большую/меньшую сторону, чтобы не ловить шум.
  const THRESHOLD = 10
  if (Math.abs(changePct) < THRESHOLD) return { trend: 'stable', changePct }
  const improved = direction === 'lower_better' ? changePct < 0 : changePct > 0
  return { trend: improved ? 'improving' : 'declining', changePct }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const url = new URL(req.url)
  const agentId = url.searchParams.get('agentId')
  const key = url.searchParams.get('key')
  const granularity = (url.searchParams.get('granularity') === 'monthly' ? 'monthly' : 'weekly') as Granularity
  const periodsCount = Math.min(Math.max(parseInt(url.searchParams.get('periods') || '8', 10), 2), 24)
  const source = url.searchParams.get('source')

  if (!key) return json({ error: 'Missing key' }, 400)

  const entry = METRIC_REGISTRY[key]
  if (!entry) return json({ error: `Unknown metric: ${key}`, available: Object.keys(METRIC_REGISTRY) }, 404)
  // agentId опционален: если не задан — считаем тренд для команды целиком
  // (для не-perAgent метрик — сразу team-wide; для perAgent — без фильтра агента).

  const orgId = await getRequestOrgId(req)
  const rawRoles = url.searchParams.get('roles')
  const roles = rawRoles ? rawRoles.split(',').map((r) => r.trim()).filter(Boolean) : null
  const now = new Date()
  const periods = buildPeriods(granularity, periodsCount, now)

  try {
    const results = await Promise.all(
      periods.map(async (p) => {
        const resolved: ResolvedPeriod = {
          from: p.from,
          to: p.to,
          granularity,
          label: p.label,
        }
        try {
          const r = await entry.compute(
            {
              orgId,
              agentId,
              market: null,
              source,
              role: null,
              roles,
            },
            resolved,
          )
          return {
            periodStart: p.from.toISOString(),
            periodEnd: p.to.toISOString(),
            label: p.label,
            value: r.value,
            sampleSize: r.sampleSize,
            status: r.status,
          } as TrendPoint
        } catch (e) {
          console.error('[agent-trend point]', e instanceof Error ? e.message : e)
          return {
            periodStart: p.from.toISOString(),
            periodEnd: p.to.toISOString(),
            label: p.label,
            value: null,
            sampleSize: 0,
            status: 'unknown' as const,
          }
        }
      }),
    )

    // Бенчмарки одни на весь scope — берём из последнего успешного point'а
    // через дополнительный compute на крайнем окне.
    const last = results[results.length - 1]
    let benchmarks = null
    if (last && last.value !== null) {
      try {
        const lastResolved: ResolvedPeriod = {
          from: new Date(last.periodStart),
          to: new Date(last.periodEnd),
          granularity,
          label: last.label,
        }
        const r = await entry.compute(
          { orgId, agentId, market: null, source, role: null, roles },
          lastResolved,
        )
        benchmarks = r.benchmarks
      } catch {}
    }

    const { trend, changePct } = computeTrend(results, entry.descriptor.direction)

    return json(
      {
        agentId: agentId ?? null,
        descriptor: entry.descriptor,
        granularity,
        benchmarks,
        points: results,
        trend,
        changePct,
      },
      200,
      30,
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[agent-trend]', msg, e instanceof Error ? e.stack : undefined)
    return json({ error: msg, where: 'agent-trend' }, 500)
  }
}
