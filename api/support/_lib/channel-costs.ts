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
 * Google Ads сюда же, когда появится доступ к API; пока в кабинете одна
 * кампания на паузе с нулевым расходом за всё время (15.09.2026).
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

  const to = new Date()
  const from = new Date(to.getTime() - days * 86400000)
  const d = (x: Date) => x.toISOString().slice(0, 10)
  const params = new URLSearchParams({
    ids: cfg.ymCounter,
    metrics: 'ym:ev:expenses<currency>,ym:ev:expenseClicks',
    dimensions: 'ym:ev:date,ym:ev:lastsignExpenseCampaign',
    date1: d(from), date2: d(to),
    currency: 'USD', limit: '1000', accuracy: 'full',
  })
  let res: any
  try {
    res = await fetch(`${YM}?${params}`, { headers: { Authorization: `OAuth ${cfg.ymToken}` } })
      .then(r => r.json())
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
