/**
 * Аналитика по фид-каналу ошибок заказов (support_channels.type='feed').
 *
 * Структурные посты: «Ресторан: X · Сервис: Y · Источник: Z · Текст ошибки: ...».
 * Классифицируем каждую ошибку по таксономии (категория → подкатегория), с
 * развёрнутой расшифровкой (что за проблема), пошаговым решением, чья вина, и
 * реальными примерами текстов ошибок + списком задетых ресторанов.
 *
 * GET ?period=today|7d|30d|90d
 */
import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = { runtime: 'edge', regions: ['iad1'] }

type Fault = 'delever' | 'integration' | 'pos' | 'merchant' | 'customer' | 'aggregator' | 'unknown'

interface Sub {
  key: string
  label: string
  match: RegExp
  fault: Fault
  decode: string        // развёрнутое описание проблемы
  fixSteps: string[]     // пошаговое решение
  owner: string
}
interface Cat { cat: string; label: string; subs: Sub[] }

const TAXONOMY: Cat[] = [
  {
    cat: 'order_create', label: 'Создание / приём заказа', subs: [
      {
        key: 'webhook_format', label: 'Неверный формат вебхука', match: /формат запроса.*вебхук|вебхук.*rpc|неправильный формат запроса/i, fault: 'delever',
        decode: 'Источник (агрегатор) присылает вебхук о заказе, но наш integrator-api не может разобрать его тело — rpc-ошибка на этапе парсинга запроса. Обычно это рассинхрон контракта: агрегатор изменил структуру/версию полей, а наш парсер ждёт старую. Заказ при этом до кассы не доходит.',
        fixSteps: [
          'Открыть полный текст ошибки — определить источник (Wolt/Glovo/…) и rpc desc.',
          'Сверить фактическую структуру вебхука с ожидаемой в нашем парсере.',
          'Проверить changelog/версию API источника — не менялся ли контракт.',
          'Обновить парсер вебхука под новый контракт (инженерка).',
          'Прогнать тестовый заказ через этот источник и убедиться, что ошибка ушла.',
        ], owner: 'engineering',
      },
      {
        key: 'receive_aggregator', label: 'Сбой приёма от агрегатора', match: /получении и создани/i, fault: 'integration',
        decode: 'Заказ от агрегатора получен, но на пути «агрегатор → Delever → касса» создание сорвалось. Рвётся именно связка, а не один компонент: либо касса не приняла, либо ответ агрегатора неполный, либо наш integrator упал на конвертации.',
        fixSteps: [
          'Посмотреть, по какому источнику (чаще Wolt) и какому ресторану концентрация.',
          'Проверить здоровье integrator-api по этому источнику (логи, доступность).',
          'Проверить интеграцию конкретного ресторана: касса онлайн, токен жив.',
          'Сделать тестовый заказ через агрегатор → касса.',
          'Если массово по многим ресторанам — это инцидент платформы, эскалировать.',
        ], owner: 'integration',
      },
      {
        key: 'crm_not_found', label: 'Заказ не найден в CRM (NotFound)', match: /получени.*заказа из CRM|по crmId/i, fault: 'pos',
        decode: 'Delever по crmId запрашивает заказ в кассе/CRM ресторана, но касса отвечает NotFound — заказа там нет. Значит заказ не был создан на стороне POS (касса офлайн в момент создания, сбой записи, или рассинхрон id).',
        fixSteps: [
          'Проверить, онлайн ли касса ресторана и стабильна ли её интеграция.',
          'Убедиться, что заказ реально создаётся на стороне POS (не только в Delever).',
          'Сверить crmId/маппинг идентификаторов между Delever и кассой.',
          'Если касса часто офлайн — связаться с рестораном/вендором кассы.',
        ], owner: 'integration',
      },
      {
        key: 'create_notfound', label: 'Создание: NotFound', match: /создани.*заказа.*NotFound|NotFound.*создани/i, fault: 'integration',
        decode: 'При создании заказа касса не нашла связанную сущность — филиал, товар или позицию меню. Чаще всего маппинг между агрегатором/Delever и кассой устарел (товар удалён/переименован, филиал не привязан).',
        fixSteps: [
          'Определить, чего именно не хватает (филиал или товар) из rpc desc.',
          'Сверить маппинг филиала ресторана с интеграцией.',
          'Сверить маппинг товаров касса↔Delever, пересинхронизировать меню.',
          'Повторить заказ после исправления маппинга.',
        ], owner: 'integration',
      },
      {
        key: 'create_invalid', label: 'Создание: невалидные данные', match: /создани.*заказа.*InvalidArgument|InvalidArgument/i, fault: 'integration',
        decode: 'Данные заказа не прошли валидацию кассы — какое-то поле в неверном формате/значении (сумма, тип оплаты/доставки, состав). Касса отклоняет заказ как некорректный.',
        fixSteps: [
          'Из rpc desc понять, какое поле невалидно.',
          'Сверить контракт полей заказа между Delever и POS.',
          'Проверить расчёт суммы и маппинг типов оплаты/доставки.',
          'Исправить формирование заказа на нашей стороне или маппинг.',
        ], owner: 'integration',
      },
      {
        key: 'pos_internal', label: 'POS Internal error', match: /создани.*заказа в POS|code = Internal/i, fault: 'pos',
        decode: 'Касса/POS ресторана вернула внутреннюю ошибку (Internal) при создании заказа — проблема на стороне самой кассы, а не данных.',
        fixSteps: [
          'Проверить состояние кассы ресторана (не зависла ли, обновления).',
          'Повторить заказ; если стабильно повторяется — это касса.',
          'Связаться с рестораном/вендором кассы с примером времени и заказа.',
        ], owner: 'integration',
      },
      {
        key: 'timeout', label: 'Таймаут (DeadlineExceeded)', match: /DeadlineEx|timeout|таймаут/i, fault: 'integration',
        decode: 'Касса или агрегатор не ответили за отведённое время — заказ завис по таймауту. Обычно медленная/перегруженная касса или сетевые проблемы.',
        fixSteps: [
          'Проверить латентность и доступность POS/источника.',
          'Посмотреть, не массовый ли это таймаут (тогда инцидент).',
          'При единичных — повторная отправка; при системных — эскалация.',
        ], owner: 'integration',
      },
      {
        key: 'order_generic', label: 'Заказ не создан (Unknown)', match: /Order can not be created|Unknown desc|создани.*заказа/i, fault: 'delever',
        decode: 'Заказ не создан, но rpc-причина не попала в известные коды (Unknown). Требует ручного разбора полного текста ошибки.',
        fixSteps: [
          'Открыть полный текст ошибки (rpc desc целиком).',
          'Сопоставить с известными паттернами; при новом — завести подкатегорию.',
          'Передать инженерке для классификации и фикса.',
        ], owner: 'engineering',
      },
    ],
  },
  {
    cat: 'payment', label: 'Оплата', subs: [
      {
        key: 'invalid_amount', label: 'Неверная сумма', match: /invalid amount|given cash amount|invalid payments/i, fault: 'delever',
        decode: 'Сумма заказа не сходится с тем, что ожидает касса/агрегатор. Известная причина: стоимость доставки плюсуется в сумму выкупа — из-за этого у курьера/кассы расходятся суммы. Это баг расчёта на нашей стороне.',
        fixSteps: [
          'Сравнить, что прислал агрегатор (сумма товаров vs доставка) и что ушло в кассу.',
          'Проверить, не суммируется ли доставка в сумму заказа/выкупа.',
          'Исправить расчёт: доставка отдельной строкой, не в сумме товаров.',
          'Проверить на затронутом ресторане (часто концентрируется на одном).',
        ], owner: 'engineering',
      },
      {
        key: 'payment_type', label: 'Невалидный тип оплаты', match: /payment type is not valid/i, fault: 'integration',
        decode: 'Тип оплаты, пришедший с заказом, не поддерживается или не сопоставлен в интеграции с кассой.',
        fixSteps: [
          'Посмотреть, какой тип оплаты пришёл и от какого источника.',
          'Сверить маппинг типов оплаты источник↔Delever↔касса.',
          'Добавить/исправить недостающее сопоставление.',
        ], owner: 'integration',
      },
    ],
  },
  {
    cat: 'menu', label: 'Меню / товары', subs: [
      {
        key: 'product_unavailable', label: 'Товар недоступен (стоп-лист)', match: /недоступны|стоп.?лист/i, fault: 'merchant',
        decode: 'Заказанные товары помечены недоступными — наличие в кассе и в Delever разошлось. Ресторан поставил стоп-лист или убрал товар в кассе, но в Delever он остался доступен (или наоборот).',
        fixSteps: [
          'Сверить наличие позиций касса↔Delever по этому ресторану.',
          'Запустить синхронизацию меню/наличия.',
          'Если товар фактически есть — снять стоп-лист; если нет — убрать из Delever.',
          'Напомнить ресторану обновлять наличие в одном месте (синк).',
        ], owner: 'support',
      },
      {
        key: 'invalid_product', label: 'Невалидный товар', match: /товара не является валидным|ид товара|invalid product/i, fault: 'merchant',
        decode: 'Товар из заказа не сопоставлен в меню Delever — невалидный id товара. Маппинг меню касса↔Delever неполный или устарел.',
        fixSteps: [
          'Найти, какой товар (id) невалиден.',
          'Сверить маппинг товаров касса↔Delever.',
          'Пересинхронизировать меню ресторана.',
        ], owner: 'integration',
      },
    ],
  },
  {
    cat: 'delivery', label: 'Доставка / зона', subs: [
      {
        key: 'out_of_zone', label: 'Адрес вне зоны', match: /за пределами|зоны достав|местополож/i, fault: 'customer',
        decode: 'Клиент оформляет заказ по адресу за пределами зоны доставки ресторана. Если массово у одного ресторана — скорее неверно настроен полигон зоны (реальные адреса отлетают). Если единично у разных — это нормальное поведение клиентов.',
        fixSteps: [
          'Проверить концентрацию: один ресторан или россыпь.',
          'Если один ресторан — открыть его зону доставки в админке и сверить полигон с фактическим охватом.',
          'Расширить/исправить границы зоны.',
          'Если россыпь по разным — действия не требуется (поведение клиентов).',
        ], owner: 'account',
      },
      {
        key: 'invalid_delivery', label: 'Невалидная доставка', match: /external delivery id|delivery type is not valid/i, fault: 'integration',
        decode: 'Идентификатор или тип доставки невалиден — маппинг параметров доставки с агрегатором/кассой не сходится.',
        fixSteps: [
          'Посмотреть, какой параметр доставки невалиден.',
          'Сверить маппинг типов/id доставки источник↔Delever↔касса.',
          'Исправить сопоставление.',
        ], owner: 'integration',
      },
      {
        key: 'branch', label: 'Филиал не найден', match: /интегрированного филиала|филиал/i, fault: 'integration',
        decode: 'Интегрированный филиал не найден — привязка филиала ресторана к интеграции отсутствует или сломана.',
        fixSteps: [
          'Проверить привязку филиала к интеграции в админке.',
          'Сверить идентификатор филиала с кассой/агрегатором.',
          'Восстановить привязку и повторить заказ.',
        ], owner: 'integration',
      },
    ],
  },
]

