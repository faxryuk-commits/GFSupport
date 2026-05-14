/**
 * Endpoint для (пере)расчёта перцентильных baseline'ов.
 *
 * POST /api/support/analytics/benchmarks-recompute
 *   body или query:
 *     metric=frt_avg_minutes  (или 'all' для всех зарегистрированных)
 *     days=60                 (исторический период для baseline; по умолчанию 60)
 *     period_type=monthly     (что считаем — daily/weekly/monthly бенчмарк; по умолчанию monthly)
 *
 * Требует org-admin авторизации.
 *
 * Что делает:
 *   1. Берёт исторический период (последние N дней).
 *   2. Для каждой зарегистрированной метрики и каждого варианта scope
 *      (глобальный + по source telegram/whatsapp), считает baseline.
 *   3. Записывает p25/p50/p75 как gold/silver/bronze в benchmark_targets
 *      с source_type='percentile_internal'.
 *   4. Возвращает summary что было пересчитано.
 *
 * Безопасно запускать многократно — upsert по уникальному индексу.
 */

import { json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import {
  METRIC_REGISTRY,
  computeWeeklyPercentileBaseline,
  resolvePeriod,
  upsertBaselines,
} from './metrics/index.js'

export const config = {
  runtime: 'edge',
  maxDuration: 60,
}

const SCOPE_VARIANTS: Array<{ source: string | null; label: string }> = [
  { source: null, label: 'global' },
  { source: 'telegram', label: 'telegram' },
  { source: 'whatsapp', label: 'whatsapp' },
]

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const ctx = await extractAgentContext(req)
  if (!ctx.orgId || !ctx.isOrgAdmin) {
    return json({ error: 'Org admin required' }, 403)
  }

  const url = new URL(req.url)
  const metricParam = url.searchParams.get('metric') || 'all'
  const days = parseInt(url.searchParams.get('days') || '60', 10)
  const periodTypeParam = url.searchParams.get('period_type') || 'monthly'
  const periodType: 'daily' | 'weekly' | 'monthly' =
    periodTypeParam === 'daily' ? 'daily' : periodTypeParam === 'weekly' ? 'weekly' : 'monthly'

  const metrics = metricParam === 'all' ? Object.keys(METRIC_REGISTRY) : [metricParam]
  for (const key of metrics) {
    if (!METRIC_REGISTRY[key]) return json({ error: `Unknown metric: ${key}` }, 400)
  }

  // Исторический период — последние N дней (произвольный, не календарный).
  const now = new Date()
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const period = resolvePeriod({ from, to: now, granularity: periodType })

  const summary: Array<{
    metric: string
    scope: string
    observations: number
    reason: string
    bronze?: number
    silver?: number
    gold?: number
  }> = []

  for (const key of metrics) {
    const entry = METRIC_REGISTRY[key]
    for (const variant of SCOPE_VARIANTS) {
      try {
        const scope = {
          orgId: ctx.orgId,
          market: null,
          source: variant.source,
          role: null,
        }
        // Если у метрики есть собственный per-agent baseline — используем его.
        // Иначе — generic weekly-percentile.
        const baseline = entry.computeBaseline
          ? await entry.computeBaseline(entry.descriptor, scope, period)
          : await computeWeeklyPercentileBaseline(entry.descriptor, scope, period, entry.compute)
        await upsertBaselines(ctx.orgId, baseline, periodType, now)
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

  return json({
    period: {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      days,
      type: periodType,
    },
    summary,
  })
}
