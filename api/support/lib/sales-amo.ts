/**
 * Общий слой работы с AmoCRM: запросы, чтение полей, определение источника,
 * раскладка воронок по территориям.
 *
 * Используется двумя входами — минутным мостом (cron/amo-sync) и разовым
 * переносом истории (sales/amo-backfill). Логика маппинга одна на оба, иначе
 * перенесённые и текущие сделки разъедутся по источникам и полям.
 */

export interface AmoCreds { domain: string; token: string }

export async function amoGet(creds: AmoCreds, path: string): Promise<any | null> {
  const res = await fetch(`https://${creds.domain}/api/v4${path}`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (res.status === 204) return null      // Amo отдаёт 204 на пустую выборку
  if (!res.ok) throw new Error(`amo ${path} → ${res.status}`)
  return res.json()
}

export function cf(entity: any, name: string): string {
  for (const f of entity?.custom_fields_values || []) {
    if (f.field_name === name) {
      const v = f.values?.[0]?.value
      return v === undefined || v === null ? '' : String(v)
    }
  }
  return ''
}

/** Воронки Amo → территории: `7858022:uz,10610970:kz,11159702:az`. */
export function marketByPipeline(pipelineId: number): string | null {
  for (const pair of (process.env.AMO_PIPELINE_MARKETS || '').split(',')) {
    const [pid, market] = pair.split(':')
    if (pid && Number(pid) === pipelineId) return market
  }
  return null
}

/**
 * Источник лида. Теги надёжнее названия: их ставит интеграция при создании,
 * и они переживают переименование сделки менеджером.
 */
export function sourceFromLead(lead: any): { source: string; formId: string | null } {
  // Заявка из «Неразобранного» несёт id формы в метаданных — это самый надёжный
  // признак источника, надёжнее тегов и названия
  const formIdMeta = lead?._unsorted_meta?.form_id
  if (formIdMeta) return { source: 'meta_leadform', formId: String(formIdMeta) }

  const tags: string[] = ((lead._embedded?.tags || []) as any[])
    .map(t => String(t.name || '').toLowerCase())

  for (const t of tags) {
    if (t.startsWith('fb') && /^\d+$/.test(t.slice(2))) return { source: 'meta_leadform', formId: t.slice(2) }
    if (t === '#facebook_lead') return { source: 'meta_leadform', formId: null }
  }
  for (const t of tags) {
    if (t === 'сайт' || t.includes('tilda')) return { source: 'site', formId: null }
    if (t.includes('instagram') || t.includes('инстаграм')) return { source: 'instagram_direct', formId: null }
    if (t.includes('исходящ')) return { source: 'outbound', formId: null }
    if (t.startsWith('импорт')) return { source: 'import', formId: null }
  }
  // Теги телефонии проверяем последними: на лиде с рекламной меткой «входящий» —
  // это залогированный звонок-обработка, а не источник
  for (const t of tags) {
    if (t === 'входящий' || t === 'пропущенный') return { source: 'call', formId: null }
  }

  const name = String(lead.name || '').toLowerCase()
  if (name.includes('facebook') || name.includes('leads |')) return { source: 'meta_leadform', formId: null }
  if (name.includes('сайт')) return { source: 'site', formId: null }
  // Заведено руками — отдельный источник. Сваливать это в «рефералы» нельзя:
  // именно так в Amo сегодня смешаны рефералы, допродажи и ручной ввод
  return { source: 'manual', formId: null }
}

/** Телефоны и имена контактов одним запросом на всю пачку — лимиты Amo жёсткие. */
export async function fetchContacts(creds: AmoCreds, ids: number[]): Promise<Map<number, { phone: string; name: string }>> {
  const map = new Map<number, { phone: string; name: string }>()
  if (!ids.length) return map
  const query = ids.slice(0, 250).map(id => `filter[id][]=${id}`).join('&')
  const data = await amoGet(creds, `/contacts?${query}&limit=250`)
  for (const c of data?._embedded?.contacts || []) {
    let phone = ''
    for (const f of c.custom_fields_values || []) {
      if (f.field_code === 'PHONE') { phone = String(f.values?.[0]?.value || ''); break }
    }
    map.set(c.id, { phone, name: c.name || '' })
  }
  return map
}

/** Поля сделки Amo → поля нашего лида. Названия полей взяты из боевой воронки. */
/**
 * Служебные названия Amo: заявке из «Неразобранного» она даёт имя вида
 * «Facebook №1410923527616895», а созданной автоматически — «Сделка #30143187».
 * В очереди сейлза это выглядит мусором, поэтому подставляем имя контакта.
 * Проверено на боевых данных: таких 22 из первых 55 лидов.
 */
function readableName(lead: any, contactName?: string): string {
  const raw = String(cf(lead, 'Бренд') || lead.name || '').trim()
  const служебное = /^(facebook|instagram|сделка|автосделка|lead|leads)\s*[#№]?/i.test(raw)
  if (raw && !служебное) return raw
  return (contactName || '').trim() || raw || 'Без названия'
}

export function leadPayload(lead: any, contact?: { phone: string; name: string }) {
  const { source, formId } = sourceFromLead(lead)
  // Названия полей сверены с боевой воронкой: «Агрегаторы» в Amo называется
  // «Работает ли в агрегаторах», тип доставки — «Есть ли свои курьеры»,
  // а филиалы встречаются в двух полях сразу
  return {
    source,
    external_id: `amo_${lead.id}`,
    name: readableName(lead, contact?.name),
    phone: contact?.phone || null,
    contact_name: contact?.name || null,
    city: cf(lead, 'Город') || null,
    market: marketByPipeline(lead.pipeline_id),
    form_id: formId || lead._unsorted_meta?.form_id || null,
    text: lead.name || null,
    orders_per_day: cf(lead, 'Заказы в день') || null,
    points: cf(lead, 'Кол филиалов') || cf(lead, 'Филиалов') || null,
    pos: cf(lead, 'POS') || null,
    aggregators: cf(lead, 'Работает ли в агрегаторах') || null,
    delivery_type: cf(lead, 'Есть ли свои курьеры') || null,
    campaign: lead._unsorted_meta?.form_name || cf(lead, 'utm_campaign') || cf(lead, 'utm_source') || null,
    raw: lead,
  }
}

/**
 * Этапы Amo → наши. Сопоставляем по названию, а не по id: id у трёх страновых
 * воронок разные, а названия совпадают по смыслу.
 */
/**
 * Статус Amo считается выигранным не только по системному типу: в боевых
 * воронках оплата живёт отдельными статусами «Оплачено», «10 заказов»,
 * «Продано». Без этого перенос отправил бы оплаченные сделки в открытые
 * и испортил и воронку, и отчёт по деньгам.
 */
export function isWonStatus(id: number, name: string, type?: number): boolean {
  if (type === 1 || id === 142) return true
  const extra = (process.env.AMO_WON_STATUSES || '').split(',').map(x => Number(x.trim()))
  if (extra.includes(id)) return true
  const n = (name || '').toLowerCase()
  return n.includes('оплачено') || n.includes('оплчено') || n.includes('продано')
    || n.includes('10 заказов')
}

export function stageKeyByStatusName(name: string, isWon: boolean, isLost: boolean): string {
  if (isWon) return 'won'
  if (isLost) return 'lost'
  const n = (name || '').toLowerCase()
  if (n.includes('договор')) return 'contract'
  if (n.includes('согласован старт') || n.includes('выставлен счет')) return 'contract'
  if (n.includes('кп') || n.includes('предложен')) return 'kp'
  if (n.includes('демо') || n.includes('презентац') || n.includes('проведена встреча')) return 'demo'
  if (n.includes('встреч')) return 'meeting'
  if (n.includes('квалиф')) return 'qualified'
  if (n.includes('переговор') || n.includes('принимают решение')) return 'kp'
  if (n.includes('не отвеча') || n.includes('дозвон') || n.includes('недозвон')
      || n.includes('взят в работу') || n.includes('холодные')) return 'attempting'
  if (n.includes('первичн') || n.includes('неразобранное') || n.includes('новая')
      || n.includes('лиды с сайта') || n.includes('база клиентов')) return 'new'
  // Неизвестный этап открытой сделки — ставим квалификацию: сейлз увидит
  // сделку в работе и сам поправит, а не потеряет её
  return 'qualified'
}

/** Названия статусов всех воронок: id → {name, isWon, isLost, pipelineId}. */
export async function fetchStatuses(creds: AmoCreds) {
  const map = new Map<number, { name: string; isWon: boolean; isLost: boolean; pipelineId: number }>()
  const data = await amoGet(creds, '/leads/pipelines')
  for (const p of data?._embedded?.pipelines || []) {
    for (const s of p._embedded?.statuses || []) {
      map.set(s.id, {
        name: s.name || '',
        isWon: isWonStatus(s.id, s.name || '', s.type),
        isLost: s.type === 2 || s.id === 143,
        pipelineId: p.id,
      })
    }
  }
  return map
}

/**
 * Какие воронки Amo нас интересуют. В аккаунте девять воронок, среди них
 * «Instagram comments» и два «Onboarding» — их сделки в CRM продаж не нужны.
 * По умолчанию берём те, что перечислены в AMO_PIPELINE_MARKETS.
 */
export function allowedPipelines(): number[] {
  const fromMarkets = (process.env.AMO_PIPELINE_MARKETS || '')
    .split(',').map(p => Number(p.split(':')[0])).filter(Boolean)
  const explicit = (process.env.AMO_PIPELINES || '')
    .split(',').map(x => Number(x.trim())).filter(Boolean)
  return explicit.length ? explicit : fromMarkets
}

export function isAllowedPipeline(pipelineId: number): boolean {
  const list = allowedPipelines()
  return list.length === 0 || list.includes(pipelineId)
}
