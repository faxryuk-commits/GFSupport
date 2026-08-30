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

const MONTH_RU: Record<string, number> = {
  'январь': 0, 'января': 0, 'jan': 0, 'january': 0,
  'февраль': 1, 'февраля': 1, 'feb': 1, 'february': 1,
  'март': 2, 'марта': 2, 'mar': 2, 'march': 2,
  'апрель': 3, 'апреля': 3, 'apr': 3, 'april': 3,
  'май': 4, 'мая': 4, 'may': 4,
  'июнь': 5, 'июня': 5, 'jun': 5, 'june': 5,
  'июль': 6, 'июля': 6, 'jul': 6, 'july': 6,
  'август': 7, 'августа': 7, 'aug': 7, 'august': 7,
  'сентябрь': 8, 'сентября': 8, 'sep': 8, 'sept': 8, 'september': 8,
  'октябрь': 9, 'октября': 9, 'oct': 9, 'october': 9,
  'ноябрь': 10, 'ноября': 10, 'nov': 10, 'november': 10,
  'декабрь': 11, 'декабря': 11, 'dec': 11, 'december': 11,
}

function periodToDates(
  period?: string,
  explicit?: { dateFrom?: string; dateTo?: string }
): { from: Date; to: Date; days: number; label: string } {
  // Явные ISO-даты имеют приоритет.
  if (explicit?.dateFrom || explicit?.dateTo) {
    const from = explicit?.dateFrom ? new Date(explicit.dateFrom) : new Date(Date.now() - 7 * 86400_000)
    const to = explicit?.dateTo ? new Date(explicit.dateTo) : new Date()
    if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
      const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400_000))
      return { from, to, days, label: `${from.toISOString().slice(0, 10)}…${to.toISOString().slice(0, 10)}` }
    }
  }

  const now = new Date()
  const raw = (period || '').toLowerCase().trim()

  // YYYY-MM (например '2026-04')
  const ym = raw.match(/^(\d{4})-(\d{1,2})$/)
  if (ym) {
    const y = Number(ym[1])
    const m = Number(ym[2]) - 1
    const from = new Date(Date.UTC(y, m, 1))
    const to = new Date(Date.UTC(y, m + 1, 1))
    return { from, to, days: Math.round((to.getTime() - from.getTime()) / 86400_000), label: raw }
  }

  // Текстовое имя месяца («апрель», «april»). Если месяц > текущего — берём прошлый год.
  if (MONTH_RU[raw] !== undefined) {
    const m = MONTH_RU[raw]
    const y = m > now.getUTCMonth() ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
    const from = new Date(Date.UTC(y, m, 1))
    const to = new Date(Date.UTC(y, m + 1, 1))
    return { from, to, days: Math.round((to.getTime() - from.getTime()) / 86400_000), label: `${y}-${String(m + 1).padStart(2, '0')}` }
  }

  if (raw === 'this_month' || raw === 'этот_месяц') {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const days = Math.round((now.getTime() - from.getTime()) / 86400_000) + 1
    return { from, to: now, days, label: 'this_month' }
  }
  if (raw === 'last_month' || raw === 'прошлый_месяц') {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    return { from, to, days: Math.round((to.getTime() - from.getTime()) / 86400_000), label: 'last_month' }
  }
  if (raw === 'yesterday' || raw === 'вчера') {
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const from = new Date(to.getTime() - 86400_000)
    return { from, to, days: 1, label: 'yesterday' }
  }

  let days = DEFAULT_PERIOD_DAYS
  switch (raw) {
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
  const to = now
  const from = new Date(to.getTime() - days * 86400_000)
  return { from, to, days, label: `${days}d` }
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

const PERIOD_PROP = {
  type: 'string',
  description:
    'Окно данных. Поддерживается: today, yesterday, 7d, 14d, 30d, 90d, ' +
    'this_month, last_month, имя месяца («апрель»), или формат YYYY-MM. ' +
    'По умолчанию 7d. Если пользователь упомянул конкретный месяц — используй его имя.',
} as const

const DATE_FROM_PROP = {
  type: 'string',
  description: 'ISO-дата начала периода (YYYY-MM-DD). Имеет приоритет над period.',
} as const

const DATE_TO_PROP = {
  type: 'string',
  description: 'ISO-дата конца периода (YYYY-MM-DD). Имеет приоритет над period.',
} as const

const SOURCE_PROP = {
  type: 'string',
  enum: ['all', 'telegram', 'whatsapp'],
  description: 'Источник каналов. По умолчанию all.',
} as const

function readPeriodArgs(args: Record<string, unknown>) {
  return periodToDates(args.period as string | undefined, {
    dateFrom: args.dateFrom as string | undefined,
    dateTo: args.dateTo as string | undefined,
  })
}

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
      period: PERIOD_PROP,
      dateFrom: DATE_FROM_PROP,
      dateTo: DATE_TO_PROP,
      source: SOURCE_PROP,
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const { from, to, days } = readPeriodArgs(args)
    const source = clampSource(args.source)
    const sql = getSQL()

    const [casesRow] = await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed'))::int AS open,
        COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at >= ${from.toISOString()}::timestamptz)::int AS resolved,
        COUNT(*) FILTER (WHERE priority = 'urgent' AND status NOT IN ('resolved', 'closed'))::int AS urgent_open
      FROM support_cases c
      LEFT JOIN support_channels ch ON ch.id = c.channel_id AND ch.org_id = c.org_id
      WHERE c.org_id = ${ctx.orgId}
        AND c.created_at >= ${from.toISOString()}::timestamptz
        AND c.created_at <= ${to.toISOString()}::timestamptz
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
          AND m.created_at >= ${from.toISOString()}::timestamptz - INTERVAL '6 hours'
          AND m.created_at <= ${to.toISOString()}::timestamptz
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
        WHERE s.created_at >= ${from.toISOString()}::timestamptz
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
        AND m.created_at >= ${from.toISOString()}::timestamptz
        AND m.created_at <= ${to.toISOString()}::timestamptz
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
      period: PERIOD_PROP,
      dateFrom: DATE_FROM_PROP,
      dateTo: DATE_TO_PROP,
      source: SOURCE_PROP,
      limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const { from, to, days } = readPeriodArgs(args)
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
          AND m.created_at >= ${from.toISOString()}::timestamptz - INTERVAL '6 hours'
          AND m.created_at <= ${to.toISOString()}::timestamptz
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
        WHERE s.created_at >= ${from.toISOString()}::timestamptz
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
          AND m.created_at >= ${from.toISOString()}::timestamptz - INTERVAL '6 hours'
          AND m.created_at <= ${to.toISOString()}::timestamptz
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
        WHERE s.created_at >= ${from.toISOString()}::timestamptz
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

