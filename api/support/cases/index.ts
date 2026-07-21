import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'
import { checkOrgRateLimit } from '../lib/rate-limit.js'

export const config = {
  runtime: 'edge',
}

const VALID_STATUSES = new Set([
  'detected', 'in_progress', 'waiting', 'blocked',
  'resolved', 'closed', 'cancelled', 'recurring',
])
const VALID_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent', 'critical'])
const VALID_SOURCES = new Set(['telegram', 'whatsapp'])
const VALID_SORTS = new Set(['priority', 'created_desc', 'created_asc', 'last_activity'])

// SLA пороги (часы от created_at) — overdue считается до появления собственных полей sla_*
const SLA_HOURS_BY_PRIORITY: Record<string, number> = {
  critical: 4,
  urgent: 4,
  high: 24,
  medium: 72,
  low: 168,
}

function parseList(raw: string | null, allowed: Set<string>): string[] | null {
  if (!raw || raw === 'all') return null
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean).filter(s => allowed.has(s))
  return parts.length ? parts : null
}

function parseIsoDate(raw: string | null): string | null {
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const orgId = await getRequestOrgId(req)
  const rateCheck = checkOrgRateLimit(orgId || 'unknown')
  if (!rateCheck.allowed) return json({ error: 'Too many requests' }, 429)

  const sql = getSQL()
  const url = new URL(req.url)

  // GET — список кейсов
  if (req.method === 'GET') {
    try {
      // --- Фильтры ---
      // statuses: comma-separated whitelist, либо preset 'active' / 'archive'
      const statusParam = url.searchParams.get('status')
      let statuses: string[] | null = null
      if (statusParam === 'active') {
        statuses = ['detected', 'in_progress', 'waiting', 'blocked', 'recurring']
      } else if (statusParam === 'archive') {
        statuses = ['resolved', 'closed', 'cancelled']
      } else {
        statuses = parseList(statusParam, VALID_STATUSES)
      }

      const priorities = parseList(url.searchParams.get('priority'), VALID_PRIORITIES)
      const channelId = url.searchParams.get('channelId') || null
      const assignedTo = url.searchParams.get('assignedTo') || null
      const unassigned = url.searchParams.get('unassigned') === 'true'
      const search = url.searchParams.get('search')?.trim() || null
      const market = url.searchParams.get('market') || null
      const dateFrom = parseIsoDate(url.searchParams.get('dateFrom'))
      const dateTo = parseIsoDate(url.searchParams.get('dateTo'))
      const source = (url.searchParams.get('source') || '').toLowerCase()
      const sourceFilter = VALID_SOURCES.has(source) ? source : null
      const overdueHoursParam = parseInt(url.searchParams.get('overdueHours') || '0')
      const overdueHours = overdueHoursParam > 0 ? overdueHoursParam : null
      const onlyOverdue = url.searchParams.get('overdue') === 'true'
      // Snooze: по умолчанию скрываем отложенные. `snoozed=only` показывает только их, `snoozed=include` — все.
      const snoozedMode = url.searchParams.get('snoozed') || 'hide'

      const sortBy = url.searchParams.get('sortBy') || 'priority'
      const sortValid = VALID_SORTS.has(sortBy) ? sortBy : 'priority'

      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50'), 1), 500)
      const offset = Math.max(parseInt(url.searchParams.get('offset') || '0'), 0)

      // --- Единый SELECT с условным WHERE ---
      // Используем NULL-coalescing pattern: `${param} IS NULL OR column = ${param}`.
      // Подзапросы заменены на LEFT JOIN-LATERAL для уменьшения cost.
      const rows = await sql`
        WITH msg_stats AS (
          SELECT case_id,
                 COUNT(*) AS messages_count,
                 MIN(created_at) AS first_message_at,
                 (ARRAY_AGG(sender_name ORDER BY created_at ASC))[1] AS reporter_name
          FROM support_messages
          WHERE org_id = ${orgId} AND case_id IS NOT NULL
          GROUP BY case_id
        ),
        act_stats AS (
          SELECT case_id,
                 MAX(created_at) AS last_activity_at,
                 MAX(CASE WHEN type IN ('status_change','status_changed') THEN created_at END) AS last_status_change_at,
                 (ARRAY_AGG(type ORDER BY created_at DESC))[1] AS last_activity_type
          FROM support_case_activities
          GROUP BY case_id
        )
        SELECT c.*, ch.name AS channel_name, ch.telegram_chat_id, ch.company_id AS ch_company_id, ch.source AS channel_source,
          a.name AS assignee_name,
          COALESCE(m.messages_count, 0) AS messages_count,
          m.reporter_name,
          m.first_message_at,
          act.last_activity_at,
          act.last_status_change_at,
          act.last_activity_type,
          -- age считается от первого сообщения клиента (точнее), fallback на created_at кейса
          EXTRACT(EPOCH FROM (NOW() - COALESCE(m.first_message_at, c.created_at))) / 3600.0 AS age_hours,
          -- точное время решения "от сообщения": если есть first_message_at и resolved_at, считаем заново
          CASE
            WHEN c.resolved_at IS NOT NULL AND m.first_message_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (c.resolved_at - m.first_message_at)) / 60.0
            ELSE c.resolution_time_minutes
          END AS resolution_time_minutes_from_msg,
          -- FRT: время первого ответа команды, считаем от первого сообщения клиента.
          -- Условие first_response_at >= first_message_at отсекает случаи, когда первым
          -- сообщением был ответ команды (иначе получили бы отрицательный FRT).
          CASE
            WHEN c.first_response_at IS NOT NULL AND m.first_message_at IS NOT NULL
                 AND c.first_response_at >= m.first_message_at
            THEN EXTRACT(EPOCH FROM (c.first_response_at - m.first_message_at)) / 60.0
            ELSE NULL
          END AS frt_minutes
        FROM support_cases c
        LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
        LEFT JOIN support_agents a ON c.assigned_to = a.id
        LEFT JOIN msg_stats m ON m.case_id = c.id
        LEFT JOIN act_stats act ON act.case_id = c.id
        WHERE c.org_id = ${orgId}
          AND (${statuses}::text[] IS NULL OR c.status = ANY(${statuses}::text[]))
          AND (${priorities}::text[] IS NULL OR c.priority = ANY(${priorities}::text[]))
          AND (${channelId}::text IS NULL OR c.channel_id = ${channelId})
          AND (
            ${assignedTo}::text IS NULL
            OR (${assignedTo} = '__none__' AND c.assigned_to IS NULL)
            OR c.assigned_to = ${assignedTo}
          )
          AND (NOT ${unassigned} OR c.assigned_to IS NULL)
          AND (${market}::text IS NULL OR c.market_id = ${market})
          AND (${sourceFilter}::text IS NULL OR ch.source = ${sourceFilter})
          AND (${dateFrom}::timestamptz IS NULL OR c.created_at >= ${dateFrom}::timestamptz)
          AND (${dateTo}::timestamptz IS NULL OR c.created_at <= ${dateTo}::timestamptz)
          AND (
            ${search}::text IS NULL
            OR c.title ILIKE '%' || ${search} || '%'
            OR c.description ILIKE '%' || ${search} || '%'
            OR CAST(c.ticket_number AS text) = ${search}
          )
          AND (
            NOT ${onlyOverdue}
            OR (
              c.status NOT IN ('resolved','closed','cancelled')
              AND EXTRACT(EPOCH FROM (NOW() - COALESCE(m.first_message_at, c.created_at))) / 3600.0 >= CASE c.priority
                WHEN 'critical' THEN 4 WHEN 'urgent' THEN 4
                WHEN 'high' THEN 24 WHEN 'medium' THEN 72
                ELSE 168 END
            )
          )
          AND (${overdueHours}::int IS NULL OR EXTRACT(EPOCH FROM (NOW() - COALESCE(m.first_message_at, c.created_at))) / 3600.0 >= ${overdueHours}::int)
          AND (
            ${snoozedMode} = 'include'
            OR (${snoozedMode} = 'only' AND c.snoozed_until IS NOT NULL AND c.snoozed_until > NOW())
            OR (${snoozedMode} = 'hide' AND (c.snoozed_until IS NULL OR c.snoozed_until <= NOW()))
          )
        ORDER BY
          CASE WHEN ${sortValid} = 'priority' THEN
            CASE c.priority WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
          END ASC NULLS LAST,
          CASE WHEN ${sortValid} = 'last_activity' THEN COALESCE(act.last_activity_at, c.updated_at, c.created_at) END DESC NULLS LAST,
          CASE WHEN ${sortValid} = 'created_asc' THEN c.created_at END ASC NULLS LAST,
          c.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `

      // Total count (для пагинации) — отдельный запрос с теми же фильтрами
      const totalResult = await sql`
        SELECT COUNT(*)::int AS total
        FROM support_cases c
        LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
        LEFT JOIN (
          SELECT case_id, MIN(created_at) AS first_message_at
          FROM support_messages
          WHERE org_id = ${orgId} AND case_id IS NOT NULL
          GROUP BY case_id
        ) m ON m.case_id = c.id
        WHERE c.org_id = ${orgId}
          AND (${statuses}::text[] IS NULL OR c.status = ANY(${statuses}::text[]))
          AND (${priorities}::text[] IS NULL OR c.priority = ANY(${priorities}::text[]))
          AND (${channelId}::text IS NULL OR c.channel_id = ${channelId})
          AND (
            ${assignedTo}::text IS NULL
            OR (${assignedTo} = '__none__' AND c.assigned_to IS NULL)
            OR c.assigned_to = ${assignedTo}
          )
          AND (NOT ${unassigned} OR c.assigned_to IS NULL)
          AND (${market}::text IS NULL OR c.market_id = ${market})
          AND (${sourceFilter}::text IS NULL OR ch.source = ${sourceFilter})
          AND (${dateFrom}::timestamptz IS NULL OR c.created_at >= ${dateFrom}::timestamptz)
          AND (${dateTo}::timestamptz IS NULL OR c.created_at <= ${dateTo}::timestamptz)
          AND (
            ${search}::text IS NULL
            OR c.title ILIKE '%' || ${search} || '%'
            OR c.description ILIKE '%' || ${search} || '%'
            OR CAST(c.ticket_number AS text) = ${search}
          )
          AND (
            NOT ${onlyOverdue}
            OR (
              c.status NOT IN ('resolved','closed','cancelled')
              AND EXTRACT(EPOCH FROM (NOW() - COALESCE(m.first_message_at, c.created_at))) / 3600.0 >= CASE c.priority
                WHEN 'critical' THEN 4 WHEN 'urgent' THEN 4
                WHEN 'high' THEN 24 WHEN 'medium' THEN 72
                ELSE 168 END
            )
          )
          AND (${overdueHours}::int IS NULL OR EXTRACT(EPOCH FROM (NOW() - COALESCE(m.first_message_at, c.created_at))) / 3600.0 >= ${overdueHours}::int)
          AND (
            ${snoozedMode} = 'include'
            OR (${snoozedMode} = 'only' AND c.snoozed_until IS NOT NULL AND c.snoozed_until > NOW())
            OR (${snoozedMode} = 'hide' AND (c.snoozed_until IS NULL OR c.snoozed_until <= NOW()))
          )
      `
      const total = totalResult[0]?.total ?? 0

      // Статистика по статусам (вне фильтров — для бейджей "Активные" / "Архив")
      const statsResult = await sql`
        SELECT status, COUNT(*)::int AS count
        FROM support_cases
        WHERE org_id = ${orgId}
          AND (${market}::text IS NULL OR market_id = ${market})
        GROUP BY status
      `
      const stats = Object.fromEntries(statsResult.map((s: any) => [s.status, s.count]))

      // Метрики времени решения за период (по умолчанию 30 дней).
      // Считается от ПЕРВОГО СООБЩЕНИЯ КЛИЕНТА (а не от created_at кейса) — fallback на cases.created_at для кейсов без привязанных сообщений.
      // Shadow-кейсы исключаем (искажают среднее вниз).
      const metricsPeriodDays = Math.min(Math.max(parseInt(url.searchParams.get('metricsPeriodDays') || '30'), 1), 365)
      const metricsRow = await sql`
        WITH resolved_cases AS (
          SELECT c.id, c.is_shadow,
                 EXTRACT(EPOCH FROM (c.resolved_at - COALESCE(m.first_message_at, c.created_at))) / 60.0 AS res_minutes
          FROM support_cases c
          LEFT JOIN (
            SELECT case_id, MIN(created_at) AS first_message_at
            FROM support_messages
            WHERE org_id = ${orgId} AND case_id IS NOT NULL
            GROUP BY case_id
          ) m ON m.case_id = c.id
          WHERE c.org_id = ${orgId}
            AND c.status IN ('resolved','closed')
            AND c.resolved_at IS NOT NULL
            AND c.resolved_at >= NOW() - (${metricsPeriodDays} || ' days')::interval
            AND (${market}::text IS NULL OR c.market_id = ${market})
        )
        SELECT
          COUNT(*) FILTER (WHERE res_minutes > 0 AND COALESCE(is_shadow, false) = false)::int AS resolved_count,
          AVG(res_minutes) FILTER (WHERE res_minutes > 0 AND COALESCE(is_shadow, false) = false) AS avg_minutes,
          MAX(res_minutes) FILTER (WHERE COALESCE(is_shadow, false) = false) AS max_minutes,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY res_minutes) FILTER (WHERE res_minutes > 0 AND COALESCE(is_shadow, false) = false) AS median_minutes,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY res_minutes) FILTER (WHERE res_minutes > 0 AND COALESCE(is_shadow, false) = false) AS p95_minutes,
          COUNT(*) FILTER (WHERE COALESCE(is_shadow, false) = true)::int AS shadow_count
        FROM resolved_cases
      `
      const m = metricsRow[0] || {}
      const avgMin = m.avg_minutes != null ? Number(m.avg_minutes) : null
      const maxMin = m.max_minutes != null ? Number(m.max_minutes) : null
      const medMin = m.median_minutes != null ? Number(m.median_minutes) : null
      const p95Min = m.p95_minutes != null ? Number(m.p95_minutes) : null
      const resolutionMetrics = {
        periodDays: metricsPeriodDays,
        resolvedCount: m.resolved_count ?? 0,
        shadowCount: m.shadow_count ?? 0,
        avgMinutes: avgMin,
        maxMinutes: maxMin,
        medianMinutes: medMin,
        p95Minutes: p95Min,
        avgHours: avgMin != null ? +(avgMin / 60).toFixed(2) : null,
        maxHours: maxMin != null ? +(maxMin / 60).toFixed(2) : null,
        medianHours: medMin != null ? +(medMin / 60).toFixed(2) : null,
        p95Hours: p95Min != null ? +(p95Min / 60).toFixed(2) : null,
      }

      // Overdue counter (по активным кейсам) — возраст от первого сообщения клиента
      const overdueRow = await sql`
        SELECT COUNT(*)::int AS overdue
        FROM support_cases c
        LEFT JOIN (
          SELECT case_id, MIN(created_at) AS first_message_at
          FROM support_messages
          WHERE org_id = ${orgId} AND case_id IS NOT NULL
          GROUP BY case_id
        ) m ON m.case_id = c.id
        WHERE c.org_id = ${orgId}
          AND c.status NOT IN ('resolved','closed','cancelled')
          AND EXTRACT(EPOCH FROM (NOW() - COALESCE(m.first_message_at, c.created_at))) / 3600.0 >= CASE c.priority
            WHEN 'critical' THEN 4 WHEN 'urgent' THEN 4
            WHEN 'high' THEN 24 WHEN 'medium' THEN 72
            ELSE 168 END
          AND (${market}::text IS NULL OR c.market_id = ${market})
      `
      const overdueCount = overdueRow[0]?.overdue ?? 0

      // Snooze counter (активные отложенные кейсы)
      const snoozedRow = await sql`
        SELECT COUNT(*)::int AS snoozed
        FROM support_cases
        WHERE org_id = ${orgId}
          AND status NOT IN ('resolved','closed','cancelled')
          AND snoozed_until IS NOT NULL
          AND snoozed_until > NOW()
          AND (${market}::text IS NULL OR market_id = ${market})
      `.catch(() => [{ snoozed: 0 }])
      const snoozedCount = snoozedRow[0]?.snoozed ?? 0

      return json({
        cases: rows.map((c: any) => {
          const ageHours = c.age_hours != null ? Number(c.age_hours) : null
          const slaThreshold = SLA_HOURS_BY_PRIORITY[c.priority] ?? 72
          const isActive = !['resolved', 'closed', 'cancelled'].includes(c.status)
          const isOverdue = isActive && ageHours != null && ageHours >= slaThreshold
          return {
            id: c.id,
            ticketNumber: c.ticket_number,
            channelId: c.channel_id,
            channelName: c.channel_name || 'Без канала',
            channelSource: c.channel_source || 'telegram',
            telegramChatId: c.telegram_chat_id,
            companyId: c.company_id || c.ch_company_id,
            companyName: c.channel_name || 'Без компании',
            leadId: c.lead_id,
            title: c.title || 'Без названия',
            description: c.description || '',
            status: c.status || 'detected',
            category: c.category || 'general',
            subcategory: c.subcategory,
            rootCause: c.root_cause,
            priority: c.priority || 'medium',
            severity: c.severity,
            assignedTo: c.assigned_to,
            assigneeName: c.assignee_name || null,
            reporterName: c.reporter_name,
            firstResponseAt: c.first_response_at,
            firstMessageAt: c.first_message_at,
            firstResponseMinutes: c.frt_minutes != null ? Number(c.frt_minutes) : null,
            resolvedAt: c.resolved_at,
            resolutionTimeMinutes: c.resolution_time_minutes_from_msg != null ? Number(c.resolution_time_minutes_from_msg) : c.resolution_time_minutes,
            resolutionNotes: c.resolution_notes,
            impactMrr: parseFloat(c.impact_mrr || 0),
            churnRiskScore: c.churn_risk_score,
            isRecurring: c.is_recurring,
            isShadow: c.is_shadow ?? false,
            relatedCaseId: c.related_case_id,
            tags: c.tags || [],
            messagesCount: parseInt(c.messages_count || 0),
            sourceMessageId: c.source_message_id,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
            updatedBy: c.updated_by,
            lastActivityAt: c.last_activity_at,
            lastStatusChangeAt: c.last_status_change_at,
            lastActivityType: c.last_activity_type,
            ageHours,
            slaThresholdHours: slaThreshold,
            isOverdue,
            snoozedUntil: c.snoozed_until,
            snoozedBy: c.snoozed_by,
            snoozeReason: c.snooze_reason,
            isSnoozed: c.snoozed_until && new Date(c.snoozed_until) > new Date(),
          }
        }),
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
        stats,
        metrics: resolutionMetrics,
        overdueCount,
        snoozedCount,
      })

    } catch (e: any) {
      console.error('Cases fetch error:', e)
      return json({ error: 'Failed to fetch cases', detail: e?.message }, 500)
    }
  }

  // POST — создать кейс
  if (req.method === 'POST') {
    try {
      const body = await req.json()

      const {
        channelId, companyId, companyName, leadId, title, description,
        category, subcategory, priority, severity, assignedTo, tags
      } = body

      if (!title) {
        return json({ error: 'Title is required' }, 400)
      }

      const caseId = `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

      // Получаем следующий номер тикета
      let ticketNumber: number
      try {
        await sql`CREATE SEQUENCE IF NOT EXISTS support_case_ticket_seq START WITH 1000`
        const maxResult = await sql`SELECT COALESCE(MAX(ticket_number), 1000) as max_num FROM support_cases WHERE org_id = ${orgId}`
        const maxNum = parseInt(maxResult[0]?.max_num || '1000')
        await sql`SELECT setval('support_case_ticket_seq', GREATEST(nextval('support_case_ticket_seq'), ${maxNum + 1}), false)`
        const seqResult = await sql`SELECT nextval('support_case_ticket_seq') as num`
        ticketNumber = parseInt(seqResult[0]?.num || '1001')
      } catch {
        const maxResult = await sql`SELECT COALESCE(MAX(ticket_number), 1000) as max_num FROM support_cases WHERE org_id = ${orgId}`
        ticketNumber = parseInt(maxResult[0]?.max_num || '1000') + 1
      }

      await sql`
        INSERT INTO support_cases (
          id, org_id, ticket_number, channel_id, company_id, lead_id, title, description,
          category, subcategory, priority, severity, assigned_to, tags
        ) VALUES (
          ${caseId},
          ${orgId},
          ${ticketNumber},
          ${channelId || null},
          ${companyId || null},
          ${leadId || null},
          ${title},
          ${description || null},
          ${category || null},
          ${subcategory || null},
          ${priority || 'medium'},
          ${severity || 'normal'},
          ${assignedTo || null},
          ${tags || []}
        )
      `

      await sql`
        INSERT INTO support_case_activities (id, case_id, type, title)
        VALUES (${'act_' + Date.now()}, ${caseId}, 'created', 'Кейс создан')
      `.catch(() => {})

      const createdCase = await sql`
        SELECT c.*, ch.name as channel_name, ch.telegram_chat_id, ch.source as channel_source, a.name as assignee_name
        FROM support_cases c
        LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
        LEFT JOIN support_agents a ON c.assigned_to = a.id
        WHERE c.id = ${caseId} AND c.org_id = ${orgId}
      `

      const c = createdCase[0]
      const slaThreshold = SLA_HOURS_BY_PRIORITY[c.priority] ?? 72

      return json({
        success: true,
        caseId,
        ticketNumber,
        message: 'Case created',
        case: {
          id: c.id,
          ticketNumber: c.ticket_number,
          channelId: c.channel_id,
          channelName: c.channel_name || 'Без канала',
          channelSource: c.channel_source || 'telegram',
          telegramChatId: c.telegram_chat_id,
          companyId: c.company_id,
          companyName: c.channel_name || 'Без компании',
          leadId: c.lead_id,
          title: c.title,
          description: c.description || '',
          status: c.status || 'detected',
          category: c.category || 'general',
          subcategory: c.subcategory,
          priority: c.priority || 'medium',
          severity: c.severity,
          assignedTo: c.assigned_to,
          assigneeName: c.assignee_name,
          tags: c.tags || [],
          messagesCount: 0,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          ageHours: 0,
          slaThresholdHours: slaThreshold,
          isOverdue: false,
        }
      })

    } catch (e: any) {
      console.error('Case create error:', e)
      return json({ error: 'Failed to create case', detail: e?.message }, 500)
    }
  }

  // DELETE — удалить кейс
  if (req.method === 'DELETE') {
    try {
      const caseId = url.searchParams.get('id')
      if (!caseId) return json({ error: 'Case ID required' }, 400)

      await sql`DELETE FROM support_case_comments WHERE case_id = ${caseId}`.catch(() => {})
      await sql`UPDATE support_messages SET case_id = NULL WHERE case_id = ${caseId} AND org_id = ${orgId}`.catch(() => {})
      await sql`DELETE FROM support_case_activities WHERE case_id = ${caseId}`.catch(() => {})
      await sql`DELETE FROM support_cases WHERE id = ${caseId} AND org_id = ${orgId}`

      return json({ success: true, deleted: caseId })
    } catch (e: any) {
      console.error('Case delete error:', e)
      return json({ error: 'Failed to delete case' }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
