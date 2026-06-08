/**
 * Метрика: среднее время решения кейса/тикета (Resolution Time).
 *
 * L3 / activity.
 *
 * Определение:
 *  - берём кейсы (support_cases), закрытые в периоде (resolved_at в [from, to]);
 *  - resolution_time_minutes проставляется при переводе кейса в resolved/closed
 *    (см. api/support/cases/[id].ts) = resolved_at − created_at в минутах;
 *  - значение метрики = AVG(resolution_time_minutes)/60 → часы;
 *  - меньше = лучше.
 *
 * Источник/рынок фильтруются через канал кейса (support_channels.source/market_id).
 * Per-agent пока не поддержан (кейс не всегда атрибутирован конкретному агенту).
 */

import { getSQL } from '../../lib/db.js'
import { loadBenchmarks, classifyStatus } from './benchmarks.js'
import type {
  MetricDescriptor,
  MetricResult,
  MetricScope,
  ResolvedPeriod,
} from './types.js'

export const resolutionTimeDescriptor: MetricDescriptor = {
  key: 'resolution_time_hours',
  level: 'activity',
  unit: 'hours',
  direction: 'lower_better',
  labelRu: 'Время решения',
  formulaRu:
    'Среднее время от создания кейса до его закрытия (resolved/closed), в часах. Считается по кейсам, закрытым в выбранном периоде.',
  perAgent: false,
}

interface ResRow {
  avg_hours: string | number | null
  sample_size: string | number | null
}

export async function computeResolutionTime(
  scope: MetricScope,
  period: ResolvedPeriod,
): Promise<MetricResult> {
  const sql = getSQL()
  const fromISO = period.from.toISOString()
  const toISO = period.to.toISOString()
  const market = scope.market ?? null
  const source = scope.source && scope.source !== 'all' ? scope.source : 'all'

  const rows = (await sql`
    SELECT
      ROUND(AVG(sc.resolution_time_minutes)::numeric / 60.0, 1) AS avg_hours,
      COUNT(*) FILTER (WHERE sc.resolution_time_minutes IS NOT NULL)::int AS sample_size
    FROM support_cases sc
    LEFT JOIN support_channels c ON c.id = sc.channel_id
    WHERE sc.org_id = ${scope.orgId}
      AND sc.resolved_at >= ${fromISO}::timestamptz
      AND sc.resolved_at <= ${toISO}::timestamptz
      AND sc.resolution_time_minutes IS NOT NULL
      AND sc.resolution_time_minutes >= 0
      AND (${market}::text IS NULL OR c.market_id = ${market})
      AND (${source}::text = 'all' OR COALESCE(c.source, 'telegram') = ${source})
  `) as ResRow[]

  const row = rows[0] || ({} as ResRow)
  const sampleSize =
    row.sample_size !== null && row.sample_size !== undefined
      ? typeof row.sample_size === 'string'
        ? parseInt(row.sample_size)
        : row.sample_size
      : 0
  const value =
    sampleSize > 0 && row.avg_hours !== null && row.avg_hours !== undefined
      ? typeof row.avg_hours === 'string'
        ? parseFloat(row.avg_hours)
        : row.avg_hours
      : null

  const benchmarks = await loadBenchmarks(resolutionTimeDescriptor.key, scope, period.granularity)
  const status = classifyStatus(value, resolutionTimeDescriptor, benchmarks)

  return {
    key: resolutionTimeDescriptor.key,
    value,
    sampleSize,
    benchmarks,
    status,
    period,
  }
}
