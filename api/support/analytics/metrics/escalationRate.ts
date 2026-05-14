/**
 * Метрика: escalation rate — доля решений AI-агента, помеченных как
 * «эскалация к человеку».
 *
 * L3 / activity. Это активность AI-агента, не команды поддержки.
 * Низкий escalation_rate = AI справляется самостоятельно, разгружая
 * команду. Высокий = AI часто упирается в неизвестные вопросы и
 * перекидывает их живому агенту.
 *
 * Формула:
 *   escalation_rate = COUNT(action='escalate') / COUNT(*) * 100
 *   по таблице support_agent_decisions за период.
 *
 * direction: lower_better.
 * unit: percent.
 * perAgent: false — это свойство AI, не отдельных команд.
 */

import { getSQL } from '../../lib/db.js'
import { loadBenchmarks, classifyStatus } from './benchmarks.js'
import type { MetricDescriptor, MetricResult, MetricScope, ResolvedPeriod } from './types.js'

export const escalationRateDescriptor: MetricDescriptor = {
  key: 'escalation_rate',
  level: 'activity',
  unit: 'percent',
  direction: 'lower_better',
  labelRu: 'Эскалации AI',
  formulaRu:
    'Доля решений AI-агента с action=escalate из всех решений за период. Меньше = AI справляется без человека.',
  perAgent: false,
}

interface Row {
  total: string | number | null
  escalations: string | number | null
}

export async function computeEscalationRate(
  scope: MetricScope,
  period: ResolvedPeriod,
): Promise<MetricResult> {
  const sql = getSQL()
  const fromISO = period.from.toISOString()
  const toISO = period.to.toISOString()

  // На случай если support_agent_decisions ещё пустая или таблицы нет —
  // .catch(() => []) даёт нулевые значения, и metric вернётся с null value.
  const rows = (await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE action = 'escalate')::int AS escalations
    FROM support_agent_decisions
    WHERE org_id = ${scope.orgId}
      AND created_at >= ${fromISO}::timestamptz
      AND created_at <= ${toISO}::timestamptz
  `.catch(() => [])) as Row[]

  const row = rows[0] || ({} as Row)
  const total = row.total !== null && row.total !== undefined
    ? typeof row.total === 'string' ? parseInt(row.total) : row.total
    : 0
  const escalations = row.escalations !== null && row.escalations !== undefined
    ? typeof row.escalations === 'string' ? parseInt(row.escalations) : row.escalations
    : 0
  const value = total > 0 ? Math.round((escalations / total) * 1000) / 10 : null

  const benchmarks = await loadBenchmarks(
    escalationRateDescriptor.key,
    scope,
    period.granularity,
  )
  const status = classifyStatus(value, escalationRateDescriptor, benchmarks)

  return {
    key: escalationRateDescriptor.key,
    value,
    sampleSize: total,
    benchmarks,
    status,
    period,
  }
}
