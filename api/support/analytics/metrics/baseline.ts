/**
 * Расчёт перцентильных baseline'ов для метрик.
 *
 * Семантика:
 *   - Берём наблюдения за исторический период (по умолчанию последние 60 дней).
 *   - Для perAgent-метрик: значение метрики у каждого агента → распределение по агентам.
 *   - Для team-level метрик: значение метрики на каждой неделе → распределение по времени.
 *   - p25/p50/p75 → bronze/silver/gold (для lower_better)
 *                 → gold/silver/bronze (для higher_better)
 *
 * Минимальные требования для записи baseline:
 *   - У каждого агента (или окна) sample_size >= MIN_SAMPLE_PER_OBSERVATION
 *   - Всего наблюдений >= MIN_OBSERVATIONS (иначе перцентили шумные)
 *
 * Если требования не выполнены — baseline НЕ пишется в benchmark_targets,
 * возвращается reason='insufficient_data'.
 */

import { getSQL } from '../../lib/db.js'
import type { MetricDescriptor, MetricScope, ResolvedPeriod } from './types.js'

const MIN_SAMPLE_PER_OBSERVATION = 5
const MIN_OBSERVATIONS = 3

export interface BaselineResult {
  metricKey: string
  scope: { market: string | null; source: string | null; role: string | null }
  observations: number
  reason: 'ok' | 'insufficient_data' | 'no_data'
  bronze?: number
  silver?: number
  gold?: number
  rawValues?: number[]
}

interface AgentFrtRow {
  agent_id: string
  avg_minutes: string | number
  sample_size: string | number
}

/**
 * Считает значение FRT на агента за период.
 * Используется ТОЛЬКО для расчёта baseline'ов — не для прямого отображения.
 *
 * Возвращает массив (agent_id, avg_minutes, sample_size) для всех агентов
 * с sample_size >= MIN_SAMPLE_PER_OBSERVATION.
 */
async function computeFrtPerAgent(
  orgId: string,
  period: ResolvedPeriod,
  market: string | null,
  source: string,
): Promise<AgentFrtRow[]> {
  const sql = getSQL()
  const fromISO = period.from.toISOString()
  const toISO = period.to.toISOString()

  const rows = (await sql`
    WITH all_msgs AS (
      SELECT
        m.id, m.channel_id, m.created_at, m.sender_role, m.is_from_client, m.text_content,
        LAG(m.sender_role) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) AS prev_role,
        LAG(m.is_from_client) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) AS prev_is_client
      FROM support_messages m
      JOIN support_channels c ON c.id = m.channel_id
      WHERE m.org_id = ${orgId}
        AND m.created_at >= ${fromISO}::timestamptz - INTERVAL '24 hours'
        AND m.created_at <= ${toISO}::timestamptz
        AND (${market}::text IS NULL OR c.market_id = ${market})
        AND (${source}::text = 'all' OR COALESCE(c.source, 'telegram') = ${source})
    ),
    session_starts AS (
      SELECT id, channel_id, created_at
      FROM all_msgs
      WHERE is_from_client = true
        AND sender_role = 'client'
        AND created_at >= ${fromISO}::timestamptz
        AND (
          prev_role IS NULL
          OR prev_role IN ('support','team','agent')
          OR prev_is_client = false
        )
        AND NOT (
          COALESCE(LENGTH(text_content), 0) <= 50
          AND LOWER(COALESCE(text_content, '')) ~ '(^|\s)(хоп|ок|окей|рахмат|спасибо|тушунарли|хорошо|понял|ладно|rahmat|ok|okay|tushunarli|hop|болди|да|нет|йук|ха|понятно|good|thanks|thank you|hozir|тушундим)(\s|$)'
        )
    ),
    first_responder AS (
      SELECT
        ss.id AS session_id,
        ss.created_at AS client_at,
        (
          SELECT m2.created_at
          FROM support_messages m2
          LEFT JOIN support_agents a ON (
            a.telegram_id::text = m2.sender_id::text
            OR a.id::text = m2.sender_id::text
            OR (m2.sender_username IS NOT NULL AND LOWER(a.username) = LOWER(m2.sender_username))
            OR (m2.sender_name IS NOT NULL AND LOWER(a.name) = LOWER(m2.sender_name))
          ) AND a.org_id = ${orgId}
          WHERE m2.org_id = ${orgId}
            AND m2.channel_id = ss.channel_id
            AND m2.is_from_client = false
            AND m2.sender_role IN ('support','team','agent')
            AND m2.created_at > ss.created_at
            AND m2.created_at <= ss.created_at + INTERVAL '4 hours'
          ORDER BY m2.created_at ASC
          LIMIT 1
        ) AS response_at,
        (
          SELECT a.id::text
          FROM support_messages m2
          JOIN support_agents a ON (
            a.telegram_id::text = m2.sender_id::text
            OR a.id::text = m2.sender_id::text
            OR (m2.sender_username IS NOT NULL AND LOWER(a.username) = LOWER(m2.sender_username))
            OR (m2.sender_name IS NOT NULL AND LOWER(a.name) = LOWER(m2.sender_name))
          ) AND a.org_id = ${orgId}
          WHERE m2.org_id = ${orgId}
            AND m2.channel_id = ss.channel_id
            AND m2.is_from_client = false
            AND m2.sender_role IN ('support','team','agent')
            AND m2.created_at > ss.created_at
            AND m2.created_at <= ss.created_at + INTERVAL '4 hours'
          ORDER BY m2.created_at ASC
          LIMIT 1
        ) AS responder_agent_id
      FROM session_starts ss
    )
    SELECT
      responder_agent_id AS agent_id,
      ROUND(AVG(EXTRACT(EPOCH FROM (response_at - client_at)) / 60.0)::numeric, 1) AS avg_minutes,
      COUNT(*)::int AS sample_size
    FROM first_responder
    WHERE response_at IS NOT NULL
      AND responder_agent_id IS NOT NULL
    GROUP BY responder_agent_id
    HAVING COUNT(*) >= ${MIN_SAMPLE_PER_OBSERVATION}
  `) as AgentFrtRow[]

  return rows
}

