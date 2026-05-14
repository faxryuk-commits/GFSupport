/**
 * Client Health Score — композитный индекс на каждого покупателя Delever
 * (один канал = один покупатель).
 *
 * L1 / driver. Это первый уровень, который напрямую отражает «здоровье»
 * клиента: продолжает ли он писать, доволен ли, решаются ли его проблемы.
 * Является proxy для outcome'ов Delever (LTV, retention, recommendability).
 *
 * Формула (значения каждого sub-score в шкале 0..100):
 *
 *   health = activity * 0.35 + sentiment * 0.30 + resolution * 0.20 + churn * 0.15
 *
 *   activity:    100 если ≤2 дней без сообщений, 0 если ≥30 дней
 *                (линейно между ними)
 *   sentiment:   % положительных сообщений клиента из всех оценённых
 *                ИИ за период (positive / scored * 100)
 *   resolution:  % решённых кейсов канала из всех созданных
 *                за период (resolved / total * 100)
 *   churn:       100 если нет churn-сигналов в текстах клиента;
 *                штрафуется по 25 за каждый матч из CHURN_SQL_KEYWORDS,
 *                до нуля при 4+ срабатываниях. Это прямая угроза ухода
 *                («отключаемся», «расторгаем», «uzamiz» и т.п.).
 *
 * Категории:
 *   healthy   — 75..100 (зелёный)
 *   at_risk   — 50..74  (жёлтый)
 *   critical  — 0..49   (красный)
 *
 * Если для канала недостаточно данных по любому из sub-score'ов
 * (sentiment без оценённых сообщений, resolution без кейсов),
 * этот компонент исключается из взвешенного среднего, и веса
 * нормализуются на оставшиеся. Если совсем нет данных — health = null.
 */

import { getSQL } from '../../lib/db.js'
import { CHURN_SQL_KEYWORDS } from '../../lib/churn-signals.js'
import type { ResolvedPeriod } from './types.js'

export type HealthBand = 'healthy' | 'at_risk' | 'critical' | 'unknown'

export interface CustomerHealthRow {
  channelId: string
  channelName: string | null
  source: string
  marketId: string | null
  lastMessageAt: string | null
  daysSinceLastMessage: number | null
  totalMessages: number
  clientMessages: number
  /** Сообщения клиента с проставленным ai_sentiment. */
  scoredMessages: number
  /** Из scoredMessages — позитивных. */
  positiveMessages: number
  /** Из scoredMessages — негативных или frustrated. */
  negativeMessages: number
  totalCases: number
  resolvedCases: number
  openCases: number
  /** Сколько клиентских сообщений матчат CHURN_SQL_KEYWORDS в этом периоде. */
  churnMatches: number
  activityScore: number | null
  sentimentScore: number | null
  resolutionScore: number | null
  churnScore: number
  healthScore: number | null
  band: HealthBand
}

interface RawRow {
  channel_id: string
  channel_name: string | null
  source: string | null
  market_id: string | null
  last_message_at: string | null
  days_silent: string | number | null
  total_messages: string | number
  client_messages: string | number
  scored: string | number
  positive: string | number
  negative: string | number
  total_cases: string | number | null
  resolved_cases: string | number | null
  open_cases: string | number | null
  churn_matches: string | number | null
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  const parsed = parseFloat(String(v))
  return Number.isFinite(parsed) ? parsed : 0
}

function computeActivity(daysSilent: number): number {
  // 100 при ≤2 днях, 0 при ≥30, линейно между.
  if (daysSilent <= 2) return 100
  if (daysSilent >= 30) return 0
  return Math.round(((30 - daysSilent) / (30 - 2)) * 100)
}

function computeChurnScore(matches: number): number {
  if (matches <= 0) return 100
  // Каждое срабатывание -25, до 0. 4+ срабатываний = 0.
  return Math.max(0, 100 - matches * 25)
}

function computeBand(score: number | null): HealthBand {
  if (score === null) return 'unknown'
  if (score >= 75) return 'healthy'
  if (score >= 50) return 'at_risk'
  return 'critical'
}

