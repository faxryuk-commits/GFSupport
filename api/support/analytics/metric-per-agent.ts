/**
 * Per-agent breakdown метрики — для табличного представления.
 *
 * GET /api/support/analytics/metric-per-agent?key=<metric_key>&period=<period>[&source=][&market=]
 *
 * На сейчас поддерживается ТОЛЬКО `frt_avg_minutes`. Другие метрики имеют
 * perAgent=true (sla_compliance_rate) или perAgent=false (sentiment, repeat).
 * Расширение списка — отдельный шаг: каждая perAgent-метрика должна
 * экспортировать computeXPerAgent(scope, period).
 *
 * Ответ:
 *   {
 *     descriptor: MetricDescriptor,
 *     period: ResolvedPeriod,
 *     benchmarks: BenchmarkSet,         // общие на scope, один на таблицу
 *     rows: Array<{
 *       agentId, agentName,
 *       value, sampleSize, status
 *     }>
 *   }
 */

import { getRequestOrgId } from '../lib/org.js'
import { json } from '../lib/db.js'
import {
  computeFrtAvgPerAgent,
  frtAvgDescriptor,
  parsePeriodParam,
  resolvePeriod,
} from './metrics/index.js'

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

  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const url = new URL(req.url)
  const key = url.searchParams.get('key')
  if (!key) return json({ error: 'Missing query param "key"' }, 400)

  if (key !== frtAvgDescriptor.key) {
    return json(
      {
        error: `Per-agent breakdown not supported for metric: ${key}`,
        supported: [frtAvgDescriptor.key],
      },
      400,
    )
  }

  const orgId = await getRequestOrgId(req)
  const period = resolvePeriod(parsePeriodParam(url.searchParams.get('period')))
  const market = url.searchParams.get('market')
  const source = url.searchParams.get('source')

  try {
    const result = await computeFrtAvgPerAgent({ orgId, market, source }, period)
    return json(
      {
        descriptor: frtAvgDescriptor,
        period: {
          from: period.from.toISOString(),
          to: period.to.toISOString(),
          granularity: period.granularity,
          label: period.label,
        },
        benchmarks: result.benchmarks,
        rows: result.rows,
      },
      200,
      30,
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[metric-per-agent]', key, msg, e instanceof Error ? e.stack : undefined)
    return json({ error: msg, where: 'metric-per-agent', key }, 500)
  }
}
