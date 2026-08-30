/**
 * Семантический слой аналитики — entry point.
 *
 * Используйте импорты ТОЛЬКО отсюда. Если в другом файле analytics видите
 * прямой импорт `./metrics/types.js` — это допустимо, но прямой импорт
 * `./metrics/agentJoin.js` минуя index — нет, теряем единый контракт.
 *
 * Каждая конкретная метрика будет добавляться отдельным файлом
 * `metrics/<key>.ts` и реэкспортироваться отсюда. На этом этапе foundation —
 * только инфраструктура, метрик ещё нет.
 */

export * from './types.js'
export {
  resolvePeriod,
  parsePeriodParam,
  periodToSqlBounds,
  type PeriodInput,
} from './periodEngine.js'
export {
  agentMatchOn,
  excludeBroadcast,
  buildMessageFilters,
  type MessageQueryFilters,
} from './agentJoin.js'
export { loadBenchmarks, classifyStatus } from './benchmarks.js'

// Конкретные метрики
export { frtAvgDescriptor, computeFrtAvg, computeFrtAvgPerAgent } from './frtAvg.js'
export type { FrtPerAgentRow, FrtPerAgentResult } from './frtAvg.js'
export {
  slaComplianceDescriptor,
  computeSlaCompliance,
  computeSlaCompliancePerAgent,
} from './slaCompliance.js'
export type { SlaPerAgentRow, SlaPerAgentResult } from './slaCompliance.js'
export { sentimentPositiveDescriptor, computeSentimentPositive } from './sentimentPositive.js'
export { repeatContactRateDescriptor, computeRepeatContactRate } from './repeatContactRate.js'
export { escalationRateDescriptor, computeEscalationRate } from './escalationRate.js'
export { computeCustomerHealth } from './customerHealth.js'
export type { CustomerHealthRow, HealthBand } from './customerHealth.js'

// Реестр + baseline-helpers
export { METRIC_REGISTRY, ALL_METRIC_KEYS } from './registry.js'
export type { MetricEntry } from './registry.js'
export {
  computeFrtBaseline,
  computeWeeklyPercentileBaseline,
  upsertBaselines,
} from './baseline.js'
export type { BaselineResult } from './baseline.js'
