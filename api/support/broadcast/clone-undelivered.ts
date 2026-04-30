import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { ensureBroadcastSchema } from '../lib/broadcast-schema.js'
import { runBroadcastWorker } from '../lib/broadcast-runner.js'

export const config = {
  runtime: 'edge',
  maxDuration: 30,
}

/**
 * Создаёт ДУБЛЬ кампании только для тех получателей, кому НЕ дошло.
 *
 *   POST /broadcast/clone-undelivered
 *     {
 *       sourceId: "<id исходной кампании>",
 *       scope?: "undelivered" | "failed" | "skipped" | "queued",  // по умолчанию undelivered (failed+skipped+queued+sending)
 *       overrideText?: string,           // опционально — новый текст
 *       sendNow?: boolean,               // по умолчанию true
 *       scheduledAt?: string,            // если sendNow=false
 *       createdBy?: string
 *     }
 *
 * Возвращает id новой кампании. Используется в кнопке UI «Создать дубль
 * для не получивших» — полезно когда первая рассылка частично упала
 * (упёрлась в timeout / некоторые чаты были недоступны временно).
 *
 * Защита от дублей-доставок: новая кампания получит свой broadcast_id
 * и собственные строки в support_broadcast_recipients. Если канал был
 * delivered в исходной — он НЕ попадёт в копию.
 */

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

const VALID_SCOPES = new Set(['undelivered', 'failed', 'skipped', 'queued'])

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() })
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  await ensureBroadcastSchema()
  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  let body: any = {}
  try { body = await req.json() } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const sourceId = String(body.sourceId || '').trim()
  if (!sourceId) return json({ error: 'sourceId_required' }, 400)

  const scope = VALID_SCOPES.has(body.scope) ? body.scope : 'undelivered'
  const sendNow = body.sendNow !== false
  const overrideText = body.overrideText ? String(body.overrideText).trim() : null
  const createdBy = String(body.createdBy || 'unknown')

  try {
    // 1. Грузим исходную кампанию.
    const [source] = await sql`
      SELECT id, message_text, message_type, notification_type, sender_type, sender_id,
             sender_name, media_url, media_type, timezone, filter_type
      FROM support_broadcast_scheduled
      WHERE id = ${sourceId} AND org_id = ${orgId}
      LIMIT 1
    `
    if (!source) return json({ error: 'source_not_found' }, 404)

    // 2. Резолвим каналы по статусу из recipients исходной кампании.
    let recipients: any[]
    if (scope === 'failed') {
      recipients = await sql`
        SELECT channel_id, telegram_chat_id, channel_name
        FROM support_broadcast_recipients
        WHERE broadcast_id = ${sourceId} AND org_id = ${orgId}
          AND status = 'failed'
      ` as any[]
    } else if (scope === 'skipped') {
      recipients = await sql`
        SELECT channel_id, telegram_chat_id, channel_name
        FROM support_broadcast_recipients
        WHERE broadcast_id = ${sourceId} AND org_id = ${orgId}
          AND status = 'skipped'
      ` as any[]
    } else if (scope === 'queued') {
      recipients = await sql`
        SELECT channel_id, telegram_chat_id, channel_name
        FROM support_broadcast_recipients
        WHERE broadcast_id = ${sourceId} AND org_id = ${orgId}
          AND status IN ('queued', 'sending')
      ` as any[]
    } else {
      // undelivered: всё кроме delivered
      recipients = await sql`
        SELECT channel_id, telegram_chat_id, channel_name
        FROM support_broadcast_recipients
        WHERE broadcast_id = ${sourceId} AND org_id = ${orgId}
          AND status <> 'delivered'
      ` as any[]
    }

    if (recipients.length === 0) {
      return json({
        success: false,
        error: 'no_undelivered_recipients',
        message: 'Все получатели исходной кампании уже получили сообщение',
      }, 400)
    }

    // 3. Создаём новую кампанию.
    const newId = genId('sch')
    const messageText = overrideText || (source as any).message_text
    const channelIds = recipients.map((r) => r.channel_id)
    const scheduledAtUtc = sendNow ? new Date() : parseScheduledAt(body.scheduledAt)
    if (!scheduledAtUtc) return json({ error: 'invalid_scheduled_at' }, 400)
    if (!sendNow && scheduledAtUtc.getTime() <= Date.now()) {
      return json({ error: 'scheduled_time_must_be_in_future' }, 400)
    }

    await sql`
      INSERT INTO support_broadcast_scheduled (
        id, org_id, message_text, message_type, notification_type,
        filter_type, selected_channels,
        scheduled_at, timezone, status,
        sender_type, sender_id, sender_name,
        media_url, media_type, created_by,
        recipients_count, queued_count, delivered_count, failed_count
      ) VALUES (
        ${newId}, ${orgId}, ${messageText},
        ${(source as any).message_type}, ${(source as any).notification_type},
        'selected', ${channelIds},
        ${scheduledAtUtc.toISOString()}::timestamptz, ${(source as any).timezone || 'Asia/Tashkent'}, 'queued',
        ${(source as any).sender_type}, ${(source as any).sender_id}, ${(source as any).sender_name},
        ${(source as any).media_url}, ${(source as any).media_type}, ${createdBy},
        ${recipients.length}, ${recipients.length}, 0, 0
      )
    `

    // 4. Bulk-INSERT recipients новой кампании.
    const CHUNK = 200
    for (let i = 0; i < recipients.length; i += CHUNK) {
      const chunk = recipients.slice(i, i + CHUNK)
      const ids = chunk.map((r) => `rcp_${newId}_${r.channel_id}`)
      const cIds = chunk.map((r) => r.channel_id)
      const chatIds = chunk.map((r) => r.telegram_chat_id)
      const names = chunk.map((r) => r.channel_name)
      await sql`
        INSERT INTO support_broadcast_recipients (
          id, broadcast_id, org_id, channel_id, telegram_chat_id, channel_name, status
        )
        SELECT u.id, ${newId}, ${orgId}, u.channel_id, u.chat_id::bigint, u.name, 'queued'
        FROM UNNEST(${ids}::text[], ${cIds}::text[], ${chatIds}::bigint[], ${names}::text[])
          AS u(id, channel_id, chat_id, name)
        ON CONFLICT (broadcast_id, channel_id) DO NOTHING
      `
    }

    // 5. Если sendNow — запускаем worker INLINE с бюджетом ~20s.
    let inlineStats: any = null
    if (sendNow) {
      try {
        inlineStats = await runBroadcastWorker({
          orgId,
          targetBroadcastId: newId,
          budgetMs: 20_000,
        })
      } catch (e) {
        console.warn('[broadcast/clone-undelivered] inline worker error:', e)
      }
    }

    return json({
      success: true,
      id: newId,
      sourceId,
      scope,
      recipientsCount: recipients.length,
      sendNow,
      inlineStats,
      message: sendNow
        ? `Создан дубль на ${recipients.length} получателей, ` +
          `доставлено ${inlineStats?.delivered || 0}` +
          (inlineStats && inlineStats.delivered < recipients.length ? ', остальные в очереди' : '')
        : `Создан дубль на ${recipients.length} получателей, запланировано на ${scheduledAtUtc.toISOString()}`,
    })
  } catch (e: any) {
    console.error('[broadcast/clone-undelivered] error:', e)
    return json({ success: false, error: e?.message || 'clone error' }, 500)
  }
}

function parseScheduledAt(input: string | undefined): Date | null {
  if (!input) return new Date()
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!match) return null
  const [, y, m, d, h, mi] = match
  const localMs = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(mi))
  return new Date(localMs - 5 * 60 * 60 * 1000)
}

