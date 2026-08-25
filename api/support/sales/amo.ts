import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'
import { AMO_MODE_KEY, readAmoMode, type AmoMode } from '../lib/sales-amo.js'
import { logEvent } from '../lib/system-journal.js'

export const config = { runtime: 'edge' }

/**
 * Управление мостом с AmoCRM — предохранитель перехода команды на свою CRM.
 *
 * GET  — режим, состояние моста, чей вклад в базе
 * POST { mode } — переключить режим (только администратор)
 *
 * Почему режим живёт здесь, а не в переменных окружения: решение «команда
 * переходит к нам» принимает руководитель продаж, а не разработчик, и откат
 * должен занимать секунды. Смысл режимов — в readAmoMode (lib/sales-amo).
 */

const MODES: AmoMode[] = ['full', 'leads_only', 'off']

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  if (req.method === 'POST') {
    if (!(ctx.isOrgAdmin || ctx.isGlobalAdmin || ctx.isSuperAdmin)) {
      return json({ error: 'Переключить режим моста может только администратор' }, 403)
    }
    const body = await req.json().catch(() => null)
    const mode = String(body?.mode || '') as AmoMode
    if (!MODES.includes(mode)) return json({ error: 'unknown mode' }, 400)

    const was = await readAmoMode(sql)
    if (was === mode) return json({ ok: true, mode, unchanged: true })

    await sql`
      INSERT INTO support_platform_settings (key, value, updated_at)
      VALUES (${AMO_MODE_KEY}, ${mode}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = ${mode}, updated_at = NOW()
    `
    const [agent] = await sql`SELECT name FROM support_agents WHERE id = ${ctx.agentId} LIMIT 1`
    // Переключение режима меняет то, чья работа считается истиной. Такое
    // решение должно быть видно в Хронике с именем, а не всплывать сюрпризом
    await logEvent(sql, 'Мост Amo', 'смена режима',
      `${was} → ${mode} · ${agent?.name || ctx.agentId}`)
    return json({ ok: true, mode, was })
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const [mode, settings, counts] = await Promise.all([
    readAmoMode(sql),
    sql`
      SELECT key, value, updated_at FROM support_platform_settings
      WHERE key IN ('sales_amo_cursor', 'sales_amo_last_run')
    `,
    sql`
      SELECT
        (SELECT COUNT(*) FROM sales_deals
          WHERE org_id = ${orgId} AND external_id LIKE 'amo_%')::int AS deals_from_amo,
        (SELECT COUNT(*) FROM sales_deals
          WHERE org_id = ${orgId} AND (external_id IS NULL OR external_id NOT LIKE 'amo_%'))::int AS deals_native,
        (SELECT COUNT(*) FROM sales_leads
          WHERE org_id = ${orgId} AND external_id LIKE 'amo_%')::int AS leads_from_amo,
        (SELECT COUNT(*) FROM sales_leads WHERE org_id = ${orgId})::int AS leads_total
    `,
  ])

  const byKey = new Map((settings as any[]).map(r => [r.key, r]))
  const cursorRow = byKey.get('sales_amo_cursor')
  const lastRunRow = byKey.get('sales_amo_last_run')
  let lastRun: any = null
  try { lastRun = lastRunRow?.value ? JSON.parse(lastRunRow.value) : null } catch { lastRun = null }

  const cursorSec = cursorRow?.value ? parseInt(cursorRow.value, 10) : null

  return json({
    mode,
    tokenSet: Boolean(process.env.AMO_DOMAIN && process.env.AMO_TOKEN),
    // Курсор — до какого момента в Amo мост дочитал. Отставание от «сейчас»
    // и есть задержка: по нему видно, что мост встал, даже когда в Amo тихо
    cursor: cursorSec,
    cursorAt: cursorSec ? new Date(cursorSec * 1000).toISOString() : null,
    lastRun,
    lastRunAt: lastRunRow?.updated_at || null,
    counts: (counts as any[])[0],
  })
}
