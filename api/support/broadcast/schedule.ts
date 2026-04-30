import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { ensureBroadcastSchema } from '../lib/broadcast-schema.js'

export const config = {
  runtime: 'edge',
  maxDuration: 30,
}

/**
 * Управление кампаниями рассылки.
 *
 *   GET    /broadcast/schedule[?status=pending|sent|all][&from=&to=]
 *   POST   /broadcast/schedule  { messageText, sendNow?, scheduledAt?, ... }
 *   DELETE /broadcast/schedule?id=<id> | ?stopAll=true
 *
 * При POST атомарно создаём:
 *   - одну строку в support_broadcast_scheduled (status='queued')
 *   - N строк в support_broadcast_recipients (status='queued')
 * Для sendNow дополнительно дёргаем worker fire-and-forget.
 *
 * UI-контракт совместим со старым: статусы 'pending' маппим на 'queued',
 * 'processing/sending' — на 'running', 'sent' — на 'completed' (на чтение).
 */

interface ChannelRow { id: string; telegram_chat_id: number | null; name: string }

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// Маппинг новых статусов state-machine на старые названия для UI.
function mapStatusForUi(status: string): string {
  switch (status) {
    case 'queued':    return 'pending'
    case 'running':   return 'sending'
    case 'completed': return 'sent'
    case 'partial':   return 'sent'
    default:          return status // failed | cancelled | sent (legacy)
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() })
  }

  await ensureBroadcastSchema()
  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)

  if (req.method === 'GET') return handleList(sql, orgId, url)
  if (req.method === 'POST') return handleCreate(req, sql, orgId)
  if (req.method === 'DELETE') return handleCancel(sql, orgId, url)
  return json({ error: 'method_not_allowed' }, 405)
}

// ---------------------------------------------------------------------------
// GET: список кампаний
// ---------------------------------------------------------------------------

async function handleList(sql: ReturnType<typeof getSQL>, orgId: string, url: URL): Promise<Response> {
  try {
    const status = url.searchParams.get('status')
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')

    let scheduled: any[]
    if (status === 'pending') {
      scheduled = await sql`
        SELECT * FROM support_broadcast_scheduled
        WHERE org_id = ${orgId} AND status IN ('queued', 'running')
        ORDER BY scheduled_at ASC
      ` as any[]
    } else if (status === 'sent') {
      scheduled = await sql`
        SELECT * FROM support_broadcast_scheduled
        WHERE org_id = ${orgId} AND status IN ('completed', 'partial', 'sent')
        ORDER BY COALESCE(completed_at, sent_at, created_at) DESC
        LIMIT 30
      ` as any[]
    } else if (from && to) {
      scheduled = await sql`
        SELECT * FROM support_broadcast_scheduled
        WHERE org_id = ${orgId}
          AND scheduled_at >= ${from}::timestamptz
          AND scheduled_at <= ${to}::timestamptz
        ORDER BY scheduled_at ASC
      ` as any[]
    } else {
      scheduled = await sql`
        SELECT * FROM support_broadcast_scheduled
        WHERE org_id = ${orgId}
        ORDER BY
          CASE WHEN status IN ('queued', 'running') THEN 0 ELSE 1 END,
          COALESCE(completed_at, scheduled_at, created_at) DESC
        LIMIT 50
      ` as any[]
    }

    return json({
      success: true,
      scheduled: scheduled.map(formatCampaignForUi),
    })
  } catch (e: any) {
    return json({ success: false, error: e?.message || 'list error' }, 500)
  }
}

function formatCampaignForUi(s: any) {
  return {
    id: s.id,
    messageText: s.message_text,
    messageType: s.message_type,
    notificationType: s.notification_type || 'announcement',
    filterType: s.filter_type,
    selectedChannels: s.selected_channels || [],
    scheduledAt: s.scheduled_at,
    timezone: s.timezone,
    // Совместимость со старым UI:
    status: mapStatusForUi(s.status),
    rawStatus: s.status, // для нового UI с прогрессом
    senderType: s.sender_type || 'ai',
    senderId: s.sender_id,
    senderName: s.sender_name,
    mediaUrl: s.media_url,
    mediaType: s.media_type,
    createdBy: s.created_by,
    createdAt: s.created_at,
    sentAt: s.sent_at || s.started_at || null,
    startedAt: s.started_at,
    completedAt: s.completed_at,
    broadcastId: s.broadcast_id,
    errorMessage: s.error_message,
    recipientsCount: Number(s.recipients_count || 0),
    deliveredCount: Number(s.delivered_count || 0),
    failedCount: Number(s.failed_count || 0),
    queuedCount: Number(s.queued_count || 0),
    viewedCount: Number(s.viewed_count || 0),
    reactionCount: Number(s.reaction_count || 0),
  }
}

// ---------------------------------------------------------------------------
// POST: создание кампании + recipients одной транзакцией
// ---------------------------------------------------------------------------

