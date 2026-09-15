import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { getRequestOrgId } from '../_lib/org.js'
import { extractAgentContext } from '../_lib/auth.js'
import {
  ensureAdsFeedbackSchema, readAdsFeedbackConfig, writeAdsFeedbackConfig, newAccessKey,
  prepareYandex, adsFeedbackStats, GOOGLE_CONVERSION_NAMES, YANDEX_GOALS,
} from '../_lib/ads-feedback.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

const APP_URL = 'https://www.gfsupport.uz'

/**
 * Настройки обратной петли Google Ads / Яндекс Директ — для окна интеграции.
 *
 * GET  → состояние: адрес CSV для Google (с ключом), счётчик Метрики,
 *        есть ли токен, сводка отправок, сердцебиение крона.
 * POST { action:'google_key' }                 — выдать (или перевыпустить) ключ CSV
 * POST { action:'yandex', counter, token? }    — сохранить счётчик и токен,
 *        сразу подготовить Метрику: порог офлайн-конверсий + три цели
 * POST { action:'yandex_off' }                 — отключить Яндекс (токен стирается)
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

    return json({ error: 'unknown action' }, 400)
  }

  const [stats, hb, fetched] = await Promise.all([
    adsFeedbackStats(sql, orgId),
    setting(sql, orgId, 'ads_feedback_heartbeat'),
    setting(sql, orgId, 'ads_feedback_google_fetched_at'),
  ])
  return json({
    google: {
      url: cfg.key ? csvUrl() : null,
      key: cfg.key,
      conversionNames: Object.values(GOOGLE_CONVERSION_NAMES),
      lastFetchedAt: fetched,
      stats: stats.google,
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
