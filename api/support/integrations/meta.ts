import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureMetaSchema, readMetaConfig, invalidateMetaConfig,
         marketFromFormName } from '../lib/meta-config.js'
import { logEvent } from '../lib/system-journal.js'

export const config = { runtime: 'edge' }

/**
 * Подключение Instagram и Facebook из настроек системы.
 *
 * Раньше доступы Meta жили в переменных окружения Vercel: подключить канал
 * мог только разработчик и только через выкладку, хотя права на страницу
 * есть совсем у других людей. Здесь всё делает тот, у кого эти права.
 *
 * GET                      состояние интеграции и список форм
 * GET  ?action=auth-url    ссылка на согласие Meta
 * GET  ?action=pages       страницы, доступные подключившемуся
 * POST ?action=credentials { appId, appSecret, verifyToken }
 * POST ?action=select-page { pageId } — берём токен страницы и подписываем вебхуки
 * POST ?action=sync-forms  тянем лид-формы страницы и раскладываем по регионам
 * POST ?action=form-market { formId, market }
 * POST ?action=disconnect
 */

const GRAPH = 'https://graph.facebook.com/v21.0'

/** Права: заявки с форм, список страниц, подписка вебхуков, директ и Messenger. */
const SCOPES = [
  'pages_show_list',
  'pages_manage_metadata',
  'leads_retrieval',
  'pages_messaging',
  'instagram_basic',
  'instagram_manage_messages',
  'business_management',
].join(',')

const redirectUri = (req: Request) =>
  `${new URL(req.url).origin}/api/support/integrations/meta-callback`

