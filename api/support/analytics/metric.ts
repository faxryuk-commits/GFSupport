/**
 * Generic metric endpoint — единая точка входа для всего семантического слоя.
 *
 * GET /api/support/analytics/metric?key=<metric_key>&period=<period>[&agentId=<id>][&market=<m>][&source=<s>][&role=<r>]
 *
 * Возвращает MetricResult (см. metrics/types.ts).
 *
 * Параметры:
 *   key      — ключ метрики (например, 'frt_avg_minutes'). Обязательный.
 *   period   — 'today'|'yesterday'|'this_week'|'last_week'|'this_month'|'last_month'|'7d'|'30d'|'90d'.
 *              По умолчанию '30d'.
 *   agentId  — ID агента в support_agents.id (для метрик с perAgent=true).
 *   market   — фильтр по рынку.
 *   source   — 'telegram'|'whatsapp'|'all'.
 *   role     — фильтр по роли агента (для team-level).
 *
 * Новые метрики добавляются через регистрацию в REGISTRY ниже — никаких
 * новых endpoint-файлов плодить не нужно.
 */

import { getRequestOrgId } from '../lib/org.js'
import { json } from '../lib/db.js'
import {
  computeFrtAvg,
  frtAvgDescriptor,
  parsePeriodParam,
  resolvePeriod,
} from './metrics/index.js'
import type {
  MetricDescriptor,
  MetricResult,
  MetricScope,
  ResolvedPeriod,
} from './metrics/index.js'

export const config = {
  runtime: 'edge',
}

type MetricCompute = (scope: MetricScope, period: ResolvedPeriod) => Promise<MetricResult>

const REGISTRY: Record<string, { descriptor: MetricDescriptor; compute: MetricCompute }> = {
  [frtAvgDescriptor.key]: { descriptor: frtAvgDescriptor, compute: computeFrtAvg },
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

  const entry = REGISTRY[key]
  if (!entry) {
    return json(
      {
        error: `Unknown metric: ${key}`,
        available: Object.keys(REGISTRY),
      },
      404,
    )
  }

  const orgId = await getRequestOrgId(req)
  const period = resolvePeriod(parsePeriodParam(url.searchParams.get('period')))
  const scope: MetricScope = {
    orgId,
    agentId: url.searchParams.get('agentId'),
    market: url.searchParams.get('market'),
    source: url.searchParams.get('source'),
    role: url.searchParams.get('role'),
  }

  try {
    const result = await entry.compute(scope, period)
    return json(
      {
        descriptor: entry.descriptor,
        result,
      },
      200,
      30,
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[metric]', key, msg, e instanceof Error ? e.stack : undefined)
    return json({ error: msg, where: 'metric', key }, 500)
  }
}
