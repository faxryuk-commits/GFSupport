import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders, ensureOnce } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Обогащение карточки данными Google Карт.
 *
 * Зачем: заведение почти всегда есть на картах, и там лежит то, что сейлз
 * иначе выспрашивает голосом — сколько точек, какой рейтинг, есть ли сайт
 * и телефон, работает ли ещё вообще. Один запрос закрывает половину
 * квалификации ещё до звонка.
 *
 * GET  ?leadId= | ?accountId=      что уже нашли
 * POST { leadId? , accountId?, query? }  найти и сохранить
 *
 * Ключ вводится в «Настройки → Интеграции → Google Карты»
 * (support_settings.google_places_key),
 * переменная окружения GOOGLE_PLACES_KEY остаётся запасным вариантом.
 * В Google он уходит заголовком, а не в адресе запроса.
 * Автоподстановка правит только пустые поля квалификации и не трогает
 * first_touch_at: обогащение — не разговор с человеком.
 */

const HOST = 'https://places.googleapis.com/v1/places:searchText'
const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.rating',
  'places.userRatingCount', 'places.websiteUri', 'places.nationalPhoneNumber',
  'places.internationalPhoneNumber', 'places.googleMapsUri', 'places.primaryTypeDisplayName',
  'places.businessStatus', 'places.location', 'places.regularOpeningHours.weekdayDescriptions',
].join(',')

type Place = {
  id: string
  displayName?: { text?: string }
  formattedAddress?: string
  rating?: number
  userRatingCount?: number
  websiteUri?: string
  nationalPhoneNumber?: string
  internationalPhoneNumber?: string
  googleMapsUri?: string
  primaryTypeDisplayName?: { text?: string }
  businessStatus?: string
  location?: { latitude?: number; longitude?: number }
  regularOpeningHours?: { weekdayDescriptions?: string[] }
}

async function search(key: string, textQuery: string, limit: number, region = 'UZ'): Promise<Place[]> {
  const res = await fetch(HOST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': FIELDS,
    },
    body: JSON.stringify({ textQuery, languageCode: 'ru', regionCode: region, maxResultCount: limit }),
    signal: AbortSignal.timeout(20000),
  })
  const out = await res.json().catch(() => null) as any
  if (!res.ok) throw new Error(out?.error?.message || 'Google Карты не ответили')
  return (out?.places || []) as Place[]
}

/**
 * Одно и то же заведение пишут и кириллицей, и латиницей: «Самарканд Giotto»
 * против «Giotto Samarkand». Приводим к латинице, иначе сверка названий
 * считает их разными местами.
 */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'j', з: 'z', и: 'i',
  й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '',
  э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
}

/** Названия сравниваем по буквам и цифрам, кириллицу переводим в латиницу. */
const norm = (s: string) => String(s || '').toLowerCase()
  .replace(/[а-яёәғқңөұүһі]/g, ch => TRANSLIT[ch] ?? ch)
  .replace(/[^a-z0-9]+/g, '')

