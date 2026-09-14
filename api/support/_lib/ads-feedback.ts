import { ensureOnce } from './db.js'

/**
 * Обратная петля качества: gfsupport → Google Ads и Яндекс Директ.
 *
 * Зачем: обе системы сейчас оптимизируются на «кто заполнит форму» и находят
 * самых лёгких — любопытных, конкурентов, случайных. Заявка за 1 500 ₽,
 * из которой неизвестно, выйдет ли клиент, — это плата за форму, а не за
 * лида. Петля сообщает рекламе, какие клики довели до квалификации, встречи
 * и оплаты, и алгоритм начинает искать похожих; вслед за этим цель кампании
 * переключается с «заявка» на «квалифицирован» — и цена уже за него.
 *
 * Тот же принцип «факт, а не мнение», что в петле Meta (_lib/meta-capi.ts):
 *   qualified — на сделке заполнены точки И тип доставки;
 *   meeting   — назначена встреча (meeting_at);
 *   purchase  — пришли деньги (sales_payments) или проставлен paid_at.
 *
 * Ключ сверки — click id, сохранённый на лиде при заявке: gclid для Google,
 * yclid для Яндекса. Без него событие некуда отнести — оно помечается
 * no_match и больше не перебирается.
 *
 * Дорога до систем разная:
 *   Google — сам забирает CSV по расписанию с нашего адреса
 *            (public/ads-conversions, ключ в запросе); API Google Ads для
 *            этого не нужен, токен разработчика ждать не надо.
 *   Яндекс — офлайн-конверсии Метрики: крон шлёт CSV в API по yclid,
 *            Директ видит их как обычные цели счётчика.
 *
 * Дедупликация — таблицей-логом sales_ads_events с уникальным event_id вида
 * ads-{network}-{deal}-{kind}. Первый прогон с пустым логом по сети помечает
 * уже случившиеся факты как baseline и не отправляет их задним числом.
 */

export type AdsNetwork = 'google' | 'yandex'
export type AdsEventKind = 'qualified' | 'meeting' | 'purchase'

/** Названия действий-конверсий в Google Ads. В CSV должны совпасть буква в букву. */
export const GOOGLE_CONVERSION_NAMES: Record<AdsEventKind, string> = {
  qualified: 'CRM: квалификация',
  meeting: 'CRM: встреча',
  purchase: 'CRM: оплата',
}

/** Идентификаторы целей Метрики (тип «JavaScript-событие») и их имена. */
export const YANDEX_GOALS: Record<AdsEventKind, { id: string; name: string }> = {
  qualified: { id: 'crm_qualified', name: 'CRM: квалифицирован' },
  meeting: { id: 'crm_meeting', name: 'CRM: встреча назначена' },
  purchase: { id: 'crm_purchase', name: 'CRM: оплата' },
}

export interface AdsFeedbackConfig {
  /** Ключ доступа к CSV для Google: без него адрес не отдаёт ничего. */
  key: string | null
  /** Счётчик Метрики, куда грузим офлайн-конверсии. */
  ymCounter: string | null
  /** OAuth-токен Яндекса с правом metrika:write. Наружу не показываем. */
  ymToken: string | null
  /** Когда порог офлайн-конверсий и цели в Метрике были заведены. */
  ymReadyAt: string | null
  enabledAt: string | null
}

const SETTING_KEY = 'ads_feedback'

export async function ensureAdsFeedbackSchema(sql: any): Promise<void> {
  await ensureOnce('ads-feedback', async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS sales_ads_events (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        org_id VARCHAR(50) NOT NULL,
        network VARCHAR(10) NOT NULL,
        deal_id VARCHAR(50) NOT NULL,
        event_name VARCHAR(20) NOT NULL,
        event_id VARCHAR(90) NOT NULL,
        click_id VARCHAR(200),
        -- pending: ждёт; published: Google забрал CSV; sent: ушло в Метрику;
        -- baseline: было до включения; no_match: click id нет; error: не ушло
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        attempts INT NOT NULL DEFAULT 0,
        value NUMERIC(14,2),
        currency VARCHAR(10),
        response JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ
      )
    `
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_ads_events_eid ON sales_ads_events(event_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_ads_events_org ON sales_ads_events(org_id, network, status)`
  })
}

