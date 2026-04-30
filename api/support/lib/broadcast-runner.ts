import { getSQL, getOrgBotToken } from './db.js'
import { sendBroadcastMessage } from './broadcast-telegram.js'

/**
 * Main loop рассылки. Используется ОБЕИМИ путями:
 *   1) Vercel cron → /broadcast/worker → runBroadcastWorker({ orgId: null })
 *   2) Inline после /broadcast/schedule (sendNow) → runBroadcastWorker({ orgId, targetBroadcastId })
 *
 * Inline-вариант обеспечивает мгновенную отправку маленьких рассылок без
 * ожидания cron'а. Большие рассылки (>50 получателей) всё равно докручиваются
 * cron'ом каждую минуту.
 */

const BATCH_SIZE = 25
const RATE_DELAY_MS = 100
const MAX_ATTEMPTS = 5

export interface RunnerOptions {
  orgId: string | null
  targetBroadcastId?: string | null
  /** Жёсткий дедлайн в мс от старта. По умолчанию — 55s (под maxDuration: 60). */
  budgetMs?: number
}

export interface RunnerStats {
  batchesProcessed: number
  delivered: number
  failed: number
  requeued: number
  skipped: number
  elapsedMs: number
}

type CampaignRow = {
  id: string
  message_text: string
  notification_type: string | null
  message_type: string | null
  sender_name: string | null
  media_url: string | null
  media_type: string | null
  org_id: string
  status: string
}

function formatMessage(row: CampaignRow): string {
  const typeKey = (row.notification_type || row.message_type || 'announcement').toLowerCase()
  const emojiMap: Record<string, string> = {
    announcement: '📢', news: '📰', update: '🔄', alert: '⚠️', warning: '⚠️',
  }
  const titleMap: Record<string, string> = {
    announcement: 'Объявление', news: 'Новости', update: 'Обновление',
    alert: 'Важное', warning: 'Предупреждение',
  }
  const emoji = emojiMap[typeKey] || '📢'
  const title = titleMap[typeKey] || 'Объявление'
  const sender = row.sender_name ? `\n\n<i>— ${row.sender_name}</i>` : ''
  return `${emoji} <b>${title}</b>\n\n${row.message_text}${sender}`
}

export async function runBroadcastWorker(opts: RunnerOptions): Promise<RunnerStats> {
  const sql = getSQL()
  const orgId = opts.orgId
  const targetBroadcastId = opts.targetBroadcastId || null
  const budget = opts.budgetMs ?? 55_000
  const startedAt = Date.now()
  const deadline = startedAt + budget

  const stats: RunnerStats = {
    batchesProcessed: 0,
    delivered: 0,
    failed: 0,
    requeued: 0,
    skipped: 0,
    elapsedMs: 0,
  }

  const tokenCache = new Map<string, string | null>()
  async function tokenFor(o: string): Promise<string | null> {
    if (tokenCache.has(o)) return tokenCache.get(o) ?? null
    const t = await getOrgBotToken(o)
    tokenCache.set(o, t)
    return t
  }

  const campaignCache = new Map<string, CampaignRow>()
  async function loadCampaign(id: string): Promise<CampaignRow | null> {
    if (campaignCache.has(id)) return campaignCache.get(id) || null
    const [row] = await sql`
      SELECT id, message_text, notification_type, message_type, sender_name,
             media_url, media_type, org_id, status
      FROM support_broadcast_scheduled
      WHERE id = ${id}
      LIMIT 1
    `
    if (row) campaignCache.set(id, row as CampaignRow)
    return (row as CampaignRow) || null
  }

  while (Date.now() < deadline) {
    const batch = await sql`
      UPDATE support_broadcast_recipients r
      SET status = 'sending',
          attempts = r.attempts + 1,
          last_attempt_at = NOW(),
          updated_at = NOW()
      FROM (
        SELECT r2.id
        FROM support_broadcast_recipients r2
        JOIN support_broadcast_scheduled b ON b.id = r2.broadcast_id
        WHERE r2.status = 'queued'
          AND (r2.retry_after_at IS NULL OR r2.retry_after_at <= NOW())
          AND b.status IN ('queued', 'running')
          AND b.scheduled_at <= NOW()
          ${orgId ? sql`AND r2.org_id = ${orgId}` : sql``}
          ${targetBroadcastId ? sql`AND b.id = ${targetBroadcastId}` : sql``}
        ORDER BY b.scheduled_at ASC, r2.created_at ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE OF r2 SKIP LOCKED
      ) AS picked
      WHERE r.id = picked.id
      RETURNING r.id, r.broadcast_id, r.org_id, r.channel_id, r.telegram_chat_id,
                r.attempts, r.channel_name
    `

    if (batch.length === 0) break

    const broadcastIds = [...new Set((batch as any[]).map((r) => r.broadcast_id))]
    for (const bid of broadcastIds) {
      await sql`
        UPDATE support_broadcast_scheduled
        SET status = 'running',
            started_at = COALESCE(started_at, NOW()),
            last_worker_at = NOW()
        WHERE id = ${bid as string} AND status = 'queued'
      `.catch(() => {})
      await sql`
        UPDATE support_broadcast_scheduled
        SET last_worker_at = NOW()
        WHERE id = ${bid as string} AND status = 'running'
      `.catch(() => {})
    }

    for (const r of batch as any[]) {
      if (Date.now() >= deadline) break

      const campaign = await loadCampaign(r.broadcast_id)
      if (!campaign) {
        await markFailed(sql, r.id, 'unknown', 'campaign_not_found')
        stats.failed += 1
        continue
      }

      if (campaign.status === 'cancelled') {
        await sql`
          UPDATE support_broadcast_recipients
          SET status = 'skipped', updated_at = NOW()
          WHERE id = ${r.id}
        `
        stats.skipped += 1
        continue
      }

      const token = await tokenFor(r.org_id)
      if (!token) {
        await markFailed(sql, r.id, 'no_token', 'Telegram bot token не настроен')
        stats.failed += 1
        continue
      }

      if (!r.telegram_chat_id) {
        await markFailed(sql, r.id, 'chat_not_found', 'Канал без telegram_chat_id')
        stats.failed += 1
        continue
      }

      const outcome = await sendBroadcastMessage({
        chatId: r.telegram_chat_id,
        text: formatMessage(campaign),
        mediaUrl: campaign.media_url,
        mediaType: campaign.media_type,
        parseMode: 'HTML',
        botToken: token,
      })

      if (outcome.status === 'delivered') {
        await sql`
          UPDATE support_broadcast_recipients
          SET status = 'delivered',
              error_code = NULL,
              error_message = NULL,
              retry_after_at = NULL,
              telegram_message_id = ${outcome.telegramMessageId},
              delivered_at = NOW(),
              updated_at = NOW()
          WHERE id = ${r.id}
        `
        await sql`
          INSERT INTO support_messages (
            id, channel_id, org_id, telegram_message_id, sender_name, sender_role,
            is_from_client, content_type, text_content, created_at
          ) VALUES (
            ${`bcm_${r.id}`}, ${r.channel_id}, ${r.org_id},
            ${outcome.telegramMessageId},
            ${campaign.sender_name || 'Broadcast'}, 'broadcast', false,
            'text', ${campaign.message_text}, NOW()
          )
          ON CONFLICT (id) DO NOTHING
        `.catch(() => {})
        stats.delivered += 1
      } else if (outcome.status === 'queued') {
        const retryAfter = outcome.retryAfterSec || 30
        if (r.attempts >= MAX_ATTEMPTS) {
          await markFailed(sql, r.id, 'transient_exhausted', outcome.errorMessage || 'too many attempts')
          stats.failed += 1
        } else {
          await sql`
            UPDATE support_broadcast_recipients
            SET status = 'queued',
                error_code = ${outcome.errorCode},
                error_message = ${outcome.errorMessage},
                retry_after_at = NOW() + (${retryAfter} || ' seconds')::interval,
                updated_at = NOW()
            WHERE id = ${r.id}
          `
          stats.requeued += 1
        }
      } else {
        await sql`
          UPDATE support_broadcast_recipients
          SET status = 'failed',
              error_code = ${outcome.errorCode},
              error_message = ${outcome.errorMessage},
              updated_at = NOW()
          WHERE id = ${r.id}
        `
        stats.failed += 1
      }

      if (RATE_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, RATE_DELAY_MS))
      }
    }

    for (const bid of broadcastIds) {
      await finalizeCampaign(sql, bid as string)
    }
    stats.batchesProcessed += 1
  }

  stats.elapsedMs = Date.now() - startedAt
  return stats
}

