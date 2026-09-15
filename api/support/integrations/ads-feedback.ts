import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { getRequestOrgId } from '../_lib/org.js'
import { extractAgentContext } from '../_lib/auth.js'
import {
  ensureAdsFeedbackSchema, readAdsFeedbackConfig, writeAdsFeedbackConfig, newAccessKey,
  prepareYandex, adsFeedbackStats, GOOGLE_CONVERSION_NAMES, YANDEX_GOALS,
} from '../_lib/ads-feedback.js'
import { ensureGoogleCalSchema, readGoogleCalConfig } from '../_lib/google-cal-config.js'
import { ensureChannelCostsSchema, readGaOauth, writeGaOauth, syncGoogleCosts } from '../_lib/channel-costs.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

const APP_URL = 'https://www.gfsupport.uz'
/** GA4-ресурс Delever.io, связанный с кабинетом Google Ads. */
const GA_PROPERTY_DEFAULT = '514959613'
const GA_SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

/**
 * Настройки обратной петли Google Ads / Яндекс Директ — для окна интеграции.
 *
 * GET  → состояние: адрес CSV для Google (с ключом), счётчик Метрики,
 *        есть ли токен, сводка отправок, сердцебиение крона.
 * POST { action:'google_key' }                 — выдать (или перевыпустить) ключ CSV
 * POST { action:'yandex', counter, token? }    — сохранить счётчик и токен,
 *        сразу подготовить Метрику: порог офлайн-конверсий + три цели
 * POST { action:'yandex_off' }                 — отключить Яндекс (токен стирается)
 * POST { action:'ga_auth', property? }         — ссылка на согласие Google Analytics
 *        (расход Google Ads берём из GA4, связанного с кабинетом); тот же
 *        OAuth-клиент, что у календаря, возврат — в google-callback со state ga_…
 * POST { action:'ga_off' }                     — отключить Analytics
 * POST { action:'ga_sync' }                    — забрать расход за 30 дней сейчас
 *
 * Токен наружу не отдаём никогда — только «есть / нет».
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  if (!(ctx.isOrgAdmin || ctx.isGlobalAdmin || ctx.isSuperAdmin)) return json({ error: 'forbidden' }, 403)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  await ensureAdsFeedbackSchema(sql)
  const cfg = await readAdsFeedbackConfig(sql, orgId)

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as any
    const action = String(body.action || '')

    if (action === 'google_key') {
      cfg.key = newAccessKey()
      cfg.enabledAt = cfg.enabledAt || new Date().toISOString()
      await writeAdsFeedbackConfig(sql, orgId, cfg)
      return json({ ok: true, url: csvUrl(), key: cfg.key })
    }

    if (action === 'yandex') {
      const counter = String(body.counter || '').replace(/[^0-9]/g, '')
      const token = String(body.token || '').trim()
      if (!counter) return json({ error: 'укажите номер счётчика Метрики' }, 400)
      cfg.ymCounter = counter
      if (token) cfg.ymToken = token
      if (!cfg.ymToken) return json({ error: 'нужен OAuth-токен Яндекса с правом metrika:write' }, 400)
      const prep = await prepareYandex(cfg)
      if (!prep.ok) return json({ error: `Метрика не приняла: ${prep.error}` }, 400)
      cfg.ymReadyAt = new Date().toISOString()
      cfg.enabledAt = cfg.enabledAt || cfg.ymReadyAt
      await writeAdsFeedbackConfig(sql, orgId, cfg)
      // Тем же токеном сразу забираем расход Директа за месяц: отчёт по
      // каналам заполняется в момент подключения, а не следующей ночью
      let costs: any = null
      try {
        const { ensureChannelCostsSchema, syncYandexCosts } = await import('../_lib/channel-costs.js')
        await ensureChannelCostsSchema(sql)
        costs = await syncYandexCosts(sql, orgId, 30)
      } catch (e: any) { costs = { error: String(e?.message || e).slice(0, 120) } }
      return json({ ok: true, goals: prep.goals, costs })
    }

    if (action === 'yandex_off') {
      cfg.ymToken = null
      cfg.ymReadyAt = null
      await writeAdsFeedbackConfig(sql, orgId, cfg)
      return json({ ok: true })
    }

    if (action === 'ga_auth') {
      await ensureGoogleCalSchema(sql)
      const gcal = await readGoogleCalConfig(orgId)
      if (!gcal.clientId || !gcal.clientSecret) {
        return json({ error: 'Сначала задайте Client ID и Client Secret в интеграции Google Календаря — OAuth-клиент общий' }, 400)
      }
      const property = String(body.property || '').replace(/[^0-9]/g, '') || GA_PROPERTY_DEFAULT
      const ga = await readGaOauth(sql, orgId)
      await writeGaOauth(sql, orgId, { ...ga, property })
      const state = `ga_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
      await sql`
        INSERT INTO support_google_oauth_state (state, org_id, agent_id)
        VALUES (${state}, ${orgId}, ${ctx.agentId})
      `
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      auth.searchParams.set('client_id', gcal.clientId)
      auth.searchParams.set('redirect_uri', gcal.redirectUri || `${new URL(req.url).origin}/api/support/integrations/google-callback`)
      auth.searchParams.set('response_type', 'code')
      auth.searchParams.set('scope', GA_SCOPES)
      auth.searchParams.set('access_type', 'offline')
      auth.searchParams.set('prompt', 'consent')
      auth.searchParams.set('include_granted_scopes', 'false')
      auth.searchParams.set('state', state)
      return json({ ok: true, url: auth.toString() })
    }

    if (action === 'ga_off') {
      const ga = await readGaOauth(sql, orgId)
      await writeGaOauth(sql, orgId, { ...ga, refreshToken: null, email: null, connectedAt: null })
      return json({ ok: true })
    }

    if (action === 'ga_sync') {
      await ensureChannelCostsSchema(sql)
      const r = await syncGoogleCosts(sql, orgId, 30)
      return json({ ok: !r.error, ...r })
    }

    return json({ error: 'unknown action' }, 400)
  }

  const [stats, hb, fetched, ga] = await Promise.all([
    adsFeedbackStats(sql, orgId),
    setting(sql, orgId, 'ads_feedback_heartbeat'),
    setting(sql, orgId, 'ads_feedback_google_fetched_at'),
    readGaOauth(sql, orgId),
  ])
  return json({
    google: {
      url: cfg.key ? csvUrl() : null,
      key: cfg.key,
      conversionNames: Object.values(GOOGLE_CONVERSION_NAMES),
      lastFetchedAt: fetched,
      stats: stats.google,
      analytics: {
        connected: !!ga.refreshToken, email: ga.email,
        property: ga.property || GA_PROPERTY_DEFAULT, connectedAt: ga.connectedAt,
      },
    },
    yandex: {
      counter: cfg.ymCounter,
      hasToken: !!cfg.ymToken,
      readyAt: cfg.ymReadyAt,
      goals: Object.values(YANDEX_GOALS),
      stats: stats.yandex,
    },
    enabledAt: cfg.enabledAt,
    heartbeatAt: hb,
  })
}

// Адрес без ключа: Менеджер данных Google ходит с Basic-авторизацией, ключ — пароль
const csvUrl = () => `${APP_URL}/api/support/public/ads-conversions.csv`

async function setting(sql: any, orgId: string, key: string): Promise<string | null> {
  const [row] = (await sql`
    SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = ${key} LIMIT 1
  `) as any[]
  return row?.value || null
}