export async function readAdsFeedbackConfig(sql: any, orgId: string): Promise<AdsFeedbackConfig> {
  const empty: AdsFeedbackConfig = { key: null, ymCounter: null, ymToken: null, ymReadyAt: null, enabledAt: null }
  try {
    const [row] = (await sql`
      SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = ${SETTING_KEY} LIMIT 1
    `) as any[]
    if (!row?.value) return empty
    const v = JSON.parse(row.value)
    return {
      key: v.key || null,
      ymCounter: v.ymCounter ? String(v.ymCounter) : null,
      ymToken: v.ymToken || null,
      ymReadyAt: v.ymReadyAt || null,
      enabledAt: v.enabledAt || null,
    }
  } catch {
    return empty
  }
}

export async function writeAdsFeedbackConfig(sql: any, orgId: string, cfg: AdsFeedbackConfig): Promise<void> {
  await sql`
    INSERT INTO support_settings (key, value, org_id, updated_at)
    VALUES (${SETTING_KEY}, ${JSON.stringify(cfg)}, ${orgId}, NOW())
    ON CONFLICT (key, org_id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `
}

/** Ключ для адреса CSV: 32 шестнадцатеричных знака, читается глазами и вставляется в поле. */
export function newAccessKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export interface AdsEventRow {
  network: AdsNetwork
  deal_id: string
  event_name: AdsEventKind
  event_id: string
  click_id: string | null
  value: number | null
  currency: string | null
}

/**
 * Кандидаты: сделки с фактами за 90 дней, у которых лид пришёл с click id
 * Google или Яндекса. Сеть определяем по click_source лида; старые лиды без
 * него — по utm_source. Событий, которых уже нет в логе, — не отдаём.
 */
export async function collectAdsEvents(sql: any, orgId: string): Promise<AdsEventRow[]> {
  const rows = (await sql`
    WITH base AS (
      SELECT d.id, d.points, d.delivery_type, d.meeting_at, d.paid_at,
             d.monthly_amount, d.amount_usd, d.currency,
             l.click_id,
             CASE
               WHEN l.click_source = 'gclid' OR (l.click_source IS NULL AND lower(l.utm_source) IN ('google', 'gclid')) THEN 'google'
               WHEN l.click_source = 'yclid' OR (l.click_source IS NULL AND lower(l.utm_source) IN ('yandex', 'yclid')) THEN 'yandex'
               WHEN l.click_source IS NULL AND l.click_id ~ '^[0-9]{12,}$' THEN 'yandex'
             END AS network,
             (SELECT p.amount FROM sales_payments p
               WHERE p.deal_id = d.id ORDER BY p.paid_at, p.id LIMIT 1) AS first_payment
      FROM sales_deals d
      JOIN sales_leads l ON l.id = d.source_lead_id
      WHERE d.org_id = ${orgId}
        AND l.click_id IS NOT NULL AND l.click_id <> ''
        AND d.stage_since > NOW() - INTERVAL '90 days'
    ),
    cand AS (
      SELECT id, network, click_id, 'qualified' AS event_name,
             NULL::numeric AS value, NULL::varchar AS currency
        FROM base WHERE points IS NOT NULL AND delivery_type IS NOT NULL
      UNION ALL
      SELECT id, network, click_id, 'meeting', NULL, NULL
        FROM base WHERE meeting_at IS NOT NULL
      UNION ALL
      SELECT id, network, click_id, 'purchase',
             COALESCE(amount_usd, first_payment, monthly_amount),
             CASE WHEN amount_usd IS NOT NULL THEN 'USD' ELSE COALESCE(currency, 'USD') END
        FROM base WHERE first_payment IS NOT NULL OR paid_at IS NOT NULL
    )
    SELECT c.network, c.id AS deal_id, c.event_name, c.click_id, c.value, c.currency,
           'ads-' || c.network || '-' || c.id || '-' || c.event_name AS event_id
    FROM cand c
    WHERE c.network IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM sales_ads_events e
        WHERE e.event_id = 'ads-' || c.network || '-' || c.id || '-' || c.event_name
      )
    ORDER BY c.network, c.id
    LIMIT 300
  `) as any[]
  return rows as AdsEventRow[]
}