/** Перцентиль массива чисел (значения должны быть отсортированы по возрастанию). */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN
  if (sortedAsc.length === 1) return sortedAsc[0]
  const idx = (sortedAsc.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedAsc[lo]
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo)
}

/**
 * Считает baseline для FRT в данном scope. Возвращает значения p25/p50/p75
 * без записи в БД (это делает upsertBaselines).
 */
export async function computeFrtBaseline(
  descriptor: MetricDescriptor,
  scope: Pick<MetricScope, 'orgId' | 'market' | 'source' | 'role'>,
  period: ResolvedPeriod,
): Promise<BaselineResult> {
  const market = scope.market ?? null
  const source = scope.source && scope.source !== 'all' ? scope.source : 'all'
  const rows = await computeFrtPerAgent(scope.orgId, period, market, source)

  const baseScope = {
    market: scope.market ?? null,
    source: scope.source ?? null,
    role: scope.role ?? null,
  }

  if (rows.length === 0) {
    return { metricKey: descriptor.key, scope: baseScope, observations: 0, reason: 'no_data' }
  }
  if (rows.length < MIN_OBSERVATIONS) {
    return {
      metricKey: descriptor.key,
      scope: baseScope,
      observations: rows.length,
      reason: 'insufficient_data',
    }
  }

  const values = rows
    .map((r) => (typeof r.avg_minutes === 'string' ? parseFloat(r.avg_minutes) : r.avg_minutes))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)

  const p25 = percentile(values, 0.25)
  const p50 = percentile(values, 0.5)
  const p75 = percentile(values, 0.75)

  // Для lower_better (FRT): лучшее значение = низкое
  //   gold (требовательно)  = p25 (топ-25% агентов укладываются в это и меньше)
  //   silver (медиана)       = p50
  //   bronze (минимум)       = p75 (75% агентов хотя бы так)
  // Для higher_better — инвертируем.
  const isLower = descriptor.direction === 'lower_better'
  return {
    metricKey: descriptor.key,
    scope: baseScope,
    observations: values.length,
    reason: 'ok',
    bronze: isLower ? p75 : p25,
    silver: p50,
    gold: isLower ? p25 : p75,
    rawValues: values,
  }
}

/**
 * Записывает baseline в benchmark_targets (upsert по уникальному индексу).
 * Перцентильные строки идут с source_type='percentile_internal'.
 * Ручные стрейч-цели (source_type='manual') этим методом НЕ перезаписываются —
 * они отдельные строки с другим source_type (для одного и того же
 * (org, metric, scope, period, tier) хранятся ОБЕ; выбор кому верить — на UI).
 *
 * Примечание: текущий уникальный индекс в init.ts не различает source_type,
 * поэтому если manual-строка существует, она будет ПЕРЕЗАПИСАНА перцентильной.
 * Это известный compromise — пока считаем, что percentile_internal безопасно
 * перезаписывать; если в будущем заведём ручные стрейчи, поправим индекс,
 * добавив source_type как часть уникальности.
 */
export async function upsertBaselines(
  orgId: string,
  baseline: BaselineResult,
  periodType: 'daily' | 'weekly' | 'monthly',
  now: Date = new Date(),
): Promise<void> {
  if (baseline.reason !== 'ok' || !baseline.bronze || !baseline.silver || !baseline.gold) return

  const sql = getSQL()
  const computedAt = now.toISOString()
  const tiers: Array<['bronze' | 'silver' | 'gold', number]> = [
    ['bronze', baseline.bronze],
    ['silver', baseline.silver],
    ['gold', baseline.gold],
  ]

  for (const [tier, value] of tiers) {
    const id = `${orgId}_${baseline.metricKey}_${baseline.scope.role || '_'}_${baseline.scope.market || '_'}_${baseline.scope.source || '_'}_${periodType}_${tier}`
    await sql`
      INSERT INTO benchmark_targets (
        id, org_id, metric_key, scope_role, scope_market, scope_source,
        period_type, tier, target_value, source_type, sample_size, computed_at
      ) VALUES (
        ${id}, ${orgId}, ${baseline.metricKey},
        ${baseline.scope.role}, ${baseline.scope.market}, ${baseline.scope.source},
        ${periodType}, ${tier}, ${value},
        'percentile_internal', ${baseline.observations}, ${computedAt}::timestamptz
      )
      ON CONFLICT (org_id, metric_key, COALESCE(scope_role,''), COALESCE(scope_market,''), COALESCE(scope_source,''), period_type, tier)
      DO UPDATE SET
        target_value = EXCLUDED.target_value,
        source_type = EXCLUDED.source_type,
        sample_size = EXCLUDED.sample_size,
        computed_at = EXCLUDED.computed_at
    `
  }
}
