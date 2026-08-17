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
  const meta = lead?._unsorted_meta || {}
  const service = String(meta.service || '').toLowerCase()
  const formId = meta.form_id ? String(meta.form_id) : null
  const formName = String(meta.form_name || '').toLowerCase()
  const page = String(meta.form_page || meta.referer || '').toLowerCase()
  const name = String(lead?.name || '').toLowerCase()
  const tags: string[] = ((lead._embedded?.tags || []) as any[])
    .map(t => String(t.name || '').toLowerCase())

  // 1. Мессенджеры: у «Неразобранного» канал написан прямо в service. Это
  //    надёжнее любых тегов — раньше без этой ветки директ падал в «вручную»
  if (service.includes('instagram') || name.startsWith('instagram_business:')) {
    return { source: 'instagram_direct', formId: null }
  }
  if (service.includes('whatsapp')) return { source: 'whatsapp', formId: null }

  // 2. Telegram-бот заявок и личные сообщения — разные вещи: бот стоит на
  //    сайте и в рекламе, личка приходит от знакомых
  if (page.includes('t.me/') || formId?.toLowerCase().includes('telegram')
      || formName.includes('чат-бот') || formName.includes('telegram')) {
    return { source: 'telegram_bot', formId }
  }
  if (service.includes('telegram')) return { source: 'telegram', formId: null }

  // 3. Рекламные лид-формы Meta: числовой id формы или метка объявления.
  //    Именованная форма («telegram-chatbot») сюда не относится
  if (formId && /^\d+$/.test(formId)) return { source: 'meta_leadform', formId }
  for (const t of tags) {
    if (t.startsWith('fb') && /^\d+$/.test(t.slice(2))) return { source: 'meta_leadform', formId: t.slice(2) }
    if (t === '#facebook_lead' || t.includes('lead ad')) return { source: 'meta_leadform', formId }
  }
  if (name.includes('facebook') || name.includes('leads |')) return { source: 'meta_leadform', formId }

  // 4. Сайт: форма и чат — разный разговор, чат уже начат
  if (formName.includes('чат') || formId?.toLowerCase().includes('chat')) {
    return { source: 'site_chat', formId }
  }
  if (page.includes('delever.io') || formId?.toLowerCase().includes('website')
      || formId?.toLowerCase().includes('site') || formName) {
    return { source: 'site', formId }
  }

  for (const t of tags) {
    if (t === 'сайт' || t.includes('tilda')) return { source: 'site', formId: null }
    if (t.includes('instagram') || t.includes('инстаграм')) return { source: 'instagram_direct', formId: null }
    if (t.includes('коммент')) return { source: 'instagram_comment', formId: null }
    if (t.includes('почт') || t.includes('mail')) return { source: 'email', formId: null }
    if (t.includes('исходящ') || t.includes('холодн')) return { source: 'outbound', formId: null }
    if (t.startsWith('импорт')) return { source: 'import', formId: null }
  }
  // Телефония последней: на лиде с рекламной меткой «входящий» — это отметка
  // о звонке-обработке, а не источник обращения
  for (const t of tags) {
    if (t === 'входящий' || t === 'пропущенный' || t.includes('звонок')) {
      return { source: 'call', formId: null }
    }
  }
  if (name.includes('сайт')) return { source: 'site', formId: null }

  // Источник не опознан. Раньше здесь стояло «заведено вручную» — и обращения
  // из директа выглядели так, будто их набрал сейлз
  return { source: 'unknown', formId: null }
}

/** Телефоны и имена контактов одним запросом на всю пачку — лимиты Amo жёсткие. */
/**
 * Ответы формы одной строкой: «Вопрос: ответ» через перенос.
 *
 * Подчёркивания Meta присылает вместо пробелов («restoran_uchun_maxsus_ilova»),
 * читаем их как фразу — иначе ответ выглядит машинным кодом.
 */
export function answersText(contact?: Partial<AmoContact>): string | null {
  const fields = contact?.fields || []
  if (!fields.length) return null
  return fields
    .map(f => `${f.name}: ${String(f.value).replace(/_/g, ' ')}`)
    .join('\n')
    .slice(0, 2000)
}

export interface AmoContact {
  phone: string
  name: string
  /** Ответы человека на вопросы формы — они лежат в полях контакта. */
  fields: Array<{ name: string; value: string }>
}

/**
 * Контакты Amo вместе с их полями.
 *
 * Раньше отсюда брались только имя и телефон, а всё остальное выбрасывалось —
 * и вместе с ним ответы лида на вопросы лид-формы: сколько доставок в день,
 * какая кухня, есть ли доставка сейчас. Meta кладёт их именно в контакт, а не
 * в сделку, поэтому карточка обращения выглядела пустой у людей, которые
 * ответили на четыре вопроса (найдено на проде 16.08.2026).
 */
