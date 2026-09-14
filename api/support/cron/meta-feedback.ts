import { getSQL, json } from '../_lib/db.js'
import { ensureSalesSchema } from '../_lib/sales-schema.js'
import { assertCron } from '../_lib/cron-auth.js'
import {
  readCapiCreds, ensureCapiSchema, collectDealEvents,
  sendCapiEvents, markBaseline, requeueErrors, isStale,
} from '../_lib/meta-capi.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

const ORG = process.env.SALES_ORG || 'org_delever'

/**
 * Cron: обратная петля качества лидов в Meta. Раз в час.
 *
 * Что делает: находит сделки, по которым случились факты (квалификация,
 * встреча, оплата), и сообщает о них в Conversions API — чтобы реклама
 * училась на клиентах, а не на заполнивших форму. Подробности и принцип
 * «факт, а не мнение» — в _lib/meta-capi.ts.
 *
 * Включение: в настройках интеграции Meta выбрать пиксель (кнопкой, из
 * списка рекламных кабинетов). Пока пиксель не выбран, крон честно отвечает
 * not_configured и ничего не делает.
 *
 * Факты старше недели помечаются baseline и НЕ отправляются: Meta такие
 * отбрасывает, а с сегодняшней меткой времени они научили бы алгоритм
 * ерунде. Так петля переживает и своё включение, и появление нового вида
 * события — прошлое не выгружается задним числом, свежее уходит со
 * временем самого факта.
 */
export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

  const creds = await readCapiCreds(ORG)
  const sql = getSQL()
  await ensureSalesSchema(sql, ORG)
  await ensureCapiSchema(sql)

  // Сердцебиение для страницы «Маркетинг»: прогон был, даже если пустой.
  await sql`
    INSERT INTO support_settings (key, value, org_id, updated_at)
    VALUES ('meta_feedback_heartbeat', ${new Date().toISOString()}, ${ORG}, NOW())
    ON CONFLICT (key, org_id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `

  // Атрибуция лидов — кампания, группа, креатив по номеру лида. Тем же
  // токеном и в том же часе, что и петля: событие с точным lead_id
  // и лид с названной кампанией — две стороны одного знания
  let attribution: any = null
  try {
    const { enrichMetaLeads } = await import('../_lib/meta-leads.js')
    attribution = await enrichMetaLeads(sql, ORG, 50)
  } catch (e: any) {
    attribution = { error: String(e?.message || e).slice(0, 120) }
  }

  // Ошибки прошлых прогонов возвращаем в очередь до отбора кандидатов.
  const requeued = await requeueErrors(sql, ORG)
  const events = await collectDealEvents(sql, ORG)

  if (!creds) {
    return json({
      ok: true, skipped: 'not_configured', pending: events.length,
      hint: 'выберите пиксель в настройках интеграции Meta',
    })
  }

  // Старые факты — базовая линия, свежие — в Meta со временем факта.
  const stale = events.filter(e => isStale(e))
  const fresh = events.filter(e => !isStale(e))
  const baseline = stale.length ? await markBaseline(sql, ORG, stale) : 0

  const result = await sendCapiEvents(sql, ORG, creds, fresh)
  return json({
    ok: !result.error,
    candidates: events.length,
    baseline,
    sent: result.sent,
    noMatch: result.noMatch,
    requeued,
    attribution,
    error: result.error,
  })
}
