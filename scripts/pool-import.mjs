/**
 * Наполнение пула рынка заведениями из OpenStreetMap.
 *
 * Зачем отдельно от воронки: это ещё не лиды, а список заведений страны —
 * полторы тысячи карточек на один Ташкент. В воронке они утопили бы работу,
 * поэтому живут своей таблицей, и сейлз забирает оттуда поштучно.
 *
 * Источник — OSM (лицензия ODbL, выгрузка и коммерческое использование
 * разрешены с указанием источника). Google для пула не годится: его условия
 * запрещают создавать и дополнять базы бизнес-листингов данными карт.
 * Карты Google остаются на карточке клиента, который уже в работе.
 *
 * Запуск: node scripts/pool-import.mjs [uz kz az kg]
 */
import 'dotenv/config'
import { neon } from '@neondatabase/serverless'

const ORG = process.env.SALES_ORG || 'org_delever'
const OVERPASS = 'https://overpass-api.de/api/interpreter'

/** Рынки и как страна называется в OSM. */
const COUNTRIES = { uz: 'UZ', kz: 'KZ', az: 'AZ', kg: 'KG', ge: 'GE' }

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'j', з: 'z', и: 'i',
  й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '',
  э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
}
const norm = s => String(s || '').toLowerCase()
  .replace(/[а-яёәғқңөұүһі]/g, c => TRANSLIT[c] ?? c).replace(/[^a-z0-9]+/g, '')

/** Телефон сравниваем по последним девяти цифрам: у нас так опознают людей. */
const tail9 = s => {
  const d = String(s || '').replace(/[^0-9]/g, '')
  return d.length >= 9 ? d.slice(-9) : ''
}

/**
 * Насколько заведение похоже на нашего клиента. Не «оценка бизнеса», а
 * порядок обзвона: без телефона звонить некуда, а сеть и доставка — признаки
 * того, что заказы уже есть и их есть чем занять.
 */
function scoreOf(t) {
  let s = 0
  if (t.phone || t['contact:phone']) s += 40
  if (t.website || t['contact:website']) s += 15
  if (t['contact:instagram'] || t.instagram) s += 10
  if (t.delivery === 'yes') s += 20
  if (t.takeaway === 'yes' || t.takeaway === 'only') s += 10
  if (t.brand || t['brand:wikidata']) s += 10
  if (t.amenity === 'restaurant') s += 8
  else if (t.amenity === 'fast_food') s += 6
  if (t.cuisine) s += 4
  if (t['addr:street']) s += 3
  return s
}

const cityOf = t => (t['addr:city'] || t['addr:place'] || t['addr:district'] || '').trim()
const addrOf = t => [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ').trim()
const phoneOf = t => String(t.phone || t['contact:phone'] || '').split(';')[0].trim()
const siteOf = t => String(t.website || t['contact:website'] || '').trim()
const igOf = t => {
  const raw = String(t['contact:instagram'] || t.instagram || '').trim()
  if (!raw) return ''
  const m = raw.match(/instagram\.com\/([A-Za-z0-9_.]{2,30})/i)
  return (m ? m[1] : raw.replace(/^@/, '')).replace(/\/$/, '').slice(0, 120)
}

async function overpass(query) {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    body: query,
    headers: { 'Content-Type': 'text/plain', 'User-Agent': 'GFSupport/1.0 (delever.uz)' },
  })
  if (!res.ok) throw new Error(`Overpass ${res.status}`)
  return res.json()
}

async function ensureSchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS sales_pool (
      id varchar(64) PRIMARY KEY,
      org_id varchar(64) NOT NULL,
      market_id varchar(8) NOT NULL,
      source varchar(16) NOT NULL DEFAULT 'osm',
      source_ref varchar(64) NOT NULL,
      name varchar(300) NOT NULL,
      name_key varchar(300),
      category varchar(60),
      cuisine varchar(120),
      city varchar(120),
      address varchar(300),
      lat numeric(9,6),
      lng numeric(9,6),
      phone varchar(60),
      phone_tail varchar(12),
      website text,
      instagram varchar(120),
      score integer NOT NULL DEFAULT 0,
      status varchar(16) NOT NULL DEFAULT 'new',
      dup_reason varchar(40),
      lead_id varchar(64),
      taken_by varchar(64),
      taken_at timestamptz,
      tags jsonb,
      created_at timestamptz DEFAULT NOW(),
      updated_at timestamptz DEFAULT NOW()
    )
  `
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS sales_pool_src ON sales_pool (org_id, source, source_ref)`
  await sql`CREATE INDEX IF NOT EXISTS sales_pool_board ON sales_pool (org_id, market_id, status, score DESC)`
  await sql`CREATE INDEX IF NOT EXISTS sales_pool_name ON sales_pool (org_id, name_key)`
  await sql`CREATE INDEX IF NOT EXISTS sales_pool_phone ON sales_pool (org_id, phone_tail)`
}

