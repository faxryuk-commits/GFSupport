/**
 * ПланФакт (planfact.io) — управленческий учёт, откуда берём фактические
 * поступления денег. Ключ выдаёт владелец аккаунта ПланФакта, живёт он
 * в support_settings под ключом planfact_api_key.
 *
 * API: https://apidoc.planfact.io — заголовок X-ApiKey, база api.planfact.io,
 * ответ всегда обёрнут в { isSuccess, errorMessage, data }.
 */

const PF_BASE = 'https://api.planfact.io'

export async function getPlanfactKey(sql: any, orgId: string): Promise<string> {
  const rows = await sql`
    SELECT value FROM support_settings
    WHERE org_id = ${orgId} AND key = 'planfact_api_key'
  `
  const raw = rows[0]?.value || ''
  try { return JSON.parse(raw) } catch { return raw }
}

export interface PfResult<T> {
  ok: boolean
  error?: string
  data?: T
}

/**
 * ИНВАРИАНТ: интеграция ТОЛЬКО ЧИТАЕТ. Никаких POST/PUT/DELETE в ПланФакт —
 * там управленческий учёт компании, и запись из CRM сломала бы его целостность.
 * Привязки операций к сделкам живут целиком на нашей стороне (sales_pf_inbox).
 * Метод зашит в GET намеренно: писать через этот клиент нельзя в принципе.
 */
export async function pfFetch<T = any>(
  apiKey: string, path: string, params?: Record<string, string | number>,
): Promise<PfResult<T>> {
  const url = new URL(PF_BASE + path)
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v))
  let res: Response
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'X-ApiKey': apiKey, Accept: 'application/json' },
    })
  } catch (e) {
    return { ok: false, error: 'ПланФакт недоступен: ' + (e instanceof Error ? e.message : 'сеть') }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'ПланФакт не принял ключ — проверьте его в личном кабинете' }
  }
  let body: any
  try { body = await res.json() } catch {
    return { ok: false, error: `ПланФакт ответил ${res.status} без JSON` }
  }
  if (body?.isSuccess === false) {
    return { ok: false, error: body.errorMessage || `Ошибка ПланФакта (${body.errorCode || res.status})` }
  }
  return { ok: true, data: (body?.data ?? body) as T }
}

/** Сводка операций за период: поступления и выплаты одним запросом. */
export async function pfSummary(apiKey: string, dateStart: string, dateEnd: string) {
  return pfFetch<{
    incomeCount: number; incomeAmount: number
    outcomeCount: number; outcomeAmount: number
  }>(apiKey, '/api/v1/operations/summary', {
    'filter.operationDateStart': dateStart,
    'filter.operationDateEnd': dateEnd,
  })
}

export interface PfOperation {
  operationId: number
  operationDate: string
  /** Сумма в валюте пользователя ПланФакта (у Delever — сумы): сравнимая база. */
  value: number
  /** Сумма как в выписке + код её валюты — для показа человеку. */
  valueOriginal: number
  currency: string
  comment: string | null
  contragent: string | null
  account: string | null
  category: string | null
  isCommitted: boolean
}

/**
 * Поступления за период, нормализованные до полей, которые нужны нам.
 *
 * Контрагент и статья живут не на операции, а в её частях (operationParts) —
 * верхний contrAgent приходит null. У Delever статья операции — это бренд
 * клиента, поэтому тащим и её: для матчинга со сделками она ценнее всего.
 */
