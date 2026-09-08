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
 * Ключ вводится в настройках продаж (support_settings.google_places_key),
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

async function search(key: string, textQuery: string, limit: number): Promise<Place[]> {
  const res = await fetch(HOST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': FIELDS,
    },
    body: JSON.stringify({ textQuery, languageCode: 'ru', regionCode: 'UZ', maxResultCount: limit }),
    signal: AbortSignal.timeout(20000),
  })
  const out = await res.json().catch(() => null) as any
  if (!res.ok) throw new Error(out?.error?.message || 'Google Карты не ответили')
  return (out?.places || []) as Place[]
}

/** Названия одной сети пишут по-разному: сравниваем по буквам и цифрам. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '')

async function handlerInner(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  await ensureOnce('sales_places', async () => {
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
        found_by varchar(64),
        updated_at timestamptz DEFAULT NOW()
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS sales_places_lead ON sales_places (org_id, lead_id)`
    await sql`CREATE INDEX IF NOT EXISTS sales_places_acc ON sales_places (org_id, account_id)`
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
  if (!key) return json({ error: 'Ключ Google Карт не введён: Продажи → Настройки → Google Карты' }, 400)

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
  let lead: any = null
  if (!name && leadId) {
    const [r] = await sql`
      SELECT l.name, l.city, a.name AS account_name, a.city AS account_city, l.qual
      FROM sales_leads l LEFT JOIN sales_accounts a ON a.id = l.account_id
      WHERE l.id = ${leadId} AND l.org_id = ${orgId} LIMIT 1
    `
    lead = r
    name = String(r?.account_name || r?.name || '').trim()
    city = String(r?.city || r?.account_city || '').trim()
  }
  if (!name && accountId) {
    const [r] = await sql`SELECT name, city FROM sales_accounts WHERE id = ${accountId} AND org_id = ${orgId} LIMIT 1`
    name = String(r?.name || '').trim()
    city = String(r?.city || '').trim()
  }
  if (!name) return json({ error: 'у карточки нет названия — искать нечего' }, 400)

  // Один запрос на всё: первый результат считаем совпадением, а остальные
  // с тем же названием — точками сети. Отдельный запрос ради счётчика
  // точек не нужен, он стоил бы столько же, сколько поиск
  const found = await search(key, city ? `${name} ${city}` : name, 20)
  if (!found.length) return json({ error: 'на картах ничего не нашлось' }, 404)

  const best = found[0]
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
  }

  // Драйвер neon не склеивает вложенные sql-куски — две honest-ветки вместо одной
  if (leadId) await sql`DELETE FROM sales_places WHERE org_id = ${orgId} AND lead_id = ${leadId}`
  else await sql`DELETE FROM sales_places WHERE org_id = ${orgId} AND account_id = ${accountId}`
  await sql`
    INSERT INTO sales_places (id, org_id, lead_id, account_id, place_id, name, address, rating,
                              reviews, website, phone, maps_url, category, status, branches,
                              hours, lat, lng, raw, found_by, updated_at)
    VALUES (${id}, ${orgId}, ${leadId}, ${accountId}, ${row.place_id}, ${row.name}, ${row.address},
            ${row.rating}, ${row.reviews}, ${row.website}, ${row.phone}, ${row.maps_url},
            ${row.category}, ${row.status}, ${row.branches}, ${row.hours}::jsonb,
            ${row.lat}, ${row.lng}, ${row.raw}::jsonb, ${ctx.agentId}, NOW())
  `

  // Подставляем только пустое и только очевидное: город и число точек.
  // first_touch_at не трогаем — это машина посмотрела карты, а не человек
  const filled: string[] = []
  if (leadId && lead) {
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
  return json({ place: saved || null, filled })
}

export default async function handler(req: Request): Promise<Response> {
  try {
    return await handlerInner(req)
  } catch (e: any) {
    return json({ error: e?.message || 'не получилось' }, 400)
  }
}
