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

export async function pfFetch<T = any>(
  apiKey: string, path: string, params?: Record<string, string | number>,
): Promise<PfResult<T>> {
  const url = new URL(PF_BASE + path)
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v))
  let res: Response
  try {
    res = await fetch(url.toString(), {
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
