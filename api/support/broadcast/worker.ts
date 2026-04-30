import { getRequestOrgId } from '../lib/org.js'
import { json, corsHeaders } from '../lib/db.js'
import { ensureBroadcastSchema } from '../lib/broadcast-schema.js'
import { runBroadcastWorker } from '../lib/broadcast-runner.js'

export const config = {
  runtime: 'edge',
  regions: ['iad1'],
  maxDuration: 60,
}

/**
 * Cron-воркер рассылок. Каждую минуту берёт queued-получателей и отправляет.
 *
 *   GET /broadcast/worker?secret=<CRON_SECRET>           — Vercel Cron, все org'и
 *   GET /broadcast/worker?id=<id>&secret=<CRON_SECRET>   — конкретная рассылка
 *   GET /broadcast/worker  + Bearer agent_<token>        — UI (debug-кнопка)
 *
 * Реальная рабочая логика вынесена в `lib/broadcast-runner.ts` —
 * она же используется inline после создания рассылки в /broadcast/schedule,
 * чтобы не зависеть от cron'а для немедленного старта маленьких рассылок.
 */

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() })
  }

  const url = new URL(req.url)
  const cronSecret = url.searchParams.get('secret') || ''
  const auth = req.headers.get('Authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const expectedSecret = process.env.CRON_SECRET || ''
  const isCron = !!expectedSecret && (cronSecret === expectedSecret || bearer === expectedSecret)
  const isAgent = !isCron && bearer.startsWith('agent_')
  const allowOpen = !expectedSecret // если CRON_SECRET вообще не задан — пропускаем (dev/legacy env)
  if (!isCron && !isAgent && !allowOpen) {
    return json({ error: 'Unauthorized', hint: 'CRON_SECRET mismatch or missing' }, 401)
  }

  await ensureBroadcastSchema()

  const targetBroadcastId = url.searchParams.get('id')
  const orgId = isCron || allowOpen ? null : await getRequestOrgId(req)

  try {
    const stats = await runBroadcastWorker({
      orgId,
      targetBroadcastId,
      budgetMs: 55_000,
    })
    return json({ success: true, stats })
  } catch (e: any) {
    console.error('[broadcast/worker] fatal:', e)
    return json({ success: false, error: e?.message || 'worker error' }, 500)
  }
}
