import { ensureOnce } from './db.js'

/**
 * Обратная петля качества: gfsupport → Meta Conversions API.
 *
 * Зачем: без неё Meta оптимизируется на «кто заполнит форму» и находит
 * самых лёгких — любопытных и конкурентов. С ней алгоритм видит, какие
 * объявления приводят людей, дошедших до квалификации, встречи и оплаты,
 * и начинает искать похожих на них.
 *
 * Принцип «факт, а не мнение»: события выводятся из данных, которые
 * менеджер заполняет, потому что без них работа не идёт, — а не из
 * статуса, который можно проставить задним числом:
 *   LeadReceived  — лид с рекламы Meta появился в CRM (сырой лид: Meta
 *                   требует первую ступень воронки, иначе не считает
 *                   долю сопоставленных и не строит воронку);
 *   QualifiedLead — на сделке заполнены точки И тип доставки;
 *   Schedule      — назначена встреча: задача kind='meeting' или переход
 *                   на этап встречи/демо (meeting_at на сделке никто
 *                   не заполняет — за 90 дней ни одной, событие молчало);
 *   Purchase      — пришли деньги (sales_payments) или проставлен paid_at.
 *
 * У каждого факта есть время (fact_at) — оно и уходит в event_time:
 * Meta просит историю смен статуса, а не снимок «на сейчас». Факт старше
 * недели в Meta не отправляется (она такие отбрасывает), а помечается
 * baseline — так же переживает и включение петли, и появление нового
 * вида события: прошлое не выгружается задним числом.
 *
 * Дедупликация — таблицей-логом sales_meta_events с уникальным event_id
 * вида gfs-{deal|lead}-{kind}: повторный прогон просто не найдёт ничего нового.
 */

export interface CapiCreds {
  datasetId: string
  token: string
  /** Чем подписана отправка — видно в карточке интеграции. */
  tokenSource: 'manual' | 'oauth' | 'page'
}

/**
 * Доступы CAPI живут в настройках интеграции Meta (support_meta_integration):
 * пиксель выбирается кнопкой из списка, токеном по умолчанию служит
 * пользовательский токен OAuth — тот же, которым система ходит за формами.
 * Ручной токен System User (capi_token) — запасной путь, он главнее.
 * Переменные окружения META_DATASET_ID / META_CAPI_TOKEN остаются
 * последним фолбэком (читаются внутри readMetaConfig).
 */
export async function readCapiCreds(orgId: string): Promise<CapiCreds | null> {
  const { readMetaConfig } = await import('./meta-config.js')
  const cfg = await readMetaConfig(orgId)
  const datasetId = (cfg.datasetId || '').trim()
  if (!datasetId) return null
  if (cfg.capiToken) return { datasetId, token: cfg.capiToken, tokenSource: 'manual' }
  if (cfg.userToken) return { datasetId, token: cfg.userToken, tokenSource: 'oauth' }
  if (cfg.pageToken) return { datasetId, token: cfg.pageToken, tokenSource: 'page' }
  return null
}

export async function ensureCapiSchema(sql: any): Promise<void> {
  await ensureOnce('meta-capi', async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS sales_meta_events (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        org_id VARCHAR(50) NOT NULL,
        deal_id VARCHAR(50) NOT NULL,
        event_name VARCHAR(30) NOT NULL,
        event_id VARCHAR(80) NOT NULL,
        -- baseline: факт был до включения петли, в Meta не отправлялся
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        attempts INT NOT NULL DEFAULT 0,
        value NUMERIC(14,2),
        currency VARCHAR(10),
        fb_response JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ
      )
    `
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_meta_events_eid ON sales_meta_events(event_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_meta_events_org ON sales_meta_events(org_id, status)`
    // Сырой лид — событие без сделки: живёт по lead_id
    await sql`ALTER TABLE sales_meta_events ADD COLUMN IF NOT EXISTS lead_id VARCHAR(50)`
    await sql`ALTER TABLE sales_meta_events ALTER COLUMN deal_id DROP NOT NULL`
  })
}

/** Старше этого Meta событие отбрасывает — такие факты только в baseline. */
export const MAX_EVENT_AGE_MS = 7 * 24 * 3600 * 1000

export interface DealEventRow {
  /** Сделка события; у сырого лида (LeadReceived) её ещё нет. */
  deal_id: string | null
  lead_id: string | null
  event_name: 'LeadReceived' | 'QualifiedLead' | 'Schedule' | 'Purchase'
  event_id: string
  lead_external_id: string | null
  meta_lead_id?: string | null
  phone: string | null
  value: number | null
  currency: string | null
  /** Когда факт случился — уходит в event_time. */
  fact_at: string | Date
}

/**
 * Кандидаты: по каждой живой сделке смотрим, какие события следуют из фактов,
 * и отдаём те, которых ещё нет в логе. Окно в 90 дней — чтобы не перебирать
 * весь архив на каждом прогоне. Сырые лиды — только с рекламы Meta (по
 * спецификации CRM-петли события с lead_id не для лидов с сайта).
 */
