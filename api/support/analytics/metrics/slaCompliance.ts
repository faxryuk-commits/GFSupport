/**
 * Метрика: SLA compliance rate — доля ответов с FRT ≤ slaMinutes.
 *
 * L3 / activity.
 *
 * Считается из тех же session_start'ов, что и FRT (см. frtAvg.ts) — логика
 * фильтрации идентична, отличие только в формуле: вместо AVG(минут) считаем
 * долю response_minutes ≤ slaMinutes.
 *
 * slaMinutes по умолчанию = 10 (можно переопределить через scope.role или
 * в будущем — через config). Использовать тот же фильтр anti-thanks и
 * 4-часовое окно, что и FRT, чтобы числа были сопоставимы.
 *
 * Возвращает значение в шкале 0..100 (percent).
 */

import { getSQL } from '../../lib/db.js'
import { loadBenchmarks, classifyStatus } from './benchmarks.js'
import { ANTI_THANKS_REGEX } from './frtShared.js'
import type {
  MetricDescriptor,
  MetricResult,
  MetricScope,
  MetricStatus,
  ResolvedPeriod,
  BenchmarkSet,
} from './types.js'

const DEFAULT_SLA_MINUTES = 10

export const slaComplianceDescriptor: MetricDescriptor = {
  key: 'sla_compliance_rate',
  level: 'activity',
  unit: 'percent',
  direction: 'higher_better',
  labelRu: 'SLA Compliance Rate',
  formulaRu:
    'Доля ВСЕХ новых запросов, отвеченных ≤ SLA (по умолчанию 10 минут). ' +
    'Знаменатель — все сессии: без ответа в окне или ответ позже SLA считаются нарушением. ' +
    'Та же выборка сессий, что у FRT.',
  perAgent: true,
}

interface SlaRow {
  total: string | number | null
  within_sla: string | number | null
}

export async function computeSlaCompliance(
  scope: MetricScope,
  period: ResolvedPeriod,
): Promise<MetricResult> {
  const sql = getSQL()
  const fromISO = period.from.toISOString()
  const toISO = period.to.toISOString()
  const market = scope.market ?? null
  const source = scope.source && scope.source !== 'all' ? scope.source : 'all'
  const agentId = scope.agentId ?? null
  const rolesFilter =
    scope.roles && scope.roles.length > 0 ? scope.roles.map((r) => r.toLowerCase()) : null
  const slaMinutes = DEFAULT_SLA_MINUTES

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
          COALESCE(LENGTH(text_content), 0) <= 50
          AND LOWER(COALESCE(text_content, '')) ~ ${ANTI_THANKS_REGEX}
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
        ) AS response_at
      FROM session_starts ss
    )
    SELECT
      -- Знаменатель = ВСЕ сессии периода. Сессия без ответа в окне (или ответ
      -- позже SLA) — это нарушение SLA, а не повод её выкинуть. Раньше
      -- знаменателем были только отвеченные → нарушители исключались из
      -- собственной метрики и SLA завышался (~+11 п.п.).
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE response_at IS NOT NULL
        AND EXTRACT(EPOCH FROM (response_at - client_at)) / 60.0 <= ${slaMinutes}
      )::int AS within_sla
    FROM first_responses
  `) as SlaRow[]

  const row = rows[0] || ({} as SlaRow)
  const total = row.total !== null && row.total !== undefined
    ? typeof row.total === 'string' ? parseInt(row.total) : row.total
    : 0
  const withinSla = row.within_sla !== null && row.within_sla !== undefined
    ? typeof row.within_sla === 'string' ? parseInt(row.within_sla) : row.within_sla
    : 0
  const value = total > 0 ? Math.round((withinSla / total) * 1000) / 10 : null

  const benchmarks = await loadBenchmarks(slaComplianceDescriptor.key, scope, period.granularity)
  const status = classifyStatus(value, slaComplianceDescriptor, benchmarks)

  return {
    key: slaComplianceDescriptor.key,
    value,
    sampleSize: total,
    benchmarks,
    status,
    period,
  }
}

/**
 * Per-agent SLA Compliance — для табличного представления в Detail-табе.
 * Структурно аналогично computeFrtAvgPerAgent в frtAvg.ts.
 *
 * Возвращает массив { agentId, agentName, value (%), sampleSize, status }
 * для всех агентов, ответивших ≥1 раз. SLA-порог = DEFAULT_SLA_MINUTES.
 */
export interface SlaPerAgentRow {
  agentId: string
  agentName: string | null
  value: number
  sampleSize: number
  status: MetricStatus
}

export interface SlaPerAgentResult {
  rows: SlaPerAgentRow[]
  benchmarks: BenchmarkSet
  period: ResolvedPeriod
}

interface PerAgentRawRow {
  agent_id: string
  agent_name: string | null
  total: string | number
  within_sla: string | number
}

export async function computeSlaCompliancePerAgent(
  scope: Pick<MetricScope, 'orgId' | 'market' | 'source' | 'roles'>,
  period: ResolvedPeriod,
): Promise<SlaPerAgentResult> {
  const sql = getSQL()
  const fromISO = period.from.toISOString()
  const toISO = period.to.toISOString()
  const market = scope.market ?? null
  const source = scope.source && scope.source !== 'all' ? scope.source : 'all'
  const rolesFilter =
    scope.roles && scope.roles.length > 0 ? scope.roles.map((r) => r.toLowerCase()) : null
  const slaMinutes = DEFAULT_SLA_MINUTES

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
          COALESCE(LENGTH(text_content), 0) <= 50
          AND LOWER(COALESCE(text_content, '')) ~ ${ANTI_THANKS_REGEX}
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
        ) AS responder_agent_id
      FROM session_starts ss
    )
    SELECT
      fr.responder_agent_id AS agent_id,
      a.name AS agent_name,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE EXTRACT(EPOCH FROM (fr.response_at - fr.client_at)) / 60.0 <= ${slaMinutes}
      )::int AS within_sla
    FROM first_responder fr
    LEFT JOIN support_agents a ON a.id::text = fr.responder_agent_id AND a.org_id = ${scope.orgId}
    WHERE fr.response_at IS NOT NULL
      AND fr.responder_agent_id IS NOT NULL
      AND (${rolesFilter}::text[] IS NULL OR LOWER(a.role) = ANY(${rolesFilter}::text[]))
    GROUP BY fr.responder_agent_id, a.name
    ORDER BY (COUNT(*) FILTER (
      WHERE EXTRACT(EPOCH FROM (fr.response_at - fr.client_at)) / 60.0 <= ${slaMinutes}
    )::numeric / NULLIF(COUNT(*), 0)) DESC NULLS LAST
  `) as PerAgentRawRow[]

  const benchmarks = await loadBenchmarks(
    slaComplianceDescriptor.key,
    { orgId: scope.orgId, market, source: scope.source ?? null },
    period.granularity,
  )

  const rows: SlaPerAgentRow[] = rawRows.map((r) => {
    const total = typeof r.total === 'string' ? parseInt(r.total) : r.total
    const withinSla = typeof r.within_sla === 'string' ? parseInt(r.within_sla) : r.within_sla
    const value = total > 0 ? Math.round((withinSla / total) * 1000) / 10 : 0
    return {
      agentId: r.agent_id,
      agentName: r.agent_name,
      value,
      sampleSize: total,
      status: classifyStatus(value, slaComplianceDescriptor, benchmarks),
    }
  })

  return { rows, benchmarks, period }
}