// ---------- agent 360 ------------------------------------------------------

const agent360Tool: ToolDef = {
  name: 'get_agent_360',
  description:
    'Краткий 360°-профиль сотрудника НАШЕЙ команды поддержки за период: число ответов, ' +
    'медианный/средний FRT, количество решённых кейсов, сравнение с медианой команды. ' +
    'Используй для вопросов «как Жамолиддин на этой неделе», «сравни Фирдавса с командой».',
  parameters: {
    type: 'object',
    properties: {
      agentName: { type: 'string', description: 'Имя сотрудника (как в support_agents.name)' },
      period: PERIOD_PROP,
      dateFrom: DATE_FROM_PROP,
      dateTo: DATE_TO_PROP,
      source: SOURCE_PROP,
    },
    required: ['agentName'],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const name = String(args.agentName || '').trim()
    if (!name) return { error: 'agentName_required' }
    const { from, to, days } = readPeriodArgs(args)
    const source = clampSource(args.source)
    const sql = getSQL()

    const [agentRow] = await sql`
      SELECT id, name, role FROM support_agents
      WHERE org_id = ${ctx.orgId} AND LOWER(name) = LOWER(${name})
      LIMIT 1
    `
    if (!agentRow) {
      return {
        error: 'agent_not_in_team',
        hint: 'Этого имени нет в support_agents. 360°-профиль строится только для сотрудников нашей команды.',
        searched: name,
      }
    }
    const resolvedName: string = agentRow.name

    // Ответы агента + FRT.
    const [kpi] = await sql`
      WITH first_client AS (
        SELECT m.id, m.channel_id, m.created_at,
               LAG(m.is_from_client) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) AS prev
        FROM support_messages m
        LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
        WHERE m.org_id = ${ctx.orgId}
          AND m.is_from_client = true
          AND m.created_at >= ${from.toISOString()}::timestamptz - INTERVAL '6 hours'
          AND m.created_at <= ${to.toISOString()}::timestamptz
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
      ),
      sessions AS (
        SELECT id, channel_id, created_at FROM first_client WHERE prev IS NULL OR prev = false
      ),
      our_responses AS (
        SELECT s.created_at AS asked_at,
          (SELECT m2.created_at FROM support_messages m2
            WHERE m2.org_id = ${ctx.orgId}
              AND m2.channel_id = s.channel_id
              AND m2.is_from_client = false
              AND m2.sender_role IN ('support', 'team', 'agent')
              AND LOWER(m2.sender_name) = LOWER(${resolvedName})
              AND m2.created_at > s.created_at
              AND m2.created_at <= s.created_at + INTERVAL '4 hours'
            ORDER BY m2.created_at ASC LIMIT 1
          ) AS responded_at
        FROM sessions s
        WHERE s.created_at >= ${from.toISOString()}::timestamptz
      )
      SELECT
        COUNT(*) FILTER (WHERE responded_at IS NOT NULL)::int AS responses,
        ROUND(AVG(EXTRACT(EPOCH FROM (responded_at - asked_at)) / 60.0)::numeric, 1)::float AS avg_minutes,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (responded_at - asked_at)) / 60.0)::numeric, 1)::float AS median_minutes
      FROM our_responses
    `

    const [resolvedRow] = await sql`
      SELECT COUNT(*)::int AS resolved
      FROM support_cases c
      LEFT JOIN support_agents a ON a.id::text = c.assigned_to::text
      LEFT JOIN support_channels ch ON ch.id = c.channel_id AND ch.org_id = c.org_id
      WHERE c.org_id = ${ctx.orgId}
        AND c.resolved_at IS NOT NULL
        AND c.resolved_at >= ${from.toISOString()}::timestamptz
        AND c.resolved_at <= ${to.toISOString()}::timestamptz
        AND (
          LOWER(a.name) = LOWER(${resolvedName})
          OR (a.id IS NULL AND c.assigned_to::text = ${agentRow.id})
        )
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
    `

    // Медиана команды для сравнения.
    const [team] = await sql`
      WITH per_agent AS (
        SELECT LOWER(m.sender_name) AS k, COUNT(*)::int AS n
        FROM support_messages m
        LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
        WHERE m.org_id = ${ctx.orgId}
          AND m.is_from_client = false
          AND m.sender_role IN ('support', 'team', 'agent')
          AND m.created_at >= ${from.toISOString()}::timestamptz
          AND m.created_at <= ${to.toISOString()}::timestamptz
          AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        GROUP BY 1
      )
      SELECT ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY n)::numeric, 0)::int AS median_n
      FROM per_agent
      WHERE n > 0
    `

    return trimToBudget({
      profile: { name: resolvedName, role: agentRow.role || 'agent' },
      period: { from: from.toISOString(), to: to.toISOString(), days, source },
      kpi: {
        responses: Number(kpi?.responses || 0),
        avgFRT: kpi?.responses > 0 ? Number(kpi.avg_minutes || 0) : null,
        medianFRT: kpi?.responses > 0 ? Number(kpi.median_minutes || 0) : null,
        resolvedCases: Number(resolvedRow?.resolved || 0),
      },
      vsTeam: {
        medianResponses: Number(team?.median_n || 0),
      },
    }, ctx.maxBytes || DEFAULT_MAX_BYTES)
  },
}