export async function collectDealEvents(sql: any, orgId: string): Promise<DealEventRow[]> {
  const rows = (await sql`
    WITH base AS (
      SELECT d.id, d.org_id, d.points, d.delivery_type, d.paid_at, d.created_at,
             d.monthly_amount, d.amount_usd, d.currency,
             l.external_id AS lead_external_id,
             l.meta_lead_id,
             -- Сделка без лида (заведена вручную) — телефон берём из контактов
             -- аккаунта: главный контакт первым. Иначе такие сделки вечно
             -- висели no_match, хотя номер в системе есть
             COALESCE(l.phone, (
               SELECT c.phone FROM sales_contacts c
               WHERE c.account_id = d.account_id AND c.phone IS NOT NULL
               ORDER BY c.is_primary DESC, c.created_at LIMIT 1
             )) AS phone,
             (SELECT p.amount FROM sales_payments p
               WHERE p.deal_id = d.id ORDER BY p.paid_at, p.id LIMIT 1) AS first_payment,
             (SELECT p.paid_at FROM sales_payments p
               WHERE p.deal_id = d.id ORDER BY p.paid_at, p.id LIMIT 1) AS first_paid_at,
             -- Время квалификации — переход на этап qualified; сделка,
             -- заведённая сразу квалифицированной (импорт), — её создание
             (SELECT MIN(e.changed_at) FROM sales_deal_events e
               JOIN sales_stages s ON s.id = e.new_stage_id
               WHERE e.deal_id = d.id AND s.key = 'qualified') AS qualified_at,
             (SELECT MIN(e.changed_at) FROM sales_deal_events e
               JOIN sales_stages s ON s.id = e.new_stage_id
               WHERE e.deal_id = d.id AND s.key IN ('meeting', 'demo')) AS meeting_stage_at,
             (SELECT MIN(t.created_at) FROM sales_tasks t
               WHERE t.deal_id = d.id AND t.kind = 'meeting'
                 AND COALESCE(t.status, 'open') <> 'cancelled') AS meeting_task_at
      FROM sales_deals d
      LEFT JOIN sales_leads l ON l.id = d.source_lead_id
      WHERE d.org_id = ${orgId}
        AND d.stage_since > NOW() - INTERVAL '90 days'
    ),
    cand AS (
      SELECT id AS deal_id, NULL::varchar AS lead_id, 'QualifiedLead' AS event_name,
             lead_external_id, meta_lead_id, phone,
             NULL::numeric AS value, NULL::varchar AS currency,
             COALESCE(qualified_at, created_at) AS fact_at
        FROM base WHERE points IS NOT NULL AND delivery_type IS NOT NULL
      UNION ALL
      SELECT id, NULL, 'Schedule', lead_external_id, meta_lead_id, phone, NULL, NULL,
             LEAST(meeting_stage_at, meeting_task_at)
        FROM base WHERE meeting_stage_at IS NOT NULL OR meeting_task_at IS NOT NULL
      UNION ALL
      SELECT id, NULL, 'Purchase', lead_external_id, meta_lead_id, phone,
             COALESCE(amount_usd, first_payment, monthly_amount),
             CASE WHEN amount_usd IS NOT NULL THEN 'USD' ELSE COALESCE(currency, 'USD') END,
             COALESCE(first_paid_at, paid_at)
        FROM base WHERE first_payment IS NOT NULL OR paid_at IS NOT NULL
      UNION ALL
      SELECT NULL, l.id, 'LeadReceived', l.external_id, l.meta_lead_id, l.phone,
             NULL, NULL, l.created_at
        FROM sales_leads l
        WHERE l.org_id = ${orgId}
          AND l.created_at > NOW() - INTERVAL '30 days'
          AND (l.meta_lead_id IS NOT NULL OR l.external_id LIKE 'meta_%')
    )
    SELECT c.deal_id, c.lead_id, c.event_name, c.lead_external_id, c.meta_lead_id, c.phone,
           c.value, c.currency, c.fact_at,
           'gfs-' || COALESCE(c.deal_id, c.lead_id) || '-' || lower(c.event_name) AS event_id
    FROM cand c
    WHERE NOT EXISTS (
      SELECT 1 FROM sales_meta_events e
      WHERE e.event_id = 'gfs-' || COALESCE(c.deal_id, c.lead_id) || '-' || lower(c.event_name)
    )
    ORDER BY c.fact_at
    LIMIT 200
  `) as any[]
  return rows as DealEventRow[]
}

/** Факт старше недели: в Meta не идёт, только в baseline. */
export function isStale(row: DealEventRow, now = Date.now()): boolean {
  const t = new Date(row.fact_at).getTime()
  return !Number.isFinite(t) || now - t > MAX_EVENT_AGE_MS
}