/** Секрет наружу не отдаём никогда — только признак, что он задан. */
const mask = (v: string | null) => (v ? `••••${v.slice(-4)}` : null)

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureMetaSchema(sql)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const action = url.searchParams.get('action')
  const cfg = await readMetaConfig(orgId, true)

  // ─── Ссылка на согласие ─────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'auth-url') {
    if (!cfg.appId || !cfg.appSecret) {
      return json({ error: 'Сначала заполните ID и секрет приложения' }, 400)
    }
    // state связывает возврат с нашей организацией и живёт недолго:
    // чужой возврат по подобранной ссылке не должен ничего подключить
    const state = `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
    await sql`
      INSERT INTO support_meta_oauth_state (state, org_id, agent_id)
      VALUES (${state}, ${orgId}, ${ctx.agentId})
    `
    await sql`
      DELETE FROM support_meta_oauth_state WHERE created_at < NOW() - INTERVAL '1 hour'
    `
    const auth = new URL('https://www.facebook.com/v21.0/dialog/oauth')
    auth.searchParams.set('client_id', cfg.appId)
    auth.searchParams.set('redirect_uri', redirectUri(req))
    auth.searchParams.set('state', state)
    auth.searchParams.set('scope', SCOPES)
    auth.searchParams.set('response_type', 'code')
    return json({ url: auth.toString(), redirectUri: redirectUri(req) })
  }

  // ─── Страницы подключившегося ───────────────────────────────────────────────
  if (req.method === 'GET' && action === 'pages') {
    const [row] = await sql`
      SELECT user_token FROM support_meta_integration WHERE org_id = ${orgId} LIMIT 1
    ` as any[]
    if (!row?.user_token) return json({ pages: [], note: 'Сначала пройдите подключение' })
    const res = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${row.user_token}`)
    if (!res.ok) {
      return json({ error: 'Meta не отдала список страниц', details: (await res.text()).slice(0, 300) }, 502)
    }
    const data: any = await res.json()
    const pages = (data?.data || []).map((p: any) => ({ id: p.id, name: p.name }))
    return json({ pages })
  }

  // ─── Состояние ──────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const forms = await sql`
      SELECT form_id, name, market_id, suggested_market, status, leads_count, last_lead_at
      FROM support_meta_forms WHERE org_id = ${orgId}
      ORDER BY (market_id IS NULL) DESC, name
    `
    const [row] = await sql`
      SELECT user_token IS NOT NULL AS has_user FROM support_meta_integration
      WHERE org_id = ${orgId} LIMIT 1
    ` as any[]
    return json({
      appId: cfg.appId,
      appSecret: mask(cfg.appSecret),
      verifyToken: cfg.verifyToken,
      pageId: cfg.pageId,
      pageName: cfg.pageName,
      pageToken: mask(cfg.pageToken),
      igUsername: cfg.igUsername,
      connectedByName: cfg.connectedByName,
      connectedAt: cfg.connectedAt,
      source: cfg.source,
      authorized: Boolean(row?.has_user),
      webhookUrl: `${url.origin}/api/support/webhook/meta-leads`,
      redirectUri: redirectUri(req),
      forms,
    })
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const body = await req.json().catch(() => null)

  // ─── Ключи приложения ───────────────────────────────────────────────────────
  if (action === 'credentials') {
    if (!(ctx.isOrgAdmin || ctx.isGlobalAdmin || ctx.isSuperAdmin)) {
      return json({ error: 'Менять доступы может только администратор' }, 403)
    }
    const appId = String(body?.appId || '').trim()
    const appSecret = String(body?.appSecret || '').trim()
    // Маркер придумываем сами, если не задали: его значение неважно,
    // важно лишь, чтобы оно совпадало с тем, что введут в консоли Meta
    const verifyToken = String(body?.verifyToken || '').trim()
      || cfg.verifyToken || `gfs_${Math.random().toString(36).slice(2, 14)}`
    if (!appId) return json({ error: 'Нужен ID приложения' }, 400)

    await sql`
      INSERT INTO support_meta_integration (org_id, app_id, app_secret, verify_token, updated_at)
      VALUES (${orgId}, ${appId}, ${appSecret || null}, ${verifyToken}, NOW())
      ON CONFLICT (org_id) DO UPDATE SET
        app_id = ${appId},
        -- пустое поле означает «не трогать»: секрет наружу не отдаётся,
        -- и форма присылает его только когда его правда меняют
        app_secret = COALESCE(NULLIF(${appSecret}, ''), support_meta_integration.app_secret),
        verify_token = ${verifyToken},
        updated_at = NOW()
    `
    invalidateMetaConfig(orgId)
    return json({ ok: true, verifyToken })
  }

  // ─── Выбор страницы: тут и берётся рабочий токен ─────────────────────────────
  if (action === 'select-page') {
    const pageId = String(body?.pageId || '')
    if (!pageId) return json({ error: 'Выберите страницу' }, 400)
    const [row] = await sql`
      SELECT user_token FROM support_meta_integration WHERE org_id = ${orgId} LIMIT 1
    ` as any[]
    if (!row?.user_token) return json({ error: 'Сначала пройдите подключение' }, 400)

    const res = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${row.user_token}`)
    const data: any = await res.json()
    const page = (data?.data || []).find((p: any) => String(p.id) === pageId)
    if (!page?.access_token) return json({ error: 'Страница недоступна этому аккаунту' }, 400)

    // Инстаграм-аккаунт, привязанный к странице: без него директ не подключить
    let igUserId: string | null = null
    let igUsername: string | null = null
    try {
      const igRes = await fetch(
        `${GRAPH}/${pageId}?fields=instagram_business_account{id,username}&access_token=${page.access_token}`)
      const ig: any = await igRes.json()
      igUserId = ig?.instagram_business_account?.id || null
      igUsername = ig?.instagram_business_account?.username || null
    } catch { /* страница может быть без инстаграма — это нормально */ }

    const [agent] = await sql`SELECT name FROM support_agents WHERE id = ${ctx.agentId} LIMIT 1`
    await sql`
      UPDATE support_meta_integration SET
        page_id = ${pageId}, page_name = ${page.name || null}, page_token = ${page.access_token},
        ig_user_id = ${igUserId}, ig_username = ${igUsername},
        connected_by = ${ctx.agentId}, connected_by_name = ${agent?.name || null},
        connected_at = NOW(), updated_at = NOW()
      WHERE org_id = ${orgId}
    `
    invalidateMetaConfig(orgId)

    // Подписываем приложение на страницу сразу: шаг, который в ручной
    // настройке забывают чаще всего, и без него вебхуки молчат
    let subscribed = false
    let subscribeError: string | null = null
    try {
      const subRes = await fetch(`${GRAPH}/${pageId}/subscribed_apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscribed_fields: 'leadgen,messages,messaging_postbacks,feed',
          access_token: page.access_token,
        }),
      })
      const sub: any = await subRes.json()
      subscribed = Boolean(sub?.success)
      if (!subscribed) subscribeError = JSON.stringify(sub?.error || sub).slice(0, 300)
    } catch (e: any) {
      subscribeError = e?.message || 'не удалось подписать страницу'
    }

    await logEvent(sql, 'Интеграция Meta', 'подключение',
      `${page.name || pageId}${igUsername ? ` · @${igUsername}` : ''} · ${agent?.name || ctx.agentId}`)
    return json({ ok: true, pageName: page.name, igUsername, subscribed, subscribeError })
  }

  // ─── Формы страницы ─────────────────────────────────────────────────────────
  if (action === 'sync-forms') {
    if (!cfg.pageId || !cfg.pageToken) return json({ error: 'Сначала выберите страницу' }, 400)
    const res = await fetch(
      `${GRAPH}/${cfg.pageId}/leadgen_forms?fields=id,name,status,leads_count&limit=200&access_token=${cfg.pageToken}`)
    if (!res.ok) {
      return json({ error: 'Meta не отдала формы', details: (await res.text()).slice(0, 300) }, 502)
    }
    const data: any = await res.json()
    const list: any[] = data?.data || []
    for (const f of list) {
      const suggested = marketFromFormName(f.name)
      await sql`
        INSERT INTO support_meta_forms (org_id, form_id, name, page_id, suggested_market,
                                        status, leads_count, seen_at)
        VALUES (${orgId}, ${String(f.id)}, ${f.name || null}, ${cfg.pageId}, ${suggested},
                ${f.status || null}, ${Number(f.leads_count || 0)}, NOW())
        ON CONFLICT (org_id, form_id) DO UPDATE SET
          name = EXCLUDED.name, status = EXCLUDED.status,
          leads_count = EXCLUDED.leads_count,
          -- подсказку обновляем, назначенный руками регион не трогаем
          suggested_market = EXCLUDED.suggested_market, seen_at = NOW()
      `
    }
    return json({ ok: true, found: list.length })
  }

  // ─── Регион формы ───────────────────────────────────────────────────────────
  if (action === 'form-market') {
    const formId = String(body?.formId || '')
    if (!formId) return json({ error: 'formId is required' }, 400)
    const market = body?.market ? String(body.market) : null
    await sql`
      UPDATE support_meta_forms SET market_id = ${market}
      WHERE org_id = ${orgId} AND form_id = ${formId}
    `
    return json({ ok: true })
  }

  // ─── Отключение ─────────────────────────────────────────────────────────────
  if (action === 'disconnect') {
    if (!(ctx.isOrgAdmin || ctx.isGlobalAdmin || ctx.isSuperAdmin)) {
      return json({ error: 'Отключить интеграцию может только администратор' }, 403)
    }
    // Ключи приложения оставляем: подключиться заново без них не выйдет,
    // а вводить их каждый раз заново — лишняя работа
    await sql`
      UPDATE support_meta_integration SET
        user_token = NULL, page_id = NULL, page_name = NULL, page_token = NULL,
        ig_user_id = NULL, ig_username = NULL, connected_at = NULL, updated_at = NOW()
      WHERE org_id = ${orgId}
    `
    invalidateMetaConfig(orgId)
    await logEvent(sql, 'Интеграция Meta', 'отключение', `организация ${orgId}`)
    return json({ ok: true })
  }

  return json({ error: 'unknown action' }, 400)
}
