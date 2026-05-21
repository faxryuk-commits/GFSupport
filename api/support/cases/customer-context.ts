/**
 * Customer 360 context для кейса.
 *
 * GET /api/support/cases/customer-context?channelId=X
 *
 * Возвращает компактный профиль клиента: имя/канал, история кейсов (всего/активных/решённых),
 * recurring count, последние 3 решённых кейса (с resolutionNotes — «так решали раньше»),
 * client health band если есть. Дешёвый — несколько count'ов + 3 row'ов.
 */

import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const orgId = await getRequestOrgId(req)
  const sql = getSQL()
  const url = new URL(req.url)

  const channelId = url.searchParams.get('channelId')
  const excludeCaseId = url.searchParams.get('excludeCaseId') // не показывать текущий кейс среди "похожих"

  if (!channelId) return json({ error: 'channelId required' }, 400)

  try {
    // Профиль канала / компании
    const [channel] = await sql`
      SELECT id, name, type, source, company_id, telegram_chat_id, market_id, created_at
      FROM support_channels
      WHERE id = ${channelId} AND org_id = ${orgId}
      LIMIT 1
    `.catch(() => [])

    if (!channel) return json({ error: 'Channel not found' }, 404)

    // Подсчёт кейсов по статусам
    const counts = await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed','cancelled'))::int AS active,
        COUNT(*) FILTER (WHERE status IN ('resolved','closed'))::int AS resolved,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        COUNT(*) FILTER (WHERE is_recurring = true)::int AS recurring,
        COUNT(*) FILTER (WHERE COALESCE(is_shadow, false) = true)::int AS shadow,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7d,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS last_30d,
        AVG(resolution_time_minutes) FILTER (WHERE resolution_time_minutes > 0 AND COALESCE(is_shadow, false) = false) AS avg_resolution_minutes,
        MAX(resolved_at) FILTER (WHERE status IN ('resolved','closed')) AS last_resolved_at
      FROM support_cases
      WHERE channel_id = ${channelId} AND org_id = ${orgId}
    `

    const c = counts[0] || {}
    const stats = {
      total: c.total ?? 0,
      active: c.active ?? 0,
      resolved: c.resolved ?? 0,
      cancelled: c.cancelled ?? 0,
      recurring: c.recurring ?? 0,
      shadow: c.shadow ?? 0,
      last7d: c.last_7d ?? 0,
      last30d: c.last_30d ?? 0,
      avgResolutionMinutes: c.avg_resolution_minutes != null ? Number(c.avg_resolution_minutes) : null,
      avgResolutionHours: c.avg_resolution_minutes != null ? +(Number(c.avg_resolution_minutes) / 60).toFixed(1) : null,
      lastResolvedAt: c.last_resolved_at,
    }

    // Последние 3 решённых кейса с resolution_notes — «как решали раньше»
    const recentResolved = await sql`
      SELECT id, ticket_number, title, description, resolution_notes, category, priority, resolved_at,
             EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60.0 AS resolved_in_minutes
      FROM support_cases
      WHERE channel_id = ${channelId}
        AND org_id = ${orgId}
        AND status IN ('resolved','closed')
        AND (${excludeCaseId}::text IS NULL OR id <> ${excludeCaseId})
      ORDER BY resolved_at DESC NULLS LAST
      LIMIT 3
    `

    // Активные кейсы этого клиента (для контекста "что ещё открыто")
    const activeCases = await sql`
      SELECT id, ticket_number, title, status, priority, created_at,
             EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0 AS age_hours
      FROM support_cases
      WHERE channel_id = ${channelId}
        AND org_id = ${orgId}
        AND status NOT IN ('resolved','closed','cancelled')
        AND (${excludeCaseId}::text IS NULL OR id <> ${excludeCaseId})
      ORDER BY created_at DESC
      LIMIT 5
    `

    // Client Health, если канал есть в analytics. Дешёвая проверка — открываем
    // sentiment / resolution из сообщений за 30 дней по этому каналу.
    let health: { band: string; score: number | null; openCases: number; churnSignals: number } | null = null
    try {
      const healthRow = await sql`
        SELECT
          COUNT(*) FILTER (WHERE ai_sentiment IN ('negative','very_negative'))::int AS neg_msgs,
          COUNT(*) FILTER (WHERE ai_sentiment IS NOT NULL)::int AS rated_msgs,
          COUNT(*) FILTER (WHERE is_problem = true)::int AS problem_msgs
        FROM support_messages
        WHERE channel_id = ${channelId}
          AND org_id = ${orgId}
          AND created_at >= NOW() - INTERVAL '30 days'
      `
      const h = healthRow[0]
      if (h && h.rated_msgs > 0) {
        const negShare = h.neg_msgs / h.rated_msgs
        let band: string
        let score: number
        if (negShare >= 0.4 || stats.recurring >= 3) { band = 'critical'; score = 30 }
        else if (negShare >= 0.2 || stats.recurring >= 1) { band = 'at_risk'; score = 55 }
        else if (negShare < 0.1) { band = 'loyal'; score = 90 }
        else { band = 'healthy'; score = 75 }
        health = { band, score, openCases: stats.active, churnSignals: h.problem_msgs ?? 0 }
      }
    } catch { /* health is optional */ }

    return json({
      channel: {
        id: channel.id,
        name: channel.name,
        source: channel.source || 'telegram',
        type: channel.type,
        companyId: channel.company_id,
        telegramChatId: channel.telegram_chat_id,
        market: channel.market_id,
        createdAt: channel.created_at,
      },
      stats,
      recentResolved: recentResolved.map((r: any) => ({
        id: r.id,
        ticketNumber: r.ticket_number,
        title: r.title,
        description: r.description,
        resolutionNotes: r.resolution_notes,
        category: r.category,
        priority: r.priority,
        resolvedAt: r.resolved_at,
        resolvedInMinutes: r.resolved_in_minutes != null ? Number(r.resolved_in_minutes) : null,
      })),
      activeCases: activeCases.map((r: any) => ({
        id: r.id,
        ticketNumber: r.ticket_number,
        title: r.title,
        status: r.status,
        priority: r.priority,
        createdAt: r.created_at,
        ageHours: r.age_hours != null ? Number(r.age_hours) : null,
      })),
      health,
    }, 200, 60) // кэш 60 сек

  } catch (e: any) {
    console.error('Customer context error:', e)
    return json({ error: 'Failed to load customer context', detail: e?.message }, 500)
  }
}