async function handleCreate(req: Request, sql: ReturnType<typeof getSQL>, orgId: string): Promise<Response> {
  let body: any
  try { body = await req.json() } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const messageText = String(body.messageText || '').trim()
  if (!messageText) return json({ error: 'message_required' }, 400)
  if (messageText.length > 8000) return json({ error: 'message_too_long' }, 400)

  const sendNow = !!body.sendNow
  const scheduledAtInput = body.scheduledAt as string | undefined
  if (!sendNow && !scheduledAtInput) {
    return json({ error: 'scheduled_at_required' }, 400)
  }

  const scheduledAtUtc = sendNow ? new Date() : parseScheduledAt(scheduledAtInput!)
  if (!scheduledAtUtc) return json({ error: 'invalid_date_format' }, 400)
  if (!sendNow && scheduledAtUtc.getTime() <= Date.now()) {
    return json({ error: 'scheduled_time_must_be_in_future' }, 400)
  }

  const filterType = String(body.filterType || 'all')
  const selectedChannels = Array.isArray(body.selectedChannels) ? body.selectedChannels : []

  // 1. Резолвим получателей.
  const channels = await resolveChannels(sql, orgId, filterType, selectedChannels)
  if (channels.length === 0) {
    return json({ error: 'no_channels_match_filter' }, 400)
  }

  // 2. Создаём кампанию.
  const id = genId('sch')
  const messageType = String(body.messageType || body.notificationType || 'announcement')
  const notificationType = String(body.notificationType || messageType)
  const senderType = body.senderType === 'agent' ? 'agent' : 'ai'
  const senderId = body.senderId ? String(body.senderId) : null
  const senderName = body.senderName ? String(body.senderName) : (senderType === 'ai' ? 'AI Помощник' : null)
  const timezone = String(body.timezone || 'Asia/Tashkent')
  const mediaUrl = body.mediaUrl ? String(body.mediaUrl) : null
  const mediaType = body.mediaType ? String(body.mediaType) : (mediaUrl ? guessMediaType(mediaUrl) : null)
  const createdBy = String(body.createdBy || 'unknown')

  await sql`
    INSERT INTO support_broadcast_scheduled (
      id, org_id, message_text, message_type, notification_type,
      filter_type, selected_channels,
      scheduled_at, timezone, status,
      sender_type, sender_id, sender_name,
      media_url, media_type, created_by,
      recipients_count, queued_count, delivered_count, failed_count
    ) VALUES (
      ${id}, ${orgId}, ${messageText}, ${messageType}, ${notificationType},
      ${filterType}, ${selectedChannels},
      ${scheduledAtUtc.toISOString()}::timestamptz, ${timezone}, 'queued',
      ${senderType}, ${senderId}, ${senderName},
      ${mediaUrl}, ${mediaType}, ${createdBy},
      ${channels.length}, ${channels.length}, 0, 0
    )
  `

  // 3. Bulk-создание получателей (параметризованный INSERT через UNNEST).
  await insertRecipients(sql, id, orgId, channels)

  // 4. Если sendNow — дёргаем worker fire-and-forget, чтобы не ждать cron.
  if (sendNow) {
    triggerWorker(req, id).catch(() => {})
  }

  return json({
    success: true,
    id,
    recipientsCount: channels.length,
    scheduledAt: scheduledAtUtc.toISOString(),
    status: sendNow ? 'queued' : 'queued',
    sendNow,
    message: sendNow
      ? 'Рассылка поставлена в очередь, worker уже стартовал'
      : 'Рассылка запланирована',
  })
}

async function resolveChannels(
  sql: ReturnType<typeof getSQL>,
  orgId: string,
  filterType: string,
  selectedChannels: string[],
): Promise<ChannelRow[]> {
  if (filterType === 'selected' && selectedChannels.length > 0) {
    return await sql`
      SELECT id, telegram_chat_id, name
      FROM support_channels
      WHERE org_id = ${orgId}
        AND telegram_chat_id IS NOT NULL
        AND id = ANY(${selectedChannels})
    ` as ChannelRow[]
  }
  if (filterType === 'active') {
    return await sql`
      SELECT id, telegram_chat_id, name
      FROM support_channels
      WHERE org_id = ${orgId}
        AND telegram_chat_id IS NOT NULL
        AND last_message_at > NOW() - INTERVAL '30 days'
    ` as ChannelRow[]
  }
  if (filterType === 'clients') {
    return await sql`
      SELECT id, telegram_chat_id, name
      FROM support_channels
      WHERE org_id = ${orgId}
        AND telegram_chat_id IS NOT NULL
        AND (type = 'client' OR sla_category = 'client')
    ` as ChannelRow[]
  }
  if (filterType === 'partners') {
    return await sql`
      SELECT id, telegram_chat_id, name
      FROM support_channels
      WHERE org_id = ${orgId}
        AND telegram_chat_id IS NOT NULL
        AND (type = 'partner' OR sla_category = 'partner')
    ` as ChannelRow[]
  }
  return await sql`
    SELECT id, telegram_chat_id, name
    FROM support_channels
    WHERE org_id = ${orgId} AND telegram_chat_id IS NOT NULL
  ` as ChannelRow[]
}

