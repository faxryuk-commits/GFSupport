import { ensureOnce } from './db.js'
import { readAdsFeedbackConfig } from './ads-feedback.js'

/**
 * Расходы каналов привлечения — не Meta.
 *
 * Meta спрашивается вживую у Graph API (см. ads-by-agent.ts). Яндекс идёт
 * иначе: Метрика связана с Директом и отдаёт расход по кампаниям и дням
 * через Reporting API — тем же токеном, что нужен петле офлайн-конверсий.
 * Данные копятся в sales_channel_costs ночным кроном, чтобы отчёт не ходил
 * в Метрику на каждое открытие и пережил её недоступность.
 *
 * Google Ads — через Google Analytics: GA4-ресурс связан с кабинетом Ads и
 * отдаёт расход и клики по кампаниям (Data API, метрики advertiserAd*).
 * Так не нужен developer token Google Ads API с заявкой на доступ. Права —
 * refresh-токен analytics.readonly, выданный владельцем через тот же
 * OAuth-клиент, что и календарь; лежит в support_settings.ga_oauth.
 */

const YM = 'https://api-metrika.yandex.net/stat/v1/data'

export async function ensureChannelCostsSchema(sql: any): Promise<void> {
  await ensureOnce('channel-costs', async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS sales_channel_costs (
        org_id VARCHAR(50) NOT NULL,
        day DATE NOT NULL,
        network VARCHAR(20) NOT NULL,
        campaign VARCHAR(200) NOT NULL DEFAULT '',
        spend_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
        clicks INT NOT NULL DEFAULT 0,
        source VARCHAR(20) NOT NULL DEFAULT 'metrika',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (org_id, day, network, campaign)
      )
    `
  })
}

export interface SyncResult {
  skipped?: string
  days?: number
  rows?: number
  spend?: number
  error?: string
}

/**
 * Подтянуть расход Директа за последние N дней. Идемпотентно: строка —
 * день × кампания, повторный прогон перезаписывает (Метрика досчитывает
 * расход задним числом до двух суток).
 */
export async function syncYandexCosts(sql: any, orgId: string, days = 14): Promise<SyncResult> {
  const cfg = await readAdsFeedbackConfig(sql, orgId)
  if (!cfg.ymToken || !cfg.ymCounter) return { skipped: 'no_token' }

  const headers = { Authorization: `OAuth ${cfg.ymToken}` }

  // Без логинов клиентов Директа отчёт по расходам отдаёт пустые метрики —
  // молча, без ошибки. Логины спрашиваем у самой Метрики: она знает, какие
  // кабинеты Директа связаны со счётчиком
  let logins: string[] = []
  try {
    const cl: any = await fetch(
      `https://api-metrika.yandex.net/management/v1/clients?counters=${cfg.ymCounter}`, { headers },
    ).then(r => r.json())
    logins = (cl?.clients || []).map((c: any) => c.chief_login).filter(Boolean)
  } catch { /* ниже — честный ответ */ }
  if (!logins.length) return { skipped: 'no_direct_clients' }

  const to = new Date()
  const from = new Date(to.getTime() - days * 86400000)
  const d = (x: Date) => x.toISOString().slice(0, 10)
  const params = new URLSearchParams({
    ids: cfg.ymCounter,
    metrics: 'ym:ev:expenses<currency>,ym:ev:expenseClicks',
    dimensions: 'ym:ev:date,ym:ev:lastsignExpenseCampaign',
    date1: d(from), date2: d(to),
    currency: 'USD', limit: '1000', accuracy: 'full',
    direct_client_logins: logins.join(','),
  })
  let res: any
  try {
    res = await fetch(`${YM}?${params}`, { headers }).then(r => r.json())
  } catch (e: any) {
    return { error: String(e?.message || e).slice(0, 200) }
  }
  if (res?.errors?.length || !Array.isArray(res?.data)) {
    return { error: res?.errors?.[0]?.message || res?.message || 'metrika: пустой ответ' }
  }

  let rows = 0, spend = 0
  for (const row of res.data) {
    const day = row.dimensions?.[0]?.name
    const campaign = String(row.dimensions?.[1]?.name || '').slice(0, 200)
    const usd = Number(row.metrics?.[0] || 0)
    const clicks = Math.round(Number(row.metrics?.[1] || 0))
    if (!day || (!usd && !clicks)) continue
    await sql`
      INSERT INTO sales_channel_costs (org_id, day, network, campaign, spend_usd, clicks, source, updated_at)
      VALUES (${orgId}, ${day}, 'yandex', ${campaign}, ${usd}, ${clicks}, 'metrika', NOW())
      ON CONFLICT (org_id, day, network, campaign) DO UPDATE
        SET spend_usd = EXCLUDED.spend_usd, clicks = EXCLUDED.clicks, updated_at = NOW()
    `
    rows++; spend += usd
  }
  return { days, rows, spend: Math.round(spend * 100) / 100 }
}

export interface NetworkSpend {
  spend: number
  clicks: number
  campaigns: Array<{ name: string; spend: number; clicks: number }>
  lastDay: string | null
}