/** Домен без протокола и www — по нему сверяем, тот ли сайт нашёлся. */
function host(u: string): string {
  const t = String(u || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
  return t.split(/[/?#]/)[0] || ''
}

/**
 * Ссылки на соцсети берём с сайта заведения: Google их не отдаёт, а на сайте
 * они лежат в подвале почти всегда. Это те самые поля клиента, которые
 * сейчас пустуют, а сейлзу нужны, чтобы посмотреть, как заведение живёт.
 */
async function socialsFromSite(site: string): Promise<{ instagram: string | null; telegram: string | null }> {
  const out: { instagram: string | null; telegram: string | null } = { instagram: null, telegram: null }
  if (!site) return out
  try {
    const res = await fetch(site, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GFSupport/1.0)' },
      signal: AbortSignal.timeout(9000),
    })
    if (!res.ok) return out
    const html = (await res.text()).slice(0, 400000)
    const ig = html.match(/instagram\.com\/([A-Za-z0-9_.]{2,30})/i)
    const igName = ig?.[1] || ''
    if (igName && !['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts'].includes(igName.toLowerCase())) {
      out.instagram = igName.replace(/\.$/, '')
    }
    const tg = html.match(/t\.me\/([A-Za-z0-9_]{3,32})/i)
    const tgName = tg?.[1] || ''
    if (tgName && !['share', 'iv'].includes(tgName.toLowerCase())) out.telegram = tgName
  } catch {
    // Сайт может лежать или отдавать защиту от роботов — это не повод
    // ронять обогащение: остальные данные уже собраны
  }
  return out
}

/** Регион поиска: клиент из Казахстана не должен находиться в Ташкенте. */
const REGION: Record<string, string> = { uz: 'UZ', kz: 'KZ', kg: 'KG', az: 'AZ', ge: 'GE', cy: 'CY', ae: 'AE' }

/**
 * Как страна называется в адресе Google. Нужно не для красоты: поиск по
 * Узбекистану спокойно возвращает бутик в Сумгаите, и такую находку надо
 * помечать неуверенной, а не подставлять в квалификацию.
 */
const COUNTRY_WORDS: Record<string, string[]> = {
  uz: ['узбекистан', 'uzbekistan'],
  kz: ['казахстан', 'kazakhstan', 'qazaqstan'],
  kg: ['кыргызстан', 'киргизия', 'kyrgyzstan'],
  az: ['азербайджан', 'azerbaijan'],
  ge: ['грузия', 'georgia'],
  cy: ['кипр', 'cyprus'],
  ae: ['оаэ', 'эмираты', 'emirates'],
}

/** Адрес указывает на другую страну, чем рынок карточки? */
function otherCountry(address: string, market: string): boolean {
  const a = String(address || '').toLowerCase()
  if (!a) return false
  for (const [code, words] of Object.entries(COUNTRY_WORDS)) {
    if (code === market) continue
    if (words.some(w => a.includes(w))) return true
  }
  return false
}

/**
 * Название карточки редко бывает чистым: к нему приклеены код рынка,
 * имя сейлза, город и повторы. В запрос это идёт шумом, и Google находит
 * не то заведение.
 */
function cleanName(raw: string): string {
  let t = String(raw || '').replace(/\s+/g, ' ').trim()
  t = t.replace(/\s+(uz|kz|kg|az|ge|cy|ae)\s*$/i, '')
  const words = t.split(' ')
  const seen = new Set<string>()
  const uniq = words.filter(w => {
    const k = norm(w)
    if (!k || seen.has(k)) return false
    seen.add(k); return true
  })
  return uniq.join(' ').trim()
}

/**
 * Совпало ли найденное с тем, что искали. Пересечение по нормализованным
 * названиям: «Диор Саидкилов» и бутик «Dior» пересекаются на трёх буквах,
 * этого мало — такие находки помечаем как неуверенные и ничего по ним
 * не подставляем.
 */
function matchKind(query: string, found: string): 'strong' | 'weak' {
  const a = norm(query)
  const b = norm(found)
  if (!a || !b) return 'weak'
  const short = a.length <= b.length ? a : b
  const long = a.length <= b.length ? b : a
  if (short.length >= 4 && long.includes(short)) return 'strong'
  // Совпадение по словам: «Самарканд Giotto» и «Giotto Samarkand» — одно место
  const words = (t: string) => t.split(/[^a-zа-яё0-9]+/i).map(norm).filter(w => w.length >= 4)
  const wa = new Set(words(query))
  const hits = words(found).filter(w => {
    if (wa.has(w)) return true
    // «samarkand» против «samarqand» — одна буква погоды не делает
    for (const q of wa) if (q.length >= 6 && (q.includes(w.slice(0, 6)) || w.includes(q.slice(0, 6)))) return true
    return false
  }).length
  return hits >= 1 && (norm(query).length <= 6 ? hits >= 2 : true) ? 'strong' : 'weak'
}

async function handlerInner(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  await ensureOnce('sales_places_v2', async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS sales_places (
        id varchar(64) PRIMARY KEY,
        org_id varchar(64) NOT NULL,
        lead_id varchar(64),
        account_id varchar(64),
        place_id varchar(200),
        name varchar(300),
        address text,
        rating numeric(2,1),
        reviews integer,
        website text,
        phone varchar(50),
        maps_url text,
        category varchar(120),
        status varchar(30),
        branches integer,
        hours jsonb,
        lat numeric(9,6),
        lng numeric(9,6),
        raw jsonb,
        instagram varchar(120),
        telegram varchar(120),
        match_kind varchar(10),
        found_by varchar(64),
        updated_at timestamptz DEFAULT NOW()
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS sales_places_lead ON sales_places (org_id, lead_id)`
    await sql`CREATE INDEX IF NOT EXISTS sales_places_acc ON sales_places (org_id, account_id)`
    await sql`ALTER TABLE sales_places ADD COLUMN IF NOT EXISTS match_kind varchar(10)`
    await sql`ALTER TABLE sales_places ADD COLUMN IF NOT EXISTS instagram varchar(120)`
    await sql`ALTER TABLE sales_places ADD COLUMN IF NOT EXISTS telegram varchar(120)`
  })

  // Ключ: сперва настройки системы, потом окружение
  const readKey = async (): Promise<string> => {
    const [row] = await sql`
      SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = 'google_places_key' LIMIT 1
    `.catch(() => [] as any[]) as any[]
    return String(row?.value || '').trim() || String(process.env.GOOGLE_PLACES_KEY || '').trim()
  }

  if (req.method === 'GET') {
    if (url.searchParams.get('action') === 'status') {
      const key = await readKey()
      return json({ configured: !!key })
    }
    const leadId = url.searchParams.get('leadId')
    const accountId = url.searchParams.get('accountId')
    if (!leadId && !accountId) return json({ place: null })
    const [row] = leadId
      ? await sql`SELECT * FROM sales_places WHERE org_id = ${orgId} AND lead_id = ${leadId} LIMIT 1`
      : await sql`SELECT * FROM sales_places WHERE org_id = ${orgId} AND account_id = ${accountId} LIMIT 1`
    return json({ place: row || null })
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const key = await readKey()
  if (!key) return json({ error: 'Ключ Google Карт не введён: Настройки → Интеграции → Google Карты' }, 400)

  const body = await req.json().catch(() => ({})) as any

  // Проверка ключа из настроек: один поиск по заведомо существующему месту
  if (String(body.action || '') === 'probe') {
    const probe = await search(key, 'Chopar Pizza Ташкент', 3)
    return json({ ok: true, found: probe.length, sample: probe[0]?.displayName?.text || null })
  }
  const leadId = body.leadId ? String(body.leadId) : null
  const dealId = body.dealId ? String(body.dealId) : null
  let accountId = body.accountId ? String(body.accountId) : null
  // У сделки своё название и город: карточку правил человек, и она точнее
  // и клиента, и текста заявки. Место при этом храним у клиента — оно его
  // свойство, а не сделки, и должно быть видно из обеих карточек
  let deal: any = null
  if (dealId) {
    const [d] = await sql`
      SELECT id, title, city, market_id, account_id, points
      FROM sales_deals WHERE id = ${dealId} AND org_id = ${orgId} LIMIT 1
    `
    deal = d
    if (d?.account_id && !accountId) accountId = d.account_id
  }
  if (!leadId && !accountId && !dealId) return json({ error: 'нужен leadId, dealId или accountId' }, 400)

  // Что ищем: название заведения и город. Своё название карточки надёжнее
  // текста заявки — его уже правил человек
  let name = String(body.query || '').trim()
  let city = ''
  let market = ''
  let siteHint = ''
  let acc: string | null = null
  let lead: any = null
  if (leadId) {
    const [r] = await sql`
      SELECT l.name, l.city, l.market_id, a.id AS acc_id, a.name AS account_name, a.city AS account_city,
             a.website, a.instagram, a.telegram, l.qual
      FROM sales_leads l LEFT JOIN sales_accounts a ON a.id = l.account_id
      WHERE l.id = ${leadId} AND l.org_id = ${orgId} LIMIT 1
    `
    lead = r
    if (!name) name = String(r?.account_name || r?.name || '').trim()
    city = String(r?.city || r?.account_city || '').trim()
    market = String(r?.market_id || '').trim()
    siteHint = host(String(r?.website || ''))
    acc = r?.acc_id || null
  }
  if (accountId) {
    const [r] = await sql`
      SELECT id, name, city, market_id, website, instagram, telegram
      FROM sales_accounts WHERE id = ${accountId} AND org_id = ${orgId} LIMIT 1
    `
    if (!name) name = String(r?.name || '').trim()
    if (!city) city = String(r?.city || '').trim()
    if (!market) market = String(r?.market_id || '').trim()
    if (!siteHint) siteHint = host(String(r?.website || ''))
    acc = acc || r?.id || null
    if (!lead) lead = r
  }
  if (deal) {
    if (!name) name = String(deal.title || '').trim()
    if (!city) city = String(deal.city || '').trim()
    if (!market) market = String(deal.market_id || '').trim()
  }
  name = cleanName(name)
  if (!name) return json({ error: 'у карточки нет названия — искать нечего' }, 400)

  // Один запрос на всё: первый результат считаем совпадением, а остальные
  // с тем же названием — точками сети. Отдельный запрос ради счётчика
  // точек не нужен, он стоил бы столько же, сколько поиск
  const region = REGION[market] || 'UZ'

  // Сайт — самый честный вход: домен принадлежит одному заведению, а название
  // делят с однофамильцами. Ищем по нему первым и принимаем только тогда,
  // когда домен найденного места совпал с нашим
  let found: Place[] = []
  let bySite: Place | null = null
  if (siteHint && !body.placeId) {
    const hits = await search(key, siteHint, 5, region).catch(() => [] as Place[])
    bySite = hits.find(p => host(p.websiteUri || '') === siteHint) || null
    if (bySite) found = hits
  }
  if (!bySite) found = await search(key, city ? `${name} ${city}` : name, 20, region)
  if (!found.length) {
    return json({
      error: `На картах ничего не нашлось по запросу «${city ? `${name} ${city}` : name}». `
        + 'Если в названии карточки имя человека, впишите название заведения.',
    }, 404)
  }

  // Можно указать конкретное место: сейлз видит список и выбирает сам,
  // когда автоматика ошиблась
  const wanted = body.placeId ? found.find(p => p.id === String(body.placeId)) : null
  const best = wanted || bySite || found[0]
  let match: 'strong' | 'weak' = (wanted || bySite) ? 'strong' : matchKind(name, best.displayName?.text || '')
  // Нашлось в другой стране — верить нельзя, даже если название совпало
  if (!wanted && market && otherCountry(best.formattedAddress || '', market)) match = 'weak'
  // Точки сети считаем по двум выдачам сразу: по городу и по бренду на весь
  // регион. Сравнивать названия «в лоб» нельзя — филиалы зовутся
  // «Chopar Pizza Юнусабад», и точное равенство схлопывало сеть до одной точки
  const brandName = (best.displayName?.text || name).trim()
  const a1 = norm(brandName)
  const a2 = norm(name)
  const root = (a2 && a2.length >= 4 && a2.length <= a1.length ? a2 : a1)
  const net = root.length >= 4 ? await search(key, brandName, 20, region).catch(() => [] as Place[]) : []
  const seen = new Set<string>()
  const branches = [...found, ...net].filter(p => {
    const n = norm(p.displayName?.text || '')
    if (root.length < 4 || !n.includes(root)) return false
    if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return false
    const k = p.id || norm(p.formattedAddress || '')
    if (seen.has(k)) return false
    seen.add(k); return true
  }).length || 1

  // Соцсети — с сайта места: Google их не знает, а сейлзу они нужны
  const social = await socialsFromSite(best.websiteUri || '')

  const id = 'sp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const row = {
    place_id: best.id || null,
    name: best.displayName?.text || name,
    address: best.formattedAddress || null,
    rating: best.rating ?? null,
    reviews: best.userRatingCount ?? null,
    website: best.websiteUri || null,
    phone: best.internationalPhoneNumber || best.nationalPhoneNumber || null,
    maps_url: best.googleMapsUri || null,
    category: best.primaryTypeDisplayName?.text || null,
    status: best.businessStatus || null,
    branches,
    hours: JSON.stringify(best.regularOpeningHours?.weekdayDescriptions || []),
    lat: best.location?.latitude ?? null,
    lng: best.location?.longitude ?? null,
    raw: JSON.stringify(found.slice(0, 10)),
    instagram: social.instagram,
    telegram: social.telegram,
    match,
  }

  // Драйвер neon не склеивает вложенные sql-куски — две honest-ветки вместо одной
  if (leadId) await sql`DELETE FROM sales_places WHERE org_id = ${orgId} AND lead_id = ${leadId}`
  else await sql`DELETE FROM sales_places WHERE org_id = ${orgId} AND account_id = ${accountId}`
  await sql`
    INSERT INTO sales_places (id, org_id, lead_id, account_id, place_id, name, address, rating,
                              reviews, website, phone, maps_url, category, status, branches,
                              hours, lat, lng, raw, instagram, telegram, match_kind, found_by, updated_at)
    VALUES (${id}, ${orgId}, ${leadId}, ${accountId}, ${row.place_id}, ${row.name}, ${row.address},
            ${row.rating}, ${row.reviews}, ${row.website}, ${row.phone}, ${row.maps_url},
            ${row.category}, ${row.status}, ${row.branches}, ${row.hours}::jsonb,
            ${row.lat}, ${row.lng}, ${row.raw}::jsonb, ${row.instagram}, ${row.telegram},
            ${row.match}, ${ctx.agentId}, NOW())
  `

  // Подставляем только пустое и только очевидное: город и число точек.
  // first_touch_at не трогаем — это машина посмотрела карты, а не человек
  // Подставляем только по уверенной находке с живыми отзывами: место без
  // единого отзыва — обычно однофамилец заведения, а не оно само
  const trusted = match === 'strong' && (best.userRatingCount ?? 0) > 0
  const filled: string[] = []

  // Сайт и соцсети — в карточку клиента, и только в пустые поля: то, что
  // сейлз вписал руками, машина не переписывает
  if (acc && trusted) {
    const patch: Array<[string, string]> = []
    if (!lead?.website && best.websiteUri) patch.push(['website', best.websiteUri])
    if (!lead?.instagram && social.instagram) patch.push(['instagram', social.instagram])
    if (!lead?.telegram && social.telegram) patch.push(['telegram', social.telegram])
    for (const [field, value] of patch) {
      if (field === 'website') await sql`UPDATE sales_accounts SET website = ${value} WHERE id = ${acc} AND org_id = ${orgId} AND (website IS NULL OR website = '')`
      if (field === 'instagram') await sql`UPDATE sales_accounts SET instagram = ${value} WHERE id = ${acc} AND org_id = ${orgId} AND (instagram IS NULL OR instagram = '')`
      if (field === 'telegram') await sql`UPDATE sales_accounts SET telegram = ${value} WHERE id = ${acc} AND org_id = ${orgId} AND (telegram IS NULL OR telegram = '')`
      filled.push(field === 'website' ? 'сайт' : field === 'instagram' ? 'Instagram' : 'Telegram')
    }
  }

  if (leadId && lead && trusted) {
    const qual = (lead.qual || {}) as Record<string, any>
    const patch: Record<string, string> = {}
    if (!qual.points && branches > 0) { patch.points = String(branches); filled.push('точек') }
    const cityFromMaps = /Tashkent|Ташкент/i.test(row.address || '') ? 'Ташкент' : ''
    if (!lead.city && cityFromMaps) filled.push('город')
    if (Object.keys(patch).length) {
      await sql`
        UPDATE sales_leads
        SET qual = COALESCE(qual, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, updated_at = NOW()
        WHERE id = ${leadId} AND org_id = ${orgId}
      `
    }
    if (!lead.city && cityFromMaps) {
      await sql`UPDATE sales_leads SET city = ${cityFromMaps}, updated_at = NOW() WHERE id = ${leadId} AND org_id = ${orgId}`
    }
  }

  // То же для сделки: пустое поле «Точек» закрывается находкой, заполненное
  // руками не трогаем — человек мог уточнить у клиента и знает лучше карт
  if (dealId && deal && trusted) {
    if (!deal.points && branches > 0) {
      await sql`
        UPDATE sales_deals SET points = ${String(branches)}, updated_at = NOW()
        WHERE id = ${dealId} AND org_id = ${orgId} AND (points IS NULL OR points = '')
      `
      filled.push('точек')
    }
    const cityFromMaps = /Tashkent|Ташкент/i.test(row.address || '') ? 'Ташкент' : ''
    if (!deal.city && cityFromMaps) {
      await sql`
        UPDATE sales_deals SET city = ${cityFromMaps}, updated_at = NOW()
        WHERE id = ${dealId} AND org_id = ${orgId} AND (city IS NULL OR city = '')
      `
      filled.push('город')
    }
  }

  const [saved] = leadId
    ? await sql`SELECT * FROM sales_places WHERE org_id = ${orgId} AND lead_id = ${leadId} LIMIT 1`
    : await sql`SELECT * FROM sales_places WHERE org_id = ${orgId} AND account_id = ${accountId} LIMIT 1`
  const candidates = found.slice(0, 6).map(p => ({
    id: p.id,
    name: p.displayName?.text || '',
    address: p.formattedAddress || '',
    rating: p.rating ?? null,
    reviews: p.userRatingCount ?? null,
  }))
  return json({ place: saved || null, filled, match, candidates, query: city ? `${name} ${city}` : name })
}

export default async function handler(req: Request): Promise<Response> {
  try {
    return await handlerInner(req)
  } catch (e: any) {
    return json({ error: e?.message || 'не получилось' }, 400)
  }
}