/** Что у нас уже есть: по названию и по телефону, клиенты и обращения. */
async function knownKeys(sql) {
  const [accounts, leads, contacts] = await Promise.all([
    sql`SELECT name FROM sales_accounts WHERE org_id = ${ORG}`,
    sql`SELECT name, phone FROM sales_leads WHERE org_id = ${ORG}`,
    sql`SELECT phone FROM sales_contacts WHERE phone IS NOT NULL AND phone <> ''`.catch(() => []),
  ])
  const names = new Set()
  const phones = new Set()
  for (const r of accounts) { const k = norm(r.name); if (k.length >= 4) names.add(k) }
  for (const r of leads) {
    const k = norm(r.name); if (k.length >= 4) names.add(k)
    const p = tail9(r.phone); if (p) phones.add(p)
  }
  for (const r of contacts) { const p = tail9(r.phone); if (p) phones.add(p) }
  return { names, phones }
}

async function importCountry(sql, market, known) {
  const iso = COUNTRIES[market]
  const query = `[out:json][timeout:600];
area["ISO3166-1"="${iso}"]["admin_level"="2"]->.a;
(
  node["amenity"~"^(restaurant|cafe|fast_food)$"]["name"](area.a);
  way["amenity"~"^(restaurant|cafe|fast_food)$"]["name"](area.a);
);
out tags center;`
  process.stdout.write(`${market}: тяну OSM… `)
  const data = await overpass(query)
  const els = data.elements || []
  console.log(`${els.length} заведений`)

  const rows = []
  const seen = new Set()
  for (const e of els) {
    const t = e.tags || {}
    if (!t.name) continue
    const ref = `${e.type}/${e.id}`
    if (seen.has(ref)) continue
    seen.add(ref)
    const nameKey = norm(t.name)
    const phone = phoneOf(t)
    const tail = tail9(phone)
    // Уже наш клиент или обращение — в пуле такой карточке делать нечего,
    // но и выбрасывать нельзя: иначе следующий импорт заведёт её снова
    const dup = known.names.has(nameKey) ? 'name' : (tail && known.phones.has(tail) ? 'phone' : null)
    rows.push({
      id: 'pl_' + Buffer.from(ref).toString('base64url').slice(0, 40),
      ref, market,
      name: String(t.name).slice(0, 300),
      nameKey: nameKey.slice(0, 300),
      category: t.amenity || null,
      cuisine: (t.cuisine || '').slice(0, 120) || null,
      city: cityOf(t).slice(0, 120) || null,
      address: addrOf(t).slice(0, 300) || null,
      lat: e.lat ?? e.center?.lat ?? null,
      lng: e.lon ?? e.center?.lon ?? null,
      phone: phone.slice(0, 60) || null,
      tail: tail || null,
      website: siteOf(t) || null,
      instagram: igOf(t) || null,
      score: scoreOf(t),
      status: dup ? 'known' : 'new',
      dup,
      tags: JSON.stringify(t).slice(0, 4000),
    })
  }

  // Пачками: одна дорога до базы стоит около 190 мс, построчно это часы
  const CHUNK = 200
  let saved = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK)
    await sql.transaction(part.map(r => sql`
      INSERT INTO sales_pool (id, org_id, market_id, source, source_ref, name, name_key, category,
                              cuisine, city, address, lat, lng, phone, phone_tail, website,
                              instagram, score, status, dup_reason, tags, updated_at)
      VALUES (${r.id}, ${ORG}, ${r.market}, 'osm', ${r.ref}, ${r.name}, ${r.nameKey}, ${r.category},
              ${r.cuisine}, ${r.city}, ${r.address}, ${r.lat}, ${r.lng}, ${r.phone}, ${r.tail},
              ${r.website}, ${r.instagram}, ${r.score}, ${r.status}, ${r.dup}, ${r.tags}::jsonb, NOW())
      ON CONFLICT (org_id, source, source_ref) DO UPDATE SET
        name = EXCLUDED.name, name_key = EXCLUDED.name_key, category = EXCLUDED.category,
        cuisine = EXCLUDED.cuisine, city = EXCLUDED.city, address = EXCLUDED.address,
        lat = EXCLUDED.lat, lng = EXCLUDED.lng, phone = EXCLUDED.phone,
        phone_tail = EXCLUDED.phone_tail, website = EXCLUDED.website,
        instagram = EXCLUDED.instagram, score = EXCLUDED.score, tags = EXCLUDED.tags,
        -- Забранное в работу и отклонённое руками переписывать нельзя:
        -- решение человека важнее свежести выгрузки
        status = CASE WHEN sales_pool.status IN ('taken', 'skipped') THEN sales_pool.status
                      ELSE EXCLUDED.status END,
        dup_reason = EXCLUDED.dup_reason, updated_at = NOW()
    `))
    saved += part.length
    process.stdout.write(`\r${market}: сохранено ${saved}/${rows.length}`)
  }
  console.log('')
  return rows
}

const markets = process.argv.slice(2).filter(m => COUNTRIES[m])
if (!markets.length) {
  console.log('Укажите рынки: node scripts/pool-import.mjs uz kz az kg')
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)
await ensureSchema(sql)
const known = await knownKeys(sql)
console.log(`в базе уже: ${known.names.size} названий, ${known.phones.size} телефонов`)

for (const m of markets) {
  try {
    const rows = await importCountry(sql, m, known)
    const fresh = rows.filter(r => r.status === 'new')
    console.log(`  ${m}: всего ${rows.length}, новых ${fresh.length},`
      + ` с телефоном ${fresh.filter(r => r.phone).length},`
      + ` уже знакомых ${rows.length - fresh.length}`)
  } catch (e) {
    console.log(`  ${m}: не вышло — ${e.message}`)
  }
}
