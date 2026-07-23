/**
 * Метрика: среднее время первого ответа (FRT, First Response Time).
 *
 * L3 / activity.
 *
 * Определение, согласованное со sla-report.ts и agent-360.ts:
 *  - берём только сообщения клиента, которые ОТКРЫВАЮТ новую беседу
 *    (предыдущее сообщение в канале — от агента или это первое в канале);
 *  - выкидываем короткие реплики «спасибо/ок/рахмат/болди/тушунарли» (≤ 50 симв.);
 *  - для каждого такого session_start ищем первый ответ от поддержки в 4-часовом окне;
 *  - время первого ответа = response_at − client_at, в минутах;
 *  - AVG по всем замерам периода.
 *
 * Это и есть «среднее время первого ответа» в человеческом смысле — клиент
 * пришёл с НОВЫМ запросом, как быстро на него отреагировали.
 *
 * Per-agent: если scope.agentId задан, в ответ засчитываются только те, кто
 * соответствует support_agents.id через расширенный JOIN
 * (telegram_id / a.id / username / name). См. agentJoin.ts.
 */

import { getSQL } from '../../lib/db.js'
import { ensureFrtOverridesTable } from '../../lib/frt-overrides-schema.js'
import { loadBenchmarks, classifyStatus } from './benchmarks.js'
import { ANTI_THANKS_REGEX, ACK_TEXT_SQL, ACK_MAX_LEN } from './frtShared.js'
import type {
  MetricDescriptor,
  MetricResult,
  MetricScope,
  MetricStatus,
  ResolvedPeriod,
  BenchmarkSet,
} from './types.js'

export const frtAvgDescriptor: MetricDescriptor = {
  key: 'frt_avg_minutes',
  level: 'activity',
  unit: 'minutes',
  direction: 'lower_better',
  labelRu: 'Среднее время первого ответа',
  formulaRu:
    'Среднее время от нового запроса клиента до первого ответа агента в 4-часовом окне ' +
    '(фильтр коротких «спасибо/ок»; без каналов type/sla_category = internal). ' +
    'Распределение скошенное — смотрите также медиану, p90 и долю отвеченных.',
  perAgent: true,
}

interface FrtRow {
  avg_minutes: string | number | null
  sample_size: string | number | null
  total_sessions: string | number | null
  median_minutes: string | number | null
  p90_minutes: string | number | null
}

