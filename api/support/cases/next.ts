/**
 * "Взять следующий кейс" — алгоритм приоритезации очереди support.
 *
 * POST /api/support/cases/next
 * Body: { agentId, autoAssign?: boolean (default true), autoStart?: boolean (default true) }
 *
 * Алгоритм (по убыванию приоритета):
 *   1. Срочные/критичные + просроченные   (priority IN ('critical','urgent') AND age > SLA)
 *   2. Мои назначенные + просроченные      (assigned_to=me AND age > SLA)
 *   3. Любые просроченные                  (age > SLA)
 *   4. Срочные не просроченные             (priority IN ('critical','urgent'))
 *   5. Мои назначенные не просроченные     (assigned_to=me)
 *   6. Новые без агента FIFO               (assigned_to IS NULL, oldest first)
 *
 * Если autoAssign=true → assigned_to ставится в agentId.
 * Если autoStart=true → status → 'in_progress' (если был 'detected').
 *
 * Возвращает выбранный кейс или { case: null, reason: 'queue_empty' }.
 */

import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'
import { checkOrgRateLimit } from '../lib/rate-limit.js'

export const config = {
  runtime: 'edge',
}

const SLA_HOURS: Record<string, number> = {
  critical: 4, urgent: 4, high: 24, medium: 72, low: 168,
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const orgId = await getRequestOrgId(req)
  const rateCheck = checkOrgRateLimit(orgId || 'unknown')
  if (!rateCheck.allowed) return json({ error: 'Too many requests' }, 429)

  const sql = getSQL()

  try {
    const body = await req.json().catch(() => ({}))
    const { agentId, autoAssign = true, autoStart = true } = body

    if (!agentId) return json({ error: 'agentId required' }, 400)

    // Единый запрос: проранжируем все доступные кейсы по приоритету очереди.
    // 1 = срочные+просроч, 2 = мои+просроч, 3 = любые просроч, 4 = срочные, 5 = мои, 6 = новые без агента
    const rows = await sql`
      WITH cases_with_age AS (
        SELECT c.*,
               EXTRACT(EPOCH FROM (NOW() - COALESCE(
                 (SELECT MIN(created_at) FROM support_messages WHERE case_id = c.id AND org_id = ${orgId}),
                 c.created_at
               ))) / 3600.0 AS age_hours,
               CASE c.priority
                 WHEN 'critical' THEN 4 WHEN 'urgent' THEN 4
                 WHEN 'high' THEN 24 WHEN 'medium' THEN 72 ELSE 168
               END AS sla_threshold
        FROM support_cases c
        WHERE c.org_id = ${orgId}
          AND c.status NOT IN ('resolved','closed','cancelled')
          AND (c.snoozed_until IS NULL OR c.snoozed_until <= NOW())
      ),
      ranked AS (
        SELECT *,
               CASE
                 WHEN priority IN ('critical','urgent') AND age_hours >= sla_threshold THEN 1
                 WHEN assigned_to = ${agentId} AND age_hours >= sla_threshold THEN 2
                 WHEN age_hours >= sla_threshold THEN 3
                 WHEN priority IN ('critical','urgent') THEN 4
                 WHEN assigned_to = ${agentId} THEN 5
                 WHEN assigned_to IS NULL THEN 6
                 ELSE 99
               END AS queue_rank
        FROM cases_with_age
      )
      SELECT * FROM ranked
      WHERE queue_rank < 99
      ORDER BY queue_rank ASC, age_hours DESC, created_at ASC
      LIMIT 1
    `

    if (!rows[0]) {
      return json({ case: null, reason: 'queue_empty' })
    }

    const picked = rows[0]
    let updated = false

    // Назначение + старт работы (если требуется)
    if (autoAssign && picked.assigned_to !== agentId) {
      await sql`UPDATE support_cases SET assigned_to = ${agentId}, updated_at = NOW() WHERE id = ${picked.id} AND org_id = ${orgId}`
      await sql`
        INSERT INTO support_case_activities (id, case_id, type, title, manager_id)
        VALUES (${'act_' + Date.now()}, ${picked.id}, 'assigned', 'Кейс взят в работу (Take Next)', ${agentId})
      `.catch(() => {})
      updated = true
    }

    if (autoStart && picked.status === 'detected') {
      await sql`UPDATE support_cases SET status = 'in_progress', updated_at = NOW() WHERE id = ${picked.id} AND org_id = ${orgId}`
      await sql`
        INSERT INTO support_case_activities (id, case_id, type, title, from_status, to_status, manager_id)
        VALUES (${'act_' + Date.now()}, ${picked.id}, 'status_change', 'Take Next: detected → in_progress', 'detected', 'in_progress', ${agentId})
      `.catch(() => {})
      updated = true
    }

    // Перечитаем кейс с полными полями
    const [c] = await sql`
      SELECT c.*, ch.name AS channel_name, ch.source AS channel_source, a.name AS assignee_name
      FROM support_cases c
      LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
      LEFT JOIN support_agents a ON c.assigned_to = a.id
      WHERE c.id = ${picked.id} AND c.org_id = ${orgId}
    `

    return json({
      case: {
        id: c.id,
        ticketNumber: c.ticket_number,
        channelId: c.channel_id,
        channelName: c.channel_name || 'Без канала',
        channelSource: c.channel_source || 'telegram',
        companyName: c.channel_name || 'Без компании',
        title: c.title || 'Без названия',
        description: c.description || '',
        status: c.status,
        category: c.category || 'general',
        priority: c.priority || 'medium',
        assignedTo: c.assigned_to,
        assigneeName: c.assignee_name,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        ageHours: Number(picked.age_hours),
        slaThresholdHours: Number(picked.sla_threshold),
        isOverdue: Number(picked.age_hours) >= Number(picked.sla_threshold),
        queueRank: picked.queue_rank,
        tags: c.tags || [],
        messagesCount: 0,
      },
      updated,
      reason: pickReason(picked.queue_rank),
    })

  } catch (e: any) {
    console.error('Take Next error:', e)
    return json({ error: 'Failed to take next case', detail: e?.message }, 500)
  }
}

function pickReason(rank: number): string {
  switch (rank) {
    case 1: return 'urgent_overdue'
    case 2: return 'mine_overdue'
    case 3: return 'overdue'
    case 4: return 'urgent'
    case 5: return 'mine'
    case 6: return 'unassigned_new'
    default: return 'normal'
  }
}
