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
 * Служебные названия Amo. Заявке из «Неразобранного» она даёт имя формы
 * («Facebook №1724015762190193»), диалогу из Instagram — «instagram_business:<id>»,
 * автосделке — «Сделка #30143187». В списке аккаунтов это выглядит мусором,
 * поэтому берём первое осмысленное: имя контакта, затем телефон, и только
 * в крайнем случае — понятную подпись по каналу.
 */
const SERVICE_NAME = /^(instagram_business|facebook|instagram|telegram|сделка|автосделка|lead|leads|amocrm)\b|^[a-z_]+:\d+$/i

function channelLabel(lead: any): string {
  const meta = lead?._unsorted_meta
  if (meta?.form_name && !SERVICE_NAME.test(String(meta.form_name))) return String(meta.form_name)
  const raw = String(lead?.name || '')
  if (/instagram/i.test(raw)) return 'Заявка из Instagram'
  if (/telegram/i.test(raw)) return 'Заявка из Telegram'
  if (/facebook|lead/i.test(raw)) return 'Заявка с рекламной формы'
  return 'Заявка без названия'
}

function readableName(lead: any, contact?: { phone?: string; name?: string }): string {
  const brand = String(cf(lead, 'Бренд') || '').trim()
  if (brand) return brand
  const raw = String(lead?.name || '').trim()
  if (raw && !SERVICE_NAME.test(raw)) return raw
  const contactName = String(contact?.name || '').trim()
  if (contactName) return contactName
  const phone = String(contact?.phone || '').trim()
  if (phone) return phone
  return channelLabel(lead)
}

export function leadPayload(lead: any, contact?: { phone: string; name: string }) {
  const { source, formId } = sourceFromLead(lead)
  // Названия полей сверены с боевой воронкой: «Агрегаторы» в Amo называется
  // «Работает ли в агрегаторах», тип доставки — «Есть ли свои курьеры»,
  // а филиалы встречаются в двух полях сразу
  return {
    source,
    external_id: `amo_${lead.id}`,
    name: readableName(lead, contact),
    phone: contact?.phone || null,
    contact_name: contact?.name || null,
    city: cf(lead, 'Город') || null,
    market: marketByPipeline(lead.pipeline_id),
    form_id: formId || lead._unsorted_meta?.form_id || null,
    orders_per_day: cf(lead, 'Заказы в день') || null,
    points: cf(lead, 'Кол филиалов') || cf(lead, 'Филиалов') || null,
    pos: cf(lead, 'POS') || null,
    aggregators: cf(lead, 'Работает ли в агрегаторах') || null,
    delivery_type: cf(lead, 'Есть ли свои курьеры') || null,
    // Реально заполняемые менеджерами поля — по ним сейлз понимает, что за лид
    text: [cf(lead, 'Направление'), cf(lead, 'Источник лида'), cf(lead, 'Модули')]
      .filter(Boolean).join(' · ') || lead.name || null,
    campaign: lead._unsorted_meta?.form_name || cf(lead, 'utm_campaign') || cf(lead, 'utm_source') || null,
    owner_hint: agentByAmoUser(lead.responsible_user_id),
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

/**
 * Ответственный из Amo → сотрудник GFSupport.
 *
 * Сопоставление задаётся переменной AMO_USER_MAP в виде `10734270:agent_xxx,...`.
 * Без него перенесённые сделки остаются без владельца: они не попадут ни в
 * «Мои», ни в очередь дня, и сейлз их просто не увидит.
 */
export function agentByAmoUser(amoUserId: number | null | undefined): string | null {
  if (!amoUserId) return null
  for (const pair of (process.env.AMO_USER_MAP || '').split(',')) {
    const [amo, agent] = pair.split(':')
    if (amo && Number(amo.trim()) === Number(amoUserId)) return agent.trim()
  }
  return null
}

/** Воронка по территории: у каждого рынка своя, без рынка — общая. */
export function pipelineForMarket(market?: string | null): string {
  return market ? `sales_${market}` : 'sales'
}

/**
 * Территория запроса в кодах продаж ('uz', 'kz', …).
 *
 * Тонкость: глобальный переключатель в шапке приложения хранит id рынка
 * (market_1772…), а продажи всюду работают кодом страны. Плюс регионов продаж
 * больше, чем рынков поддержки (Азербайджан, Грузия, ОАЭ), поэтому у модуля
 * есть собственный параметр region — он и главнее.
 */
const marketCodes = new Map<string, string | null>()
export async function resolveRegion(sql: any, orgId: string, url: URL): Promise<string> {
  const region = (url.searchParams.get('region') || '').trim().toLowerCase()
  if (region && region !== 'all') return region

  const market = (url.searchParams.get('market') || '').trim()
  if (!market) return ''
  if (!market.startsWith('market_')) return market.toLowerCase()

  if (marketCodes.has(market)) return marketCodes.get(market) || ''
  try {
    const [row] = await sql`SELECT code FROM support_markets WHERE id = ${market} LIMIT 1`
    const code = (row?.code || '').toLowerCase() || null
    marketCodes.set(market, code)
    return code || ''
  } catch {
    return ''
  }
}
