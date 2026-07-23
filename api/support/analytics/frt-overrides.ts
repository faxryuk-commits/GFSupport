import { getSQL, json } from '../lib/db.js'
import { getRequestOrgId } from '../lib/org.js'
import {
  ensureFrtOverridesTable,
  type FrtOverrideType,
} from '../lib/frt-overrides-schema.js'

export const config = { runtime: 'edge' }

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
  }
}

async function getAgentFromRequest(req: Request, orgId: string) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.replace('Bearer ', '')
  const parts = token.split('_')
  if (parts.length < 3 || parts[0] !== 'agent') return null
  const agentId = `${parts[0]}_${parts[1]}_${parts[2]}`
  const sql = getSQL()
  const [row] = await sql`
    SELECT id, name FROM support_agents
    WHERE id = ${agentId} AND org_id = ${orgId}
    LIMIT 1
  `
  return row as { id: string; name: string } | undefined
}

function mapOverride(row: any) {
  return {
    id: row.id,
    messageId: row.message_id,
    channelId: row.channel_id,
    overrideType: row.override_type as FrtOverrideType,
    frtMinutes: row.frt_minutes != null ? Number(row.frt_minutes) : null,
    note: row.note || null,
    createdByName: row.created_by_name || null,
    updatedAt: row.updated_at,
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors() })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  await ensureFrtOverridesTable(sql)

  if (req.method === 'GET') {
    const url = new URL(req.url)
    const messageId = url.searchParams.get('messageId')
    if (messageId) {
      const [row] = await sql`
        SELECT * FROM support_frt_overrides
        WHERE org_id = ${orgId} AND message_id = ${messageId}
        LIMIT 1
      `
      return json({ override: row ? mapOverride(row) : null }, 200)
    }
    const rows = await sql`
      SELECT * FROM support_frt_overrides
      WHERE org_id = ${orgId}
      ORDER BY updated_at DESC
      LIMIT 200
    `
    return json({ overrides: rows.map(mapOverride) }, 200)
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const messageId = String(body.messageId || '').trim()
      const channelId = String(body.channelId || '').trim()
      const overrideType = body.overrideType as FrtOverrideType
      const note = body.note ? String(body.note).trim().slice(0, 500) : null
      const frtMinutes =
        body.frtMinutes != null && body.frtMinutes !== ''
          ? Math.round(Number(body.frtMinutes))
          : null

      if (!messageId || !channelId) {
        return json({ error: 'messageId и channelId обязательны' }, 400)
      }
      if (overrideType !== 'exclude' && overrideType !== 'manual') {
        return json({ error: 'overrideType: exclude или manual' }, 400)
      }
      if (overrideType === 'manual') {
        if (frtMinutes == null || Number.isNaN(frtMinutes) || frtMinutes < 0 || frtMinutes > 1440) {
          return json({ error: 'Укажите фактическое FRT от 0 до 1440 минут' }, 400)
        }
      }

      const agent = await getAgentFromRequest(req, orgId)
      const id = `frt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

      const [row] = await sql`
        INSERT INTO support_frt_overrides (
          id, org_id, message_id, channel_id, override_type, frt_minutes,
          note, created_by, created_by_name, updated_at
        ) VALUES (
          ${id}, ${orgId}, ${messageId}, ${channelId}, ${overrideType},
          ${overrideType === 'manual' ? frtMinutes : null},
          ${note}, ${agent?.id ?? null}, ${agent?.name ?? null}, NOW()
        )
        ON CONFLICT (org_id, message_id) DO UPDATE SET
          channel_id = EXCLUDED.channel_id,
          override_type = EXCLUDED.override_type,
          frt_minutes = EXCLUDED.frt_minutes,
          note = EXCLUDED.note,
          created_by = COALESCE(support_frt_overrides.created_by, EXCLUDED.created_by),
          created_by_name = COALESCE(support_frt_overrides.created_by_name, EXCLUDED.created_by_name),
          updated_at = NOW()
        RETURNING *
      `

      return json({ ok: true, override: mapOverride(row) }, 200)
    } catch (e: any) {
      console.error('FRT override save error:', e)
      return json({ error: e.message || 'Internal error' }, 500)
    }
  }

  if (req.method === 'DELETE') {
    const url = new URL(req.url)
    const messageId = url.searchParams.get('messageId')
    if (!messageId) {
      return json({ error: 'messageId обязателен' }, 400)
    }
    await sql`
      DELETE FROM support_frt_overrides
      WHERE org_id = ${orgId} AND message_id = ${messageId}
    `
    return json({ ok: true }, 200)
  }

  return json({ error: 'Method not allowed' }, 405)
}
