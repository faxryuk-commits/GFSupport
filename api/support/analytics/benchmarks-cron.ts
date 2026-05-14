/**
 * Cron endpoint для автоматического пересчёта бенчмарков.
 *
 * GET /api/support/analytics/benchmarks-cron?secret=<CRON_SECRET>
 *
 * Запускается раз в неделю Vercel cron'ом (см. vercel.json).
 * Итерирует все организации в таблице organizations и для каждой
 * пересчитывает baseline'ы по всем метрикам в METRIC_REGISTRY.
 *
 * Безопасно запускать многократно — upsert по уникальному индексу.
 * Если в БД уже есть ручные стрейч-таргеты (source_type='manual'),
 * они перезатрутся — это известный compromise, см. baseline.ts.
 */

import { getSQL, json, corsHeaders } from '../lib/db.js'
import { ensureBenchmarkTable } from '../lib/ensure-taxonomy.js'
import {
  METRIC_REGISTRY,
  computeWeeklyPercentileBaseline,
  resolvePeriod,
  upsertBaselines,
} from './metrics/index.js'

export const config = {
  runtime: 'edge',
  maxDuration: 300,
}

const SCOPE_VARIANTS: Array<{ source: string | null; label: string }> = [
  { source: null, label: 'global' },
  { source: 'telegram', label: 'telegram' },
  { source: 'whatsapp', label: 'whatsapp' },
]

const HISTORICAL_DAYS = 60
const PERIOD_TYPE: 'monthly' = 'monthly'

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const url = new URL(req.url)
  const querySecret = url.searchParams.get('secret') || ''
  const auth = req.headers.get('Authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const expected = process.env.CRON_SECRET || ''
  const allowed = !!expected && (querySecret === expected || bearer === expected)
  // В dev/legacy env, если CRON_SECRET не задан, разрешаем — но логируем
  const allowOpen = !expected
  if (!allowed && !allowOpen) {
    return json({ error: 'Unauthorized: cron secret mismatch' }, 401)
  }

  await ensureBenchmarkTable()
  const sql = getSQL()
  const now = new Date()
  const period = resolvePeriod({
    from: new Date(now.getTime() - HISTORICAL_DAYS * 24 * 60 * 60 * 1000),
    to: now,
    granularity: PERIOD_TYPE,
  })

  // Все активные org'и. Если organizations пустая (legacy single-tenant без
  // регистрации), берём org_id из support_channels как fallback.
  let orgs: string[] = []
  try {
    const rows = (await sql`
      SELECT id FROM organizations
    `) as Array<{ id: string }>
    orgs = rows.map((r) => r.id)
  } catch {
    // Таблица organizations может отсутствовать на старых деплоях — игнорируем.
  }
  if (orgs.length === 0) {
    const rows = (await sql`
      SELECT DISTINCT org_id FROM support_channels WHERE org_id IS NOT NULL
    `) as Array<{ org_id: string }>
    orgs = rows.map((r) => r.org_id).filter(Boolean)
  }

  const perOrg: Array<{
    orgId: string
    summary: Array<{
      metric: string
      scope: string
      observations: number
      reason: string
      bronze?: number
      silver?: number
      gold?: number
    }>
  }> = []

  for (const orgId of orgs) {
    const summary: typeof perOrg[number]['summary'] = []
    for (const [key, entry] of Object.entries(METRIC_REGISTRY)) {
      for (const variant of SCOPE_VARIANTS) {
        try {
          const scope = { orgId, market: null, source: variant.source, role: null }
          const baseline = entry.computeBaseline
            ? await entry.computeBaseline(entry.descriptor, scope, period)
            : await computeWeeklyPercentileBaseline(entry.descriptor, scope, period, entry.compute)
          await upsertBaselines(orgId, baseline, PERIOD_TYPE, now)
          summary.push({
            metric: key,
            scope: variant.label,
            observations: baseline.observations,
            reason: baseline.reason,
            bronze: baseline.bronze,
            silver: baseline.silver,
            gold: baseline.gold,
          })
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'Unknown error'
          summary.push({
            metric: key,
            scope: variant.label,
            observations: 0,
            reason: `error: ${msg}`,
          })
        }
      }
    }
    perOrg.push({ orgId, summary })
  }

  return json({
    ranAt: now.toISOString(),
    period: { from: period.from.toISOString(), to: period.to.toISOString(), days: HISTORICAL_DAYS },
    orgsProcessed: orgs.length,
    results: perOrg,
  })
}
