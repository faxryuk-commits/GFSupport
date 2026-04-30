import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, getOrgBotToken, corsHeaders } from '../lib/db.js'
import { ensureBroadcastSchema } from '../lib/broadcast-schema.js'

export const config = {
  runtime: 'edge',
}

/**
 * Диагностика рассылок. Возвращает мгновенный снимок состояния:
 *   - есть ли env CRON_SECRET (без значения)
 *   - есть ли Telegram bot token у org
 *   - кампаний по статусам
 *   - получателей по статусам (только для текущей org)
 *   - последние 5 кампаний с их last_worker_at — видно, идёт ли cron
 *
 *   GET /broadcast/diag
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() })
  }
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)

  await ensureBroadcastSchema()
  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  try {
    const cronSecretSet = !!process.env.CRON_SECRET
    const botToken = await getOrgBotToken(orgId).catch(() => null)
    const botTokenSet = !!botToken

    const campaignsByStatus = await sql`
      SELECT status, COUNT(*)::int AS n
      FROM support_broadcast_scheduled
      WHERE org_id = ${orgId}
      GROUP BY status
    `

    const recipientsByStatus = await sql`
      SELECT status, COUNT(*)::int AS n
      FROM support_broadcast_recipients
      WHERE org_id = ${orgId}
      GROUP BY status
    `

    const stuckCampaigns = await sql`
      SELECT id, status, scheduled_at, started_at, last_worker_at,
             recipients_count, delivered_count, failed_count, queued_count,
             EXTRACT(EPOCH FROM (NOW() - COALESCE(last_worker_at, started_at, created_at)))::int AS idle_seconds
      FROM support_broadcast_scheduled
      WHERE org_id = ${orgId}
        AND status IN ('queued', 'running')
      ORDER BY scheduled_at DESC
      LIMIT 10
    `

    const recentCampaigns = await sql`
      SELECT id, status, scheduled_at, started_at, completed_at, last_worker_at,
             recipients_count, delivered_count, failed_count, queued_count
      FROM support_broadcast_scheduled
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
      LIMIT 5
    `

    const pendingNow = await sql`
      SELECT COUNT(*)::int AS n
      FROM support_broadcast_recipients r
      JOIN support_broadcast_scheduled b ON b.id = r.broadcast_id
      WHERE r.org_id = ${orgId}
        AND r.status = 'queued'
        AND (r.retry_after_at IS NULL OR r.retry_after_at <= NOW())
        AND b.status IN ('queued', 'running')
        AND b.scheduled_at <= NOW()
    `

    const env = {
      cronSecretSet,
      botTokenSet,
      orgId,
      timestamp: new Date().toISOString(),
    }

    const summary: any = {
      env,
      pendingRecipientsReadyNow: (pendingNow[0] as any)?.n ?? 0,
      campaignsByStatus: rowsToMap(campaignsByStatus),
      recipientsByStatus: rowsToMap(recipientsByStatus),
      stuckCampaigns,
      recentCampaigns,
    }

    // Подсказки
    const hints: string[] = []
    if (!botTokenSet) hints.push('Не настроен Telegram bot token — рассылки не будут отправлены.')
    if (!cronSecretSet) hints.push('CRON_SECRET не задан — Vercel cron работать не будет, но inline-runner работает.')
    if (summary.pendingRecipientsReadyNow > 0) {
      hints.push(`${summary.pendingRecipientsReadyNow} получателей готовы к отправке. Если cron не запускается — нажмите «Запустить сейчас» в деталях.`)
    }
    for (const c of stuckCampaigns as any[]) {
      const idle = Number(c.idle_seconds) || 0
      if (idle > 120 && (c.status === 'queued' || c.status === 'running')) {
        hints.push(`Кампания ${c.id} простаивает ${idle}s в статусе ${c.status} — worker не дёргается.`)
      }
    }
    summary.hints = hints

    return json({ success: true, ...summary })
  } catch (e: any) {
    console.error('[broadcast/diag] error:', e)
    return json({ success: false, error: e?.message || 'diag error' }, 500)
  }
}

function rowsToMap(rows: any[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const r of rows) m[r.status] = Number(r.n)
  return m
}