async function markFailed(sql: ReturnType<typeof getSQL>, recipientId: string, errorCode: string, message: string) {
  await sql`
    UPDATE support_broadcast_recipients
    SET status = 'failed',
        error_code = ${errorCode},
        error_message = ${message?.slice(0, 500) || errorCode},
        updated_at = NOW()
    WHERE id = ${recipientId}
  `.catch(() => {})
}

async function finalizeCampaign(sql: ReturnType<typeof getSQL>, broadcastId: string): Promise<void> {
  const rows = await sql`
    SELECT status, COUNT(*)::int AS n
    FROM support_broadcast_recipients
    WHERE broadcast_id = ${broadcastId}
    GROUP BY status
  `
  const m: Record<string, number> = {}
  for (const r of rows as any[]) m[r.status] = Number(r.n)

  const queued = m['queued'] || 0
  const sending = m['sending'] || 0
  const delivered = m['delivered'] || 0
  const failed = m['failed'] || 0
  const skipped = m['skipped'] || 0
  const total = queued + sending + delivered + failed + skipped

  let status: string | null = null
  if (queued + sending === 0) {
    if (delivered === 0 && failed > 0) status = 'failed'
    else if (failed > 0) status = 'partial'
    else status = 'completed'
  }

  if (status) {
    await sql`
      UPDATE support_broadcast_scheduled
      SET status = ${status},
          delivered_count = ${delivered},
          failed_count = ${failed},
          queued_count = ${queued + sending},
          recipients_count = ${total},
          completed_at = NOW(),
          sent_at = COALESCE(sent_at, NOW())
      WHERE id = ${broadcastId} AND status NOT IN ('cancelled')
    `.catch(() => {})

    await sql`
      INSERT INTO support_broadcasts (
        id, org_id, message_type, message_text, filter_type, sender_name,
        channels_count, successful_count, failed_count, created_at
      )
      SELECT id, org_id, message_type, message_text, filter_type, sender_name,
             ${total}::int, ${delivered}::int, ${failed}::int, COALESCE(started_at, created_at)
      FROM support_broadcast_scheduled WHERE id = ${broadcastId}
      ON CONFLICT (id) DO UPDATE SET
        successful_count = EXCLUDED.successful_count,
        failed_count = EXCLUDED.failed_count,
        channels_count = EXCLUDED.channels_count
    `.catch(() => {})
  } else {
    await sql`
      UPDATE support_broadcast_scheduled
      SET delivered_count = ${delivered},
          failed_count = ${failed},
          queued_count = ${queued + sending},
          recipients_count = ${total},
          last_worker_at = NOW()
      WHERE id = ${broadcastId} AND status NOT IN ('cancelled', 'completed', 'partial', 'failed')
    `.catch(() => {})
  }
}
