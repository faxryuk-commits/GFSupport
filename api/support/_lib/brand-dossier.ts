import { chQuery, CH_DONE_STATUS, type ChConfig } from './clickhouse.js'

/**
 * Досье клиента в Delever: что подключено, через что идут заказы и что
 * из этого следует продавать.
 *
 * Источник — read-only реплика ClickHouse, только агрегаты по бренду.
 * Из crm_credentials читается один столбец — crm_type; crm_data с ключами
 * интеграций не читается никогда.
 *
 * Сигналы — правила с порогами, а не мнение модели: у каждого есть
 * условие, цифра клиента и цена из прайса. Сравнения («у брендов с ботом
 * он даёт 12% заказов») считаются по всей базе раз в сутки и кешируются
 * в support_settings, чтобы карточка не ждала тяжёлый запрос.
 */

export type IntegrationGroup = 'pos' | 'aggregator' | 'delivery' | 'payment' | 'channel' | 'marketing' | 'telephony' | 'other'

/** Типы из crm_credentials.crm_type — как их называет платформа. */
const GROUP_OF: Record<string, IntegrationGroup> = {
  iiko: 'pos', poster: 'pos', jowi: 'pos', syrve: 'pos', rkeeper: 'pos', 'rkeeper-wh': 'pos', clopos: 'pos',
  paloma365: 'pos', dodo: 'pos', alipos: 'pos', inone: 'pos', yaros: 'pos', 'food-picasso': 'pos', atmosaq: 'pos',
  wolt: 'aggregator', glovo: 'aggregator', 'yandex-eats': 'aggregator', chocofood: 'aggregator', 'uzum-tezkor': 'aggregator',
  uzum: 'aggregator', express24: 'aggregator', foody: 'aggregator', rappi: 'aggregator', bolt: 'aggregator', loook: 'aggregator',
  'uzum-retail': 'aggregator', 'yandex-retail': 'aggregator',
  yandex: 'delivery', noor: 'delivery', millenium: 'delivery', 'wolt-drive': 'delivery', 'yoko-taxi': 'delivery',
  'uzum-delivery': 'delivery', yango: 'delivery',
  tiptoppay: 'payment', kaspi: 'payment', applepay: 'payment', gpay: 'payment', rahmat: 'payment', uzqr: 'payment',
  'my-uzbekistan': 'payment', alisa: 'payment',
  'click-mini-app': 'channel',
  mindbox: 'marketing', magnet: 'marketing',
  onlinepbx: 'telephony', asterisk: 'telephony',
}
const LABEL: Record<string, string> = {
  iiko: 'iiko', poster: 'Poster', jowi: 'Jowi', syrve: 'Syrve', rkeeper: 'R-Keeper', 'rkeeper-wh': 'R-Keeper WH', clopos: 'Clopos',
  paloma365: 'Paloma365', dodo: 'Dodo IS', alipos: 'AliPOS', inone: 'InOne', wolt: 'Wolt', glovo: 'Glovo', 'yandex-eats': 'Yandex Eats',
  chocofood: 'Chocofood', 'uzum-tezkor': 'Uzum Tezkor', uzum: 'Uzum', express24: 'Express24', foody: 'Foody', rappi: 'Rappi', bolt: 'Bolt Food',
  yandex: 'Яндекс Доставка', noor: 'Noor', millenium: 'Millenium', 'wolt-drive': 'Wolt Drive', 'yoko-taxi': 'Yoko Taxi', 'uzum-delivery': 'Uzum Delivery',
  yango: 'Yango', tiptoppay: 'TipTopPay', kaspi: 'Kaspi', applepay: 'Apple Pay', gpay: 'Google Pay', rahmat: 'Rahmat', uzqr: 'UzQR',
  'click-mini-app': 'Click Mini App', mindbox: 'Mindbox', onlinepbx: 'OnlinePBX', asterisk: 'Asterisk', 'my-uzbekistan': 'My Uzbekistan', alisa: 'Alisa',
}
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)