// ---------- find channels --------------------------------------------------

const findChannelsTool: ToolDef = {
  name: 'find_channels',
  description:
    'Поиск каналов по имени. Возвращает топ-10 совпадений с числом сообщений, открытых кейсов, ' +
    'awaitingReply, источником, sla-категорией. Используй когда пользователь упомянул конкретного клиента/группу.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Часть имени канала для поиска' },
      source: { type: 'string', enum: ['all', 'telegram', 'whatsapp'] },
      onlyAwaiting: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const query = String(args.query || '').trim()
    const source = clampSource(args.source)
    const onlyAwaiting = !!args.onlyAwaiting
    const limit = Math.max(1, Math.min(20, Number(args.limit) || 10))
    const sql = getSQL()

    const onlyAwaitingFlag = onlyAwaiting ? 1 : 0
    const rows = await sql`
      SELECT
        ch.id,
        ch.name,
        COALESCE(ch.source, 'telegram') AS source,
        ch.sla_category,
        ch.awaiting_reply,
        COALESCE(ch.unread_count, 0)::int AS unread,
        ch.last_message_at,
        (SELECT COUNT(*) FROM support_cases c
          WHERE c.org_id = ${ctx.orgId}
            AND c.channel_id = ch.id
            AND c.status NOT IN ('resolved', 'closed'))::int AS open_cases,
        (SELECT COUNT(*) FROM support_messages m
          WHERE m.org_id = ${ctx.orgId}
            AND m.channel_id = ch.id
            AND m.created_at >= NOW() - INTERVAL '7 days')::int AS msgs_7d
      FROM support_channels ch
      WHERE ch.org_id = ${ctx.orgId}
        AND ch.is_active = true
        AND (${query}::text = '' OR ch.name ILIKE ${'%' + query + '%'})
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
        AND (${onlyAwaitingFlag}::int = 0 OR ch.awaiting_reply = true)
      ORDER BY ch.last_message_at DESC NULLS LAST
      LIMIT ${limit}
    `
    return trimToBudget(maskPII({
      total: (rows as any[]).length,
      channels: (rows as any[]).map((r) => ({
        id: r.id,
        name: r.name,
        source: r.source,
        slaCategory: r.sla_category || 'client',
        awaitingReply: !!r.awaiting_reply,
        unread: Number(r.unread || 0),
        openCases: Number(r.open_cases || 0),
        messages7d: Number(r.msgs_7d || 0),
        lastMessageAt: r.last_message_at,
      })),
    }, !!ctx.includePII), ctx.maxBytes || DEFAULT_MAX_BYTES)
  },
}