export async function logAdsEvent(
  sql: any, orgId: string, row: AdsEventRow, status: string, response: any = null,
): Promise<void> {
  await sql`
    INSERT INTO sales_ads_events (org_id, network, deal_id, event_name, event_id, click_id,
                                  status, attempts, value, currency, response, sent_at)
    VALUES (${orgId}, ${row.network}, ${row.deal_id}, ${row.event_name}, ${row.event_id},
            ${row.click_id}, ${status}, 1, ${row.value}, ${row.currency},
            ${response ? JSON.stringify(response) : null}::jsonb,
            ${status === 'sent' ? new Date().toISOString() : null})
    ON CONFLICT (event_id) DO UPDATE
      SET status = EXCLUDED.status,
          attempts = sales_ads_events.attempts + 1,
          response = EXCLUDED.response,
          sent_at = COALESCE(sales_ads_events.sent_at, EXCLUDED.sent_at)
  `
}

/** Есть ли уже лог по сети: пустой лог = петля только что включена. */
export async function hasHistory(sql: any, orgId: string, network: AdsNetwork): Promise<boolean> {
  const [{ n }] = (await sql`
    SELECT COUNT(*)::int AS n FROM sales_ads_events WHERE org_id = ${orgId} AND network = ${network}
  `) as any[]
  return Number(n) > 0
}

/** Ошибочные отправки в Метрику — вернуть в очередь (до 5 попыток). */
export async function requeueYandexErrors(sql: any, orgId: string): Promise<number> {
  const rows = (await sql`
    DELETE FROM sales_ads_events
    WHERE org_id = ${orgId} AND network = 'yandex' AND status = 'error' AND attempts < 5
    RETURNING event_id
  `) as any[]
  return rows.length
}

// ─── Google: CSV, который Ads забирает сам ──────────────────────────────────

/** Время в формате, который Google принимает без догадок: yyyy-MM-dd HH:mm:ss, зона задана в шапке. */
function googleTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} `
    + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

const csvCell = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s

/**
 * CSV для запланированной загрузки Google Ads («конверсии по кликам»).
 * Отдаём всё за 60 дней, а не только новое: Google сам отбрасывает уже
 * загруженные строки как дубли, а вот пропущенный прогон с «только новым»
 * потерял бы конверсии навсегда. Время конверсии — момент, когда факт
 * впервые замечен кроном: оно стабильно между выгрузками, и дубль остаётся
 * дублем.
 */
export async function googleCsv(sql: any, orgId: string): Promise<{ csv: string; rows: number; ids: number[] }> {
  const rows = (await sql`
    SELECT id, click_id, event_name, created_at, value, currency
    FROM sales_ads_events
    WHERE org_id = ${orgId} AND network = 'google'
      AND status IN ('pending', 'published')
      AND created_at > NOW() - INTERVAL '60 days'
    ORDER BY created_at
  `) as any[]
  const lines = [
    'Parameters:TimeZone=+0000;',
    'Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency',
  ]
  for (const r of rows) {
    const name = GOOGLE_CONVERSION_NAMES[r.event_name as AdsEventKind] || r.event_name
    const value = r.event_name === 'purchase' && r.value != null ? String(Number(r.value)) : ''
    const currency = value ? (r.currency || 'USD') : ''
    lines.push([r.click_id, name, googleTime(r.created_at), value, currency].map(csvCell).join(','))
  }
  return { csv: lines.join('\n') + '\n', rows: rows.length, ids: rows.map(r => Number(r.id)) }
}

// ─── Яндекс: офлайн-конверсии Метрики ───────────────────────────────────────

const YM = 'https://api-metrika.yandex.net/management/v1/counter'

async function ymFetch(cfg: AdsFeedbackConfig, path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${YM}/${cfg.ymCounter}${path}`, {
    ...init,
    headers: { Authorization: `OAuth ${cfg.ymToken}`, ...(init.headers || {}) },
  })
  const body = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, body }
}

