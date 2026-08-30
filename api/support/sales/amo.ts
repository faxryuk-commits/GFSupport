import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { ensureSalesSchema } from '../_lib/sales-schema.js'
import { AMO_MODE_KEY, readAmoMode, amoGet, isAllowedPipeline, statusMap,
         stageKeyByStatusName, marketByPipeline, type AmoMode } from '../_lib/sales-amo.js'
import { logEvent } from '../_lib/system-journal.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Управление мостом с AmoCRM — предохранитель перехода команды на свою CRM.
 *
 * GET                  — режим, состояние моста, чей вклад в базе
 * GET ?action=reconcile&page=N — сверка одной страницы сделок Amo с нашей базой
 * POST { mode }        — переключить режим (только администратор)
 *
 * Почему режим живёт здесь, а не в переменных окружения: решение «команда
 * переходит к нам» принимает руководитель продаж, а не разработчик, и откат
 * должен занимать секунды. Смысл режимов — в readAmoMode (lib/sales-amo).
 */

const MODES: AmoMode[] = ['full', 'leads_only', 'off']
const RECONCILE_PAGE = 250

/**
 * Сверка одной страницы. Постранично, а не целиком, намеренно: сколько сделок
 * в Amo, отсюда неизвестно, а edge-функция живёт секунды — проход «за всё
 * сразу» упирался бы в таймаут ровно тогда, когда база выросла. Страницу
 * заказывает интерфейс и складывает результаты сам.
 */
async function reconcilePage(sql: any, orgId: string, creds: any, page: number) {
  const data = await amoGet(creds, `/leads?limit=${RECONCILE_PAGE}&page=${page}&order[id]=asc`)
  const batch: any[] = data?._embedded?.leads || []
  const hasMore = batch.length === RECONCILE_PAGE

  // Чужие воронки (Instagram comments, Onboarding) в CRM продаж не заводятся —
  // их отсутствие у нас не расхождение, а замысел
  const mine = batch.filter(l => isAllowedPipeline(l.pipeline_id))
  if (!mine.length) {
    return { page, seen: batch.length, checked: 0, hasMore, missing: [], noDeal: [], stageDiff: [] }
  }

  const extIds = mine.map(l => `amo_${l.id}`)
  const [leadRows, dealRows, statuses] = await Promise.all([
    sql`SELECT external_id FROM sales_leads WHERE org_id = ${orgId} AND external_id = ANY(${extIds})`,
    sql`
      SELECT d.external_id, COALESCE(s.key, '') AS stage_key
      FROM sales_deals d LEFT JOIN sales_stages s ON s.id = d.stage_id
      WHERE d.org_id = ${orgId} AND d.external_id = ANY(${extIds}) AND d.archived_at IS NULL
    `,
    statusMap(creds),
  ])
  const haveLead = new Set((leadRows as any[]).map(r => r.external_id))
  const dealStage = new Map((dealRows as any[]).map(r => [r.external_id, r.stage_key]))

  const missing: any[] = []    // нет ни лида, ни сделки
  const noDeal: any[] = []     // лид завели, а сделки нет — та самая дыра синка
  const stageDiff: any[] = []  // сделка есть, но стоит на другом этапе

  for (const l of mine) {
    const ext = `amo_${l.id}`
    const st = (statuses as any).get(l.status_id)
    const amoStage = st ? stageKeyByStatusName(st.name, st.isWon, st.isLost) : null
    const row = {
      id: l.id, name: l.name || null, amoStatus: st?.name || null,
      amoStage, market: marketByPipeline(l.pipeline_id),
    }
    if (!dealStage.has(ext)) {
      if (haveLead.has(ext)) noDeal.push(row)
      else missing.push(row)
      continue
    }
    const ourStage = dealStage.get(ext)
    if (amoStage && ourStage && amoStage !== ourStage) {
      stageDiff.push({ ...row, ourStage })
    }
  }

  return { page, seen: batch.length, checked: mine.length, hasMore, missing, noDeal, stageDiff }
}

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

  const url = new URL(req.url)
  if (url.searchParams.get('action') === 'reconcile') {
    const domain = process.env.AMO_DOMAIN
    const token = process.env.AMO_TOKEN
    if (!domain || !token) return json({ error: 'Доступ к Amo не настроен' }, 400)
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
    try {
      return json(await reconcilePage(sql, orgId, { domain, token }, page))
    } catch (e: any) {
      return json({ error: e?.message || 'Amo не ответил' }, 502)
    }
  }

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