async function insertRecipients(
  sql: ReturnType<typeof getSQL>,
  broadcastId: string,
  orgId: string,
  channels: ChannelRow[],
): Promise<void> {
  // Делаем чанками по 200 — Postgres ограничивает количество параметров (~32k),
  // плюс это безопасно для Edge runtime.
  const CHUNK = 200
  for (let i = 0; i < channels.length; i += CHUNK) {
    const chunk = channels.slice(i, i + CHUNK)
    const ids = chunk.map((c) => `rcp_${broadcastId}_${c.id}`)
    const channelIds = chunk.map((c) => c.id)
    const chatIds = chunk.map((c) => c.telegram_chat_id)
    const names = chunk.map((c) => c.name || null)

    // UNNEST для bulk-insert: один statement, один трип в БД.
    await sql`
      INSERT INTO support_broadcast_recipients (
        id, broadcast_id, org_id, channel_id, telegram_chat_id, channel_name, status
      )
      SELECT
        u.id, ${broadcastId}, ${orgId}, u.channel_id, u.chat_id::bigint, u.name, 'queued'
      FROM UNNEST(
        ${ids}::text[],
        ${channelIds}::text[],
        ${chatIds}::bigint[],
        ${names}::text[]
      ) AS u(id, channel_id, chat_id, name)
      ON CONFLICT (broadcast_id, channel_id) DO NOTHING
    `
  }
}

function parseScheduledAt(input: string): Date | null {
  // datetime-local («2026-04-30T14:00») трактуем как локальное Asia/Tashkent (UTC+5).
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!match) return null
  const [, y, m, d, h, mi] = match
  const localMs = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(mi))
  // Asia/Tashkent = UTC+5 → вычитаем 5 часов чтобы получить UTC.
  return new Date(localMs - 5 * 60 * 60 * 1000)
}

function guessMediaType(url: string): string {
  const lower = url.toLowerCase()
  if (/\.(jpe?g|png|webp|gif)$/.test(lower)) return 'photo'
  if (/\.(mp4|mov|avi|webm)$/.test(lower)) return 'video'
  if (/\.(mp3|m4a|ogg|wav)$/.test(lower)) return 'audio'
  return 'document'
}

async function triggerWorker(req: Request, broadcastId: string): Promise<void> {
  const url = new URL(req.url)
  const secret = process.env.CRON_SECRET
  if (!secret) return
  const workerUrl = `${url.protocol}//${url.host}/api/support/broadcast/worker?secret=${encodeURIComponent(secret)}&id=${encodeURIComponent(broadcastId)}`
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), 1500)
  await fetch(workerUrl, { signal: ctrl.signal }).catch(() => {})
}

// ---------------------------------------------------------------------------
// DELETE: отмена кампании или всех активных
// ---------------------------------------------------------------------------

async function handleCancel(sql: ReturnType<typeof getSQL>, orgId: string, url: URL): Promise<Response> {
  const stopAll = url.searchParams.get('stopAll') === 'true'

  try {
    if (stopAll) {
      const cancelled = await sql`
        UPDATE support_broadcast_scheduled
        SET status = 'cancelled',
            completed_at = NOW(),
            error_message = 'Остановлено вручную (stopAll)'
        WHERE org_id = ${orgId}
          AND status IN ('queued', 'running')
        RETURNING id
      `
      const ids = (cancelled as any[]).map((r) => r.id)
      if (ids.length > 0) {
        await sql`
          UPDATE support_broadcast_recipients
          SET status = 'skipped', updated_at = NOW()
          WHERE org_id = ${orgId}
            AND broadcast_id = ANY(${ids})
            AND status = 'queued'
        `
      }
      return json({
        success: true,
        cancelled: ids.length,
        message: `Остановлено ${ids.length} рассылок`,
      })
    }

    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'id_required' }, 400)

    const [existing] = await sql`
      SELECT id, status FROM support_broadcast_scheduled
      WHERE id = ${id} AND org_id = ${orgId}
      LIMIT 1
    `
    if (!existing) return json({ error: 'not_found' }, 404)

    const cancellable = ['queued', 'running']
    if (!cancellable.includes((existing as any).status)) {
      return json({ error: `cannot_cancel_status_${(existing as any).status}` }, 400)
    }

    await sql`
      UPDATE support_broadcast_scheduled
      SET status = 'cancelled',
          completed_at = NOW(),
          error_message = COALESCE(error_message, 'Остановлено вручную')
      WHERE id = ${id} AND org_id = ${orgId}
    `
    await sql`
      UPDATE support_broadcast_recipients
      SET status = 'skipped', updated_at = NOW()
      WHERE broadcast_id = ${id} AND org_id = ${orgId}
        AND status = 'queued'
    `
    return json({ success: true, message: 'Broadcast cancelled' })
  } catch (e: any) {
    return json({ success: false, error: e?.message || 'cancel error' }, 500)
  }
}