const ymError = (r: { status: number; body: any }) =>
  r.body?.message || r.body?.errors?.[0]?.message || `HTTP ${r.status}`

/**
 * Подготовка счётчика: включить расширенный порог офлайн-конверсий (иначе
 * Метрика ждёт конверсию в те же сутки, а квалификация приходит через дни)
 * и завести три цели типа «JavaScript-событие» с нашими идентификаторами.
 * Идемпотентно: уже заведённые цели ищем по идентификатору условия.
 */
export async function prepareYandex(cfg: AdsFeedbackConfig): Promise<{ ok: boolean; error?: string; goals: string[] }> {
  if (!cfg.ymCounter || !cfg.ymToken) return { ok: false, error: 'нет счётчика или токена', goals: [] }

  const th = await ymFetch(cfg, '/offline_conversions/extended_threshold', { method: 'POST' })
  if (!th.ok) return { ok: false, error: `порог офлайн-конверсий: ${ymError(th)}`, goals: [] }

  const list = await ymFetch(cfg, '/goals')
  if (!list.ok) return { ok: false, error: `цели: ${ymError(list)}`, goals: [] }
  const existing = new Set<string>()
  for (const g of list.body?.goals || []) {
    for (const c of g.conditions || []) if (c.url) existing.add(String(c.url))
  }

  const made: string[] = []
  for (const kind of Object.keys(YANDEX_GOALS) as AdsEventKind[]) {
    const g = YANDEX_GOALS[kind]
    if (existing.has(g.id)) { made.push(g.id); continue }
    const r = await ymFetch(cfg, '/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: { name: g.name, type: 'action', conditions: [{ type: 'exact', url: g.id }] } }),
    })
    if (!r.ok) return { ok: false, error: `цель ${g.id}: ${ymError(r)}`, goals: made }
    made.push(g.id)
  }
  return { ok: true, goals: made }
}

export interface SendResult { sent: number; error: string | null }

/**
 * Отправка пачкой: один файл на прогон. Метрика ждёт колонки
 * Yclid, Target, DateTime (unix), Price, Currency — и принимает конверсии
 * до 21 дня давности при включённом расширенном пороге.
 */
export async function sendYandexEvents(
  sql: any, orgId: string, cfg: AdsFeedbackConfig, rows: AdsEventRow[],
): Promise<SendResult> {
  if (!rows.length) return { sent: 0, error: null }
  const now = Math.floor(Date.now() / 1000)
  const lines = ['Yclid,Target,DateTime,Price,Currency']
  for (const r of rows) {
    const price = r.event_name === 'purchase' && r.value != null ? String(Number(r.value)) : ''
    lines.push([r.click_id, YANDEX_GOALS[r.event_name].id, String(now), price, price ? (r.currency || 'USD') : ''].join(','))
  }
  const form = new FormData()
  form.append('file', new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }), 'conversions.csv')

  let errText: string | null = null
  let body: any = null
  try {
    const r = await ymFetch(cfg, '/offline_conversions/upload?client_id_type=YCLID&comment=gfsupport', {
      method: 'POST', body: form,
    })
    body = r.body
    if (!r.ok) errText = ymError(r)
  } catch (e) {
    errText = e instanceof Error ? e.message : String(e)
  }
  const status = errText ? 'error' : 'sent'
  for (const r of rows) await logAdsEvent(sql, orgId, r, status, errText ? { error: errText } : body)
  return { sent: errText ? 0 : rows.length, error: errText }
}

/** Сводка для карточки настроек: сколько чего по каждой сети за 30 дней. */
export async function adsFeedbackStats(sql: any, orgId: string): Promise<Record<AdsNetwork, Record<string, number>>> {
  const rows = (await sql`
    SELECT network, status, COUNT(*)::int AS n
    FROM sales_ads_events
    WHERE org_id = ${orgId} AND created_at > NOW() - INTERVAL '30 days'
    GROUP BY network, status
  `) as any[]
  const out: Record<AdsNetwork, Record<string, number>> = { google: {}, yandex: {} }
  for (const r of rows) if (r.network in out) out[r.network as AdsNetwork][r.status] = r.n
  return out
}