export async function pfIncomeOperations(
  apiKey: string, dateStart: string, dateEnd: string, limit = 100, offset = 0,
): Promise<PfResult<{ items: PfOperation[]; total: number }>> {
  const r = await pfFetch<{ items: any[]; total: number }>(apiKey, '/api/v1/operations', {
    'filter.operationDateStart': dateStart,
    'filter.operationDateEnd': dateEnd,
    'filter.operationType': 'Income',
    'paging.limit': limit,
    'paging.offset': offset,
  })
  if (!r.ok || !r.data) return { ok: r.ok, error: r.error }
  const items: PfOperation[] = (r.data.items || []).map((o: any) => {
    const part = Array.isArray(o.operationParts) ? o.operationParts[0] : null
    const uzs = Number(o.valueInUserCurrency)
    return {
      operationId: o.operationId,
      operationDate: String(o.operationDate || '').slice(0, 10),
      value: Math.round(Number.isFinite(uzs) && uzs > 0 ? uzs : Number(o.value) || 0),
      valueOriginal: Math.round(Number(o.value) || 0),
      currency: o.accountCurrency?.currencyCode || 'UZS',
      comment: o.comment || null,
      contragent: part?.contrAgent?.title || o.contrAgent?.title || null,
      account: o.account?.title || null,
      category: part?.operationCategory?.title || o.operationCategory?.title || null,
      isCommitted: o.isCommitted !== false,
    }
  })
  return { ok: true, data: { items, total: Number(r.data.total) || items.length } }
}


/**
 * Забрать поступления ПланФакта во «входящие» за последние N дней.
 *
 * Раньше это делала только кнопка в KPI — и зеркало жило ровно до того дня,
 * когда о ней вспоминали (15.09.2026 последняя операция была за 03.09).
 * Теперь то же самое зовёт ночной крон. Идемпотентно: операции с решением
 * (linked / ignored / subscription) не трогаются, «новые» обновляются.
 */
export async function syncPfInbox(
  sql: any, orgId: string, days = 14,
): Promise<{ fetched: number; added: number; error?: string }> {
  const key = await getPlanfactKey(sql, orgId)
  if (!key) return { fetched: 0, added: 0, error: 'ПланФакт не подключён' }
  const to = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
  const from = new Date(Date.now() - days * 86400000 + 5 * 3600 * 1000).toISOString().slice(0, 10)

  let offset = 0, fetched = 0, added = 0
  for (let page = 0; page < 30; page++) {
    const r = await pfIncomeOperations(key, from, to, 100, offset)
    if (!r.ok) return { fetched, added, error: r.error }
    const items = r.data?.items || []
    fetched += items.length
    for (const op of items) {
      if (!op.operationId || !(op.value > 0)) continue
      const rows = await sql`
        INSERT INTO sales_pf_inbox (
          org_id, pf_operation_id, operation_date, amount,
          contragent, comment, account, category, currency, amount_original
        ) VALUES (
          ${orgId}, ${op.operationId}, ${op.operationDate}, ${op.value},
          ${op.contragent}, ${op.comment}, ${op.account}, ${op.category},
          ${op.currency}, ${op.valueOriginal}
        )
        ON CONFLICT (org_id, pf_operation_id) DO UPDATE SET
          operation_date = EXCLUDED.operation_date, amount = EXCLUDED.amount,
          contragent = EXCLUDED.contragent, comment = EXCLUDED.comment,
          account = EXCLUDED.account, category = EXCLUDED.category,
          currency = EXCLUDED.currency, amount_original = EXCLUDED.amount_original
        WHERE sales_pf_inbox.status = 'new'
        RETURNING (xmax = 0) AS inserted
      `
      if (rows.length && rows[0].inserted) added++
    }
    // total у ПланФакта не заполняется (приходит 0) — верим только
    // размеру страницы: неполная страница значит, что данные кончились
    if (items.length < 100) break
    offset += 100
  }
  return { fetched, added }
}

/** Платил дольше этого — подписка, а не новые деньги. */
const SUBSCRIPTION_AGE_DAYS = 45