export async function computeFrtAvg(
  scope: MetricScope,
  period: ResolvedPeriod,
): Promise<MetricResult> {
  const sql = getSQL()
  await ensureFrtOverridesTable(sql)
  const fromISO = period.from.toISOString()
  const toISO = period.to.toISOString()
  const market = scope.market ?? null
  const source = scope.source && scope.source !== 'all' ? scope.source : 'all'
  const agentId = scope.agentId ?? null
  // roles: null / [] = без фильтра; иначе lowercased список ролей
  const rolesFilter =
    scope.roles && scope.roles.length > 0 ? scope.roles.map((r) => r.toLowerCase()) : null

  // ВАЖНО: расширенный JOIN с support_agents — единственный способ корректно
  // атрибутировать web-агентов (sender_id='agent_xxx'). Семантика повторяет
  // agentMatchOn() из agentJoin.ts. Если меняете тут — синхронизируйте там.
  const rows = (await sql`
    WITH all_msgs AS (
      SELECT
        m.id, m.channel_id, m.created_at, m.sender_role, m.is_from_client, m.text_content,
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
          COALESCE(LENGTH(text_content), 0) <= ${ACK_MAX_LEN}
          AND ${ACK_TEXT_SQL} ~ ${ANTI_THANKS_REGEX}
        )
        AND NOT EXISTS (
          SELECT 1 FROM support_frt_overrides fo
          WHERE fo.org_id = ${scope.orgId}
            AND fo.message_id = all_msgs.id
            AND fo.override_type = 'exclude'
        )
    ),
    first_responses AS (
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
          ) AND a.org_id = ${scope.orgId}
          WHERE m2.org_id = ${scope.orgId}
            AND m2.channel_id = ss.channel_id
            AND m2.is_from_client = false
            AND m2.sender_role IN ('support','team','agent')
            AND m2.created_at > ss.created_at
            AND m2.created_at <= ss.created_at + INTERVAL '4 hours'
            AND (${agentId}::text IS NULL OR a.id::text = ${agentId}::text)
            AND (${rolesFilter}::text[] IS NULL OR LOWER(a.role) = ANY(${rolesFilter}::text[]))
          ORDER BY m2.created_at ASC
          LIMIT 1
        ) AS response_at,
        fo.override_type,
        fo.frt_minutes AS override_minutes
      FROM session_starts ss
      LEFT JOIN support_frt_overrides fo
        ON fo.org_id = ${scope.orgId} AND fo.message_id = ss.id
    ),
    with_minutes AS (
      SELECT
        session_id,
        client_at,
        response_at,
        CASE
          WHEN override_type = 'manual' AND override_minutes IS NOT NULL THEN override_minutes::float
          WHEN response_at IS NOT NULL THEN EXTRACT(EPOCH FROM (response_at - client_at)) / 60.0
          ELSE NULL
        END AS response_minutes
      FROM first_responses
    )
    SELECT
      ROUND(AVG(response_minutes)::numeric, 1) AS avg_minutes,
      COUNT(*) FILTER (WHERE response_minutes IS NOT NULL)::int AS sample_size,
      COUNT(*)::int AS total_sessions,
      ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY response_minutes))::numeric, 1) AS median_minutes,
      ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY response_minutes))::numeric, 1) AS p90_minutes
    FROM with_minutes
  `) as FrtRow[]

  const row = rows[0] || ({} as FrtRow)
  const sampleSize = row.sample_size !== null && row.sample_size !== undefined
    ? typeof row.sample_size === 'string' ? parseInt(row.sample_size) : row.sample_size
    : 0
  const value =
    sampleSize > 0 && row.avg_minutes !== null && row.avg_minutes !== undefined
      ? typeof row.avg_minutes === 'string'
        ? parseFloat(row.avg_minutes)
        : row.avg_minutes
      : null

  const benchmarks = await loadBenchmarks(frtAvgDescriptor.key, scope, period.granularity)
  const status = classifyStatus(value, frtAvgDescriptor, benchmarks)

  const num = (v: string | number | null | undefined): number | null =>
    v === null || v === undefined ? null : typeof v === 'string' ? parseFloat(v) : v
  const totalSessions = num(row.total_sessions) ?? 0
  const answeredRate =
    totalSessions > 0 ? Math.round((sampleSize / totalSessions) * 1000) / 10 : null

  return {
    key: frtAvgDescriptor.key,
    value,
    sampleSize,
    benchmarks,
    status,
    period,
    medianValue: sampleSize > 0 ? num(row.median_minutes) : null,
    p90Value: sampleSize > 0 ? num(row.p90_minutes) : null,
    totalSessions,
    answeredRate,
  }
}

/**
 * Per-agent breakdown — для табличного представления в Detail-табе.
 *
 * Возвращает массив { agentId, agentName, value, sampleSize, status }
 * для всех агентов, которые ответили на ≥1 session_start за период.
 * Бенчмарк один на scope, status вычисляется для каждого агента отдельно.
 *
 * Threshold ≥1 (а не ≥5 как в baseline) — для отображения хотим видеть
 * всех, кто работал, даже с малой выборкой; пользователь решит, доверять
 * ли. SampleSize в таблице явно показан.
 */
export interface FrtPerAgentRow {
  agentId: string
  agentName: string | null
  value: number
  sampleSize: number
  status: MetricStatus
}

export interface FrtPerAgentResult {
  rows: FrtPerAgentRow[]
  benchmarks: BenchmarkSet
  period: ResolvedPeriod
}

interface PerAgentRawRow {
  agent_id: string
  agent_name: string | null
  avg_minutes: string | number
  sample_size: string | number
}

