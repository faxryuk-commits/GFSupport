/**
 * Управление бенчмарками (просмотр + ручной edit).
 *
 * GET  /api/support/analytics/benchmarks
 *   → список всех benchmark_targets для org, плюс реестр метрик.
 *
 * PUT  /api/support/analytics/benchmarks
 *   body: { metric_key, tier, target_value, scope_role?, scope_market?,
 *           scope_source?, period_type?, notes? }
 *   → upsert одной строки с source_type='manual'.
 *
 * DELETE /api/support/analytics/benchmarks?id=<row_id>
 *   → удалить строку (например, чтобы снять ручной override и вернуться к
 *     percentile_internal). Удаляются только manual-строки.
 */

import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureBenchmarkTable } from '../lib/ensure-taxonomy.js'
import { METRIC_REGISTRY } from './metrics/index.js'

export const config = {
  runtime: 'edge',
}

interface BenchmarkRow {
  id: string
  org_id: string
  metric_key: string
  scope_role: string | null
  scope_market: string | null
  scope_source: string | null
  period_type: string
  tier: string
  target_value: string | number
  source_type: string
  sample_size: number | null
  computed_at: string | null
  set_by: string | null
  set_at: string | null
  notes: string | null
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const ctx = await extractAgentContext(req)
  if (!ctx.orgId) return json({ error: 'Unauthorized' }, 401)

  await ensureBenchmarkTable()
  const sql = getSQL()

  try {
  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT * FROM benchmark_targets
      WHERE org_id = ${ctx.orgId}
      ORDER BY metric_key, period_type, scope_role NULLS FIRST,
               scope_market NULLS FIRST, scope_source NULLS FIRST, tier
    `) as BenchmarkRow[]

    return json({
      metrics: Object.values(METRIC_REGISTRY).map((e) => e.descriptor).map((d) => ({
        key: d.key,
        labelRu: d.labelRu,
        unit: d.unit,
        direction: d.direction,
        level: d.level,
        formulaRu: d.formulaRu,
        perAgent: d.perAgent,
      })),
      benchmarks: rows.map((r) => ({
        id: r.id,
        metricKey: r.metric_key,
        scope: {
          role: r.scope_role,
          market: r.scope_market,
          source: r.scope_source,
        },
        periodType: r.period_type,
        tier: r.tier,
        value: typeof r.target_value === 'string' ? parseFloat(r.target_value) : r.target_value,
        sourceType: r.source_type,
        sampleSize: r.sample_size,
        computedAt: r.computed_at,
        setBy: r.set_by,
        setAt: r.set_at,
        notes: r.notes,
      })),
    })
  }

  if (req.method === 'PUT') {
    if (!ctx.isOrgAdmin) return json({ error: 'Org admin required' }, 403)

    const body = (await req.json().catch(() => null)) as null | {
      metric_key?: string
      tier?: string
      target_value?: number
      scope_role?: string | null
      scope_market?: string | null
      scope_source?: string | null
      period_type?: string
      notes?: string | null
    }
    if (!body) return json({ error: 'Invalid JSON body' }, 400)

    const { metric_key, tier, target_value } = body
    if (!metric_key || !tier || target_value === undefined || target_value === null) {
      return json({ error: 'metric_key, tier, target_value are required' }, 400)
    }
    if (!METRIC_REGISTRY[metric_key]) return json({ error: `Unknown metric: ${metric_key}` }, 400)
    if (!['bronze', 'silver', 'gold'].includes(tier)) {
      return json({ error: `Invalid tier: ${tier}` }, 400)
    }

    const role = body.scope_role || null
    const market = body.scope_market || null
    const source = body.scope_source || null
    const periodType = body.period_type || 'monthly'
    const notes = body.notes || null
    const id = `${ctx.orgId}_${metric_key}_${role || '_'}_${market || '_'}_${source || '_'}_${periodType}_${tier}`

    await sql`
      INSERT INTO benchmark_targets (
        id, org_id, metric_key, scope_role, scope_market, scope_source,
        period_type, tier, target_value, source_type, sample_size, computed_at,
        set_by, set_at, notes
      ) VALUES (
        ${id}, ${ctx.orgId}, ${metric_key}, ${role}, ${market}, ${source},
        ${periodType}, ${tier}, ${target_value},
        'manual', NULL, NULL, ${ctx.agentId}, NOW(), ${notes}
      )
      ON CONFLICT (org_id, metric_key, COALESCE(scope_role,''), COALESCE(scope_market,''), COALESCE(scope_source,''), period_type, tier)
      DO UPDATE SET
        target_value = EXCLUDED.target_value,
        source_type = 'manual',
        sample_size = NULL,
        set_by = EXCLUDED.set_by,
        set_at = NOW(),
        notes = EXCLUDED.notes
    `
    return json({ ok: true, id })
  }

  if (req.method === 'DELETE') {
    if (!ctx.isOrgAdmin) return json({ error: 'Org admin required' }, 403)
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'Query param "id" required' }, 400)

    // Удаляем только manual-строки — перцентильные пересчитываются автоматически,
    // их прибивать вручную смысла нет (потеряются и снова появятся при recompute).
    const result = (await sql`
      DELETE FROM benchmark_targets
      WHERE id = ${id} AND org_id = ${ctx.orgId} AND source_type = 'manual'
      RETURNING id
    `) as Array<{ id: string }>

    if (result.length === 0) {
      return json({ error: 'Row not found or not manual' }, 404)
    }
    return json({ ok: true, deleted: result[0].id })
  }

  return json({ error: 'Method not allowed' }, 405)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[benchmarks]', req.method, msg, e instanceof Error ? e.stack : undefined)
    return json({ error: msg, where: 'benchmarks' }, 500)
  }
}
