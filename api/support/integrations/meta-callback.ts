import { getSQL } from '../lib/db.js'
import { ensureMetaSchema, readMetaConfig, invalidateMetaConfig } from '../lib/meta-config.js'

export const config = { runtime: 'edge' }

/**
 * Возврат из согласия Meta.
 *
 * Сюда браузер приходит после того, как человек разрешил доступ. Меняем
 * временный код на долгоживущий токен и кладём его в базу — дальше в настройках
 * останется выбрать страницу.
 *
 * Адрес этого маршрута прописывается в приложении Meta как «Допустимый URI
 * перенаправления OAuth»: developers.facebook.com → Вход через Facebook →
 * Настройки. Он отдаётся в карточке интеграции, чтобы не набирать руками.
 *
 * Отвечаем страницей, а не JSON: сюда попадает живой человек в браузере.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'

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

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)

  const denied = url.searchParams.get('error')
  if (denied) {
    return page('Доступ не выдан',
      `Meta вернула отказ: ${url.searchParams.get('error_description') || denied}. Ничего не изменилось.`, false)
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return page('Неполный возврат', 'Meta не передала код подтверждения.', false)

  const sql = getSQL()
  await ensureMetaSchema(sql)

  // state одноразовый: без него подключить организацию по подобранной ссылке
  // было бы можно, а это чужой доступ в чужую систему
  const [row] = await sql`
    SELECT org_id, agent_id FROM support_meta_oauth_state
    WHERE state = ${state} AND created_at > NOW() - INTERVAL '1 hour' LIMIT 1
  ` as any[]
  await sql`DELETE FROM support_meta_oauth_state WHERE state = ${state}`
  if (!row) return page('Ссылка устарела', 'Начните подключение заново из настроек.', false)

  const cfg = await readMetaConfig(row.org_id, true)
  if (!cfg.appId || !cfg.appSecret) {
    return page('Не заданы ключи приложения', 'Заполните ID и секрет в карточке интеграции.', false)
  }

  const redirectUri = `${url.origin}/api/support/integrations/meta-callback`

  try {
    // Код действует секунды и только один раз — меняем сразу
    const shortRes = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
      client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: redirectUri, code,
    }))
    const short: any = await shortRes.json()
    if (!short?.access_token) {
      return page('Meta не выдала токен',
        String(short?.error?.message || 'Проверьте, что адрес возврата добавлен в настройках приложения.'), false)
    }

    // Короткий токен живёт час. Меняем на долгий — иначе интеграция отвалится
    // к вечеру того же дня, и никто не поймёт почему
    const longRes = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: cfg.appId, client_secret: cfg.appSecret, fb_exchange_token: short.access_token,
    }))
    const long: any = await longRes.json()
    const token = long?.access_token || short.access_token
    const expires = long?.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null

    let userName: string | null = null
    try {
      const meRes = await fetch(`${GRAPH}/me?fields=name&access_token=${token}`)
      const me: any = await meRes.json()
      userName = me?.name || null
    } catch { /* имя необязательно */ }

    await sql`
      INSERT INTO support_meta_integration (org_id, user_token, user_name, token_expires_at, updated_at)
      VALUES (${row.org_id}, ${token}, ${userName}, ${expires}, NOW())
      ON CONFLICT (org_id) DO UPDATE SET
        user_token = ${token}, user_name = ${userName},
        token_expires_at = ${expires}, updated_at = NOW()
    `
    invalidateMetaConfig(row.org_id)

    return page('Доступ выдан',
      `${userName ? `${userName}, с` : 'С'}пасибо. Осталось выбрать страницу в карточке интеграции — и заявки пойдут к нам.`, true)
  } catch (e: any) {
    console.error('[meta-callback] error:', e)
    return page('Не получилось', e?.message || 'Ошибка при обмене кода на токен.', false)
  }
}