/** Расход по сетям за период — из накопленного. */
export async function channelSpend(
  sql: any, orgId: string, from: string, to: string,
): Promise<Record<string, NetworkSpend>> {
  const rows = (await sql`
    SELECT network, campaign, SUM(spend_usd)::float AS spend, SUM(clicks)::int AS clicks,
           to_char(MAX(day), 'YYYY-MM-DD') AS last_day
    FROM sales_channel_costs
    WHERE org_id = ${orgId} AND day >= ${from}::date AND day <= ${to}::date
    GROUP BY network, campaign
    ORDER BY spend DESC
  `) as any[]
  const out: Record<string, NetworkSpend> = {}
  for (const r of rows) {
    const n = out[r.network] ||= { spend: 0, clicks: 0, campaigns: [], lastDay: null }
    n.spend += r.spend; n.clicks += r.clicks
    n.campaigns.push({ name: r.campaign, spend: r.spend, clicks: r.clicks })
    if (!n.lastDay || r.last_day > n.lastDay) n.lastDay = r.last_day
  }
  return out
}

// ─── Google Ads через Google Analytics ──────────────────────────────────────

export interface GaOauth {
  refreshToken: string | null
  email: string | null
  /** GA4 property id (число), связанный с кабинетом Ads. */
  property: string | null
  connectedAt: string | null
}

export async function readGaOauth(sql: any, orgId: string): Promise<GaOauth> {
  const empty: GaOauth = { refreshToken: null, email: null, property: null, connectedAt: null }
  try {
    const [row] = (await sql`
      SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = 'ga_oauth' LIMIT 1
    `) as any[]
    if (!row?.value) return empty
    const v = JSON.parse(row.value)
    return {
      refreshToken: v.refreshToken || null, email: v.email || null,
      property: v.property ? String(v.property) : null, connectedAt: v.connectedAt || null,
    }
  } catch { return empty }
}

export async function writeGaOauth(sql: any, orgId: string, v: GaOauth): Promise<void> {
  await sql`
    INSERT INTO support_settings (key, value, org_id, updated_at)
    VALUES ('ga_oauth', ${JSON.stringify(v)}, ${orgId}, NOW())
    ON CONFLICT (key, org_id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `
}

/** Access-токен по refresh-токену через OAuth-клиент календаря (он один на организацию). */
async function gaAccessToken(sql: any, orgId: string, refreshToken: string): Promise<string | null> {
  const [app] = (await sql`
    SELECT client_id, client_secret FROM support_google_calendar WHERE org_id = ${orgId} LIMIT 1
  `) as any[]
  if (!app?.client_id || !app?.client_secret) return null
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: app.client_id, client_secret: app.client_secret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  })
  const j: any = await r.json().catch(() => null)
  return j?.access_token || null
}

/**
 * Расход Google Ads за последние N дней из GA4 Data API. Валюту просим
 * сразу в USD — API пересчитывает по курсу дня. Строка — день × кампания,
 * идемпотентно, как у Яндекса.
 */
export async function syncGoogleCosts(sql: any, orgId: string, days = 14): Promise<SyncResult> {
  const ga = await readGaOauth(sql, orgId)
  if (!ga.refreshToken || !ga.property) return { skipped: 'no_token' }
  const token = await gaAccessToken(sql, orgId, ga.refreshToken)
  if (!token) return { error: 'не удалось обновить токен Google — переподключите Analytics' }

  const to = new Date()
  const from = new Date(to.getTime() - days * 86400000)
  const d = (x: Date) => x.toISOString().slice(0, 10)
  let res: any
  try {
    res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${ga.property}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: d(from), endDate: d(to) }],
        dimensions: [{ name: 'date' }, { name: 'sessionGoogleAdsCampaignName' }],
        metrics: [{ name: 'advertiserAdCost' }, { name: 'advertiserAdClicks' }],
        currencyCode: 'USD',
        limit: 1000,
      }),
    }).then(r => r.json())
  } catch (e: any) {
    return { error: String(e?.message || e).slice(0, 200) }
  }
  if (res?.error) return { error: String(res.error.message || res.error.status).slice(0, 200) }

  let rows = 0, spend = 0
  for (const row of res.rows || []) {
    const raw = String(row.dimensionValues?.[0]?.value || '')
    const day = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw
    const name = String(row.dimensionValues?.[1]?.value || '')
    // «(not set)» — сессии без кампании Ads: расхода у них нет, пропускаем
    if (!day || !name || name === '(not set)') continue
    const usd = Number(row.metricValues?.[0]?.value || 0)
    const clicks = Math.round(Number(row.metricValues?.[1]?.value || 0))
    if (!usd && !clicks) continue
    await sql`
      INSERT INTO sales_channel_costs (org_id, day, network, campaign, spend_usd, clicks, source, updated_at)
      VALUES (${orgId}, ${day}, 'google', ${name.slice(0, 200)}, ${usd}, ${clicks}, 'ga', NOW())
      ON CONFLICT (org_id, day, network, campaign) DO UPDATE
        SET spend_usd = EXCLUDED.spend_usd, clicks = EXCLUDED.clicks, updated_at = NOW()
    `
    rows++; spend += usd
  }
  return { days, rows, spend: Math.round(spend * 100) / 100 }
}
