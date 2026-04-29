import { getSQL } from './db.js'

/**
 * Реестр инструментов для ИИ-чата (insights-chat).
 *
 * Каждый tool:
 *  - имеет имя (snake_case) — то, что LLM будет вызывать,
 *  - схему аргументов в формате JSON Schema (function-calling OpenAI),
 *  - валидатор аргументов (узкие типы, без any),
 *  - executor — асинхронная функция, дёргает SQL и возвращает компактный JSON.
 *
 * orgId всегда фиксируется снаружи (из middleware), LLM не может его
 * переопределить. PII (телефоны, email клиентов) маскируются на уровне
 * executor'а — настраивается флагом INCLUDE_PII (по умолчанию false).
 */

export type ToolName =
  | 'get_dashboard_metrics'
  | 'get_sla_report'
  | 'get_agent_360'
  | 'find_channels'
  | 'find_cases'
  | 'get_category_flow'

export interface ToolDef {
  name: ToolName
  description: string
  parameters: Record<string, unknown> // JSON Schema (subset)
  execute: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>
}

export interface ToolCtx {
  orgId: string
  includePII?: boolean
  // Soft-cap для размера результата tool'а — чтобы не раздувать контекст LLM.
  maxBytes?: number
}

const DEFAULT_MAX_BYTES = 8 * 1024
const DEFAULT_PERIOD_DAYS = 7

// ---------- helpers --------------------------------------------------------

function periodToDates(period?: string): { from: Date; to: Date; days: number } {
  const to = new Date()
  let days = DEFAULT_PERIOD_DAYS
  switch ((period || '').toLowerCase()) {
    case 'today':
    case '1d':
      days = 1
      break
    case '7d':
    case 'week':
    case 'неделя':
      days = 7
      break
    case '14d':
      days = 14
      break
    case '30d':
    case 'month':
    case 'месяц':
      days = 30
      break
    case '90d':
    case 'quarter':
      days = 90
      break
    default:
      days = DEFAULT_PERIOD_DAYS
  }
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
  return { from, to, days }
}

function clampSource(source?: unknown): 'all' | 'telegram' | 'whatsapp' {
  const s = String(source || 'all').toLowerCase()
  if (s === 'telegram' || s === 'whatsapp') return s
  return 'all'
}

function maskPII<T>(value: T, includePII: boolean): T {
  if (includePII) return value
  if (value == null) return value
  if (typeof value === 'string') {
    const masked = value
      .replace(/(\+?\d[\d\s().-]{7,})/g, (m) =>
        m.length > 4 ? `${m.slice(0, 2)}***${m.slice(-2)}` : '***'
      )
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***')
    return masked as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((v) => maskPII(v, includePII)) as unknown as T
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskPII(v, includePII)
    }
    return out as unknown as T
  }
  return value
}

function trimToBudget(payload: unknown, maxBytes: number): unknown {
  let s = JSON.stringify(payload)
  if (s.length <= maxBytes) return payload
  // Если массив/объект — урежем массивы. Простой эвристический trim.
  if (Array.isArray(payload)) {
    const half = Math.max(1, Math.floor(payload.length / 2))
    return trimToBudget(payload.slice(0, half), maxBytes)
  }
  if (payload && typeof payload === 'object') {
    const obj = { ...(payload as Record<string, unknown>) }
    for (const k of Object.keys(obj)) {
      const v = obj[k]
      if (Array.isArray(v) && v.length > 5) obj[k] = v.slice(0, 5)
    }
    s = JSON.stringify(obj)
    if (s.length <= maxBytes) return obj
    return { _truncated: true, summary: 'Слишком большой результат, верни уточняющие фильтры' }
  }
  return payload
}

// ---------- tools ----------------------------------------------------------

