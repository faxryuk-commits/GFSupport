import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureMetaSchema, readMetaConfig, invalidateMetaConfig,
         readMetaAccounts, marketFromFormName } from '../lib/meta-config.js'
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
 * POST ?action=select-page { pageId } — добавляем аккаунт и подписываем вебхуки
 * POST ?action=sync-forms { accountId? } — тянем лид-формы и раскладываем по регионам
 * POST ?action=form-market { formId, market }
 * POST ?action=account-market { accountId, market }
 * POST ?action=disconnect { accountId? } — аккаунт или весь доступ приложения
 *
 * Аккаунтов может быть несколько: у каждого региона своя страница со своей
 * рекламой и своим инстаграмом. Настройка приложения при этом одна и разовая —
 * это разные сущности с разной судьбой, и мешать их в одном экране нельзя.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'

/**
 * Права разделены на две части намеренно.
 *
 * Базовые есть у любого приложения с настроенными сценариями Instagram
 * и Messenger. А leads_retrieval живёт в отдельном сценарии про рекламу,
 * и если его в приложении нет, Facebook отвечает «Invalid Scopes» и не
 * пускает вообще никуда — вместе с директом и страницами, которые
 * подключились бы прекрасно.
 *
 * Поэтому при отказе можно подключиться базовым набором и добавить заявки
 * потом, когда сценарий появится: повторное согласие просто расширит права.
 */
const BASE_SCOPES = [
  'pages_show_list',
  'pages_manage_metadata',
  'pages_messaging',
  'instagram_basic',
  'instagram_manage_messages',
]
// Заявок два разрешения, а не одно: leads_retrieval даёт читать содержимое
// заявки, а pages_manage_ads — вообще увидеть список форм страницы. Без
// второго Meta отвечает «(#200) Requires pages_manage_ads permission»
const LEAD_SCOPES = ['leads_retrieval', 'pages_manage_ads', 'business_management']

const scopesFor = (mode: string | null) =>
  (mode === 'base' ? BASE_SCOPES : [...BASE_SCOPES, ...LEAD_SCOPES]).join(',')

/**
 * Адрес возврата. Собирался из хоста текущего запроса — и это подводило:
 * приложение отвечает на трёх доменах, а Meta со строгим режимом требует
 * точного совпадения с тем, что внесли в консоль. Откроешь панель с другого
 * адреса — и снова «URL заблокирован» без внятной причины.
 *
 * Поэтому адрес закрепляется при сохранении ключей и дальше берётся только
 * из базы: что показали и скопировали, то и уходит в Meta.
 */
const computeRedirect = (req: Request) =>
  `${new URL(req.url).origin}/api/support/integrations/meta-callback`

