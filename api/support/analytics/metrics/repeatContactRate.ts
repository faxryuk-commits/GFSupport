/**
 * Метрика: repeat-contact rate — доля каналов, обратившихся 2+ раза за период.
 *
 * L2 / indicator — proxy для первоконтактного решения (FCR, first-contact
 * resolution). Высокий repeat-rate означает, что клиент не получил полного
 * ответа с первого раза и пришёл снова. Низкий repeat-rate ≈ хорошее
 * качество ответа.
 *
 * Формула:
 *   contacts_per_channel = COUNT(session_starts) GROUP BY channel
 *   repeat_channels      = COUNT(channel WHERE contacts >= 2)
 *   total_channels       = COUNT(channel WHERE contacts >= 1)
 *   repeat_rate          = repeat_channels / total_channels * 100
 *
 * session_start считается по той же логике, что и в FRT (anti-thanks фильтр,
 * предыдущее не от клиента) — чтобы числа были сопоставимы.
 *
 * lower_better: чем меньше повторных обращений — тем лучше.
 */

import { getSQL } from '../../lib/db.js'
import { loadBenchmarks, classifyStatus } from './benchmarks.js'
import { ANTI_THANKS_REGEX, ACK_TEXT_SQL } from './frtShared.js'
import type { MetricDescriptor, MetricResult, MetricScope, ResolvedPeriod } from './types.js'

export const repeatContactRateDescriptor: MetricDescriptor = {
  key: 'repeat_contact_rate',
  level: 'indicator',
  unit: 'percent',
  direction: 'lower_better',
  labelRu: 'Доля повторных обращений',
  formulaRu:
    '% каналов, обратившихся 2+ раза за период. Proxy первоконтактного решения (FCR).',
  perAgent: false,
}

interface RepeatRow {
  total_channels: string | number | null
  repeat_channels: string | number | null
}

export async function computeRepeatContactRate(
  scope: MetricScope,
  period: ResolvedPeriod,
): Promise<MetricResult> {
  const sql = getSQL()
  const fromISO = period.from.toISOString()
  const toISO = period.to.toISOString()
  const market = scope.market ?? null
  const source = scope.source && scope.source !== 'all' ? scope.source : 'all'

  const rows = (await sql`
    WITH all_msgs AS (
      SELECT
        m.channel_id, m.created_at, m.sender_role, m.is_from_client, m.text_content,
        LAG(m.sender_role) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) AS prev_role,
        LAG(m.is_from_client) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) AS prev_is_client
      FROM support_messages m
      JOIN support_channels c ON c.id = m.channel_id
      WHERE m.org_id = ${scope.orgId}
        AND m.created_at >= ${fromISO}::timestamptz - INTERVAL '24 hours'
        AND m.created_at <= ${toISO}::timestamptz
        AND (${market}::text IS NULL OR c.market_id = ${market})
        AND (${source}::text = 'all' OR COALESCE(c.source, 'telegram') = ${source})
        AND COALESCE(c.type, 'client') <> 'internal'
        AND COALESCE(c.sla_category, 'client') <> 'internal'
    ),
    session_starts AS (
      SELECT channel_id, created_at
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
          AND ${ACK_TEXT_SQL} ~ ${ANTI_THANKS_REGEX}
        )
    ),
    per_channel AS (
      SELECT channel_id, COUNT(*) AS contacts
      FROM session_starts
      GROUP BY channel_id
    )
    SELECT
      COUNT(*)::int AS total_channels,
      COUNT(*) FILTER (WHERE contacts >= 2)::int AS repeat_channels
    FROM per_channel
  `) as RepeatRow[]

  const row = rows[0] || ({} as RepeatRow)
  const total = row.total_channels !== null && row.total_channels !== undefined
    ? typeof row.total_channels === 'string' ? parseInt(row.total_channels) : row.total_channels
    : 0
  const repeat = row.repeat_channels !== null && row.repeat_channels !== undefined
    ? typeof row.repeat_channels === 'string' ? parseInt(row.repeat_channels) : row.repeat_channels
    : 0
  const value = total > 0 ? Math.round((repeat / total) * 1000) / 10 : null

  const benchmarks = await loadBenchmarks(
    repeatContactRateDescriptor.key,
    scope,
    period.granularity,
  )
  const status = classifyStatus(value, repeatContactRateDescriptor, benchmarks)

  return {
    key: repeatContactRateDescriptor.key,
    value,
    sampleSize: total,
    benchmarks,
    status,
    period,
  }
}