const dashboardMetricsTool: ToolDef = {
  name: 'get_dashboard_metrics',
  description:
    'KPI дашборда за период: всего/открытых/решённых кейсов, ' +
    'медианное и среднее время первой реакции (FRT), доля ответов в SLA (≤10 минут), ' +
    'разбивка по источнику (telegram/whatsapp). Используй для общих вопросов вроде ' +
    '«как у нас дела на этой неделе», «сколько было обращений за месяц», «кпи за 7 дней».',
  parameters: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['today', '7d', '14d', '30d', '90d'],
        description: 'Окно данных. По умолчанию 7d.',
      },
      source: {
        type: 'string',
        enum: ['all', 'telegram', 'whatsapp'],
        description: 'Источник каналов. По умолчанию all.',
      },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const { from, to, days } = periodToDates(args.period as string | undefined)
    const source = clampSource(args.source)
    const sql = getSQL()

    const [casesRow] = await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed'))::int AS open,
        COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at >= ${from.toISOString()})::int AS resolved,
        COUNT(*) FILTER (WHERE priority = 'urgent' AND status NOT IN ('resolved', 'closed'))::int AS urgent_open
      FROM support_cases c
      LEFT JOIN support_channels ch ON ch.id = c.channel_id AND ch.org_id = c.org_id
      WHERE c.org_id = ${ctx.orgId}
        AND c.created_at >= ${from.toISOString()}
        AND c.created_at <= ${to.toISOString()}
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
    `

    // Простая метрика времени первой реакции — берём средний и медианный
    // ответ агента на первое сообщение клиента в сессии (упрощённо).
    const frtRows = await sql`
      WITH first_client AS (
        SELECT m.id, m.channel_id, m.created_at,
               LAG(m.is_from_client) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) AS prev_from_client
        FROM support_messages m
        LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
        WHERE m.org_id = ${ctx.orgId}
          AND m.is_from_client = true
          AND m.created_at >= ${from.toISOString()} - INTERVAL '6 hours'
          AND m.created_at <= ${to.toISOString()}
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
      ),
      sessions AS (
        SELECT id, channel_id, created_at
        FROM first_client
        WHERE prev_from_client IS NULL OR prev_from_client = false
      ),
      response AS (
        SELECT
          s.id,
          (SELECT MIN(m2.created_at) FROM support_messages m2
            WHERE m2.org_id = ${ctx.orgId}
              AND m2.channel_id = s.channel_id
              AND m2.is_from_client = false
              AND m2.sender_role IN ('support', 'team', 'agent')
              AND m2.created_at > s.created_at
              AND m2.created_at <= s.created_at + INTERVAL '4 hours'
          ) AS responded_at,
          s.created_at AS asked_at
        FROM sessions s
        WHERE s.created_at >= ${from.toISOString()}
      )
      SELECT
        COUNT(*) FILTER (WHERE responded_at IS NOT NULL)::int AS responses,
        ROUND(AVG(EXTRACT(EPOCH FROM (responded_at - asked_at)) / 60.0)::numeric, 1)::float AS avg_minutes,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (responded_at - asked_at)) / 60.0)::numeric, 1)::float AS median_minutes,
        COUNT(*) FILTER (WHERE responded_at IS NOT NULL AND EXTRACT(EPOCH FROM (responded_at - asked_at)) / 60.0 <= 10)::int AS within_sla_10m
      FROM response
    `
    const frt = (frtRows as any[])[0] || {}
    const responses = Number(frt.responses || 0)

    // Разбивка по источнику.
    const bySource = await sql`
      SELECT COALESCE(ch.source, 'telegram') AS source,
             COUNT(*)::int AS messages
      FROM support_messages m
      LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
      WHERE m.org_id = ${ctx.orgId}
        AND m.created_at >= ${from.toISOString()}
        AND m.created_at <= ${to.toISOString()}
      GROUP BY 1
      ORDER BY 2 DESC
    `

    const result = {
      period: { from: from.toISOString(), to: to.toISOString(), days, source },
      cases: {
        total: Number(casesRow?.total || 0),
        open: Number(casesRow?.open || 0),
        resolved: Number(casesRow?.resolved || 0),
        urgentOpen: Number(casesRow?.urgent_open || 0),
      },
      frt: {
        responses,
        avgMinutes: responses > 0 ? Number(frt.avg_minutes || 0) : null,
        medianMinutes: responses > 0 ? Number(frt.median_minutes || 0) : null,
        slaPercent: responses > 0
          ? Math.round((Number(frt.within_sla_10m || 0) / responses) * 100)
          : null,
        slaThresholdMinutes: 10,
      },
      bySource: (bySource as any[]).map((r) => ({ source: r.source, messages: Number(r.messages) })),
    }
    return trimToBudget(result, ctx.maxBytes || DEFAULT_MAX_BYTES)
  },
}

const slaReportTool: ToolDef = {
  name: 'get_sla_report',
  description:
    'Подробный SLA-отчёт за период: лидерборд сотрудников по времени первой реакции, ' +
    'распределение ответов по бакетам (≤5/10/30/60/60+ минут), доля в SLA. ' +
    'Используй для вопросов вроде «кто отстаёт по FRT», «топ-5 по скорости», ' +
    '«покажи лидерборд за неделю».',
  parameters: {
    type: 'object',
    properties: {
      period: { type: 'string', enum: ['today', '7d', '14d', '30d', '90d'] },
      source: { type: 'string', enum: ['all', 'telegram', 'whatsapp'] },
      limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const { from, to, days } = periodToDates(args.period as string | undefined)
    const source = clampSource(args.source)
    const limit = Math.max(1, Math.min(30, Number(args.limit) || 10))
    const sql = getSQL()

    // Лидерборд агентов: средний FRT по их ответам.
    const leaderboard = await sql`
      WITH first_client AS (
        SELECT m.id, m.channel_id, m.created_at,
               LAG(m.is_from_client) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) AS prev
        FROM support_messages m
        LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
        WHERE m.org_id = ${ctx.orgId}
          AND m.is_from_client = true
          AND m.created_at >= ${from.toISOString()} - INTERVAL '6 hours'
          AND m.created_at <= ${to.toISOString()}
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
      ),
      sessions AS (
        SELECT id, channel_id, created_at FROM first_client
        WHERE prev IS NULL OR prev = false
      ),
      first_response AS (
        SELECT s.created_at AS asked_at,
          (SELECT m2.sender_name FROM support_messages m2
            WHERE m2.org_id = ${ctx.orgId}
              AND m2.channel_id = s.channel_id
              AND m2.is_from_client = false
              AND m2.sender_role IN ('support', 'team', 'agent')
              AND m2.created_at > s.created_at
              AND m2.created_at <= s.created_at + INTERVAL '4 hours'
            ORDER BY m2.created_at ASC LIMIT 1
          ) AS agent_name,
          (SELECT MIN(m2.created_at) FROM support_messages m2
            WHERE m2.org_id = ${ctx.orgId}
              AND m2.channel_id = s.channel_id
              AND m2.is_from_client = false
              AND m2.sender_role IN ('support', 'team', 'agent')
              AND m2.created_at > s.created_at
              AND m2.created_at <= s.created_at + INTERVAL '4 hours'
          ) AS responded_at
        FROM sessions s
        WHERE s.created_at >= ${from.toISOString()}
      ),
      team_only AS (
        SELECT fr.agent_name, fr.asked_at, fr.responded_at
        FROM first_response fr
        WHERE fr.responded_at IS NOT NULL
          AND fr.agent_name IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM support_agents a
            WHERE a.org_id = ${ctx.orgId} AND LOWER(a.name) = LOWER(fr.agent_name)
          )
      )
      SELECT
        agent_name,
        COUNT(*)::int AS responses,
        ROUND(AVG(EXTRACT(EPOCH FROM (responded_at - asked_at)) / 60.0)::numeric, 1)::float AS avg_minutes,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (responded_at - asked_at)) / 60.0)::numeric, 1)::float AS median_minutes,
        COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (responded_at - asked_at)) / 60.0 <= 10)::int AS within_sla_10m
      FROM team_only
      GROUP BY agent_name
      ORDER BY avg_minutes ASC
      LIMIT ${limit}
    `

    // Распределение по бакетам — те же ответы, разрезанные на ≤5/10/30/60/60+
    const buckets = await sql`
      WITH first_client AS (
        SELECT m.id, m.channel_id, m.created_at,
               LAG(m.is_from_client) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) AS prev
        FROM support_messages m
        LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
        WHERE m.org_id = ${ctx.orgId}
          AND m.is_from_client = true
          AND m.created_at >= ${from.toISOString()} - INTERVAL '6 hours'
          AND m.created_at <= ${to.toISOString()}
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
      ),
      sessions AS (
        SELECT id, channel_id, created_at FROM first_client WHERE prev IS NULL OR prev = false
      ),
      response AS (
        SELECT s.created_at AS asked_at,
          (SELECT MIN(m2.created_at) FROM support_messages m2
            WHERE m2.org_id = ${ctx.orgId}
              AND m2.channel_id = s.channel_id
              AND m2.is_from_client = false
              AND m2.sender_role IN ('support', 'team', 'agent')
              AND m2.created_at > s.created_at
              AND m2.created_at <= s.created_at + INTERVAL '4 hours'
          ) AS responded_at
        FROM sessions s
        WHERE s.created_at >= ${from.toISOString()}
      )
      SELECT
        CASE
          WHEN mins <= 5  THEN '5min'
          WHEN mins <= 10 THEN '10min'
          WHEN mins <= 30 THEN '30min'
          WHEN mins <= 60 THEN '60min'
          ELSE '60plus'
        END AS bucket,
        COUNT(*)::int AS count
      FROM (
        SELECT EXTRACT(EPOCH FROM (responded_at - asked_at)) / 60.0 AS mins
        FROM response
        WHERE responded_at IS NOT NULL
      ) sub
      GROUP BY 1
    `

    const totalResponses = (buckets as any[]).reduce((s, r) => s + Number(r.count || 0), 0)
    const within = (buckets as any[])
      .filter((r) => r.bucket === '5min' || r.bucket === '10min')
      .reduce((s, r) => s + Number(r.count || 0), 0)
    const slaPercent = totalResponses > 0 ? Math.round((within / totalResponses) * 100) : null

    const result = {
      period: { from: from.toISOString(), to: to.toISOString(), days, source },
      slaPercent,
      slaThresholdMinutes: 10,
      totalResponses,
      buckets: (buckets as any[]).map((r) => ({ bucket: r.bucket, count: Number(r.count) })),
      leaderboard: (leaderboard as any[]).map((r) => ({
        agentName: r.agent_name,
        responses: Number(r.responses),
        avgMinutes: Number(r.avg_minutes || 0),
        medianMinutes: Number(r.median_minutes || 0),
        slaPercent: r.responses > 0
          ? Math.round((Number(r.within_sla_10m || 0) / Number(r.responses)) * 100)
          : null,
      })),
    }
    return trimToBudget(maskPII(result, !!ctx.includePII), ctx.maxBytes || DEFAULT_MAX_BYTES)
  },
}

// ---------- registry -------------------------------------------------------

export const TOOLS: Record<ToolName, ToolDef> = {
  get_dashboard_metrics: dashboardMetricsTool,
  get_sla_report: slaReportTool,
  // Остальные (agent_360, find_channels, find_cases, get_category_flow)
  // подключим следующим коммитом — поэтапно, чтобы LLM не путался.
  get_agent_360: dashboardMetricsTool, // placeholder, не публикуем в LLM-схеме
  find_channels: dashboardMetricsTool,
  find_cases: dashboardMetricsTool,
  get_category_flow: dashboardMetricsTool,
}

const ACTIVE_TOOLS: ToolName[] = ['get_dashboard_metrics', 'get_sla_report']

// Схема для chat.completions tools[].
export function getOpenAITools() {
  return ACTIVE_TOOLS.map((name) => {
    const t = TOOLS[name]
    return {
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }
  })
}

export function isActiveTool(name: string): name is ToolName {
  return ACTIVE_TOOLS.includes(name as ToolName)
}

// ---------- chat tables ---------------------------------------------------

let chatTablesEnsured = false

export async function ensureChatTables(): Promise<void> {
  if (chatTablesEnsured) return
  const sql = getSQL()
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS support_ai_chat_sessions (
        id VARCHAR(60) PRIMARY KEY,
        org_id VARCHAR(50) NOT NULL,
        user_id VARCHAR(60) NOT NULL,
        title VARCHAR(255) NOT NULL DEFAULT 'Без названия',
        period_default VARCHAR(10) DEFAULT '7d',
        source_default VARCHAR(20) DEFAULT 'all',
        archived BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    await sql`
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_user
      ON support_ai_chat_sessions (org_id, user_id, archived, updated_at DESC)
    `
    await sql`
      CREATE TABLE IF NOT EXISTS support_ai_chat_messages (
        id VARCHAR(60) PRIMARY KEY,
        session_id VARCHAR(60) NOT NULL,
        role VARCHAR(20) NOT NULL,
        content TEXT,
        tool_name VARCHAR(60),
        tool_args JSONB,
        tool_result JSONB,
        tokens_in INT DEFAULT 0,
        tokens_out INT DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    await sql`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session
      ON support_ai_chat_messages (session_id, created_at ASC)
    `
    chatTablesEnsured = true
  } catch (e) {
    console.error('[ensureChatTables]', e)
  }
}
