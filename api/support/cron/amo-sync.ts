import { getSQL, json } from '../lib/db.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'
import { acceptLead } from '../lib/sales-intake.js'
import { amoGet, fetchContacts, leadPayload, isAllowedPipeline } from '../lib/sales-amo.js'

export const config = { runtime: 'edge' }

/**
 * Мост AmoCRM → приёмник лидов. Переходное решение на время, пока лид-формы
 * Meta приходят через Amo: своё приложение ждёт проверки, а лиды нужны сегодня.
 *
 * Раз в минуту забираем изменившиеся сделки по курсору updated_at и то, что
 * лежит в «Неразобранном» — заявки лид-форм падают именно туда, и про этот
 * отдельный раздел API легко забыть.
 *
 * Историю переносит отдельная разовая ручка sales/amo-backfill: у крона задача
 * держать поток, а не тянуть архив.
 *
 * Ограничение переходного периода: через Amo не доезжают ad_id и campaign_id,
 * приходит только тег формы. Разбивка по кампаниям появится со своим приёмником
 * Meta — для команды при переключении не изменится ничего, вход один.
 *
 * Переменные: AMO_DOMAIN, AMO_TOKEN, AMO_PIPELINE_MARKETS, SALES_ORG, CRON_SECRET.
 */

const ORG = process.env.SALES_ORG || 'org_delever'
const CURSOR_KEY = 'sales_amo_cursor'
const MAX_PAGES = 4            // 1000 сделок за проход — с запасом для минутного крона
const FIRST_RUN_WINDOW_H = 24  // первый запуск не тянет архив, для этого есть backfill

export default async function handler(req: Request): Promise<Response> {
  const ua = req.headers.get('user-agent') || ''
  const auth = req.headers.get('authorization') || ''
  if (!ua.includes('vercel-cron') && !(process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)) {
    return json({ error: 'unauthorized' }, 401)
  }

  const domain = process.env.AMO_DOMAIN
  const token = process.env.AMO_TOKEN
  if (!domain || !token) return json({ ok: false, error: 'AMO_DOMAIN / AMO_TOKEN not set' }, 200)
  const creds = { domain, token }

  const sql = getSQL()
  await ensureSalesSchema(sql, ORG)

  const [cursorRow] = await sql`
    SELECT value FROM support_platform_settings WHERE key = ${CURSOR_KEY}
  `
  const since = cursorRow?.value
    ? parseInt(cursorRow.value, 10)
    : Math.floor(Date.now() / 1000) - FIRST_RUN_WINDOW_H * 3600

  const out = { fetched: 0, created: 0, deduped: 0, skipped: 0, errors: 0 }
  let maxUpdated = since

  try {
    // ─── 1. Сделки, изменившиеся с прошлого прохода ───────────────────────────
    const leads: any[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await amoGet(creds,
        `/leads?filter[updated_at][from]=${since}&with=contacts&limit=250&page=${page}`)
      const batch = data?._embedded?.leads || []
      leads.push(...batch)
      if (batch.length < 250) break
    }

    // ─── 2. «Неразобранное»: заявки лид-форм лежат отдельно от сделок ─────────
    const unsorted = await amoGet(creds, `/leads/unsorted?limit=100`)
    for (const u of unsorted?._embedded?.unsorted || []) {
      const lead = u._embedded?.leads?.[0]
      if (!lead) continue
      lead._unsorted_meta = u.metadata || null
      lead._embedded = { ...(lead._embedded || {}), contacts: u._embedded?.contacts || [] }
      leads.push(lead)
    }

    out.fetched = leads.length

    const contactIds = new Set<number>()
    for (const l of leads) for (const c of l._embedded?.contacts || []) if (c.id) contactIds.add(c.id)
    const contacts = await fetchContacts(creds, [...contactIds])

    // ─── 3. В приёмник — тем же путём, что сайт и Instagram ───────────────────
    for (const lead of leads) {
      try {
        if (lead.updated_at && lead.updated_at > maxUpdated) maxUpdated = lead.updated_at
        // В аккаунте девять воронок: Instagram comments и Onboarding в CRM продаж не нужны
        if (!isAllowedPipeline(lead.pipeline_id)) { out.skipped++; continue }
        const contact = (lead._embedded?.contacts || [])
          .map((c: any) => contacts.get(c.id))
          .find((c: any) => c?.phone)

        const res = await acceptLead(sql, ORG, leadPayload(lead, contact))
        if (!res.ok) out.skipped++
        else if (res.deduped) out.deduped++
        else out.created++
      } catch (e) {
        out.errors++
        console.error('[amo-sync] lead failed:', lead?.id, e)
      }
    }

    // Курсор двигаем только после успешного прохода: упали — на следующем заходе
    // заберём тот же диапазон, идемпотентность приёмника это выдержит
    await sql`
      INSERT INTO support_platform_settings (key, value, updated_at)
      VALUES (${CURSOR_KEY}, ${String(maxUpdated)}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = ${String(maxUpdated)}, updated_at = NOW()
    `
  } catch (e: any) {
    console.error('[amo-sync] failed:', e)
    return json({ ok: false, error: e?.message || 'sync failed', ...out }, 200)
  }

  return json({ ok: true, since, cursor: maxUpdated, ...out })
}
