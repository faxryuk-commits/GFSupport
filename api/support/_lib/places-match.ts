/**
 * Сверка названий заведений с тем, что вернули карты.
 *
 * Живёт отдельно от обработчика: это единственное место, где решается
 * «тот же это клиент или однофамилец», и оно должно проверяться тестами
 * без похода в базу и в Google. Каждый случай в тестах не выдуман —
 * «Диор Саидкилов» находился как бутик Dior в Сумгаите, «Самарканд Giotto»
 * не совпадал с «Giotto Samarkand» из-за разных алфавитов, а «Tekit Sushi»
 * приносил в карточку сайт «Sushita».
 */

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
export const norm = (s: string) => String(s || '').toLowerCase()
  .replace(/[а-яёәғқңөұүһі]/g, ch => TRANSLIT[ch] ?? ch)
  .replace(/[^a-z0-9]+/g, '')

/** Домен без протокола и www — по нему сверяем, тот ли сайт нашёлся. */
export function host(u: string): string {
  const t = String(u || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
  return t.split(/[/?#]/)[0] || ''
}

/** Регион поиска: клиент из Казахстана не должен находиться в Ташкенте. */
export const REGION: Record<string, string> = { uz: 'UZ', kz: 'KZ', kg: 'KG', az: 'AZ', ge: 'GE', cy: 'CY', ae: 'AE' }

/**
 * Рамка страны для поиска. `regionCode` — только подсказка о языке и
 * предпочтениях, Google при ней спокойно отдаёт заведение в Италии, если
 * название похоже. Рамка — жёсткое ограничение: за её пределы выдача
 * не выходит вовсе. Координаты — грубый прямоугольник по стране,
 * с запасом на приграничье.
 */
export const BOUNDS: Record<string, { low: [number, number]; high: [number, number] }> = {
  uz: { low: [37.1, 55.9], high: [45.7, 73.2] },
  kz: { low: [40.5, 46.4], high: [55.5, 87.4] },
  kg: { low: [39.1, 69.2], high: [43.4, 80.3] },
  az: { low: [38.3, 44.7], high: [41.95, 50.7] },
  ge: { low: [41.0, 39.9], high: [43.6, 46.8] },
  ae: { low: [22.6, 51.5], high: [26.2, 56.4] },
  cy: { low: [34.5, 32.2], high: [35.8, 34.7] },
}

/** Рамка для запроса в Google: {low:{...}, high:{...}}. */
export function boundsFor(market: string | null | undefined) {
  const b = BOUNDS[String(market || '').toLowerCase()] || BOUNDS.uz
  return {
    rectangle: {
      low: { latitude: b.low[0], longitude: b.low[1] },
      high: { latitude: b.high[0], longitude: b.high[1] },
    },
  }
}

/**
 * Страна находки не входит в наши рынки — значит это точно не наш клиент.
 * Рамка отсекает почти всё, но у сетей бывают адреса вида «Milan, Italy»
 * в названии филиала, и такую находку показывать не стоит.
 */
export function foreignCountry(address: string): boolean {
  const a = String(address || '').toLowerCase()
  if (!a) return false
  const ours = new Set(Object.values(COUNTRY_WORDS).flat())
  const alien = [
    'италия', 'italy', 'германия', 'germany', 'франция', 'france', 'испания', 'spain',
    'польша', 'poland', 'турция', 'turkey', 'türkiye', 'россия', 'russia', 'украина', 'ukraine',
    'сша', 'usa', 'united states', 'великобритания', 'united kingdom', 'китай', 'china',
    'индия', 'india', 'болгария', 'bulgaria', 'румыния', 'romania', 'чехия', 'czech',
    'нидерланды', 'netherlands', 'бельгия', 'belgium', 'португалия', 'portugal',
  ]
  return alien.some(w => a.includes(w) && !ours.has(w))
}

/**
 * Как страна называется в адресе Google. Нужно не для красоты: поиск по
 * Узбекистану спокойно возвращает бутик в Сумгаите, и такую находку надо
 * помечать неуверенной, а не подставлять в квалификацию.
 */
export const COUNTRY_WORDS: Record<string, string[]> = {
  uz: ['узбекистан', 'uzbekistan'],
  kz: ['казахстан', 'kazakhstan', 'qazaqstan'],
  kg: ['кыргызстан', 'киргизия', 'kyrgyzstan'],
  az: ['азербайджан', 'azerbaijan'],
  ge: ['грузия', 'georgia'],
  cy: ['кипр', 'cyprus'],
  ae: ['оаэ', 'эмираты', 'emirates'],
}

/** Адрес указывает на другую страну, чем рынок карточки? */
export function otherCountry(address: string, market: string): boolean {
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
export function cleanName(raw: string): string {
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
 * Слова, которые говорят о кухне, формате или городе, а не о бренде.
 * На них совпадать нельзя: «Sushita» и «Tekit Sushi» — разные заведения,
 * общее у них только слово «суши», и по нему в карточку клиента уже
 * попали чужие сайт и соцсети.
 */
const GENERIC = new Set([
  'sushi', 'sushiroll', 'rolls', 'pizza', 'pitsa', 'pizzeria', 'burger', 'burgers', 'kebab',
  'kabob', 'shashlik', 'lavash', 'shawarma', 'shaurma', 'doner', 'donar', 'coffee', 'kofe',
  'coffeeshop', 'kafe', 'cafe', 'caffe', 'restoran', 'restaurant', 'resto', 'choyhona',
  'choyxona', 'chayhana', 'osh', 'oshxona', 'plov', 'palov', 'somsa', 'samsa', 'manti',
  'tandir', 'tandoor', 'milliy', 'millii', 'taomlar', 'taom', 'food', 'fastfood', 'steak', 'grill',
  'wok', 'noodle', 'ramen', 'bakery', 'pekarnya', 'konditerskaya', 'dessert', 'market',
  'magazin', 'shop', 'store', 'dostavka', 'delivery', 'express', 'service', 'servis',
  'group', 'holding', 'company', 'kompaniya', 'house', 'home', 'club', 'lounge', 'hookah',
  'kalyan', 'centre', 'center', 'centr', 'mall', 'plaza', 'hotel', 'otel', 'street',
  'uzbekistan', 'tashkent', 'toshkent', 'samarkand', 'samarqand', 'buxoro', 'bukhara',
  'andijan', 'namangan', 'fergana', 'xiva', 'nukus', 'almaty', 'astana', 'shymkent', 'baku',
])

/**
 * Расстояние правки, но дальше двух букв не считаем: нам важно отличить
 * опечатку от другого слова, а не измерить её точно.
 */
function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > 2) return 3
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i, ...Array(n).fill(0)]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

/** Слова названия, по которым вообще можно судить: длинные и не общие. */
const ownWords = (t: string) => t.split(/[^a-zа-яё0-9]+/i).map(norm)
  .filter(w => w.length >= 4 && !GENERIC.has(w))

/**
 * Совпало ли найденное с тем, что искали, и на каком основании.
 *
 * Ответ нужен не только машине: сейлз видит «Sushita.uz» в шапке и
 * «Tekit Sushi» в карточке, и должен понимать, почему система решила,
 * что это одно место. Поэтому вместе с вердиктом возвращаем причину
 * человеческим языком — она уезжает в карточку.
 */
export function matchKind(query: string, found: string): { kind: 'strong' | 'weak'; why: string } {
  const a = norm(query)
  const b = norm(found)
  if (!a || !b) return { kind: 'weak', why: 'нечего сравнивать' }
  if (a === b) return { kind: 'strong', why: 'название совпало точно' }

  // Одно название целиком внутри другого: «Same bobo» ⊂ «Ресторан Саме Бобо».
  // Четырёх букв мало — «Dior» так находится внутри «Диор Саидкилов»
  const short = a.length <= b.length ? a : b
  const long = a.length <= b.length ? b : a
  if (short.length >= 5 && long.includes(short) && !GENERIC.has(short)) {
    return { kind: 'strong', why: `название совпало целиком: «${short}»` }
  }

  const wq = ownWords(query)
  const wf = ownWords(found)
  const hits: string[] = []
  for (const w of wf) {
    for (const q of wq) {
      if (q === w) { hits.push(w); break }
      // «samarkand» против «samarqand» — опечатка, одно место.
      // «sushita» против «sushi» — отрезанный хвост, разные бренды,
      // поэтому сверяем расстоянием правки, а не общим началом
      const lim = Math.min(q.length, w.length) >= 7 ? 2 : 1
      if (q.length >= 5 && w.length >= 5 && editDistance(q, w) <= lim) { hits.push(w); break }
    }
  }
  if (hits.length) return { kind: 'strong', why: `совпало по слову: «${hits.join('», «')}»` }

  // Ничего своего не совпало — скажем, что общего всё-таки нашлось,
  // иначе «название не совпало» звучит непонятно рядом с похожими вывесками
  const qGen = new Set(query.split(/[^a-zа-яё0-9]+/i).map(norm).filter(w => GENERIC.has(w)))
  const shared = found.split(/[^a-zа-яё0-9]+/i).map(norm)
    .filter(w => GENERIC.has(w) && (qGen.has(w) || [...qGen].some(g => g.startsWith(w) || w.startsWith(g))
      || wq.some(q => q.startsWith(w))))
  if (shared.length) {
    return { kind: 'weak', why: `общее только «${shared.join('», «')}» — это кухня, а не название` }
  }
  return { kind: 'weak', why: 'название не совпало' }
}

/**
 * Корень названия для счёта точек сети. Филиалы зовутся «Chopar Pizza
 * Юнусабад», поэтому сравнивать названия целиком нельзя.
 */
export function brandRoot(cardName: string, foundName: string): string {
  const a1 = norm(foundName || cardName)
  const a2 = norm(cardName)
  return a2 && a2.length >= 4 && a2.length <= a1.length ? a2 : a1
}

/**
 * Свои слова бренда — то, по чему узнаются филиалы. Общие слова
 * («сомса», «пицца», «кафе») отброшены: по ним в одну сеть слипается
 * пол-города.
 */
export function brandKeys(...names: string[]): string[] {
  return [...new Set(names.flatMap(n => ownWords(n)))]
}

/**
 * Тот же это бренд? Сеть и франшиза пишутся на картах вразнобой:
 * «Chitir-chitir somsa», «Читир читир сомса», «Chitir Chitir». Вхождение
 * корня их не ловит — «chitirchitirsomsa» не содержит «chitrchitr» подряд,
 * и сеть из четырёх точек схлопывалась в одну. Сверяем по словам с тем же
 * допуском на опечатку, что и сами названия.
 */
export function sameBrand(keys: string[], title: string): boolean {
  const w = ownWords(title)
  if (!keys.length || !w.length) return false
  return keys.some(b => w.some(x => x === b
    || (b.length >= 5 && x.length >= 5
        && editDistance(b, x) <= (Math.min(b.length, x.length) >= 7 ? 2 : 1))))
}

/**
 * Порядок кандидатов. Google сортирует выдачу по своей близости, и наверх
 * всплывала случайная точка сети с двумя отзывами, а её данные потом ехали
 * в карточку. Сначала те, где название вообще совпало, внутри — по
 * заметности: у сети головная точка та, где отзывов больше.
 */
export function rankPlaces<T>(query: string, list: T[],
  nameOf: (p: T) => string, reviewsOf: (p: T) => number | null | undefined): T[] {
  const scored = list.map((p, i) => ({ p, i, strong: matchKind(query, nameOf(p)).kind === 'strong' }))
  const hits = scored.filter(s => s.strong)
  const pool = hits.length ? hits : scored
  const rest = scored.filter(s => !pool.includes(s))
  pool.sort((a, b) => (reviewsOf(b.p) || 0) - (reviewsOf(a.p) || 0) || a.i - b.i)
  return [...pool, ...rest].map(s => s.p)
}

/**
 * Итоговое решение по находке: не только «похоже ли название», но и можно ли
 * этой находке верить настолько, чтобы заполнять по ней поля клиента.
 *
 * Сверка имён одна с этим не справляется. «Диор Саидкилов» — это человек,
 * а Google отдаёт бутик Dior: слово «Dior» совпадает целиком, и по названию
 * находка выглядит верной. Спасают два независимых признака: место оказалось
 * в другой стране и у него нет ни одного отзыва. Держим их рядом с именем,
 * чтобы решение было в одном месте и проверялось целиком.
 */
export function decideMatch(args: {
  query: string
  foundName: string
  address?: string | null
  market?: string | null
  reviews?: number | null
  /** Домен клиента совпал с доменом места — это сильнее любого имени. */
  bySite?: boolean
  /** Место выбрал человек из списка — спорить не с чем. */
  picked?: boolean
}): { kind: 'strong' | 'weak'; why: string; trusted: boolean } {
  if (args.picked) return { kind: 'strong', why: 'место выбрано вручную', trusted: true }
  if (args.bySite) return { kind: 'strong', why: 'совпал сайт клиента', trusted: true }

  const byName = matchKind(args.query, args.foundName)
  let kind = byName.kind
  let why = byName.why

  if (kind === 'strong' && args.market && otherCountry(args.address || '', args.market)) {
    kind = 'weak'
    why = 'место в другой стране, чем клиент'
  }

  // Заведение без единого отзыва — обычно однофамилец, а не оно само.
  // Показать покажем, но поля клиента по нему не заполняем
  const trusted = kind === 'strong' && (args.reviews ?? 0) > 0
  if (kind === 'strong' && !trusted) why += ' · но отзывов нет — поля не заполняем'
  return { kind, why, trusted }
}

/**
 * Города, как их зовут в карточках. Google на русской локали всё равно
 * отдаёт locality латиницей («Tashkent»), а в CRM 196 карточек с
 * «Ташкент» — без перевода в квалификации завелись бы два разных города.
 */
const CITY_RU: Record<string, string> = {
  tashkent: 'Ташкент', toshkent: 'Ташкент', chirchik: 'Чирчик', chirchiq: 'Чирчик',
  nurafshon: 'Нурафшон', angren: 'Ангрен', olmaliq: 'Алмалык', almalyk: 'Алмалык',
  samarkand: 'Самарканд', samarqand: 'Самарканд', bukhara: 'Бухара', buxoro: 'Бухара',
  andijan: 'Андижан', andijon: 'Андижан', namangan: 'Наманган',
  fergana: 'Фергана', farghona: 'Фергана', fargona: 'Фергана', qoqon: 'Коканд', kokand: 'Коканд',
  nukus: 'Нукус', khiva: 'Хива', xiva: 'Хива', urgench: 'Ургенч', urganch: 'Ургенч',
  navoiy: 'Навои', navoi: 'Навои', jizzakh: 'Джизак', jizzax: 'Джизак',
  qarshi: 'Карши', karshi: 'Карши', termez: 'Термез', termiz: 'Термез',
  guliston: 'Гулистан', gulistan: 'Гулистан', zarafshan: 'Зарафшан',
  almaty: 'Алматы', astana: 'Астана', nursultan: 'Астана', shymkent: 'Шымкент',
  karaganda: 'Караганда', aktobe: 'Актобе', atyrau: 'Атырау',
  baku: 'Баку', ganja: 'Гянджа', sumqayit: 'Сумгаит', sumgait: 'Сумгаит',
  bishkek: 'Бишкек', osh: 'Ош', tbilisi: 'Тбилиси', batumi: 'Батуми',
  dubai: 'Дубай', nicosia: 'Никосия', limassol: 'Лимасол',
}

/** Название города в том виде, в каком его пишет команда. */
export function cityRu(raw: string): string {
  const t = String(raw || '').trim()
  if (!t) return ''
  return CITY_RU[norm(t)] || t
}

/**
 * Логины соцсетей со страницы заведения.
 *
 * Тонкость, на которой уже обожглись: у части клиентов «сайтом» в картах
 * указан сам Instagram. Мы скачивали эту страницу, а в её коде лежит
 * служебная ссылка `instagram.com/rsrc.php` — загрузчик статики Facebook.
 * Регулярка принимала её за логин, и в пять карточек попало «@rsrc.php».
 * Поэтому: служебные пути отсекаем списком, точки и `.php` в логине
 * не допускаем, а если ссылка сама ведёт на профиль — берём логин из неё.
 */
const IG_RESERVED = new Set([
  'p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts', 'about', 'legal',
  'developer', 'developers', 'directory', 'embed', 'graphql', 'ajax', 'web', 'static',
  'favicon', 'oauth', 'privacy', 'terms', 'help', 'api', 'sitemap', 'challenge',
  'emails', 'session', 'push', 'data', 'igsh', 'share',
])

const TG_RESERVED = new Set(['share', 'iv', 'telegram', 'about', 'faq', 'apps', 'blog', 'proxy'])

/** Похоже ли на настоящий логин Instagram. */
export function validIgHandle(raw: string): string | null {
  const h = String(raw || '').trim().replace(/^@/, '').replace(/\.+$/, '')
  if (!h || h.length < 3 || h.length > 30) return null
  if (!/^[A-Za-z0-9_.]+$/.test(h)) return null
  if (h.includes('.php') || h.includes('..')) return null
  if (IG_RESERVED.has(h.toLowerCase())) return null
  // Логин без единой буквы — почти наверняка служебный путь
  if (!/[a-z]/i.test(h)) return null
  return h
}

/** Логин из ссылки на профиль: instagram.com/chitir.chitir?igshid=… */
export function igFromUrl(u: string): string | null {
  const t = String(u || '').trim().toLowerCase()
  if (!/(^|\/\/|\.)instagram\.com\//.test(t)) return null
  const path = t.split('instagram.com/')[1] || ''
  return validIgHandle(path.split(/[/?#]/)[0] || '')
}

/** Логин Telegram из ссылки t.me. */
export function validTgHandle(raw: string): string | null {
  const h = String(raw || '').trim().replace(/^@/, '')
  if (!h || h.length < 3 || h.length > 32) return null
  if (!/^[A-Za-z0-9_]+$/.test(h)) return null
  if (TG_RESERVED.has(h.toLowerCase())) return null
  return h
}

/** Первый пригодный логин Instagram со страницы. */
export function igFromHtml(html: string): string | null {
  const re = /instagram\.com\/([A-Za-z0-9_.]{2,40})/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(String(html || '')))) {
    const h = validIgHandle(m[1])
    if (h) return h
  }
  return null
}

/** Первый пригодный логин Telegram со страницы. */
export function tgFromHtml(html: string): string | null {
  const re = /t\.me\/([A-Za-z0-9_]{3,40})/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(String(html || '')))) {
    const h = validTgHandle(m[1])
    if (h) return h
  }
  return null
}