async function sha256(s: string): Promise<string> {
  const data = new TextEncoder().encode(s)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Телефон для матчинга — полный международный, только цифры.
 * phone_norm в базе — последние 9 цифр, для Meta этого мало,
 * поэтому берём сырой номер; 9 цифр считаем узбекским локальным.
 */
export function phoneForMatch(raw: string | null): string | null {
  if (!raw) return null
  const d = String(raw).replace(/\D/g, '')
  if (d.length === 9) return '998' + d
  if (d.length >= 11 && d.length <= 15) return d
  return null
}

/** user_data по правилам Meta: lead_id точный, телефон — SHA-256. */
async function userDataFor(row: DealEventRow): Promise<Record<string, unknown> | null> {
  // Точный номер лида Meta — лучший ключ: сопоставление без промахов.
  // Лиды идут через Amo, и раньше номера у нас не было — всё уходило
  // по хешу телефона, и каждое восьмое событие терялось как no_match
  if (row.meta_lead_id) return { lead_id: String(row.meta_lead_id) }
  const ext = row.lead_external_id || ''
  if (ext.startsWith('meta_')) return { lead_id: ext.slice(5) }
  const phone = phoneForMatch(row.phone)
  if (phone) return { ph: [await sha256(phone)] }
  return null
}

export interface SendResult {
  sent: number
  noMatch: number
  error: string | null
}

/** event_time — время факта; в будущее и старше недели не бывает по построению. */
function eventTimeOf(row: DealEventRow, now: number): number {
  const t = new Date(row.fact_at).getTime()
  const sec = Number.isFinite(t) ? Math.floor(t / 1000) : now
  return Math.min(sec, now)
}

/**
 * Отправка пачкой в {dataset}/events. Один запрос на прогон: Meta требует
 * свежести раз в сутки, крон ходит раз в час — запас десятикратный.
 */
export async function sendCapiEvents(
  sql: any, orgId: string, creds: CapiCreds, rows: DealEventRow[],
): Promise<SendResult> {
  const now = Math.floor(Date.now() / 1000)
  const payload: any[] = []
  const sendable: DealEventRow[] = []
  let noMatch = 0

  for (const row of rows) {
    const userData = await userDataFor(row)
    if (!userData) {
      // Матчить не по чему — фиксируем, чтобы не перебирать сделку вечно.
      await logEvent(sql, orgId, row, 'no_match', null)
      noMatch++
      continue
    }
    sendable.push(row)
    payload.push({
      event_name: row.event_name,
      event_time: eventTimeOf(row, now),
      event_id: row.event_id,
      action_source: 'system_generated',
      user_data: userData,
      custom_data: {
        lead_event_source: 'gfsupport',
        event_source: 'crm',
        ...(row.event_name === 'Purchase' && row.value != null
          ? { value: Number(row.value), currency: row.currency || 'USD' }
          : {}),
      },
    })
  }

  if (!payload.length) return { sent: 0, noMatch, error: null }

  let fb: any = null
  let errText: string | null = null
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${creds.datasetId}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: payload, access_token: creds.token }),
      },
    )
    fb = await res.json().catch(() => null)
    if (!res.ok) errText = fb?.error?.message || `HTTP ${res.status}`
  } catch (e) {
    errText = e instanceof Error ? e.message : String(e)
  }

  const status = errText ? 'error' : 'sent'
  for (const row of sendable) {
    await logEvent(sql, orgId, row, status, errText ? { error: errText } : fb)
  }
  return { sent: errText ? 0 : sendable.length, noMatch, error: errText }
}

/** Пометить факты, случившиеся до включения петли: не отправляем задним числом. */
export async function markBaseline(sql: any, orgId: string, rows: DealEventRow[]): Promise<number> {
  for (const row of rows) await logEvent(sql, orgId, row, 'baseline', null)
  return rows.length
}

async function logEvent(
  sql: any, orgId: string, row: DealEventRow, status: string, fb: any,
): Promise<void> {
  await sql`
    INSERT INTO sales_meta_events (org_id, deal_id, lead_id, event_name, event_id, status,
                                   attempts, value, currency, fb_response, sent_at)
    VALUES (${orgId}, ${row.deal_id}, ${row.lead_id}, ${row.event_name}, ${row.event_id}, ${status},
            1, ${row.value}, ${row.currency}, ${fb ? JSON.stringify(fb) : null}::jsonb,
            ${status === 'sent' ? new Date().toISOString() : null})
    ON CONFLICT (event_id) DO UPDATE
      SET status = EXCLUDED.status,
          attempts = sales_meta_events.attempts + 1,
          fb_response = EXCLUDED.fb_response,
          sent_at = COALESCE(sales_meta_events.sent_at, EXCLUDED.sent_at)
  `
}

/** Ошибочные отправки прошлых прогонов — вернуть в очередь (до 5 попыток). */
export async function requeueErrors(sql: any, orgId: string): Promise<number> {
  const rows = (await sql`
    DELETE FROM sales_meta_events
    WHERE org_id = ${orgId} AND status = 'error' AND attempts < 5
    RETURNING event_id
  `) as any[]
  return rows.length
}