export interface Integration { key: string; label: string; group: IntegrationGroup }
export interface ChannelShare { key: string; label: string; n: number; pct: number }
export interface Signal {
  key: string; tone: 'hot' | 'warm' | 'info'; title: string; evidence: string; offer: string; rule: string
  /** Как это сказать клиенту — одна фраза для сценария. */
  say?: string
  /** Что предложить — ключ прайса, если сигнал про конкретный модуль. */
  priceKey?: string | null
}
export interface Benchmarks {
  computedAt: string
  botMedianPct: number; botQ3Pct: number; botBrands: number
  appMedianPct: number; appBrands: number
  kioskMedianOrders: number; kioskBrands: number
  aggOnlyBrands: number; aggOnlyOrders: number
  noModulesBrands: number; activeBrands: number
}
export interface Dossier {
  branches: number
  integrations: Integration[]
  modules: string[]
  channels: ChannelShare[]
  done30: number
  signals: Signal[]
  script: string[]
  benchmarks: Benchmarks | null
}

export const CHANNEL_LABELS: Record<string, string> = {
  aggregator: 'агрегаторы', bot: 'Telegram-бот', ios: 'приложение iOS', android: 'приложение Android',
  website: 'сайт', kiosk: 'киоск', admin_panel: 'операторы', hall: 'зал', qr: 'QR-меню',
}

const D = CH_DONE_STATUS

/** Бенчмарки по всей базе: суточный кеш в support_settings. */
export async function loadBenchmarks(sql: any, cfg: ChConfig): Promise<Benchmarks | null> {
  const [row] = await sql`SELECT value FROM support_settings WHERE org_id = 'org_delever' AND key = 'ch_benchmarks' LIMIT 1` as any[]
  if (row) {
    try {
      const b = JSON.parse(row.value) as Benchmarks
      if (Date.now() - new Date(b.computedAt).getTime() < 24 * 3600e3) return b
    } catch { /* пересчитаем */ }
  }
  const O = `SELECT shipper_id, countIf(status_id = ${D}) done,
    countIf(status_id = ${D} AND source = 'bot') bot, countIf(status_id = ${D} AND source IN ('ios','android')) app,
    countIf(status_id = ${D} AND source = 'aggregator') agg, countIf(status_id = ${D} AND source = 'kiosk') kiosk
    FROM order_v WHERE created_at >= now() - INTERVAL 30 DAY GROUP BY shipper_id HAVING done >= 300`
  const r = await chQuery(cfg, `
    SELECT
      (SELECT count() FROM (${O}) WHERE bot > 0) bot_brands,
      (SELECT round(quantile(0.5)(bot / done) * 100) FROM (${O}) WHERE bot > 0) bot_med,
      (SELECT round(quantile(0.75)(bot / done) * 100) FROM (${O}) WHERE bot > 0) bot_q3,
      (SELECT count() FROM (${O}) WHERE app > 0) app_brands,
      (SELECT round(quantile(0.5)(app / done) * 100) FROM (${O}) WHERE app > 0) app_med,
      (SELECT count() FROM (${O}) WHERE kiosk > 0) kiosk_brands,
      (SELECT round(quantile(0.5)(kiosk)) FROM (${O}) WHERE kiosk > 0) kiosk_med,
      (SELECT count() FROM (${O}) WHERE agg / done >= 0.95) agg_only_brands,
      (SELECT sum(done) FROM (${O}) WHERE agg / done >= 0.95) agg_only_orders,
      (SELECT count() FROM (${O})) active_brands,
      (SELECT count() FROM (${O}) WHERE shipper_id NOT IN (SELECT shipper_id FROM shipper_additional_modules WHERE is_active = 1)) no_modules`, 40000)
  if (!r.ok || !r.data?.[0]) return null
  const x = r.data[0]
  const b: Benchmarks = {
    computedAt: new Date().toISOString(),
    botMedianPct: Number(x.bot_med || 0), botQ3Pct: Number(x.bot_q3 || 0), botBrands: Number(x.bot_brands || 0),
    appMedianPct: Number(x.app_med || 0), appBrands: Number(x.app_brands || 0),
    kioskMedianOrders: Number(x.kiosk_med || 0), kioskBrands: Number(x.kiosk_brands || 0),
    aggOnlyBrands: Number(x.agg_only_brands || 0), aggOnlyOrders: Number(x.agg_only_orders || 0),
    noModulesBrands: Number(x.no_modules || 0), activeBrands: Number(x.active_brands || 0),
  }
  await sql`
    INSERT INTO support_settings (org_id, key, value) VALUES ('org_delever', 'ch_benchmarks', ${JSON.stringify(b)})
    ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value
  `.catch(() => {})
  return b
}

