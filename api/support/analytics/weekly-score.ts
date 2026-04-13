import { getRequestOrgId } from '../lib/org.js'
import { getSQL } from '../lib/db.js'

export const config = { runtime: 'edge' }

interface WeekMetrics {
  weekStart: string
  weekEnd: string
  label: string
  avgResponseMin: number | null
  messagesIn: number
  messagesOut: number
  casesCreated: number
  casesResolved: number
  resolveRate: number
  commitmentsTotal: number
  commitmentsOverdue: number
  commitmentRate: number
  aiTotal: number
  aiCorrect: number
  aiAccuracy: number
  negativeSentiment: number
  totalSentiment: number
  satisfactionRate: number
  activeAgents: number
  score: number
}

const TARGET_RESPONSE_MIN = 10

function calcScore(m: WeekMetrics): number {
  const responseScore = m.avgResponseMin !== null
    ? Math.max(0, Math.min(1, 1 - (m.avgResponseMin - TARGET_RESPONSE_MIN) / (TARGET_RESPONSE_MIN * 3)))
    : 0.5
  const resolveScore = m.casesCreated > 0
    ? Math.min(1, m.casesResolved / m.casesCreated)
    : 0.5
  const commitScore = m.commitmentsTotal > 0
    ? 1 - (m.commitmentsOverdue / m.commitmentsTotal)
    : 0.7
  const aiScore = m.aiTotal > 0
    ? m.aiCorrect / m.aiTotal
    : 0.5
  const satScore = m.totalSentiment > 0
    ? 1 - (m.negativeSentiment / m.totalSentiment)
    : 0.7

  return Math.round((
    0.30 * responseScore +
    0.25 * resolveScore +
    0.20 * commitScore +
    0.15 * aiScore +
    0.10 * satScore
  ) * 100)
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

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)
  const weeksParam = parseInt(url.searchParams.get('weeks') || '8')
  const weeks = Math.min(weeksParam, 16)

  try {
    const now = new Date()
    const results: WeekMetrics[] = []

    for (let w = weeks - 1; w >= 0; w--) {
      const weekEnd = new Date(now)
      weekEnd.setDate(now.getDate() - w * 7)
      weekEnd.setHours(23, 59, 59, 999)

      const weekStart = new Date(weekEnd)
      weekStart.setDate(weekEnd.getDate() - 6)
      weekStart.setHours(0, 0, 0, 0)

      const from = weekStart.toISOString()
      const to = weekEnd.toISOString()

      const [msgs, cases, commitments, ai, sentiment, agentCount] = await Promise.all([
        sql`
          SELECT
            COUNT(*) FILTER (WHERE is_from_client = true)::int as msgs_in,
            COUNT(*) FILTER (WHERE is_from_client = false)::int as msgs_out,
            ROUND(AVG(response_time_ms) FILTER (
              WHERE response_time_ms IS NOT NULL AND response_time_ms > 0 AND response_time_ms < 86400000
            ))::bigint as avg_resp_ms
          FROM support_messages
          WHERE org_id = ${orgId} AND created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz
        `,
        sql`
          SELECT
            COUNT(*) FILTER (WHERE created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz)::int as created,
            COUNT(*) FILTER (WHERE resolved_at >= ${from}::timestamptz AND resolved_at <= ${to}::timestamptz)::int as resolved
          FROM support_cases WHERE org_id = ${orgId}
        `,
        sql`
          SELECT
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE status = 'overdue')::int as overdue
          FROM support_commitments
          WHERE org_id = ${orgId} AND created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz
        `,
        sql`
          SELECT
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE feedback = 'correct')::int as correct
          FROM support_agent_decisions
          WHERE org_id = ${orgId} AND created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz
        `,
        sql`
          SELECT
            COUNT(*) FILTER (WHERE ai_sentiment = 'negative')::int as negative,
            COUNT(*) FILTER (WHERE ai_sentiment IS NOT NULL)::int as total
          FROM support_messages
          WHERE org_id = ${orgId} AND is_from_client = true
            AND created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz
        `,
        sql`
          SELECT COUNT(DISTINCT sender_name)::int as cnt
          FROM support_messages
          WHERE org_id = ${orgId} AND is_from_client = false
            AND created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz
            AND sender_name IS NOT NULL AND LENGTH(sender_name) > 1
        `,
      ])

      const m = msgs[0] || {}
      const c = cases[0] || {}
      const cm = commitments[0] || {}
      const a = ai[0] || {}
      const s = sentiment[0] || {}
      const ac = agentCount[0] || {}

      const avgMs = Number(m.avg_resp_ms) || 0
      const avgMin = avgMs > 0 ? Math.round(avgMs / 60000) : null
      const casesCreated = Number(c.created) || 0
      const casesResolved = Number(c.resolved) || 0
      const cmTotal = Number(cm.total) || 0
      const cmOverdue = Number(cm.overdue) || 0
      const aiTotal = Number(a.total) || 0
      const aiCorrect = Number(a.correct) || 0
      const negSent = Number(s.negative) || 0
      const totSent = Number(s.total) || 0

      const weekLabel = `${weekStart.getDate().toString().padStart(2, '0')}.${(weekStart.getMonth() + 1).toString().padStart(2, '0')}`

      const week: WeekMetrics = {
        weekStart: from,
        weekEnd: to,
        label: weekLabel,
        avgResponseMin: avgMin,
        messagesIn: Number(m.msgs_in) || 0,
        messagesOut: Number(m.msgs_out) || 0,
        casesCreated,
        casesResolved,
        resolveRate: casesCreated > 0 ? Math.round((casesResolved / casesCreated) * 100) : 0,
        commitmentsTotal: cmTotal,
        commitmentsOverdue: cmOverdue,
        commitmentRate: cmTotal > 0 ? Math.round(((cmTotal - cmOverdue) / cmTotal) * 100) : 100,
        aiTotal,
        aiCorrect,
        aiAccuracy: aiTotal > 0 ? Math.round((aiCorrect / aiTotal) * 100) : 0,
        negativeSentiment: negSent,
        totalSentiment: totSent,
        satisfactionRate: totSent > 0 ? Math.round(((totSent - negSent) / totSent) * 100) : 100,
        activeAgents: Number(ac.cnt) || 0,
        score: 0,
      }
      week.score = calcScore(week)
      results.push(week)
    }

    const current = results[results.length - 1]
    const previous = results.length > 1 ? results[results.length - 2] : null
    const delta = previous ? current.score - previous.score : 0

    let streak = 0
    for (let i = results.length - 1; i >= 1; i--) {
      if (results[i].score > results[i - 1].score) streak++
      else break
    }

    let trend: 'improving' | 'stable' | 'declining'
    if (streak >= 3) trend = 'improving'
    else if (delta >= 0) trend = 'stable'
    else trend = 'declining'

    return json({
      currentScore: current.score,
      previousScore: previous?.score ?? null,
      delta,
      streak,
      trend,
      weeks: results,
    }, 200, 120)
  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
