import { getRequestOrgId } from '../lib/org.js'
import { fetchTeamFrtAggregate } from '../lib/team-frt-aggregate.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

/**
 * GET /api/support/analytics/team-frt
 * Лёгкий ответ только для страницы «Команда»: среднее FRT и разбивка по сотрудникам
 * (та же логика, что в sla-report, один запрос без тяжёлых побочных эффектов).
 */
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

  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)

  const fromDate = url.searchParams.get('from') || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const toDate = url.searchParams.get('to') || new Date().toISOString().split('T')[0]
  const slaMinutes = parseInt(url.searchParams.get('sla_minutes') || '10', 10)
  const market = url.searchParams.get('market') || null
  const source = url.searchParams.get('source') || 'all'

  const fromDateTime = `${fromDate}T00:00:00+05:00`
  const toDateTime = `${toDate}T23:59:59+05:00`

  try {
    const { avgResponseMinutes, agents } = await fetchTeamFrtAggregate(sql, {
      orgId,
      fromDateTime,
      toDateTime,
      market,
      source,
    })

    const agentPerformance = agents.map((a) => ({
      name: a.name,
      totalResponses: a.totalResponses,
      avgMinutes: a.avgMinutes,
    }))

    return json(
      {
        period: {
          from: fromDate,
          to: toDate,
          slaMinutes,
          source,
        },
        responseTimeSummary: {
          avgResponseMinutes,
        },
        agentPerformance,
      },
      200,
      60,
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[team-frt]', msg)
    return json({ error: msg }, 500)
  }
}
