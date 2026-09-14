import { getSQL } from '../_lib/db.js'
import { ensureAdsFeedbackSchema, readAdsFeedbackConfig, googleCsv } from '../_lib/ads-feedback.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

const ORG = process.env.SALES_ORG || 'org_delever'

/**
 * CSV конверсий для запланированной загрузки Google Ads.
 *
 * Google сам приходит сюда по расписанию (Цели → Загрузки → Расписания →
 * «HTTPS»), поэтому адрес открыт, а вход — по ключу в запросе: без него
 * или с чужим отдаём 404, как будто адреса нет. Формат — «конверсии по
 * кликам»: Google Click ID, название действия-конверсии, время.
 *
 * GET /api/support/public/ads-conversions?key=…
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('not found', { status: 404 })
  const key = (new URL(req.url).searchParams.get('key') || '').trim()
  if (!key || key.length < 16) return new Response('not found', { status: 404 })

  const sql = getSQL()
  await ensureAdsFeedbackSchema(sql)
  const cfg = await readAdsFeedbackConfig(sql, ORG)
  if (!cfg.key || cfg.key !== key) return new Response('not found', { status: 404 })

  const { csv, ids } = await googleCsv(sql, ORG)
  if (ids.length) {
    // Забрал — значит опубликовано; в карточке настроек это «Google забрал N»
    await sql`
      UPDATE sales_ads_events SET status = 'published', sent_at = COALESCE(sent_at, NOW())
      WHERE id = ANY(${ids}::bigint[]) AND status = 'pending'
    `
  }
  await sql`
    INSERT INTO support_settings (key, value, org_id, updated_at)
    VALUES ('ads_feedback_google_fetched_at', ${new Date().toISOString()}, ${ORG}, NOW())
    ON CONFLICT (key, org_id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'inline; filename="conversions.csv"',
      'Cache-Control': 'no-store',
    },
  })
}
