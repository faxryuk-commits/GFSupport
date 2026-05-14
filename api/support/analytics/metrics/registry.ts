/**
 * Единый реестр всех метрик системы.
 *
 * До этого descriptor + compute + computeBaseline были рассыпаны по трём
 * endpoint-файлам (metric.ts, benchmarks.ts, benchmarks-recompute.ts), и
 * добавить новую метрику = править все три. Теперь — одна точка регистрации.
 *
 * Чтобы добавить метрику:
 *   1. Создать metrics/<key>.ts с descriptor, compute и (опционально) computeBaseline.
 *   2. Добавить запись в METRIC_REGISTRY ниже.
 *   3. Всё — метрика автоматически доступна на /api/.../metric?key=...,
 *      попадает в /api/.../benchmarks (список) и в recompute.
 *
 * computeBaseline опционален: если не задан, baseline считается через
 * generic weekly-percentile стратегию (см. baseline.ts).
 */

import type {
  MetricDescriptor,
  MetricResult,
  MetricScope,
  ResolvedPeriod,
} from './types.js'
import type { BaselineResult } from './baseline.js'

import { frtAvgDescriptor, computeFrtAvg } from './frtAvg.js'
import { computeFrtBaseline } from './baseline.js'
import { slaComplianceDescriptor, computeSlaCompliance } from './slaCompliance.js'
import { sentimentPositiveDescriptor, computeSentimentPositive } from './sentimentPositive.js'
import { repeatContactRateDescriptor, computeRepeatContactRate } from './repeatContactRate.js'

export type MetricComputeFn = (
  scope: MetricScope,
  period: ResolvedPeriod,
) => Promise<MetricResult>

export type BaselineComputeFn = (
  descriptor: MetricDescriptor,
  scope: Pick<MetricScope, 'orgId' | 'market' | 'source' | 'role'>,
  period: ResolvedPeriod,
) => Promise<BaselineResult>

export interface MetricEntry {
  descriptor: MetricDescriptor
  compute: MetricComputeFn
  /**
   * Метрика-специфичная стратегия baseline'а. Если не задана, baseline
   * считается через generic weekly-percentile (compute поверх каждой недели
   * исторического окна).
   */
  computeBaseline?: BaselineComputeFn
}

export const METRIC_REGISTRY: Record<string, MetricEntry> = {
  [frtAvgDescriptor.key]: {
    descriptor: frtAvgDescriptor,
    compute: computeFrtAvg,
    computeBaseline: computeFrtBaseline,
  },
  [slaComplianceDescriptor.key]: {
    descriptor: slaComplianceDescriptor,
    compute: computeSlaCompliance,
    // baseline через weekly-percentile (по умолчанию)
  },
  [sentimentPositiveDescriptor.key]: {
    descriptor: sentimentPositiveDescriptor,
    compute: computeSentimentPositive,
  },
  [repeatContactRateDescriptor.key]: {
    descriptor: repeatContactRateDescriptor,
    compute: computeRepeatContactRate,
  },
}

export const ALL_METRIC_KEYS = Object.keys(METRIC_REGISTRY)
