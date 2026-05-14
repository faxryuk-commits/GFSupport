/**
 * Загрузка бенчмарков для метрики в данном scope.
 *
 * Логика подбора: ищем строку в benchmark_targets, наиболее точно подходящую
 * по scope. Если есть строка с конкретным market+source — берём её. Иначе с
 * одним из них. Иначе глобальную (NULL+NULL). По tier'ам собираем bronze/silver/gold.
 */

import { getSQL } from '../../lib/db.js'
import type {
  BenchmarkSet,
  BenchmarkTarget,
  MetricDescriptor,
  MetricScope,
  MetricStatus,
  Tier,
} from './types.js'

interface BenchmarkRow {
  metric_key: string
  scope_role: string | null
  scope_market: string | null
  scope_source: string | null
  period_type: string
  tier: string
  target_value: string | number
  source_type: string
  sample_size: number | null
  computed_at: string | null
}

/** Чем специфичнее scope совпадает — тем выше score. Используется для выбора наиболее подходящей строки. */
function scopeScore(row: BenchmarkRow, scope: MetricScope): number {
  let s = 0
  if (row.scope_market && row.scope_market === scope.market) s += 4
  else if (!row.scope_market) s += 1
  else return -1 // market не совпадает — отбрасываем

  if (row.scope_source && row.scope_source === scope.source) s += 4
  else if (!row.scope_source) s += 1
  else return -1

  if (row.scope_role && row.scope_role === scope.role) s += 2
  else if (!row.scope_role) s += 1
  else return -1

  return s
}

function rowToTarget(row: BenchmarkRow): BenchmarkTarget {
  return {
    tier: row.tier as Tier,
    value: typeof row.target_value === 'string' ? parseFloat(row.target_value) : row.target_value,
    source: row.source_type as BenchmarkTarget['source'],
    sampleSize: row.sample_size,
    computedAt: row.computed_at,
  }
}

/** Загрузить полный набор бенчмарков (bronze/silver/gold) для одной метрики в данном scope. */
export async function loadBenchmarks(
  metricKey: string,
  scope: MetricScope,
  periodType: 'daily' | 'weekly' | 'monthly',
): Promise<BenchmarkSet> {
  const sql = getSQL()
  const rows = (await sql`
    SELECT
      metric_key, scope_role, scope_market, scope_source,
      period_type, tier, target_value, source_type, sample_size, computed_at
    FROM benchmark_targets
    WHERE org_id = ${scope.orgId}
      AND metric_key = ${metricKey}
      AND period_type = ${periodType}
  `.catch(() => [])) as BenchmarkRow[]

  const byTier: BenchmarkSet = { bronze: null, silver: null, gold: null }
  for (const tier of ['bronze', 'silver', 'gold'] as const) {
    const candidates = rows
      .filter((r) => r.tier === tier)
      .map((r) => ({ row: r, score: scopeScore(r, scope) }))
      .filter((c) => c.score >= 0)
      .sort((a, b) => b.score - a.score)
    if (candidates.length > 0) {
      byTier[tier] = rowToTarget(candidates[0].row)
    }
  }
  return byTier
}

/**
 * Определить статус значения относительно бенчмарков. Считается на бэке, чтобы
 * фронт не дублировал логику и не разъезжался с правдой.
 *
 * Правило:
 *   higher_better: value >= gold → 'good'; >= silver → 'borderline'; иначе 'bad'.
 *   lower_better:  value <= gold → 'good'; <= silver → 'borderline'; иначе 'bad'.
 *   Если silver/gold нет — 'unknown'.
 */
export function classifyStatus(
  value: number | null,
  descriptor: MetricDescriptor,
  benchmarks: BenchmarkSet,
): MetricStatus {
  if (value === null) return 'unknown'
  const silver = benchmarks.silver?.value ?? null
  const gold = benchmarks.gold?.value ?? null
  if (silver === null && gold === null) return 'unknown'

  if (descriptor.direction === 'higher_better') {
    if (gold !== null && value >= gold) return 'good'
    if (silver !== null && value >= silver) return 'borderline'
    return 'bad'
  } else {
    if (gold !== null && value <= gold) return 'good'
    if (silver !== null && value <= silver) return 'borderline'
    return 'bad'
  }
}