export async function computeFrtAvgPerAgent(
  scope: Pick<MetricScope, 'orgId' | 'market' | 'source' | 'roles'>,
  period: ResolvedPeriod,
): Promise<FrtPerAgentResult> {
  const sql = getSQL()
  await ensureFrtOverridesTable(sql)
  const fromISO = period.from.toISOString()
  const toISO = period.to.toISOString()
  const market = scope.market ?? null
  const source = scope.source && scope.source !== 'all' ? scope.source : 'all'
  const rolesFilter =
    scope.roles && scope.roles.length > 0 ? scope.roles.map((r) => r.toLowerCase()) : null

  const rawRows = (await sql`
    WITH all_msgs AS (
      SELECT
        m.id, m.channel_id, m.created_at, m.sender_role, m.is_from_client, m.text_content,
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
          COALESCE(LENGTH(text_content), 0) <= ${ACK_MAX_LEN}
          AND ${ACK_TEXT_SQL} ~ ${ANTI_THANKS_REGEX}
        )
        AND NOT EXISTS (
          SELECT 1 FROM support_frt_overrides fo
          WHERE fo.org_id = ${scope.orgId}
            AND fo.message_id = all_msgs.id
            AND fo.override_type = 'exclude'
        )
    ),
    first_responder AS (
      SELECT
        ss.id AS session_id,
        ss.created_at AS client_at,
        (
          SELECT m2.created_at
          FROM support_messages m2
          WHERE m2.org_id = ${scope.orgId}
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
          ) AND a.org_id = ${scope.orgId}
          WHERE m2.org_id = ${scope.orgId}
            AND m2.channel_id = ss.channel_id
            AND m2.is_from_client = false
            AND m2.sender_role IN ('support','team','agent')
            AND m2.created_at > ss.created_at
            AND m2.created_at <= ss.created_at + INTERVAL '4 hours'
            AND (${rolesFilter}::text[] IS NULL OR LOWER(a.role) = ANY(${rolesFilter}::text[]))
          ORDER BY m2.created_at ASC
          LIMIT 1
        ) AS responder_agent_id,
        fo.override_type,
        fo.frt_minutes AS override_minutes
      FROM session_starts ss
      LEFT JOIN support_frt_overrides fo
        ON fo.org_id = ${scope.orgId} AND fo.message_id = ss.id
    ),
    with_minutes AS (
      SELECT
        responder_agent_id,
        CASE
          WHEN override_type = 'manual' AND override_minutes IS NOT NULL THEN override_minutes::float
          WHEN response_at IS NOT NULL THEN EXTRACT(EPOCH FROM (response_at - client_at)) / 60.0
          ELSE NULL
        END AS response_minutes
      FROM first_responder
    )
    SELECT
      wm.responder_agent_id AS agent_id,
      a.name AS agent_name,
      ROUND(AVG(wm.response_minutes)::numeric, 1) AS avg_minutes,
      COUNT(*)::int AS sample_size
    FROM with_minutes wm
    LEFT JOIN support_agents a ON a.id::text = wm.responder_agent_id AND a.org_id = ${scope.orgId}
    WHERE wm.response_minutes IS NOT NULL
      AND wm.responder_agent_id IS NOT NULL
      AND (${rolesFilter}::text[] IS NULL OR LOWER(a.role) = ANY(${rolesFilter}::text[]))
    GROUP BY wm.responder_agent_id, a.name
    ORDER BY avg_minutes ASC
  `) as PerAgentRawRow[]

  const benchmarks = await loadBenchmarks(
    frtAvgDescriptor.key,
    { orgId: scope.orgId, market, source: scope.source ?? null },
    period.granularity,
  )

  const rows: FrtPerAgentRow[] = rawRows.map((r) => {
    const value = typeof r.avg_minutes === 'string' ? parseFloat(r.avg_minutes) : r.avg_minutes
    const sampleSize =
      typeof r.sample_size === 'string' ? parseInt(r.sample_size) : r.sample_size
    return {
      agentId: r.agent_id,
      agentName: r.agent_name,
      value,
      sampleSize,
      status: classifyStatus(value, frtAvgDescriptor, benchmarks),
    }
  })

  return { rows, benchmarks, period }
}
