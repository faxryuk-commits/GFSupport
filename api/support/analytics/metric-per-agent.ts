/**
 * Per-agent breakdown метрики — для табличного представления.
 *
 * GET /api/support/analytics/metric-per-agent?key=<metric_key>&period=<period>[&source=][&market=]
 *
 * Поддерживается: `frt_avg_minutes`, `sla_compliance_rate`.
 * Другие метрики (sentiment, repeat) имеют perAgent=false — для них
 * per-agent не имеет смысла (они per-channel/per-team).
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
  computeSlaCompliancePerAgent,
  frtAvgDescriptor,
  slaComplianceDescriptor,
  parsePeriodParam,
  resolvePeriod,
} from './metrics/index.js'
import type { MetricDescriptor } from './metrics/index.js'

export const config = {
  runtime: 'edge',
}

const SUPPORTED: Record<
  string,
  {
    descriptor: MetricDescriptor
    compute: (
      scope: { orgId: string; market: string | null; source: string | null },
      period: ReturnType<typeof resolvePeriod>,
    ) => Promise<{
      rows: Array<{
        agentId: string
        agentName: string | null
        value: number
        sampleSize: number
        status: string
      }>
      benchmarks: unknown
    }>
  }
> = {
  [frtAvgDescriptor.key]: {
    descriptor: frtAvgDescriptor,
    compute: computeFrtAvgPerAgent,
  },
  [slaComplianceDescriptor.key]: {
    descriptor: slaComplianceDescriptor,
    compute: computeSlaCompliancePerAgent,
  },
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

  const entry = SUPPORTED[key]
  if (!entry) {
    return json(
      {
        error: `Per-agent breakdown not supported for metric: ${key}`,
        supported: Object.keys(SUPPORTED),
      },
      400,
    )
  }

  const orgId = await getRequestOrgId(req)
  const period = resolvePeriod(parsePeriodParam(url.searchParams.get('period')))
  const market = url.searchParams.get('market')
  const source = url.searchParams.get('source')

  try {
    const result = await entry.compute({ orgId, market, source }, period)
    return json(
      {
        descriptor: entry.descriptor,
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
