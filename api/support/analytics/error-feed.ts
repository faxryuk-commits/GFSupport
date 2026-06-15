/**
 * Аналитика по фид-каналу ошибок заказов (support_channels.type='feed').
 *
 * Структурные посты: «Ресторан: X · Сервис: Y · Источник: Z · Текст ошибки: ...».
 * Классифицируем каждую ошибку по таксономии (категория → подкатегория), с
 * расшифровкой, чья вина и что делать. Таксономия построена на реальных текстах
 * фида (см. сессию-аудит): integrator-api доминирует; топ — вебхук-формат, приём
 * от агрегатора, NotFound в CRM, создание NotFound/InvalidArgument, оплата/сумма,
 * стоп-лист, вне зоны.
 *
 * GET ?period=today|7d|30d  → структурированная разбивка для вкладки «Ошибки заказов».
 */
import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = { runtime: 'edge', regions: ['iad1'] }

// fault: чья зона ответственности.
//   delever     — наш баг (парсер/расчёт/платформа)
//   integration — связка Delever↔POS↔агрегатор (общая зона, чаще наша эскалация)
//   pos         — касса/CRM ресторана
//   merchant    — настройка ресторана (стоп-лист, меню, зона)
//   customer    — поведение клиента
//   aggregator  — сторона агрегатора
type Fault = 'delever' | 'integration' | 'pos' | 'merchant' | 'customer' | 'aggregator' | 'unknown'

interface Sub {
  key: string
  label: string
  match: RegExp
  fault: Fault
  decode: string
  fix: string
  owner: string
}
interface Cat { cat: string; label: string; subs: Sub[] }

