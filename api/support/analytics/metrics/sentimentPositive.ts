/**
 * Метрика: доля сообщений с положительным sentiment.
 *
 * L2 / indicator — впервые меряем КАЧЕСТВО клиентского опыта, не только
 * активность агента. Это proxy для удовлетворённости покупателей Delever.
 *
 * Формула: positive / scored.
 *   scored = сообщения клиента, на которых ai_sentiment проставлен
 *            (positive / neutral / negative / frustrated).
 *   positive = sentiment = 'positive'.
 *
 * Считается только по клиентским сообщениям (is_from_client = true),
 * поэтому perAgent=false — индикатор работает на уровне канала/команды,
 * не отдельного агента. Можно фильтровать по source / market.
 *
 * Значение в шкале 0..100 (percent). higher_better.
 */

import { getSQL } from '../../lib/db.js'
import { loadBenchmarks, classifyStatus } from './benchmarks.js'
import type { MetricDescriptor, MetricResult, MetricScope, ResolvedPeriod } from './types.js'

export const sentimentPositiveDescriptor: MetricDescriptor = {
  key: 'sentiment_positive_rate',
  level: 'indicator',
  unit: 'percent',
  direction: 'higher_better',
  labelRu: 'Доля позитивных сообщений',
  formulaRu:
    '% сообщений клиента с ai_sentiment = positive из всех оценённых ИИ. Индикатор клиентского опыта.',
  perAgent: false,
}

interface SentimentRow {
  scored: string | number | null
  positive: string | number | null
}

export async function computeSentimentPositive(
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
      COUNT(*) FILTER (WHERE m.ai_sentiment IS NOT NULL)::int AS scored,
      COUNT(*) FILTER (WHERE LOWER(m.ai_sentiment) = 'positive')::int AS positive
    FROM support_messages m
    JOIN support_channels c ON c.id = m.channel_id
    WHERE m.org_id = ${scope.orgId}
      AND m.is_from_client = true
      AND m.created_at >= ${fromISO}::timestamptz
      AND m.created_at <= ${toISO}::timestamptz
      AND (${market}::text IS NULL OR c.market_id = ${market})
      AND (${source}::text = 'all' OR COALESCE(c.source, 'telegram') = ${source})
  `) as SentimentRow[]

  const row = rows[0] || ({} as SentimentRow)
  const scored = row.scored !== null && row.scored !== undefined
    ? typeof row.scored === 'string' ? parseInt(row.scored) : row.scored
    : 0
  const positive = row.positive !== null && row.positive !== undefined
    ? typeof row.positive === 'string' ? parseInt(row.positive) : row.positive
    : 0
  const value = scored > 0 ? Math.round((positive / scored) * 1000) / 10 : null

  const benchmarks = await loadBenchmarks(
    sentimentPositiveDescriptor.key,
    scope,
    period.granularity,
  )
  const status = classifyStatus(value, sentimentPositiveDescriptor, benchmarks)

  return {
    key: sentimentPositiveDescriptor.key,
    value,
    sampleSize: scored,
    benchmarks,
    status,
    period,
  }
}