const fmt = (n: number) => n.toLocaleString('ru-RU')

export async function brandDossier(
  sql: any, cfg: ChConfig, shipperId: string, opts: { currency: string; prices: Record<string, { name: string; price: number; unit_kind: string }> },
): Promise<Dossier | null> {
  const sid = shipperId.replace(/[^0-9a-f-]/gi, '')
  const [ch, integ, mods, br, bench] = await Promise.all([
    chQuery(cfg, `SELECT source, count() n FROM order_v WHERE shipper_id = '${sid}' AND status_id = ${D} AND created_at >= now() - INTERVAL 30 DAY GROUP BY source ORDER BY n DESC`),
    chQuery(cfg, `SELECT DISTINCT crm_type FROM crm_credentials WHERE shipper_id = '${sid}' AND deleted_at = 0`),
    chQuery(cfg, `SELECT DISTINCT m.name AS name FROM shipper_additional_modules s JOIN additional_modules m ON m.id = s.additional_module_id WHERE s.shipper_id = '${sid}' AND s.is_active = 1`),
    chQuery(cfg, `SELECT countIf(deleted_at = 0 AND is_active = 1) n FROM branches_v WHERE shipper_id = '${sid}'`),
    loadBenchmarks(sql, cfg),
  ])
  if (!ch.ok) return null

  const rows = (ch.data || []).map((r: any) => ({ key: String(r.source || 'other'), n: Number(r.n) }))
  const done30 = rows.reduce((s, r) => s + r.n, 0)
  const channels: ChannelShare[] = rows.map(r => ({ key: r.key, label: CHANNEL_LABELS[r.key] || r.key, n: r.n, pct: done30 ? Math.round((r.n / done30) * 100) : 0 }))
  const share = (k: string) => channels.find(c => c.key === k)?.pct || 0
  const has = (k: string) => (channels.find(c => c.key === k)?.n || 0) > 0

  const integrations: Integration[] = (integ.data || [])
    .map((r: any) => String(r.crm_type))
    .filter(k => k && !isUuid(k))
    .map(key => ({ key, label: LABEL[key] || key, group: GROUP_OF[key] || 'other' }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
  const modules = (mods.data || []).map((r: any) => String(r.name)).filter(Boolean).sort()
  const branches = Number(br.data?.[0]?.n || 0)
  const hasModule = (re: RegExp) => modules.some(m => re.test(m))
  const price = (key: string) => opts.prices[key]?.price || 0
  const cur = opts.currency
  const money = (v: number) => `${fmt(v)} ${cur}`

  // ── Сигналы: каждое правило — условие, цифра клиента, что предложить ──
  const signals: Signal[] = []
  const aggPct = share('aggregator')
  const ownN = (channels.filter(c => ['bot', 'ios', 'android', 'website', 'kiosk'].includes(c.key)).reduce((s, c) => s + c.n, 0))
  const ownPct = done30 ? Math.round((ownN / done30) * 100) : 0

  if (done30 >= 300 && aggPct >= 95) {
    const botPct = bench?.botMedianPct || 12
    const est = Math.round((done30 * botPct) / 100)
    signals.push({
      key: 'agg_only', tone: 'hot',
      title: `Все ${fmt(done30)} заказов в месяц — через агрегаторы`,
      evidence: `Свой канал — ${ownPct}%. У брендов, подключивших бота, он даёт в медиане ${botPct}% заказов${bench ? ` (у верхней четверти — ${bench.botQ3Pct}%+)` : ''}. Для этого бренда ${botPct}% — ≈ ${fmt(est)} заказов в месяц без комиссии.`,
      offer: 'Telegram-бот входит в тариф — подключение, не покупка; White Label приложение — после первых цифр по боту. Аргумент — комиссия агрегатора с этих заказов, а не «ещё один канал».',
      rule: 'агрегаторы ≥ 95% и заказов ≥ 300', priceKey: null,
    })
  } else if (done30 >= 300 && aggPct >= 60 && !has('bot') && !has('ios') && !has('android')) {
    signals.push({
      key: 'agg_heavy', tone: 'warm',
      title: `${aggPct}% заказов через агрегаторы, своих каналов нет`,
      evidence: `${fmt(done30)} заказов за 30 дней; бот и приложение не дают ни одного.`,
      offer: 'Telegram-бот из тарифа как первый свой канал.', rule: 'агрегаторы ≥ 60%, бот и приложение = 0', priceKey: null,
      say: `«${aggPct}% ваших заказов идут через агрегаторы с комиссией, а своего канала пока нет. Бот входит в тариф — можно включить и посмотреть, сколько заказов уйдёт мимо комиссии».`,
    })
  }
  if (branches >= 5 && !hasModule(/кухн|kds/i)) {
    signals.push({
      key: 'kds', tone: 'warm',
      title: `${branches} филиалов без экрана кухни`,
      evidence: `${fmt(done30)} заказов в месяц; модуль «Кухня (KDS)» не подключён — кухни собирают заказы с планшетов.`,
      offer: `Кухня (KDS) · ${money(price('kds'))} × ${branches} точек в месяц.`, rule: 'филиалов ≥ 5, KDS нет', priceKey: 'kds',
      say: `«У вас ${branches} кухонь и ${fmt(done30)} заказов в месяц — как сейчас повар видит очередь? Экран кухни собирает все каналы в одну очередь, ${money(price('kds'))} за точку».`,
    })
  }
  if (done30 >= 1000 && !hasModule(/маркетинг/i)) {
    const ownBase = ownPct >= 30
    signals.push({
      key: 'marketing', tone: ownBase ? 'warm' : 'info',
      title: ownBase ? `Свои каналы ${ownPct}%, а маркетинг-модуля нет` : `Нет маркетинг-модуля при ${fmt(done30)} заказах`,
      evidence: ownBase
        ? `${fmt(ownN)} заказов в месяц идут через свои каналы — есть база покупателей, которой можно писать.`
        : 'Промокоды, push и реферальная программа не подключены; своей базы покупателей пока нет — покупатели у агрегаторов.',
      offer: `Маркетинг · ${money(price('marketing'))}/мес${ownBase ? '' : ' — только вместе с ботом, иначе некому слать'}.`,
      rule: 'заказов ≥ 1 000, модуля нет', priceKey: 'marketing',
      say: ownBase
        ? `«${fmt(ownN)} заказов в месяц у вас идут через свои каналы — это база покупателей, которой вы пока ничего не пишете. Промокод на второй заказ и push по пятницам — ${money(price('marketing'))} в месяц».`
        : undefined,
    })
  }
  if (done30 >= 1000 && !hasModule(/дашборд|аналит/i)) {
    signals.push({
      key: 'dashboard', tone: 'info',
      title: `${branches >= 3 ? `Сеть из ${branches} филиалов` : 'Бренд'} без аналитики`,
      evidence: `${fmt(done30)} заказов в месяц, дашборд не подключён.`,
      offer: `Дашборд аналитики · ${money(price('analytics-dash'))}/мес.`, rule: 'заказов ≥ 1 000, дашборда нет', priceKey: 'analytics-dash',
      say: `«${fmt(done30)} заказов в месяц${branches >= 3 ? ` по ${branches} точкам` : ''} — где вы сейчас смотрите средний чек и повторные заказы? Дашборд — ${money(price('analytics-dash'))} в месяц».`,
    })
  }
  if (share('admin_panel') >= 30 && done30 >= 300) {
    signals.push({
      key: 'operators', tone: 'warm',
      title: `${share('admin_panel')}% заказов заводят операторы руками`,
      evidence: `${fmt(channels.find(c => c.key === 'admin_panel')?.n || 0)} заказов в месяц принимаются по телефону и вбиваются в панель.`,
      offer: 'Бот и сайт с заказом снимают эту нагрузку; колл-центр-модуль — если поток по телефону останется.', rule: 'операторы ≥ 30%', priceKey: null,
      say: `«${share('admin_panel')}% заказов ваши операторы вбивают руками — это ${fmt(channels.find(c => c.key === 'admin_panel')?.n || 0)} звонков в месяц. Сколько людей на этом сидит? Часть уйдёт в бот и на сайт сама».`,
    })
  }
  // Киоск по данным платформы не угадать: зал виден только у тех, у кого он уже
  // подключён. Правило появится, когда в карточке клиента будет поле «есть зал»
  if (!integrations.some(i => i.group === 'delivery') && !hasModule(/курьер/i)
      && ownN > 0 && done30 >= 300 && aggPct < 95) {
    signals.push({
      key: 'courier', tone: 'info',
      title: 'Своя доставка без курьерского модуля',
      evidence: 'Курьерских сервисов не подключено, модуля «Курьерка» нет — маршруты и статусы ведутся вручную.',
      offer: `Курьерское приложение · ${money(price('courier-app'))}/мес или Яндекс Доставка как сервис. Сначала спросить, как возят.`, rule: 'свои каналы есть, курьерки и сервисов доставки нет', priceKey: 'courier-app',
    })
  }
  // Интеграция подключена, потока по ней нет
  const aggInteg = integrations.filter(i => i.group === 'aggregator')
  if (aggInteg.length && !has('aggregator') && done30 >= 100) {
    signals.push({
      key: 'dead_integration', tone: 'info',
      title: `${aggInteg.map(i => i.label).join(', ')} подключён, заказов через него 0`,
      evidence: 'Интеграция есть, потока нет — либо выключена, либо бренд ушёл с площадки. Спросить.',
      offer: '', rule: 'интеграция агрегатора без заказов', priceKey: null,
    })
  }
  if (modules.length === 0 && done30 >= 300 && !signals.some(s => s.key === 'agg_only')) {
    const first = ownPct >= 30 ? 'Маркетинг' : aggPct >= 50 ? '«Агрегатор все»' : 'Дашборд'
    signals.push({
      key: 'no_modules', tone: 'warm',
      title: 'Ни одного модуля',
      evidence: bench ? `${bench.noModulesBrands} из ${bench.activeBrands} активных брендов живут без модулей; по базе без модулей уходит каждый второй, с 1–2 модулями — каждый пятый.` : 'Модули — то, что удерживает: без них уходит каждый второй.',
      offer: `Один модуль в ближайший договор — для этого клиента первым напрашивается ${first}.`, rule: 'модулей 0, заказов ≥ 300', priceKey: null,
    })
  }
  const order: Record<Signal['tone'], number> = { hot: 0, warm: 1, info: 2 }
  signals.sort((a, b) => order[a.tone] - order[b.tone])
  // Больше пяти сигналов — это уже не сигналы, а шум; слабые «info» уходят первыми
  signals.splice(5)

  // ── Сценарий: из сигналов, по порядку силы — фразами, а не заголовками ──
  const script: string[] = []
  const s0 = signals[0]
  if (s0?.key === 'agg_only') {
    const aggNames = aggInteg.map(i => i.label).join(', ') || 'агрегаторы'
    script.push(`Открыть с их цифрой: «У вас ${fmt(done30)} заказов в месяц, и все идут через ${aggNames}. Считали, сколько это в комиссии за год?»`)
    script.push(`Сравнение с похожими: «Бренды вашего размера с ботом переводят на него в среднем ${bench?.botMedianPct || 12}% заказов — у вас это ${fmt(Math.round((done30 * (bench?.botMedianPct || 12)) / 100))} заказов в месяц без комиссии».`)
    script.push('Низкий порог: «Бот уже входит в тариф — это подключение, не покупка. Приложение обсуждаем после первых цифр по боту».')
  } else if (s0?.say) {
    script.push(`Открыть с их цифрой: ${s0.say}`)
  }
  for (const sg of signals.slice(1, 4)) {
    if (sg.say) script.push(`Второй заход, если разговор идёт: ${sg.say}`)
  }
  if (ownPct < 10 && signals.some(sg => sg.key === 'marketing')) {
    script.push('Не предлагать сейчас: маркетинг-модуль — пока нет своей базы покупателей, ему некому писать.')
  }

  return { branches, integrations, modules, channels, done30, signals, script, benchmarks: bench }
}