export async function fetchContacts(creds: AmoCreds, ids: number[]): Promise<Map<number, AmoContact>> {
  const map = new Map<number, AmoContact>()
  if (!ids.length) return map
  const query = ids.slice(0, 250).map(id => `filter[id][]=${id}`).join('&')
  const data = await amoGet(creds, `/contacts?${query}&limit=250`)
  for (const c of data?._embedded?.contacts || []) {
    let phone = ''
    const fields: Array<{ name: string; value: string }> = []
    for (const f of c.custom_fields_values || []) {
      const value = f.values?.[0]?.value
      if (f.field_code === 'PHONE' && !phone) { phone = String(value || ''); continue }
      // Служебные коды каналов в карточке не нужны: человек их не заполнял
      if (f.field_code && ['EMAIL', 'IM', 'POSITION'].includes(f.field_code)) continue
      if (value === undefined || value === null || typeof value === 'object') continue
      fields.push({ name: f.field_name || f.field_code || 'Поле', value: String(value) })
    }
    map.set(c.id, { phone, name: c.name || '', fields })
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
/**
 * Строки, которые подставляет не человек, а система: по ним клиента не узнать.
 *
 * Без \b намеренно: в JS этот якорь опирается на латинский \w, поэтому
 * «сделка\b» не срабатывал на «Сделка #30194251» — и служебное имя из Amo
 * проходило как настоящее название клиента.
 */
const SERVICE_NAME = new RegExp(
  '^(instagram_business|facebook|instagram|telegram|whatsapp|сделка|автосделка|lead|leads'
  + '|amocrm|company|заявка|обращение|новая заявка|без названия|клиент|посетитель сайта)'
  + '|^[a-z_]+:\\d+$',
  'i',
)

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
  // Бренд — то, как клиент называет себя сам. Всё остальное подставляет система
  const brand = String(cf(lead, 'Бренд') || cf(lead, 'Название компании')
    || cf(lead, 'Компания') || '').trim()
  if (brand && !SERVICE_NAME.test(brand)) return brand
  const raw = String(lead?.name || '').trim()
  if (raw && !SERVICE_NAME.test(raw)) return raw
  // Имя профиля из мессенджера: «Nexus Club» вместо
  // «instagram_business:17841448182331145»
  const profile = String(lead?._unsorted_meta?.client?.name
    || lead?._unsorted_meta?.from || '').trim()
  if (profile) return profile
  const contactName = String(contact?.name || '').trim()
  if (contactName) return contactName
  const phone = String(contact?.phone || '').trim()
  if (phone) return phone
  return channelLabel(lead)
}

/** Что человек сделал: заполнил форму, написал, прокомментировал, позвонил. */
export function kindOfSource(source: string): string {
  if (['instagram_direct', 'telegram', 'telegram_bot', 'whatsapp', 'site_chat'].includes(source)) return 'message'
  if (['meta_leadform', 'site', 'partner_apply'].includes(source)) return 'form'
  if (source === 'instagram_comment') return 'comment'
  if (source === 'call') return 'call'
  if (source === 'email') return 'email'
  if (source === 'manual') return 'manual'
  return 'other'
}

/** Текст первого сообщения из «Неразобранного»: то, что человек реально написал. */
function firstMessage(lead: any): string | null {
  const meta = lead?._unsorted_meta || {}
  const direct = meta.text || meta.last_message || meta.message
  if (typeof direct === 'string' && direct.trim()) return direct.trim().slice(0, 500)
  const msgs = lead?._embedded?.messages || meta.messages
  if (Array.isArray(msgs)) {
    const first = msgs.find((m: any) => m?.text || m?.message)
    const text = first?.text || first?.message
    if (typeof text === 'string' && text.trim()) return text.trim().slice(0, 500)
  }
  return null
}

export function leadPayload(lead: any, contact?: Partial<AmoContact>) {
  const { source, formId } = sourceFromLead(lead)
  const answers = answersToQualification(contact?.fields)
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
    lead_kind: kindOfSource(source),
    // Поле Amo заполняет менеджер после разговора — оно точнее выбранной в
    // анкете категории. Анкета идёт запасным вариантом, когда разговора ещё не было
    orders_per_day: cf(lead, 'Заказы в день') || answers.ordersPerDay || null,
    points: cf(lead, 'Кол филиалов') || cf(lead, 'Филиалов') || null,
    pos: cf(lead, 'POS') || null,
    aggregators: cf(lead, 'Работает ли в агрегаторах') || null,
    delivery_type: cf(lead, 'Есть ли свои курьеры') || answers.deliveryType || null,
    // Что показывать в строке: сперва само сообщение человека, потом
    // заполненные менеджером поля. Служебное название сделки из Amo сюда не
    // попадает — оно и так стоит в заголовке и ничего не добавляет
    // Что человек на самом деле сказал: сперва его сообщение, затем ответы на
    // вопросы формы — они лежат в полях контакта и раньше терялись целиком,
    // и карточка выглядела пустой у людей, ответивших на четыре вопроса.
    // Служебное название сделки из Amo сюда не попадает: оно и так в заголовке
    text: firstMessage(lead)
      || answersText(contact)
      // «Источник лида» сюда не идёт: это служебная пометка Amo вроде
      // «Исходящий», и в карточке она читалась как сообщение клиента
      || [cf(lead, 'Направление'), cf(lead, 'Модули')].filter(Boolean).join(' · ')
      || null,
    campaign: lead._unsorted_meta?.form_name || cf(lead, 'utm_campaign') || cf(lead, 'utm_source') || null,
    owner_hint: agentByAmoUser(lead.responsible_user_id),
    // Поля контакта кладём рядом с сырой сделкой: карточка обращения
    // показывает их как заполненное человеком, а не как наш домысел
    raw: contact?.fields?.length ? { ...lead, _contact_fields: contact.fields } : lead,
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
  // «Все регионы» — это выбор человека, а не отсутствие выбора. Дальше стоит
  // параметр market, который клиент дописывает ко ВСЕМ запросам из ранее
  // выбранного рынка, и он забивал явное «все»: раздел показывал один регион
  if (region === 'all') return ''

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

/**
 * Примечания сделки Amo — там прячется содержимое заявки.
 *
 * Заявка с лид-формы Meta приезжает в Amo почти пустой: в полях только бренд,
 * а телефон и ответы на вопросы формы падают отдельным примечанием. Мы их не
 * читали, и в карточке стояло «телефон не оставил» у человека, который его
 * оставил (проверено на проде 16.08.2026: у трети свежих заявок телефон был
 * только в примечании).
 */
export async function fetchNotes(creds: AmoCreds, leadId: number): Promise<string[]> {
  const data = await amoGet(creds, `/leads/${leadId}/notes?limit=50`)
  const out: string[] = []
  for (const n of data?._embedded?.notes || []) {
    const t = n?.params?.text || n?.params?.message || ''
    if (t && typeof t === 'string') out.push(t.trim())
  }
  return out
}

/**
 * Телефон и человеческий текст из примечаний.
 *
 * Отдельная строка с одним телефоном — это ответ на поле формы, а не
 * сообщение; в текст обращения она не идёт, иначе карточка показывала бы
 * «клиент написал: +998901234567».
 */
export function parseNotes(notes: string[]): { phone: string | null; text: string | null } {
  let phone: string | null = null
  const lines: string[] = []
  for (const raw of notes) {
    const note = raw.replace(/\s+/g, ' ').trim()
    if (!note) continue
    const digits = note.replace(/\D/g, '')
    const onlyPhone = /^\+?[\d\s()\-]{9,20}$/.test(note) && digits.length >= 9
    if (onlyPhone) {
      if (!phone) phone = note
      continue
    }
    const found = note.match(/\+?\d[\d\s()\-]{8,18}\d/)
    if (found && !phone) phone = found[0]
    // Подчёркивания вместо пробелов — это ответ на вопрос формы
    // («нет_канала_для_онлайн-продаж»), читаем его как фразу
    lines.push(note.replace(/_/g, ' '))
  }
  return { phone, text: lines.length ? lines.join('\n').slice(0, 2000) : null }
}

/**
 * Ответы формы → поля квалификации.
 *
 * Человек в лид-форме отвечает ровно на то, что нужно скорингу: сколько
 * доставок в день, есть ли доставка сейчас, чем занимается. Мы складывали эти
 * ответы в текст и не показывали их оценке — из-за чего лид с заполненной
 * анкетой получал ноль «данных нет» либо оценивался по устаревшему полю Amo.
 *
 * Вопросы распознаём по смыслу, а не по точному тексту: формы заводят
 * маркетологи, и завтра тот же вопрос будет сформулирован иначе.
 */
export function answersToQualification(fields?: Array<{ name: string; value: string }>) {
  const out: { ordersPerDay?: string; deliveryType?: string; segment?: string; interest?: string } = {}
  for (const f of fields || []) {
    const q = (f.name || '').toLowerCase()
    const a = String(f.value || '').replace(/_/g, ' ').trim()
    if (!a) continue

    // «Kuniga nechta dostavkasi bor», «сколько заказов в день»
    if ((/nechta|necha|qancha/.test(q) && /dostavka|buyurtma|zakaz/.test(q))
        || /сколько.*(заказ|доставок)|заказов в день/.test(q)) {
      out.ordersPerDay = a
      continue
    }
    // «Hozir dostavka bormi?» — есть ли доставка сейчас
    if (/dostavka\s*bor|бормi|есть ли.*доставк/.test(q)) { out.deliveryType = a; continue }
    // «Qaysi yonalishda faoliyat olib borishadi» — направление заведения
    if (/yonalish|yo'nalish|направлен|кухн/.test(q)) { out.segment = a; continue }
    // «Qaysi xizmatimiz haqida ma'lumot olmoqchi» — что именно интересует
    if (/xizmat|услуг|интересует/.test(q)) { out.interest = a; continue }
  }
  return out
}