/** Свежие «новые» операции прогнать через историю: платил раньше — подписка. */
export async function reclassifyNewOps(sql: any, orgId: string): Promise<number> {
  const { clientKeyOf } = await import('./pf-match.js')
  const rows = await sql`
    SELECT pf_operation_id, operation_date::text AS d, contragent, category
    FROM sales_pf_inbox WHERE org_id = ${orgId} AND status = 'new'
  ` as any[]
  if (!rows.length) return 0
  const keys = [...new Set(rows.map(r => clientKeyOf(r.contragent, r.category)).filter(Boolean))]
  if (!keys.length) return 0
  const clients = await sql`
    SELECT client_key, first_paid_at::text AS f FROM sales_pf_clients
    WHERE org_id = ${orgId} AND client_key = ANY(${keys})
  ` as any[]
  const firstBy = new Map(clients.map(c => [c.client_key, c.f]))
  const toSub: number[] = []
  for (const r of rows) {
    const k = clientKeyOf(r.contragent, r.category)
    if (!k) continue
    const f = firstBy.get(k)
    if (!f) continue
    const age = (Date.parse(r.d) - Date.parse(f)) / 86400000
    if (age > SUBSCRIPTION_AGE_DAYS) toSub.push(Number(r.pf_operation_id))
  }
  if (toSub.length) {
    await sql`
      UPDATE sales_pf_inbox SET status = 'subscription'
      WHERE org_id = ${orgId} AND pf_operation_id = ANY(${toSub}) AND status = 'new'
    `
  }
  return toSub.length
}

/** Ниже этого сходства имён совпадением не считаем. */
const MIN_LINK_SCORE = 60

/**
 * «Новые» операции — к выигранным сделкам, если пара единственная.
 *
 * До этого каждую операцию привязывал РОП руками, и по выигранным сделкам
 * оплат в отчётах не было, пока он не дойдёт до разбора. Теперь очевидные
 * пары (одно имя клиента → одна выигранная сделка за последние полгода)
 * закрываются сами, сомнительные остаются человеку. Платёж создаётся тем же
 * способом, что и ручная привязка, — с external_id pf_<операция>, чтобы
 * ни одна операция не стала двумя платежами.
 */
export async function autoLinkNewOps(
  sql: any, orgId: string,
): Promise<{ checked: number; linked: number; ambiguous: number }> {
  const { nameScore } = await import('./pf-match.js')
  const ops = await sql`
    SELECT pf_operation_id, operation_date, amount, contragent, category, comment
    FROM sales_pf_inbox WHERE org_id = ${orgId} AND status = 'new'
  ` as any[]
  if (!ops.length) return { checked: 0, linked: 0, ambiguous: 0 }

  // Кандидаты — выигранные за полгода и сделки на договоре: те, у кого
  // деньги уже ожидаются. Открытая квалификация в пару не годится
  const deals = await sql`
    SELECT d.id, d.title, d.owner_agent_id, a.name AS account_name
    FROM sales_deals d
    LEFT JOIN sales_accounts a ON a.id = d.account_id
    LEFT JOIN sales_stages s ON s.id = d.stage_id
    WHERE d.org_id = ${orgId} AND d.archived_at IS NULL
      AND (d.won_at > NOW() - INTERVAL '180 days' OR s.key IN ('contract', 'won'))
  ` as any[]

  let linked = 0, ambiguous = 0
  for (const op of ops) {
    const hits = deals
      .map(d => ({ d, score: nameScore([op.contragent, op.category, op.comment], [d.title, d.account_name]) }))
      .filter(x => x.score >= MIN_LINK_SCORE)
      .sort((a, b) => b.score - a.score)
    // Несколько сделок одного клиента — тоже неоднозначность: какая из них
    // оплачена, знает сейлз
    const uniq = new Set(hits.map(h => h.d.id))
    if (uniq.size !== 1) { if (uniq.size > 1) ambiguous++; continue }
    const d = hits[0].d
    const opId = Number(op.pf_operation_id)
    const [pay] = await sql`
      INSERT INTO sales_payments (org_id, deal_id, agent_id, amount, paid_at, source, note, external_id, pf_status, pf_checked_at)
      VALUES (${orgId}, ${d.id}, ${d.owner_agent_id}, ${op.amount}, ${op.operation_date}, 'planfact',
              ${op.contragent || 'ПланФакт'}, ${'pf_' + opId}, 'matched', NOW())
      ON CONFLICT DO NOTHING
      RETURNING id
    ` as any[]
    if (!pay) continue
    await sql`
      UPDATE sales_pf_inbox SET status = 'linked', deal_id = ${d.id}, payment_id = ${Number(pay.id)}
      WHERE org_id = ${orgId} AND pf_operation_id = ${opId} AND status = 'new'
    `
    linked++
  }
  return { checked: ops.length, linked, ambiguous }
}
