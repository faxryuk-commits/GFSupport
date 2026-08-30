import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema, salesId } from '../lib/sales-schema.js'

export const config = {
  runtime: 'edge', regions: ['fra1'],
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
 * kind: stage | reason | source | option (значения полей: город, касса, тариф…)
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
    const [stages, reasons, sources, markets, options, pipelines] = await Promise.all([
      sql`
        SELECT id, key, label, kind, owner_role, sla_hours, required_fields, cadence,
               sort_order, probability, is_active, COALESCE(pipeline, 'sales') AS pipeline
        FROM sales_stages WHERE org_id = ${orgId} ORDER BY pipeline, sort_order
      `,
      sql`
        SELECT id, code, label, reactivate_days, sort_order, is_active
        FROM sales_lost_reasons WHERE org_id = ${orgId} ORDER BY sort_order
      `,
      sql`
        SELECT id, key, label, kind, sort_order, is_active
        FROM sales_sources WHERE org_id = ${orgId} ORDER BY sort_order
      `,
      // Регионы: у каждого своя воронка, своя валюта и своё юрлицо
      sql`
        SELECT m.market_id, m.currency, m.legal_entity,
               (SELECT COUNT(*) FROM sales_deals d
                 WHERE d.org_id = m.org_id AND d.market_id = m.market_id)::int AS deals
        FROM sales_market_settings m WHERE m.org_id = ${orgId} ORDER BY deals DESC
      `,
      sql`
        SELECT id, field, value, label, market_id, sort_order, is_active
        FROM sales_field_options WHERE org_id = ${orgId}
        ORDER BY field, sort_order
      `,
      sql`
        SELECT p.id, p.key, p.label, p.market_id, p.kind, p.description, p.sort_order, p.is_active,
               (SELECT COUNT(*) FROM sales_deals d
                 WHERE d.org_id = p.org_id AND d.pipeline = p.key AND d.archived_at IS NULL)::int AS deals,
               (SELECT COUNT(*) FROM sales_stages st
                 WHERE st.org_id = p.org_id AND st.pipeline = p.key AND st.is_active)::int AS stages
        FROM sales_pipelines p WHERE p.org_id = ${orgId}
        ORDER BY p.sort_order, p.label
      `,
    ])
    return json({ stages, reasons, sources, markets, options, pipelines })
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

      if (kind === 'pipeline') {
        const { label, description, isActive } = body
        await sql`
          UPDATE sales_pipelines SET
            label = COALESCE(${label ?? null}, label),
            description = COALESCE(${description ?? null}, description),
            is_active = COALESCE(${isActive ?? null}, is_active)
          WHERE id = ${id} AND org_id = ${orgId}
        `
        return json({ success: true })
      }

      if (kind === 'option') {
        const { label, value, isActive } = body
        await sql`
          UPDATE sales_field_options SET
            label = COALESCE(${label ?? null}, label),
            value = COALESCE(${value ?? null}, value),
            is_active = COALESCE(${isActive ?? null}, is_active)
          WHERE id = ${id} AND org_id = ${orgId}
        `
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
                requiredFields = [], cadence = [], stageKind = 'open',
                pipeline = 'sales' } = body
        if (!key || !label) return json({ error: 'key and label are required' }, 400)
        const [{ max }] = await sql`
          SELECT COALESCE(MAX(sort_order), -1)::int AS max FROM sales_stages
          WHERE org_id = ${orgId} AND pipeline = ${pipeline}
        `
        const id = salesId('sst')
        await sql`
          INSERT INTO sales_stages (id, org_id, key, label, kind, owner_role, sla_hours,
                                  required_fields, cadence, sort_order, probability, pipeline)
          VALUES (${id}, ${orgId}, ${key}, ${label}, ${stageKind}, ${ownerRole}, ${slaHours},
                  ${JSON.stringify(requiredFields)}::jsonb, ${JSON.stringify(cadence)}::jsonb,
                  ${max + 1}, ${probability}, ${pipeline})
          ON CONFLICT (org_id, pipeline, key) DO NOTHING
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

      if (kind === 'pipeline') {
        const { key, label, market = null, description = null, copyFrom = 'sales' } = body
        if (!key || !label) return json({ error: 'нужны ключ и название' }, 400)
        const clean = String(key).toLowerCase().replace(/[^a-z0-9_]/g, '_')
        const [{ max }] = await sql`
          SELECT COALESCE(MAX(sort_order), -1)::int AS max FROM sales_pipelines WHERE org_id = ${orgId}
        `
        const id = salesId('spl')
        await sql`
          INSERT INTO sales_pipelines (id, org_id, key, label, market_id, kind, description, sort_order)
          VALUES (${id}, ${orgId}, ${clean}, ${label}, ${market}, 'sales', ${description}, ${max + 1})
          ON CONFLICT (org_id, key) DO NOTHING
        `
        // Пустая воронка бесполезна: копируем этапы у образца, чтобы сразу
        // было куда класть сделки, а правки делались поверх
        await sql`
          INSERT INTO sales_stages (id, org_id, key, label, kind, owner_role, sla_hours,
                                    required_fields, cadence, sort_order, probability, pipeline, description)
          SELECT 'sst_' || ${clean} || '_' || st.key, st.org_id, st.key, st.label, st.kind,
                 st.owner_role, st.sla_hours, st.required_fields, st.cadence, st.sort_order,
                 st.probability, ${clean}, st.description
          FROM sales_stages st
          WHERE st.org_id = ${orgId} AND st.pipeline = ${copyFrom}
          ON CONFLICT (org_id, pipeline, key) DO NOTHING
        `
        return json({ success: true, id, key: clean })
      }

      if (kind === 'option') {
        const { field, value, label, market = null } = body
        if (!field || !value) return json({ error: 'field and value are required' }, 400)
        const [{ max }] = await sql`
          SELECT COALESCE(MAX(sort_order), -1)::int AS max FROM sales_field_options
          WHERE org_id = ${orgId} AND field = ${field}
        `
        const id = salesId('sfo')
        await sql`
          INSERT INTO sales_field_options (id, org_id, field, value, label, market_id, sort_order)
          VALUES (${id}, ${orgId}, ${field}, ${value}, ${label || value}, ${market}, ${max + 1})
          ON CONFLICT (org_id, field, value, COALESCE(market_id, '')) DO NOTHING
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
    // Значение поля — единственное, что удаляется физически: оно нигде не
    // хранится по ссылке, в сделке лежит сама строка, история не пострадает
    if (kind === 'pipeline') {
      const [p] = await sql`SELECT key, label FROM sales_pipelines WHERE id = ${id} AND org_id = ${orgId}`
      if (!p) return json({ error: 'воронка не найдена' }, 404)
      const [{ deals }] = await sql`
        SELECT COUNT(*)::int AS deals FROM sales_deals
        WHERE org_id = ${orgId} AND pipeline = ${p.key} AND archived_at IS NULL
      ` as any[]
      // Сделки нельзя оставить без воронки: они пропадут со всех досок
      const moveTo = url.searchParams.get('moveTo')
      if (deals > 0 && !moveTo) {
        return json({
          error: `В воронке «${p.label}» ${deals} сделок. Укажите, куда их перенести.`,
          deals,
        }, 409)
      }
      if (deals > 0 && moveTo) {
        await sql`
          UPDATE sales_deals d
          SET pipeline = ${moveTo}, stage_id = COALESCE(ns.id, d.stage_id)
          FROM sales_stages os
          LEFT JOIN sales_stages ns ON ns.org_id = os.org_id AND ns.pipeline = ${moveTo} AND ns.key = os.key
          WHERE d.org_id = ${orgId} AND d.pipeline = ${p.key} AND os.id = d.stage_id
        `
      }
      await sql`DELETE FROM sales_stages WHERE org_id = ${orgId} AND pipeline = ${p.key}`
      await sql`DELETE FROM sales_pipelines WHERE id = ${id} AND org_id = ${orgId}`
      return json({ success: true, moved: deals })
    }

    if (kind === 'option') {
      await sql`DELETE FROM sales_field_options WHERE id = ${id} AND org_id = ${orgId}`
      return json({ success: true })
    }
    return json({ error: 'unknown kind' }, 400)
  }

  return json({ error: 'method not allowed' }, 405)
}