const TAXONOMY: Cat[] = [
  {
    cat: 'order_create', label: 'Создание / приём заказа', subs: [
      { key: 'webhook_format', label: 'Неверный формат вебхука', match: /формат запроса.*вебхук|вебхук.*rpc|неправильный формат запроса/i, fault: 'delever', decode: 'Агрегатор прислал вебхук, который наш интегратор не смог распарсить — несовпадение контракта/версии.', fix: 'Проверить парсер вебхука и контракт источника; сверить версию интеграции по источнику.', owner: 'engineering' },
      { key: 'receive_aggregator', label: 'Сбой приёма от агрегатора', match: /получении и создани/i, fault: 'integration', decode: 'Заказ от агрегатора (Wolt/Glovo/…) не удалось принять и создать — сбой связки агрегатор↔Delever↔POS.', fix: 'Проверить здоровье integrator-api по источнику; сделать тестовый заказ.', owner: 'integration' },
      { key: 'crm_not_found', label: 'Заказ не найден в CRM (NotFound)', match: /получени.*заказа из CRM|по crmId/i, fault: 'pos', decode: 'Delever запросил заказ в CRM/кассе ресторана — его там нет (не дошёл или не создан на стороне POS).', fix: 'Проверить интеграцию кассы ресторана: онлайн ли касса, создаётся ли заказ на стороне POS.', owner: 'integration' },
      { key: 'create_notfound', label: 'Создание: NotFound', match: /создани.*заказа.*NotFound|NotFound.*создани/i, fault: 'integration', decode: 'При создании заказа не найдена связанная сущность — филиал, товар или позиция меню.', fix: 'Сверить маппинг филиала и товаров между агрегатором и POS.', owner: 'integration' },
      { key: 'create_invalid', label: 'Создание: невалидные данные', match: /создани.*заказа.*InvalidArgument|InvalidArgument/i, fault: 'integration', decode: 'Данные заказа не прошли валидацию POS (поля/формат/сумма/тип).', fix: 'Посмотреть, какое поле невалидно в rpc desc; сверить контракт с POS.', owner: 'integration' },
      { key: 'pos_internal', label: 'POS Internal error', match: /создани.*заказа в POS|code = Internal/i, fault: 'pos', decode: 'Касса/POS ресторана вернула внутреннюю ошибку при создании заказа.', fix: 'Проверить POS ресторана; при повторении — к вендору кассы.', owner: 'integration' },
      { key: 'timeout', label: 'Таймаут (DeadlineExceeded)', match: /DeadlineEx|timeout|таймаут/i, fault: 'integration', decode: 'Касса/агрегатор не ответили в отведённое время.', fix: 'Проверить доступность и латентность POS/источника; повторить заказ.', owner: 'integration' },
      { key: 'order_generic', label: 'Заказ не создан (Unknown)', match: /Order can not be created|Unknown desc|создани.*заказа/i, fault: 'delever', decode: 'Заказ не создан, причина в rpc не классифицирована.', fix: 'Открыть полный rpc desc сообщения; нужен ручной разбор инженером.', owner: 'engineering' },
    ],
  },
  {
    cat: 'payment', label: 'Оплата', subs: [
      { key: 'invalid_amount', label: 'Неверная сумма', match: /invalid amount|given cash amount|invalid payments/i, fault: 'delever', decode: 'Сумма заказа не сходится — возможна известная проблема: стоимость доставки плюсуется в сумму выкупа.', fix: 'Проверить расчёт: сумма заказа vs стоимость доставки; сверить с тем, что прислал агрегатор.', owner: 'engineering' },
      { key: 'payment_type', label: 'Невалидный тип оплаты', match: /payment type is not valid/i, fault: 'integration', decode: 'Тип оплаты не поддерживается или не сопоставлен в интеграции.', fix: 'Сверить маппинг типов оплаты между источником и POS.', owner: 'integration' },
    ],
  },
  {
    cat: 'menu', label: 'Меню / товары', subs: [
      { key: 'product_unavailable', label: 'Товар недоступен (стоп-лист)', match: /недоступны|стоп.?лист/i, fault: 'merchant', decode: 'Заказанные товары помечены недоступными — расхождение наличия касса↔Delever (стоп-лист не синхронизирован).', fix: 'Синхронизировать наличие/меню; снять стоп-лист, если товар фактически есть.', owner: 'support' },
      { key: 'invalid_product', label: 'Невалидный товар', match: /товара не является валидным|ид товара|invalid product/i, fault: 'merchant', decode: 'Товар из заказа не сопоставлен в меню Delever.', fix: 'Сверить маппинг товаров касса↔Delever; пересинхронизировать меню.', owner: 'integration' },
    ],
  },
  {
    cat: 'delivery', label: 'Доставка / зона', subs: [
      { key: 'out_of_zone', label: 'Адрес вне зоны', match: /за пределами|зоны достав|местополож/i, fault: 'customer', decode: 'Клиент оформляет заказ за пределами зоны доставки ресторана.', fix: 'Если массово по одному ресторану — проверить полигон зоны доставки; иначе это поведение клиента.', owner: 'account' },
      { key: 'invalid_delivery', label: 'Невалидная доставка', match: /external delivery id|delivery type is not valid/i, fault: 'integration', decode: 'Идентификатор или тип доставки невалиден.', fix: 'Сверить маппинг параметров доставки с агрегатором.', owner: 'integration' },
      { key: 'branch', label: 'Филиал не найден', match: /интегрированного филиала|филиал/i, fault: 'integration', decode: 'Интегрированный филиал не найден.', fix: 'Проверить привязку филиала к интеграции в админке.', owner: 'integration' },
    ],
  },
]

const FAULT_LABEL: Record<Fault, string> = {
  delever: 'Delever (наш баг)', integration: 'Интеграция (наша зона)', pos: 'Касса/CRM ресторана',
  merchant: 'Ресторан (настройка)', customer: 'Клиент', aggregator: 'Агрегатор', unknown: 'Не определено',
}
// «Наша зона ответственности» = то, что чиним мы (платформа + интеграция).
const OUR_FAULT: Fault[] = ['delever', 'integration']

const field = (t: string, label: string): string | null => {
  const m = t.match(new RegExp(label + '\\s*:?\\s*([^\\n]+?)(?=\\s*(?:Ресторан|Сервис|Источник|Текст ошибки|$))', 'i'))
  return m ? m[1].trim() : null
}
function classify(errText: string): { cat: Cat; sub: Sub } | null {
  for (const cat of TAXONOMY) for (const sub of cat.subs) if (sub.match.test(errText)) return { cat, sub }
  return null
}