export async function computeCustomerHealth(
  scope: { orgId: string; market: string | null; source: string | null },
  period: ResolvedPeriod,
): Promise<CustomerHealthRow[]> {
  const sql = getSQL()
  const fromISO = period.from.toISOString()
  const toISO = period.to.toISOString()
  const market = scope.market ?? null
  const source = scope.source && scope.source !== 'all' ? scope.source : 'all'

  const rawRows = (await sql`
    WITH msg_agg AS (
      SELECT
        m.channel_id,
        MAX(m.created_at) AS last_message_at,
        COUNT(*)::int AS total_messages,
        COUNT(*) FILTER (WHERE m.is_from_client = true)::int AS client_messages,
        COUNT(*) FILTER (
          WHERE m.is_from_client = true AND m.ai_sentiment IS NOT NULL
        )::int AS scored,
        COUNT(*) FILTER (
          WHERE m.is_from_client = true AND LOWER(m.ai_sentiment) = 'positive'
        )::int AS positive,
        COUNT(*) FILTER (
          WHERE m.is_from_client = true AND LOWER(m.ai_sentiment) IN ('negative', 'frustrated')
        )::int AS negative,
        COUNT(*) FILTER (
          WHERE m.is_from_client = true
            AND m.text_content IS NOT NULL
            AND m.text_content ~* ANY(${CHURN_SQL_KEYWORDS}::text[])
        )::int AS churn_matches
      FROM support_messages m
      WHERE m.org_id = ${scope.orgId}
        AND m.created_at >= ${fromISO}::timestamptz
        AND m.created_at <= ${toISO}::timestamptz
      GROUP BY m.channel_id
    ),
    case_agg AS (
      SELECT
        channel_id,
        COUNT(*)::int AS total_cases,
        COUNT(*) FILTER (WHERE status IN ('resolved', 'closed'))::int AS resolved_cases,
        COUNT(*) FILTER (
          WHERE status NOT IN ('resolved', 'closed', 'cancelled')
        )::int AS open_cases
      FROM support_cases
      WHERE org_id = ${scope.orgId}
        AND created_at >= ${fromISO}::timestamptz
        AND created_at <= ${toISO}::timestamptz
      GROUP BY channel_id
    )
    SELECT
      c.id AS channel_id,
      c.name AS channel_name,
      COALESCE(c.source, 'telegram') AS source,
      c.market_id,
      ma.last_message_at,
      EXTRACT(EPOCH FROM (NOW() - ma.last_message_at)) / 86400 AS days_silent,
      COALESCE(ma.total_messages, 0) AS total_messages,
      COALESCE(ma.client_messages, 0) AS client_messages,
      COALESCE(ma.scored, 0) AS scored,
      COALESCE(ma.positive, 0) AS positive,
      COALESCE(ma.negative, 0) AS negative,
      COALESCE(ma.churn_matches, 0) AS churn_matches,
      COALESCE(ca.total_cases, 0) AS total_cases,
      COALESCE(ca.resolved_cases, 0) AS resolved_cases,
      COALESCE(ca.open_cases, 0) AS open_cases
    FROM support_channels c
    LEFT JOIN msg_agg ma ON ma.channel_id = c.id
    LEFT JOIN case_agg ca ON ca.channel_id = c.id
    WHERE c.org_id = ${scope.orgId}
      AND COALESCE(c.is_active, true) = true
      AND (${market}::text IS NULL OR c.market_id = ${market})
      AND (${source}::text = 'all' OR COALESCE(c.source, 'telegram') = ${source})
      AND (ma.total_messages > 0 OR ca.total_cases > 0)
  `) as RawRow[]

  return rawRows
    .map((r): CustomerHealthRow => {
      const daysSilent =
        r.days_silent !== null && r.days_silent !== undefined
          ? Math.max(0, num(r.days_silent))
          : null
      const totalMessages = num(r.total_messages)
      const clientMessages = num(r.client_messages)
      const scored = num(r.scored)
      const positive = num(r.positive)
      const negative = num(r.negative)
      const totalCases = num(r.total_cases)
      const resolvedCases = num(r.resolved_cases)
      const openCases = num(r.open_cases)
      const churnMatches = num(r.churn_matches)

      const activityScore = daysSilent !== null ? computeActivity(daysSilent) : null
      const sentimentScore = scored > 0 ? Math.round((positive / scored) * 100) : null
      const resolutionScore =
        totalCases > 0 ? Math.round((resolvedCases / totalCases) * 100) : null
      const churnScoreVal = computeChurnScore(churnMatches)

      // Взвешенное среднее по доступным компонентам.
      // churn — всегда учитывается (отсутствие сигналов = 100, это валидное наблюдение).
      const weights = { activity: 0.35, sentiment: 0.30, resolution: 0.20, churn: 0.15 }
      const components: Array<{ score: number; weight: number }> = []
      if (activityScore !== null) components.push({ score: activityScore, weight: weights.activity })
      if (sentimentScore !== null)
        components.push({ score: sentimentScore, weight: weights.sentiment })
      if (resolutionScore !== null)
        components.push({ score: resolutionScore, weight: weights.resolution })
      components.push({ score: churnScoreVal, weight: weights.churn })

      let healthScore: number | null = null
      if (components.length > 0) {
        const totalWeight = components.reduce((s, c) => s + c.weight, 0)
        const weightedSum = components.reduce((s, c) => s + c.score * c.weight, 0)
        healthScore = Math.round(weightedSum / totalWeight)
      }

      return {
        channelId: r.channel_id,
        channelName: r.channel_name,
        source: r.source || 'telegram',
        marketId: r.market_id,
        lastMessageAt: r.last_message_at,
        daysSinceLastMessage: daysSilent !== null ? Math.round(daysSilent * 10) / 10 : null,
        totalMessages,
        clientMessages,
        scoredMessages: scored,
        positiveMessages: positive,
        negativeMessages: negative,
        totalCases,
        resolvedCases,
        openCases,
        churnMatches,
        activityScore,
        sentimentScore,
        resolutionScore,
        churnScore: churnScoreVal,
        healthScore,
        band: computeBand(healthScore),
      }
    })
    .sort((a, b) => {
      // Сначала проблемные — critical, at_risk, healthy, unknown.
      // Внутри группы — по health asc.
      const bandOrder: Record<HealthBand, number> = { critical: 0, at_risk: 1, healthy: 2, unknown: 3 }
      const bandDelta = bandOrder[a.band] - bandOrder[b.band]
      if (bandDelta !== 0) return bandDelta
      return (a.healthScore ?? 999) - (b.healthScore ?? 999)
    })
}