export function pinnedRedirect(row: any, req: Request): string {
  return row?.redirect_uri || computeRedirect(req)
}

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
    const [pinRow] = await sql`
      SELECT redirect_uri FROM support_meta_integration WHERE org_id = ${orgId} LIMIT 1
    ` as any[]
    const auth = new URL('https://www.facebook.com/v21.0/dialog/oauth')
    auth.searchParams.set('client_id', cfg.appId)
    auth.searchParams.set('redirect_uri', pinnedRedirect(pinRow, req))
    auth.searchParams.set('state', state)
    auth.searchParams.set('scope', scopesFor(url.searchParams.get('scopes')))
    auth.searchParams.set('response_type', 'code')
    return json({ url: auth.toString(), redirectUri: pinnedRedirect(pinRow, req) })
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

  // ─── Что нам вообще разрешили ───────────────────────────────────────────────
  // Без этого человек узнаёт об отсутствии права только по ошибке в середине
  // работы — и по тексту Meta понять, чего не хватает, невозможно
  if (req.method === 'GET' && action === 'permissions') {
    const [row] = await sql`
      SELECT user_token FROM support_meta_integration WHERE org_id = ${orgId} LIMIT 1
    ` as any[]
    if (!row?.user_token) return json({ granted: [], leadsOk: false, messagesOk: false })
    try {
      const res = await fetch(`${GRAPH}/me/permissions?access_token=${row.user_token}`)
      const data: any = await res.json()
      const granted: string[] = (data?.data || [])
        .filter((p: any) => p.status === 'granted').map((p: any) => p.permission)
      const has = (n: string) => granted.includes(n)
      return json({
        granted,
        leadsOk: has('leads_retrieval') && has('pages_manage_ads'),
        messagesOk: has('pages_messaging') || has('instagram_manage_messages'),
      })
    } catch {
      return json({ granted: [], leadsOk: false, messagesOk: false })
    }
  }

  // ─── Состояние ──────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const forms = await sql`
      SELECT form_id, name, market_id, suggested_market, status, leads_count, last_lead_at
      FROM support_meta_forms WHERE org_id = ${orgId}
      ORDER BY (market_id IS NULL) DESC, name
    `
    const [row] = await sql`
      SELECT user_token IS NOT NULL AS has_user, redirect_uri FROM support_meta_integration
      WHERE org_id = ${orgId} LIMIT 1
    ` as any[]
    const accounts = await readMetaAccounts(orgId)
    return json({
      accounts: accounts.map(a => ({
        id: a.id, pageId: a.pageId, pageName: a.pageName,
        igUsername: a.igUsername, marketId: a.marketId,
        subscribed: a.subscribed, subscribeError: a.subscribeError,
        connectedByName: a.connectedByName, connectedAt: a.connectedAt,
      })),
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
      redirectUri: pinnedRedirect(row, req),
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

    // Закрепляем адрес возврата тем, что человек видит и копирует прямо сейчас
    const pin = computeRedirect(req)
    await sql`
      INSERT INTO support_meta_integration (org_id, app_id, app_secret, verify_token, redirect_uri, updated_at)
      VALUES (${orgId}, ${appId}, ${appSecret || null}, ${verifyToken}, ${pin}, NOW())
      ON CONFLICT (org_id) DO UPDATE SET
        redirect_uri = ${pin},
        app_id = ${appId},
        -- пустое поле означает «не трогать»: секрет наружу не отдаётся,
        -- и форма присылает его только когда его правда меняют
        app_secret = COALESCE(NULLIF(${appSecret}, ''), support_meta_integration.app_secret),
        verify_token = ${verifyToken},
        updated_at = NOW()
    `
    invalidateMetaConfig(orgId)
    return json({ ok: true, verifyToken, redirectUri: pin })
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
    // Аккаунт добавляется в список, а не заменяет единственный: у каждого
    // региона своя страница, и подключают их в разное время разные люди
    await sql`
      INSERT INTO support_meta_accounts (id, org_id, page_id, page_name, page_token,
                                         ig_user_id, ig_username, connected_by, connected_by_name)
      VALUES (${'ma_' + pageId}, ${orgId}, ${pageId}, ${page.name || null}, ${page.access_token},
              ${igUserId}, ${igUsername}, ${ctx.agentId}, ${agent?.name || null})
      ON CONFLICT (org_id, page_id) DO UPDATE SET
        page_name = EXCLUDED.page_name, page_token = EXCLUDED.page_token,
        ig_user_id = EXCLUDED.ig_user_id, ig_username = EXCLUDED.ig_username,
        connected_by = EXCLUDED.connected_by, connected_by_name = EXCLUDED.connected_by_name,
        is_active = true, updated_at = NOW()
    `
    invalidateMetaConfig(orgId)

    // Подписываем приложение на страницу сразу: шаг, который в ручной
    // настройке забывают чаще всего, и без него вебхуки молчат
    // Подписываемся двумя заходами, а не одним списком. Одним — Meta валит
    // всю подписку из-за единственного поля: нет разрешения на заявки, и
    // вместе с ними отваливаются сообщения, которые подписались бы спокойно
    const subscribe = async (fields: string): Promise<string | null> => {
      try {
        const res = await fetch(`${GRAPH}/${pageId}/subscribed_apps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscribed_fields: fields, access_token: page.access_token }),
        })
        const out: any = await res.json()
        if (out?.success) return null
        return String(out?.error?.message || JSON.stringify(out)).slice(0, 200)
      } catch (e: any) {
        return e?.message || 'страница не ответила'
      }
    }

    const msgErr = await subscribe('messages,messaging_postbacks,feed')
    const leadErr = await subscribe('leadgen')
    const subscribed = !msgErr
    // Про заявки говорим человеческим языком: в ответе Meta это длинная
    // строка с трассировкой, из которой ничего не понять
    const subscribeError = msgErr
      ? `Сообщения не подписались: ${msgErr}`
      : leadErr
        ? 'Сообщения идут. Заявки с рекламы — нет разрешения leads_retrieval'
        : null

    await sql`
      UPDATE support_meta_accounts SET subscribed = ${subscribed}, subscribe_error = ${subscribeError}
      WHERE org_id = ${orgId} AND page_id = ${pageId}
    `
    await logEvent(sql, 'Интеграция Meta', 'подключён аккаунт',
      `${page.name || pageId}${igUsername ? ` · @${igUsername}` : ''} · ${agent?.name || ctx.agentId}`)
    return json({ ok: true, pageName: page.name, igUsername, subscribed, subscribeError })
  }

  // ─── Формы страницы ─────────────────────────────────────────────────────────
  // Формы тянем по всем подключённым аккаунтам сразу: у каждой страницы
  // свои формы, и заставлять выбирать страницу перед обновлением незачем
  if (action === 'sync-forms') {
    const accounts = await readMetaAccounts(orgId)
    const targets = body?.accountId
      ? accounts.filter(a => a.id === String(body.accountId))
      : accounts
    if (!targets.length) return json({ error: 'Сначала подключите аккаунт' }, 400)

    let found = 0
    const failed: string[] = []
    for (const acc of targets) {
      if (!acc.pageToken) continue
      const res = await fetch(
        `${GRAPH}/${acc.pageId}/leadgen_forms?fields=id,name,status,leads_count&limit=200&access_token=${acc.pageToken}`)
      if (!res.ok) {
        // Разбираем ответ Meta: «не отдала формы» не говорит человеку ничего,
        // а причина почти всегда одна и та же — не хватает разрешения
        let why = ''
        try {
          const err: any = await res.json()
          why = String(err?.error?.message || '')
        } catch { /* тело не разобралось — обойдёмся кодом ответа */ }
        if (/pages_manage_ads|leads_retrieval|permission/i.test(why)) {
          return json({
            error: 'Нет разрешения на заявки с рекламы. Вы подключались без него — '
              + 'добавьте в приложении Meta права pages_manage_ads и leads_retrieval, '
              + 'затем нажмите «+ Аккаунт» и войдите заново: права расширятся, '
              + 'переподключать страницу не нужно.',
            needsScopes: ['pages_manage_ads', 'leads_retrieval'],
            details: why.slice(0, 200),
          }, 403)
        }
        failed.push(acc.pageName || acc.pageId)
        continue
      }
      const data: any = await res.json()
      for (const f of (data?.data || [])) {
        found++
        // Регион формы наследуем от аккаунта, если у страницы он задан:
        // страница региона обычно и ведёт формы этого региона
        const suggested = marketFromFormName(f.name) || acc.marketId
        await sql`
          INSERT INTO support_meta_forms (org_id, form_id, name, page_id, suggested_market,
                                          status, leads_count, seen_at)
          VALUES (${orgId}, ${String(f.id)}, ${f.name || null}, ${acc.pageId}, ${suggested},
                  ${f.status || null}, ${Number(f.leads_count || 0)}, NOW())
          ON CONFLICT (org_id, form_id) DO UPDATE SET
            name = EXCLUDED.name, status = EXCLUDED.status, page_id = EXCLUDED.page_id,
            leads_count = EXCLUDED.leads_count,
            -- подсказку обновляем, назначенный руками регион не трогаем
            suggested_market = EXCLUDED.suggested_market, seen_at = NOW()
        `
      }
    }
    return json({ ok: true, found, failed })
  }

  // ─── Регион аккаунта ────────────────────────────────────────────────────────
  if (action === 'account-market') {
    if (!body?.accountId) return json({ error: 'accountId is required' }, 400)
    await sql`
      UPDATE support_meta_accounts SET market_id = ${body.market || null}, updated_at = NOW()
      WHERE org_id = ${orgId} AND id = ${String(body.accountId)}
    `
    return json({ ok: true })
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
      return json({ error: 'Отключить может только администратор' }, 403)
    }
    // Отключение одного аккаунта — обычное дело: закрыли направление, сменили
    // страницу. Остальные при этом работать не перестают
    if (body?.accountId) {
      const [acc] = await sql`
        SELECT page_name FROM support_meta_accounts
        WHERE org_id = ${orgId} AND id = ${String(body.accountId)} LIMIT 1
      ` as any[]
      await sql`
        UPDATE support_meta_accounts SET is_active = false, page_token = NULL, updated_at = NOW()
        WHERE org_id = ${orgId} AND id = ${String(body.accountId)}
      `
      invalidateMetaConfig(orgId)
      await logEvent(sql, 'Интеграция Meta', 'отключён аккаунт', acc?.page_name || String(body.accountId))
      return json({ ok: true })
    }

    // Без указания аккаунта — снимаем сам доступ приложения. Ключи оставляем:
    // подключиться заново без них не выйдет, а вводить каждый раз — лишняя работа
    await sql`
      UPDATE support_meta_integration SET user_token = NULL, updated_at = NOW()
      WHERE org_id = ${orgId}
    `
    await sql`UPDATE support_meta_accounts SET is_active = false WHERE org_id = ${orgId}`
    invalidateMetaConfig(orgId)
    await logEvent(sql, 'Интеграция Meta', 'полное отключение', `организация ${orgId}`)
    return json({ ok: true })
  }

  return json({ error: 'unknown action' }, 400)
}