function periodStart(period: string): Date {
  const now = Date.now()
  const d = period === 'today' ? 1 : period === '30d' ? 30 : period === '90d' ? 90 : 7
  return new Date(now - d * 864e5)
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id' } })
  const orgId = await getRequestOrgId(req)
  const sql = getSQL()
  const url = new URL(req.url)
  const period = url.searchParams.get('period') || '7d'
  const from = periodStart(period).toISOString()

  const [feed] = await sql`SELECT id, name FROM support_channels WHERE org_id=${orgId} AND type='feed' ORDER BY last_message_at DESC NULLS LAST LIMIT 1` as any[]
  if (!feed) return json({ ok: true, hasFeed: false, total: 0 })

  const rows = await sql`
    SELECT text_content t FROM support_messages
    WHERE org_id=${orgId} AND channel_id=${feed.id} AND text_content IS NOT NULL AND created_at >= ${from}` as any[]

  // агрегации
  const catAgg: Record<string, { label: string; count: number; subs: Record<string, { sub: Sub; count: number; restaurants: Record<string, number> }> }> = {}
  const faultAgg: Record<string, number> = {}
  const serviceAgg: Record<string, number> = {}
  const sourceAgg: Record<string, number> = {}
  const restaurantAgg: Record<string, number> = {}
  let classified = 0, unmatched = 0

  for (const r of rows) {
    const t = String(r.t).replace(/\s+/g, ' ')
    const errText = field(t, 'Текст ошибки') || t
    const service = field(t, 'Сервис') || 'unknown'
    const source = field(t, 'Источник') || 'unknown'
    const restaurant = field(t, 'Ресторан') || 'unknown'
    serviceAgg[service] = (serviceAgg[service] || 0) + 1
    sourceAgg[source] = (sourceAgg[source] || 0) + 1
    restaurantAgg[restaurant] = (restaurantAgg[restaurant] || 0) + 1

    const c = classify(errText)
    if (!c) { unmatched++; faultAgg['unknown'] = (faultAgg['unknown'] || 0) + 1; continue }
    classified++
    faultAgg[c.sub.fault] = (faultAgg[c.sub.fault] || 0) + 1
    if (!catAgg[c.cat.cat]) catAgg[c.cat.cat] = { label: c.cat.label, count: 0, subs: {} }
    catAgg[c.cat.cat].count++
    if (!catAgg[c.cat.cat].subs[c.sub.key]) catAgg[c.cat.cat].subs[c.sub.key] = { sub: c.sub, count: 0, restaurants: {} }
    catAgg[c.cat.cat].subs[c.sub.key].count++
    catAgg[c.cat.cat].subs[c.sub.key].restaurants[restaurant] = (catAgg[c.cat.cat].subs[c.sub.key].restaurants[restaurant] || 0) + 1
  }

  const total = rows.length
  const ourFault = OUR_FAULT.reduce((s, f) => s + (faultAgg[f] || 0), 0)
  const topList = (o: Record<string, number>, n = 10) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, count: v }))

  const categories = Object.entries(catAgg).map(([key, c]) => ({
    key, label: c.label, count: c.count, pct: Math.round((c.count / total) * 100),
    subcategories: Object.values(c.subs).sort((a, b) => b.count - a.count).map(s => {
      const restE = Object.entries(s.restaurants).sort((a, b) => b[1] - a[1])
      const top = restE[0]
      const concentrated = top && top[1] / s.count >= 0.6 && s.count >= 5
      return {
        key: s.sub.key, label: s.sub.label, count: s.count, pct: Math.round((s.count / total) * 100),
        fault: s.sub.fault, faultLabel: FAULT_LABEL[s.sub.fault], decode: s.sub.decode, fix: s.sub.fix, owner: s.sub.owner,
        topRestaurant: top ? top[0] : null, topRestaurantShare: top ? Math.round((top[1] / s.count) * 100) : 0,
        concentrated, restaurantsAffected: restE.length,
      }
    }),
  })).sort((a, b) => b.count - a.count)

  return json({
    ok: true, hasFeed: true, feedName: feed.name, period, total,
    classifiedPct: total ? Math.round((classified / total) * 100) : 0, unmatched,
    ourFault, ourFaultPct: total ? Math.round((ourFault / total) * 100) : 0,
    byFault: Object.entries(faultAgg).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ fault: k, label: FAULT_LABEL[k as Fault] || k, count: v, pct: Math.round((v / total) * 100) })),
    byService: topList(serviceAgg), bySource: topList(sourceAgg), topRestaurants: topList(restaurantAgg, 12),
    categories,
  })
}