// ---------- find cases ------------------------------------------------------

const findCasesTool: ToolDef = {
  name: 'find_cases',
  description:
    'Поиск кейсов по фильтрам: status, priority, period (по created_at), assignedTo (имя агента). ' +
    'Возвращает топ N (до 20) с заголовком, статусом, приоритетом, числом дней без активности.',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Например: open, resolved, urgent, stuck (>24ч без активности)',
        enum: ['any', 'open', 'resolved', 'closed', 'urgent', 'stuck'],
      },
      assignedTo: { type: 'string', description: 'Имя агента' },
      period: PERIOD_PROP,
      dateFrom: DATE_FROM_PROP,
      dateTo: DATE_TO_PROP,
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const status = String(args.status || 'open')
    const assignedTo = String(args.assignedTo || '').trim()
    const { from, to } = readPeriodArgs(args)
    const limit = Math.max(1, Math.min(20, Number(args.limit) || 10))
    const sql = getSQL()

    const rows = await sql`
      SELECT
        c.id, c.ticket_number, c.title, c.status, c.priority,
        c.channel_id, c.assigned_to, c.created_at, c.resolved_at, c.updated_at,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(c.updated_at, c.created_at))) / 3600.0 AS hours_idle,
        a.name AS agent_name,
        ch.name AS channel_name,
        COALESCE(ch.source, 'telegram') AS source
      FROM support_cases c
      LEFT JOIN support_agents a ON a.id::text = c.assigned_to::text
      LEFT JOIN support_channels ch ON ch.id = c.channel_id AND ch.org_id = c.org_id
      WHERE c.org_id = ${ctx.orgId}
        AND c.created_at >= ${from.toISOString()}::timestamptz
        AND c.created_at <= ${to.toISOString()}::timestamptz
        AND (${status} = 'any' OR (
          (${status} = 'open' AND c.status NOT IN ('resolved', 'closed')) OR
          (${status} = 'resolved' AND c.status = 'resolved') OR
          (${status} = 'closed' AND c.status = 'closed') OR
          (${status} = 'urgent' AND c.priority = 'urgent' AND c.status NOT IN ('resolved', 'closed')) OR
          (${status} = 'stuck' AND c.status NOT IN ('resolved', 'closed')
                              AND EXTRACT(EPOCH FROM (NOW() - COALESCE(c.updated_at, c.created_at))) / 3600.0 >= 24)
        ))
        AND (${assignedTo} = '' OR LOWER(a.name) = LOWER(${assignedTo}))
      ORDER BY c.created_at DESC
      LIMIT ${limit}
    `

    return trimToBudget(maskPII({
      filters: { status, assignedTo, period: { from: from.toISOString(), to: to.toISOString() } },
      total: (rows as any[]).length,
      cases: (rows as any[]).map((r) => ({
        id: r.id,
        caseNumber: r.ticket_number,
        title: r.title,
        status: r.status,
        priority: r.priority,
        agent: r.agent_name,
        channel: r.channel_name,
        source: r.source,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
        hoursIdle: r.hours_idle != null ? Math.round(Number(r.hours_idle) * 10) / 10 : null,
      })),
    }, !!ctx.includePII), ctx.maxBytes || DEFAULT_MAX_BYTES)
  },
}

