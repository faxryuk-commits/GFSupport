/**
 * Агрегат FRT «первый ответ после сообщения клиента» — та же CTE-логика,
 * что в начале sla-report.ts (блок firstResponseData), но без LIMIT 500:
 * считается по всем событиям периода.
 */

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>

export interface TeamFrtAgentRow {
  name: string
  totalResponses: number
  avgMinutes: number
}

export async function fetchTeamFrtAggregate(
  sql: SqlFn,
  params: {
    orgId: string
    fromDateTime: string
    toDateTime: string
    market: string | null
    source: string
  },
): Promise<{ avgResponseMinutes: number; agents: TeamFrtAgentRow[] }> {
  const { orgId, fromDateTime, toDateTime, market, source } = params

  const rows = await sql`
    WITH all_msgs AS (
      SELECT
        m.id,
        m.channel_id,
        m.sender_name,
        m.text_content,
        m.created_at,
        m.sender_role,
        m.is_from_client,
        c.name as channel_name,
        LAG(m.sender_role) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_sender_role,
        LAG(m.is_from_client) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_is_from_client
      FROM support_messages m
      JOIN support_channels c ON c.id = m.channel_id
      WHERE m.org_id = ${orgId}
        AND m.created_at >= ${fromDateTime}::timestamptz - INTERVAL '24 hours'
        AND m.created_at <= ${toDateTime}::timestamptz
        AND (${market}::text IS NULL OR c.market_id = ${market})
        AND (${source}::text = 'all' OR COALESCE(c.source, 'telegram') = ${source})
    ),
    client_messages AS (
      SELECT id, channel_id, sender_name as client_name, text_content, created_at as message_at, channel_name
      FROM all_msgs
      WHERE sender_role = 'client' AND is_from_client = true
        AND created_at >= ${fromDateTime}::timestamptz
        AND (
          prev_sender_role IS NULL
          OR prev_sender_role IN ('support', 'team', 'agent')
          OR prev_is_from_client = false
        )
        AND NOT (
          COALESCE(LENGTH(text_content), 0) <= 50
          AND LOWER(COALESCE(text_content, '')) ~ '(^|\\s)(хоп|ок|окей|рахмат|спасибо|тушунарли|хорошо|понял|ладно|rahmat|ok|okay|tushunarli|hop|хоп рахмат|ок рахмат|рахмат катта|катта рахмат|болди|хо[пр]|да|нет|йук|ха|хн|понятно|good|thanks|thank you|aни|hozir|тушундим)(\\s|$)'
        )
    ),
    first_responses AS (
      SELECT
        cm.id as client_msg_id,
        cm.channel_id,
        cm.channel_name,
        cm.client_name,
        cm.text_content,
        cm.message_at,
        (
          SELECT m2.created_at
          FROM support_messages m2
          WHERE m2.channel_id = cm.channel_id
            AND m2.org_id = ${orgId}
            AND m2.is_from_client = false
            AND m2.sender_role IN ('support', 'team', 'agent')
            AND m2.created_at > cm.message_at
            AND m2.created_at <= cm.message_at + INTERVAL '4 hours'
          ORDER BY m2.created_at ASC
          LIMIT 1
        ) as response_at,
        (
          SELECT COALESCE(ra.name, m2.sender_name)
          FROM support_messages m2
          LEFT JOIN support_agents ra ON (
            ra.telegram_id::text = m2.sender_id::text
            OR ra.id::text = m2.sender_id::text
            OR LOWER(ra.username) = LOWER(m2.sender_username)
            OR LOWER(ra.name) = LOWER(m2.sender_name)
          )
          WHERE m2.channel_id = cm.channel_id
            AND m2.org_id = ${orgId}
            AND m2.is_from_client = false
            AND m2.sender_role IN ('support', 'team', 'agent')
            AND m2.created_at > cm.message_at
            AND m2.created_at <= cm.message_at + INTERVAL '4 hours'
          ORDER BY m2.created_at ASC
          LIMIT 1
        ) as responder_name
      FROM client_messages cm
    ),
    fr_with_minutes AS (
      SELECT
        responder_name,
        response_at,
        CASE
          WHEN response_at IS NOT NULL
          THEN ROUND(EXTRACT(EPOCH FROM (response_at - message_at)) / 60.0, 1)
          ELSE NULL
        END as response_minutes
      FROM first_responses
    )
    SELECT
      ROUND(COALESCE(
        (SELECT AVG(response_minutes) FROM fr_with_minutes WHERE response_at IS NOT NULL AND response_minutes IS NOT NULL),
        0
      )::numeric, 1)::float as avg_response_minutes,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'name', g.responder_name,
              'totalResponses', g.total_responses,
              'avgMinutes', g.avg_minutes
            )
            ORDER BY g.responder_name
          )
          FROM (
            SELECT
              responder_name,
              COUNT(*)::int as total_responses,
              ROUND(AVG(response_minutes)::numeric, 1)::float as avg_minutes
            FROM fr_with_minutes
            WHERE response_at IS NOT NULL
              AND responder_name IS NOT NULL
            GROUP BY responder_name
          ) g
        ),
        '[]'::json
      ) as agents
  `

  const row = rows[0]
  if (!row) {
    return { avgResponseMinutes: 0, agents: [] }
  }

  let agentsRaw = row.agents
  if (typeof agentsRaw === 'string') {
    try {
      agentsRaw = JSON.parse(agentsRaw)
    } catch {
      agentsRaw = []
    }
  }

  const agents: TeamFrtAgentRow[] = Array.isArray(agentsRaw)
    ? agentsRaw.map((a: any) => ({
        name: String(a.name || ''),
        totalResponses: parseInt(String(a.totalResponses || 0), 10) || 0,
        avgMinutes: typeof a.avgMinutes === 'number' ? a.avgMinutes : parseFloat(String(a.avgMinutes)) || 0,
      }))
    : []

  const avg = row.avg_response_minutes
  const avgResponseMinutes =
    typeof avg === 'number' ? avg : parseFloat(String(avg ?? 0)) || 0

  return { avgResponseMinutes, agents }
}
