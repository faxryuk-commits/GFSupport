import { getSQL } from '../_lib/db.js'
import { ensureAdsFeedbackSchema, readAdsFeedbackConfig, googleCsv } from '../_lib/ads-feedback.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

const ORG = process.env.SALES_ORG || 'org_delever'

/** Ключ из Basic-пароля либо из запроса. Имя пользователя не проверяем: секрет — пароль. */
function givenKey(req: Request): string {
  const auth = req.headers.get('authorization') || ''
  if (/^basic /i.test(auth)) {
    try {
      const decoded = atob(auth.slice(6).trim())
      const i = decoded.indexOf(':')
      return (i >= 0 ? decoded.slice(i + 1) : decoded).trim()
    } catch { return '' }
  }
  return (new URL(req.url).searchParams.get('key') || '').trim()
}

/**
 * CSV конверсий для запланированной загрузки Google Ads.
 *
 * Google сам приходит сюда по расписанию (Менеджер данных → HTTPS),
 * поэтому адрес открыт, а вход — по ключу: Менеджер данных требует имя
 * и пароль, поэтому основной путь — Basic-авторизация (имя любое, пароль —
 * ключ); ключ в запросе оставлен для проверки руками. Без ключа или с чужим
 * отдаём 401 с вызовом Basic. Формат — «конверсии по кликам»:
 * Google Click ID, название действия-конверсии, время.
 *
 * GET /api/support/public/ads-conversions.csv        (Authorization: Basic …;
 *     суффикс .csv — rewrite в vercel.json: Менеджер данных требует расширение)
 * GET /api/support/public/ads-conversions?key=…
 */
/**
 * Без ключа — 401 с вызовом Basic, а не 404: HTTP-клиенты (и Менеджер данных
 * Google) шлют имя и пароль только в ответ на такой вызов. С 404 Google
 * докладывал «неверные учётные данные», хотя до пароля дело не доходило.
 */
const challenge = () => new Response('unauthorized', {
  status: 401,
  headers: { 'WWW-Authenticate': 'Basic realm="gfsupport", charset="UTF-8"' },
})

export default async function handler(req: Request): Promise<Response> {
  console.log('[ads-conversions]', req.method, req.headers.get('authorization') ? 'auth' : 'no-auth', req.headers.get('user-agent') || '')
  // HEAD — проверка доступности: Менеджер данных может сперва спросить
  // заголовки. Отвечаем тем же вызовом/успехом, но без тела
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('not found', { status: 404 })
  const key = givenKey(req)
  if (!key || key.length < 16) return challenge()

  const sql = getSQL()
  await ensureAdsFeedbackSchema(sql)
  const cfg = await readAdsFeedbackConfig(sql, ORG)
  if (!cfg.key || cfg.key !== key) return challenge()

  const { csv, ids } = await googleCsv(sql, ORG)
  if (req.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } })
  }
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
