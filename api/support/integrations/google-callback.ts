import { getSQL } from '../_lib/db.js'
import { ensureGoogleCalSchema, invalidateGoogleToken } from '../_lib/google-cal-config.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Возврат из согласия Google.
 *
 * Сюда браузер приходит после того, как владелец календаря разрешил доступ.
 * Меняем временный код на refresh-токен и кладём его в базу — дальше встречи
 * из CRM создаются от имени этого ящика.
 *
 * Адрес этого маршрута прописывается в OAuth-клиенте Google как «Разрешённый
 * URI перенаправления». Он показан в карточке интеграции, чтобы не набирать
 * руками и не промахнуться символом.
 *
 * Отвечаем страницей, а не JSON: сюда попадает живой человек в браузере.
 */

function page(title: string, body: string, ok: boolean): Response {
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#eef1f6;
  font:16px/1.6 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0d1420">
  <div style="max-width:460px;padding:34px 32px;background:#fff;border:1px solid #dde3ed;
    border-radius:18px;box-shadow:0 8px 30px -18px rgba(13,20,32,.4);text-align:center">
    <div style="font-size:40px;line-height:1">${ok ? '✅' : '⚠️'}</div>
    <h1 style="font-size:21px;font-weight:750;letter-spacing:-.02em;margin:14px 0 8px">${title}</h1>
    <p style="color:#38445c;font-size:14.5px;margin:0 0 22px">${body}</p>
    <a href="/settings" style="display:inline-block;background:#3a41c9;color:#fff;text-decoration:none;
      font-size:14px;font-weight:600;padding:10px 20px;border-radius:10px">Вернуться в настройки</a>
  </div>
</body></html>`
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

const esc = (s: string) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)

  const denied = url.searchParams.get('error')
  if (denied) {
    return page('Доступ не выдан',
      `Google вернул отказ: ${esc(url.searchParams.get('error_description') || denied)}. Ничего не изменилось.`, false)
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return page('Неполный возврат', 'Google не передал код подтверждения.', false)

  const sql = getSQL()
  await ensureGoogleCalSchema(sql)

  // state одноразовый: без него подключить чужую организацию по подобранной
  // ссылке было бы можно, а это чужой календарь в чужой системе
  const [row] = await sql`
    SELECT org_id, agent_id FROM support_google_oauth_state
    WHERE state = ${state} AND created_at > NOW() - INTERVAL '1 hour' LIMIT 1
  ` as any[]
  await sql`DELETE FROM support_google_oauth_state WHERE state = ${state}`
  if (!row) return page('Ссылка устарела', 'Начните подключение заново из настроек.', false)

  const [cfg] = await sql`
    SELECT client_id, client_secret, redirect_uri
    FROM support_google_calendar WHERE org_id = ${row.org_id} LIMIT 1
  ` as any[]
  if (!cfg?.client_id || !cfg?.client_secret) {
    return page('Не заданы ключи приложения', 'Заполните Client ID и Client Secret в карточке интеграции.', false)
  }

  // Тот же адрес, что уходил в согласие: Google сверяет его побуквенно,
  // и вычисленный из текущего хоста может не совпасть
  const redirectUri = cfg.redirect_uri || `${url.origin}/api/support/integrations/google-callback`

  try {
    // Код действует секунды и только один раз — меняем сразу
    const tokRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    const tok: any = await tokRes.json()

    if (!tok?.refresh_token) {
      // Google отдаёт refresh-токен только при access_type=offline с prompt=consent.
      // Если он не пришёл, доступ уже был выдан раньше и повторное согласие
      // вернуло только access — надо отозвать доступ и пройти заново
      const why = tok?.error_description || tok?.error
        || 'Google вернул доступ без refresh-токена. Отзовите доступ приложению в аккаунте Google и подключите заново.'
      return page('Токен не получен', esc(String(why)), false)
    }

    // Чей календарь подключили — показываем в карточке, иначе непонятно,
    // тот ли аккаунт выбрали в диалоге согласия
    let email: string | null = null
    try {
      const meRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      })
      if (meRes.ok) email = (await meRes.json() as any)?.email || null
    } catch { /* адрес необязателен */ }

    let agentName: string | null = null
    try {
      const [a] = await sql`
        SELECT name FROM support_agents WHERE id = ${row.agent_id} LIMIT 1
      ` as any[]
      agentName = a?.name || null
    } catch { /* имя необязательно */ }

    await sql`
      INSERT INTO support_google_calendar
        (org_id, refresh_token, calendar_email, connected_by, connected_by_name, connected_at, updated_at)
      VALUES (${row.org_id}, ${tok.refresh_token}, ${email}, ${row.agent_id}, ${agentName}, NOW(), NOW())
      ON CONFLICT (org_id) DO UPDATE SET
        refresh_token = ${tok.refresh_token},
        calendar_email = ${email},
        connected_by = ${row.agent_id},
        connected_by_name = ${agentName},
        connected_at = NOW(),
        updated_at = NOW()
    `
    invalidateGoogleToken(row.org_id)

    return page('Календарь подключён',
      `${email ? esc(email) + ' — в' : 'В'}стречи из CRM будут появляться в этом календаре со ссылкой Google Meet.`, true)
  } catch (e: any) {
    console.error('[google-callback] error:', e)
    return page('Не удалось подключить', esc(e?.message || 'Неизвестная ошибка при обмене кода.'), false)
  }
}
