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
        match_kind varchar(10),
        found_by varchar(64),
        updated_at timestamptz DEFAULT NOW()
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS sales_places_lead ON sales_places (org_id, lead_id)`
    await sql`CREATE INDEX IF NOT EXISTS sales_places_acc ON sales_places (org_id, account_id)`
    await sql`ALTER TABLE sales_places ADD COLUMN IF NOT EXISTS match_kind varchar(10)`
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
  const accountId = body.accountId ? String(body.accountId) : null
  if (!leadId && !accountId) return json({ error: 'нужен leadId или accountId' }, 400)

  // Что ищем: название заведения и город. Своё название карточки надёжнее
  // текста заявки — его уже правил человек
  let name = String(body.query || '').trim()
  let city = ''
  let market = ''
  let lead: any = null
  if (leadId) {
    const [r] = await sql`
      SELECT l.name, l.city, l.market_id, a.name AS account_name, a.city AS account_city, l.qual
      FROM sales_leads l LEFT JOIN sales_accounts a ON a.id = l.account_id
      WHERE l.id = ${leadId} AND l.org_id = ${orgId} LIMIT 1
    `
    lead = r
    if (!name) name = String(r?.account_name || r?.name || '').trim()
    city = String(r?.city || r?.account_city || '').trim()
    market = String(r?.market_id || '').trim()
  }
  if (accountId && !name) {
    const [r] = await sql`SELECT name, city, market_id FROM sales_accounts WHERE id = ${accountId} AND org_id = ${orgId} LIMIT 1`
    name = String(r?.name || '').trim()
    city = String(r?.city || '').trim()
    market = String(r?.market_id || '').trim()
  }
  name = cleanName(name)
  if (!name) return json({ error: 'у карточки нет названия — искать нечего' }, 400)

  // Один запрос на всё: первый результат считаем совпадением, а остальные
  // с тем же названием — точками сети. Отдельный запрос ради счётчика
  // точек не нужен, он стоил бы столько же, сколько поиск
  const region = REGION[market] || 'UZ'
  const found = await search(key, city ? `${name} ${city}` : name, 20, region)
  if (!found.length) {
    return json({
      error: `На картах ничего не нашлось по запросу «${city ? `${name} ${city}` : name}». `
        + 'Если в названии карточки имя человека, впишите название заведения.',
    }, 404)
  }

  // Можно указать конкретное место: сейлз видит список и выбирает сам,
  // когда автоматика ошиблась
  const wanted = body.placeId ? found.find(p => p.id === String(body.placeId)) : null
  const best = wanted || found[0]
  let match: 'strong' | 'weak' = wanted ? 'strong' : matchKind(name, best.displayName?.text || '')
  // Нашлось в другой стране — верить нельзя, даже если название совпало
  if (!wanted && market && otherCountry(best.formattedAddress || '', market)) match = 'weak'
  const brand = norm(best.displayName?.text || name)
  const branches = found.filter(p => norm(p.displayName?.text || '') === brand).length

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
    match,
  }

  // Драйвер neon не склеивает вложенные sql-куски — две honest-ветки вместо одной
  if (leadId) await sql`DELETE FROM sales_places WHERE org_id = ${orgId} AND lead_id = ${leadId}`
  else await sql`DELETE FROM sales_places WHERE org_id = ${orgId} AND account_id = ${accountId}`
  await sql`
    INSERT INTO sales_places (id, org_id, lead_id, account_id, place_id, name, address, rating,
                              reviews, website, phone, maps_url, category, status, branches,
                              hours, lat, lng, raw, match_kind, found_by, updated_at)
    VALUES (${id}, ${orgId}, ${leadId}, ${accountId}, ${row.place_id}, ${row.name}, ${row.address},
            ${row.rating}, ${row.reviews}, ${row.website}, ${row.phone}, ${row.maps_url},
            ${row.category}, ${row.status}, ${row.branches}, ${row.hours}::jsonb,
            ${row.lat}, ${row.lng}, ${row.raw}::jsonb, ${row.match}, ${ctx.agentId}, NOW())
  `

  // Подставляем только пустое и только очевидное: город и число точек.
  // first_touch_at не трогаем — это машина посмотрела карты, а не человек
  // Подставляем только по уверенной находке с живыми отзывами: место без
  // единого отзыва — обычно однофамилец заведения, а не оно само
  const trusted = match === 'strong' && (best.userRatingCount ?? 0) > 0
  const filled: string[] = []
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
