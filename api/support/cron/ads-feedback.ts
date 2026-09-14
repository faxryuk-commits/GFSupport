import { getSQL, json } from '../_lib/db.js'
import { ensureSalesSchema } from '../_lib/sales-schema.js'
import { assertCron } from '../_lib/cron-auth.js'
import {
  ensureAdsFeedbackSchema, readAdsFeedbackConfig, collectAdsEvents, logAdsEvent,
  hasHistory, requeueYandexErrors, sendYandexEvents, type AdsEventRow,
} from '../_lib/ads-feedback.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

const ORG = process.env.SALES_ORG || 'org_delever'

/**
 * Cron: обратная петля качества лидов в Google Ads и Яндекс Директ. Раз в час.
 *
 * Находит сделки, по которым случились факты (квалификация, встреча,
 * оплата), и раскладывает их по сетям:
 *   Google — кладёт в очередь; сам файл Google забирает по расписанию
 *            с public/ads-conversions, здесь ничего не отправляется;
 *   Яндекс — грузит офлайн-конверсии в Метрику по yclid.
 *
 * Первый прогон по сети с пустым логом помечает уже случившиеся факты как
 * baseline и не отправляет их: конверсии задним числом научили бы алгоритм
 * ерунде. Подробности — _lib/ads-feedback.ts.
 */
export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

  const sql = getSQL()
  await ensureSalesSchema(sql, ORG)
  await ensureAdsFeedbackSchema(sql)
  const cfg = await readAdsFeedbackConfig(sql, ORG)

  await sql`
    INSERT INTO support_settings (key, value, org_id, updated_at)
    VALUES ('ads_feedback_heartbeat', ${new Date().toISOString()}, ${ORG}, NOW())
    ON CONFLICT (key, org_id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `

  const requeued = await requeueYandexErrors(sql, ORG)
  const events = await collectAdsEvents(sql, ORG)
  const google = events.filter(e => e.network === 'google')
  const yandex = events.filter(e => e.network === 'yandex')
  const out: Record<string, unknown> = { ok: true, candidates: events.length, requeued }

  // Google: очередь для CSV. Без ключа адрес закрыт, значит и очереди нет смысла.
  if (google.length) {
    if (!cfg.key) {
      out.google = { skipped: 'not_configured', pending: google.length }
    } else if (!(await hasHistory(sql, ORG, 'google'))) {
      for (const r of google) await logAdsEvent(sql, ORG, r, 'baseline')
      out.google = { baseline: google.length }
    } else {
      for (const r of google) await logAdsEvent(sql, ORG, r, 'pending')
      out.google = { queued: google.length }
    }
  }

  // Яндекс: сразу в Метрику.
  if (yandex.length) {
    if (!cfg.ymCounter || !cfg.ymToken || !cfg.ymReadyAt) {
      out.yandex = { skipped: 'not_configured', pending: yandex.length }
    } else if (!(await hasHistory(sql, ORG, 'yandex'))) {
      for (const r of yandex) await logAdsEvent(sql, ORG, r, 'baseline')
      out.yandex = { baseline: yandex.length }
    } else {
      const res = await sendYandexEvents(sql, ORG, cfg, yandex as AdsEventRow[])
      out.yandex = { sent: res.sent, error: res.error }
      if (res.error) out.ok = false
    }
  }

  return json(out)
}