// ---------- category flow --------------------------------------------------

const categoryFlowTool: ToolDef = {
  name: 'get_category_flow',
  description:
    'Воронка по AI-категориям обращений за период: сколько всего, сколько решено/в работе/застряло/проигнорено, ' +
    'распределение настроений (happy/neutral/unhappy). Используй для вопросов «какие проблемы чаще всего», ' +
    '«что застревает», «по чему больше всего недовольств».',
  parameters: {
    type: 'object',
    properties: {
      period: PERIOD_PROP,
      dateFrom: DATE_FROM_PROP,
      dateTo: DATE_TO_PROP,
      source: SOURCE_PROP,
      limit: { type: 'integer', minimum: 1, maximum: 15, default: 8 },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const { from, to, days } = readPeriodArgs(args)
    const source = clampSource(args.source)
    const limit = Math.max(1, Math.min(15, Number(args.limit) || 8))
    const sql = getSQL()

    const rows = await sql`
      SELECT
        COALESCE(NULLIF(m.ai_domain, ''), m.ai_category, 'без категории') AS domain,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE m.ai_sentiment = 'positive')::int AS positive,
        COUNT(*) FILTER (WHERE m.ai_sentiment = 'negative')::int AS negative,
        COUNT(*) FILTER (WHERE m.is_problem = true)::int AS problems
      FROM support_messages m
      LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = m.org_id
      WHERE m.org_id = ${ctx.orgId}
        AND m.created_at >= ${from.toISOString()}::timestamptz
        AND m.created_at <= ${to.toISOString()}::timestamptz
        AND m.is_from_client = true
        AND (${source}::text = 'all' OR COALESCE(ch.source, 'telegram') = ${source})
      GROUP BY 1
      ORDER BY total DESC
      LIMIT ${limit}
    `

    return trimToBudget({
      period: { from: from.toISOString(), to: to.toISOString(), days, source },
      categories: (rows as any[]).map((r) => ({
        domain: r.domain,
        total: Number(r.total),
        positive: Number(r.positive),
        negative: Number(r.negative),
        problems: Number(r.problems),
      })),
    }, ctx.maxBytes || DEFAULT_MAX_BYTES)
  },
}

// ---------- registry -------------------------------------------------------

export const TOOLS: Record<ToolName, ToolDef> = {
  get_dashboard_metrics: dashboardMetricsTool,
  get_sla_report: slaReportTool,
  get_agent_360: agent360Tool,
  find_channels: findChannelsTool,
  find_cases: findCasesTool,
  get_category_flow: categoryFlowTool,
}

const ACTIVE_TOOLS: ToolName[] = [
  'get_dashboard_metrics',
  'get_sla_report',
  'get_agent_360',
  'find_channels',
  'find_cases',
  'get_category_flow',
]

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
