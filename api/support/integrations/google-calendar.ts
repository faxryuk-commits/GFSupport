import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import {
  ensureGoogleCalSchema, readGoogleCalConfig, getGoogleAccessToken,
  invalidateGoogleToken, GOOGLE_CAL_SCOPES,
} from '../_lib/google-cal-config.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Подключение общего календаря продаж из настроек системы.
 *
 * Календарь один на команду: встречи распределяет CRM, но видят их все —
 * если менеджер не успевает, коллега подхватывает встречу, а для этого
 * чужое расписание должно лежать на одном полотне с собственным.
 *
 * GET                       состояние интеграции
 * GET  ?action=auth-url     ссылка на согласие Google
 * POST ?action=credentials  { clientId, clientSecret }
 * POST ?action=settings     { workDays, workFrom, workTo, slotMinutes, publicBooking }
 * POST ?action=disconnect   отзываем доступ, ключи приложения оставляем
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
    invalidateGoogleToken(orgId)
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
    // Ключи приложения оставляем: заводить их заново ради переподключения
    // календаря — лишняя работа, а секрет уже и так у нас
    await sql`
      UPDATE support_google_calendar
      SET refresh_token = NULL, calendar_email = NULL,
          connected_by = NULL, connected_by_name = NULL, connected_at = NULL, updated_at = NOW()
      WHERE org_id = ${orgId}
    `
    invalidateGoogleToken(orgId)
    return json({ ok: true })
  }

  // ─── Состояние ──────────────────────────────────────────────────────────────
  // Живость проверяем обменом refresh-токена: сам факт записи в базе ничего
  // не значит — доступ могли отозвать в аккаунте Google, и об этом надо
  // сказать до того, как сорвётся назначение встречи
  const alive = cfg.refreshToken ? Boolean(await getGoogleAccessToken(cfg)) : false

  return json({
    appConfigured: Boolean(cfg.clientId && cfg.clientSecret),
    clientId: cfg.clientId,
    clientSecret: mask(cfg.clientSecret),
    redirectUri: cfg.redirectUri || computeRedirect(req),
    connected: Boolean(cfg.refreshToken),
    alive,
    calendarEmail: cfg.calendarEmail,
    connectedByName: cfg.connectedByName,
    connectedAt: cfg.connectedAt,
    workDays: cfg.workDays,
    workFrom: cfg.workFrom,
    workTo: cfg.workTo,
    slotMinutes: cfg.slotMinutes,
    publicBooking: cfg.publicBooking,
  })
}