const FAULT_LABEL: Record<Fault, string> = {
  delever: 'Delever (наш баг)', integration: 'Интеграция (наша зона)', pos: 'Касса/CRM ресторана',
  merchant: 'Ресторан (настройка)', customer: 'Клиент', aggregator: 'Агрегатор', unknown: 'Не определено',
}
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
  const d = period === 'today' ? 1 : period === '30d' ? 30 : period === '90d' ? 90 : 7
  return new Date(Date.now() - d * 864e5)
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

  const catAgg: Record<string, { label: string; count: number; subs: Record<string, { sub: Sub; count: number; restaurants: Record<string, number>; examples: string[] }> }> = {}
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
    const subA = catAgg[c.cat.cat].subs[c.sub.key] || (catAgg[c.cat.cat].subs[c.sub.key] = { sub: c.sub, count: 0, restaurants: {}, examples: [] })
    subA.count++
    subA.restaurants[restaurant] = (subA.restaurants[restaurant] || 0) + 1
    // до 3 реальных примеров (короткий хвост текста ошибки)
    if (subA.examples.length < 3) {
      const ex = errText.slice(0, 220)
      if (!subA.examples.includes(ex)) subA.examples.push(ex)
    }
  }

  const total = rows.length
  const ourFault = OUR_FAULT.reduce((s, f) => s + (faultAgg[f] || 0), 0)
  const topList = (o: Record<string, number>, n = 10) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, count: v }))

  const categories = Object.entries(catAgg).map(([key, c]) => ({
    key, label: c.label, count: c.count, pct: Math.round((c.count / total) * 100),
    subcategories: Object.values(c.subs).sort((a, b) => b.count - a.count).map(s => {
      const restE = Object.entries(s.restaurants).sort((a, b) => b[1] - a[1])
      const top = restE[0]
      const concentrated = !!top && top[1] / s.count >= 0.6 && s.count >= 5
      return {
        key: s.sub.key, label: s.sub.label, count: s.count, pct: Math.round((s.count / total) * 100),
        fault: s.sub.fault, faultLabel: FAULT_LABEL[s.sub.fault], decode: s.sub.decode, fixSteps: s.sub.fixSteps, owner: s.sub.owner,
        topRestaurant: top ? top[0] : null, topRestaurantShare: top ? Math.round((top[1] / s.count) * 100) : 0,
        concentrated, restaurantsAffected: restE.length,
        restaurants: restE.slice(0, 6).map(([name, count]) => ({ name, count })),
        examples: s.examples,
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
