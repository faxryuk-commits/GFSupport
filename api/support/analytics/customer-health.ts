/**
 * Endpoint для Client Health Score — состояние покупателей Delever.
 *
 * GET /api/support/analytics/customer-health?period=30d[&source=][&market=][&limit=50]
 *
 * Возвращает per-channel rows с composite health score, отсортированные
 * по «proблемности» (critical → at_risk → healthy).
 *
 * См. metrics/customerHealth.ts для формулы.
 */

import { getRequestOrgId } from '../lib/org.js'
import { json } from '../lib/db.js'
import { computeCustomerHealth, parsePeriodParam, resolvePeriod } from './metrics/index.js'
import type { CustomerHealthRow, HealthBand } from './metrics/index.js'

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

  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)
  const period = resolvePeriod(parsePeriodParam(url.searchParams.get('period')))
  const market = url.searchParams.get('market')
  const source = url.searchParams.get('source')
  // По умолчанию возвращаем ВСЕ строки (количество ограничено числом активных
  // каналов, обычно < 1k даже для крупного клиента). Раньше был limit=100,
  // и при сортировке critical→at_risk→healthy здоровые отрезались, хотя в
  // summary они учитывались — пользователь видел «88 здоровых», а в табе
  // «Здоровы» 0 строк. Пагинация теперь на фронте.
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '2000', 10), 5000)

  try {
    const rows = await computeCustomerHealth({ orgId, market, source }, period)

    // Сводка по уровням
    const summary = rows.reduce(
      (acc, r) => {
        acc[r.band] = (acc[r.band] ?? 0) + 1
        return acc
      },
      {} as Record<HealthBand, number>,
    )

    return json(
      {
        period: {
          from: period.from.toISOString(),
          to: period.to.toISOString(),
          granularity: period.granularity,
          label: period.label,
        },
        summary: {
          healthy: summary.healthy ?? 0,
          atRisk: summary.at_risk ?? 0,
          critical: summary.critical ?? 0,
          unknown: summary.unknown ?? 0,
          total: rows.length,
        },
        rows: rows.slice(0, limit) as CustomerHealthRow[],
      },
      200,
      30,
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[customer-health]', msg, e instanceof Error ? e.stack : undefined)
    return json({ error: msg, where: 'customer-health' }, 500)
  }
}
