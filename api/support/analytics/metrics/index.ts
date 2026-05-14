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
