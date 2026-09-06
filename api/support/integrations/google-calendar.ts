import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import {
  ensureGoogleCalSchema, readGoogleCalConfig, getAgentToken,
  invalidateAgentToken, listConnectedAgents, GOOGLE_CAL_SCOPES,
} from '../_lib/google-cal-config.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Подключение календарей команды из настроек системы.
 *
 * Каждый сотрудник подключает свой ящик сам: только так Google знает
 * настоящую занятость человека — включая то, что заведено вне CRM. Общий
 * календарь этого не умел и показывал лишь конфликты, созданные нами же.
 *
 * Реквизиты приложения общие на организацию, согласие проходит каждый за себя.
 *
 * GET                       состояние интеграции
 * GET  ?action=auth-url     ссылка на согласие Google
 * POST ?action=credentials  { clientId, clientSecret }
 * POST ?action=settings     { workDays, workFrom, workTo, slotMinutes, publicBooking }
 * POST ?action=disconnect   отключаем свой календарь, ключи приложения оставляем
 */

/**
 * Адрес возврата закрепляем при сохранении ключей, а не собираем на лету.
 * Урок интеграции Meta: приложение отвечает на нескольких доменах, а провайдер
 * требует точного совпадения с тем, что внесли в консоль. Что показали
 * и скопировали — то и уходит в Google.
 */
const computeRedirect = (req: Request) =>
  `${new URL(req.url).origin}/api/support/integrations/google-callback`

/** Секрет наружу не отдаём никогда — только признак, что он задан. */
const mask = (v: string | null) => (v ? `••••${v.slice(-4)}` : null)

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureGoogleCalSchema(sql)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const action = url.searchParams.get('action')
  const cfg = await readGoogleCalConfig(orgId)

  // ─── Ссылка на согласие ─────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'auth-url') {
    if (!cfg.clientId || !cfg.clientSecret) {
      return json({ error: 'Сначала заполните Client ID и Client Secret' }, 400)
    }
    const state = `gc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
    await sql`
      INSERT INTO support_google_oauth_state (state, org_id, agent_id)
      VALUES (${state}, ${orgId}, ${ctx.agentId})
    `
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    auth.searchParams.set('client_id', cfg.clientId)
    auth.searchParams.set('redirect_uri', cfg.redirectUri || computeRedirect(req))
    auth.searchParams.set('response_type', 'code')
    auth.searchParams.set('scope', GOOGLE_CAL_SCOPES)
    // offline + consent: без них Google отдаёт refresh-токен только один раз
    // в жизни приложения, и переподключение молча остаётся без токена
    auth.searchParams.set('access_type', 'offline')
    auth.searchParams.set('prompt', 'consent')
    auth.searchParams.set('state', state)
    return json({ url: auth.toString() })
  }

  // ─── Ключи приложения ───────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'credentials') {
    const body = await req.json().catch(() => ({})) as any
    const clientId = String(body.clientId || '').trim()
    const clientSecret = String(body.clientSecret || '').trim()
    if (!clientId || !clientSecret) {
      return json({ error: 'Нужны и Client ID, и Client Secret' }, 400)
    }
    const redirect = computeRedirect(req)
    await sql`
      INSERT INTO support_google_calendar (org_id, client_id, client_secret, redirect_uri, updated_at)
      VALUES (${orgId}, ${clientId}, ${clientSecret}, ${redirect}, NOW())
      ON CONFLICT (org_id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        client_secret = EXCLUDED.client_secret,
        redirect_uri = EXCLUDED.redirect_uri,
        updated_at = NOW()
    `
    // Смена ключей приложения обесценивает все выданные токены сразу
    invalidateAgentToken(orgId, ctx.agentId)
    return json({ ok: true, redirectUri: redirect })
  }

  // ─── Рабочие часы и публичная бронь ─────────────────────────────────────────
  if (req.method === 'POST' && action === 'settings') {
    const body = await req.json().catch(() => ({})) as any
    const days = Array.isArray(body.workDays)
      ? body.workDays.map((n: any) => parseInt(n, 10)).filter((n: number) => n >= 0 && n <= 6)
      : cfg.workDays
    const from = Math.max(0, Math.min(23, parseInt(body.workFrom, 10) || cfg.workFrom))
    const to = Math.max(from + 1, Math.min(24, parseInt(body.workTo, 10) || cfg.workTo))
    const slot = [15, 30, 45, 60, 90].includes(parseInt(body.slotMinutes, 10))
      ? parseInt(body.slotMinutes, 10) : cfg.slotMinutes
    await sql`
      INSERT INTO support_google_calendar (org_id, work_days, work_from, work_to, slot_minutes, public_booking, updated_at)
      VALUES (${orgId}, ${days.join(',')}, ${from}, ${to}, ${slot}, ${Boolean(body.publicBooking)}, NOW())
      ON CONFLICT (org_id) DO UPDATE SET
        work_days = EXCLUDED.work_days,
        work_from = EXCLUDED.work_from,
        work_to = EXCLUDED.work_to,
        slot_minutes = EXCLUDED.slot_minutes,
        public_booking = EXCLUDED.public_booking,
        updated_at = NOW()
    `
    return json({ ok: true })
  }

  // ─── Отключение ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'disconnect') {
    // Отключить можно только себя: чужой доступ — чужое дело, и снимать его
    // за человека значит тихо сломать ему встречи
    await sql`DELETE FROM support_google_agent WHERE org_id = ${orgId} AND agent_id = ${ctx.agentId}`
    invalidateAgentToken(orgId, ctx.agentId)
    return json({ ok: true })
  }

  // ─── Состояние ──────────────────────────────────────────────────────────────
  // Живость проверяем реальным обменом токена: сам факт записи в базе ничего
  // не значит — доступ могли отозвать в аккаунте Google, и сказать об этом
  // надо до того, как сорвётся назначение встречи
  const [connected, myToken] = await Promise.all([
    listConnectedAgents(orgId),
    getAgentToken(orgId, ctx.agentId),
  ])
  const mine = connected.find(c => c.agentId === ctx.agentId) || null

  return json({
    appConfigured: Boolean(cfg.clientId && cfg.clientSecret),
    clientId: cfg.clientId,
    clientSecret: mask(cfg.clientSecret),
    redirectUri: cfg.redirectUri || computeRedirect(req),
    // моё подключение
    connected: Boolean(mine),
    alive: Boolean(myToken),
    calendarEmail: mine?.email || null,
    connectedAt: mine?.connectedAt || null,
    // кто ещё из команды подключился — чтобы было видно, у кого встречи
    // будут создаваться, а у кого нет
    team: connected,
    workDays: cfg.workDays,
    workFrom: cfg.workFrom,
    workTo: cfg.workTo,
    slotMinutes: cfg.slotMinutes,
    publicBooking: cfg.publicBooking,
  })
}
