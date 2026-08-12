import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema, salesId } from '../lib/sales-schema.js'

export const config = {
  runtime: 'edge',
}

/**
 * Справочники модуля «Продажи» — движок правил в виде данных.
 *
 * GET    - этапы, причины отказа, источники
 * PUT    - изменить этап (label, sla_hours, probability, required_fields, cadence),
 *          причину (label, reactivate_days) или источник (label, kind)
 * POST   - добавить элемент
 * DELETE - ?kind=...&id=... мягко (is_active=false): этап или причина могут
 *          использоваться в закрытых сделках, физически удалять нельзя
 *
 * kind: stage | reason | source
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  // Справочники — это устройство процесса продаж: этапы, нормативы, причины
  // отказа. Наружу отдавать нечего, поэтому авторизация обязательна и на чтение
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  if (req.method === 'GET') {
    const [stages, reasons, sources] = await Promise.all([
      sql`
        SELECT id, key, label, kind, owner_role, sla_hours, required_fields, cadence,
               sort_order, probability, is_active
        FROM sales_stages WHERE org_id = ${orgId} ORDER BY sort_order
      `,
      sql`
        SELECT id, code, label, reactivate_days, sort_order, is_active
        FROM sales_lost_reasons WHERE org_id = ${orgId} ORDER BY sort_order
      `,
      sql`
        SELECT id, key, label, kind, sort_order, is_active
        FROM sales_sources WHERE org_id = ${orgId} ORDER BY sort_order
      `,
    ])
    return json({ stages, reasons, sources })
  }

  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { kind, id } = body
      if (!id) return json({ error: 'id is required' }, 400)

      if (kind === 'stage') {
        const { label, ownerRole, slaHours, probability, requiredFields, cadence, isActive } = body
        // COALESCE: не переданное поле остаётся прежним — форма может слать только изменённое
        await sql`
          UPDATE sales_stages SET
            label = COALESCE(${label ?? null}, label),
            owner_role = COALESCE(${ownerRole ?? null}, owner_role),
            sla_hours = COALESCE(${slaHours ?? null}, sla_hours),
            probability = COALESCE(${probability ?? null}, probability),
            required_fields = COALESCE(${requiredFields ? JSON.stringify(requiredFields) : null}::jsonb, required_fields),
            cadence = COALESCE(${cadence ? JSON.stringify(cadence) : null}::jsonb, cadence),
            is_active = COALESCE(${isActive ?? null}, is_active)
          WHERE id = ${id} AND org_id = ${orgId}
        `
        return json({ success: true })
      }

      if (kind === 'reason') {
        const { label, reactivateDays, isActive } = body
        // reactivate_days = null означает «не возвращаемся», поэтому COALESCE тут не годится:
        // отсутствие ключа и явный null — разные намерения, разводим их двумя запросами
        if (reactivateDays === undefined) {
          await sql`
            UPDATE sales_lost_reasons SET
              label = COALESCE(${label ?? null}, label),
              is_active = COALESCE(${isActive ?? null}, is_active)
            WHERE id = ${id} AND org_id = ${orgId}
          `
        } else {
          await sql`
            UPDATE sales_lost_reasons SET
              label = COALESCE(${label ?? null}, label),
              reactivate_days = ${reactivateDays},
              is_active = COALESCE(${isActive ?? null}, is_active)
            WHERE id = ${id} AND org_id = ${orgId}
          `
        }
        return json({ success: true })
      }

      if (kind === 'source') {
        const { label, sourceKind, isActive } = body
        await sql`
          UPDATE sales_sources SET
            label = COALESCE(${label ?? null}, label),
            kind = COALESCE(${sourceKind ?? null}, kind),
            is_active = COALESCE(${isActive ?? null}, is_active)
          WHERE id = ${id} AND org_id = ${orgId}
        `
        return json({ success: true })
      }

      return json({ error: 'unknown kind' }, 400)
    } catch (e: any) {
      return json({ error: e?.message || 'update failed' }, 500)
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { kind } = body

      if (kind === 'stage') {
        const { key, label, ownerRole = 'ae', slaHours = null, probability = 0,
                requiredFields = [], cadence = [], stageKind = 'open' } = body
        if (!key || !label) return json({ error: 'key and label are required' }, 400)
        const [{ max }] = await sql`
          SELECT COALESCE(MAX(sort_order), -1)::int AS max FROM sales_stages WHERE org_id = ${orgId}
        `
        const id = salesId('sst')
        await sql`
          INSERT INTO sales_stages (id, org_id, key, label, kind, owner_role, sla_hours,
                                  required_fields, cadence, sort_order, probability)
          VALUES (${id}, ${orgId}, ${key}, ${label}, ${stageKind}, ${ownerRole}, ${slaHours},
                  ${JSON.stringify(requiredFields)}::jsonb, ${JSON.stringify(cadence)}::jsonb,
                  ${max + 1}, ${probability})
          ON CONFLICT (org_id, key) DO NOTHING
        `
        return json({ success: true, id })
      }

      if (kind === 'reason') {
        const { code, label, reactivateDays = null } = body
        if (!code || !label) return json({ error: 'code and label are required' }, 400)
        const [{ max }] = await sql`
          SELECT COALESCE(MAX(sort_order), -1)::int AS max FROM sales_lost_reasons WHERE org_id = ${orgId}
        `
        const id = salesId('slr')
        await sql`
          INSERT INTO sales_lost_reasons (id, org_id, code, label, reactivate_days, sort_order)
          VALUES (${id}, ${orgId}, ${code}, ${label}, ${reactivateDays}, ${max + 1})
          ON CONFLICT (org_id, code) DO NOTHING
        `
        return json({ success: true, id })
      }

      if (kind === 'source') {
        const { key, label, sourceKind = 'inbound' } = body
        if (!key || !label) return json({ error: 'key and label are required' }, 400)
        const [{ max }] = await sql`
          SELECT COALESCE(MAX(sort_order), -1)::int AS max FROM sales_sources WHERE org_id = ${orgId}
        `
        const id = salesId('ssrc')
        await sql`
          INSERT INTO sales_sources (id, org_id, key, label, kind, sort_order)
          VALUES (${id}, ${orgId}, ${key}, ${label}, ${sourceKind}, ${max + 1})
          ON CONFLICT (org_id, key) DO NOTHING
        `
        return json({ success: true, id })
      }

      return json({ error: 'unknown kind' }, 400)
    } catch (e: any) {
      return json({ error: e?.message || 'create failed' }, 500)
    }
  }

  if (req.method === 'DELETE') {
    const kind = url.searchParams.get('kind')
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'id is required' }, 400)

    // Мягкое удаление: элемент может быть в закрытых сделках, история не должна рваться
    if (kind === 'stage') {
      await sql`UPDATE sales_stages SET is_active = false WHERE id = ${id} AND org_id = ${orgId}`
      return json({ success: true, soft: true })
    }
    if (kind === 'reason') {
      await sql`UPDATE sales_lost_reasons SET is_active = false WHERE id = ${id} AND org_id = ${orgId}`
      return json({ success: true, soft: true })
    }
    if (kind === 'source') {
      await sql`UPDATE sales_sources SET is_active = false WHERE id = ${id} AND org_id = ${orgId}`
      return json({ success: true, soft: true })
    }
    return json({ error: 'unknown kind' }, 400)
  }

  return json({ error: 'method not allowed' }, 405)
}
