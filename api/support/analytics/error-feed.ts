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

// nature: системная ошибка или ОЖИДАЕМОЕ бизнес-отклонение (система отработала
// верно — стоп-лист, вне зоны). Отклонения не считаются «ошибкой/нашей виной».
type Nature = 'error' | 'rejection'

interface Sub {
  key: string
  label: string
  match: RegExp
  fault: Fault
  nature?: Nature        // по умолчанию 'error'
  decode: string        // развёрнутое описание проблемы
  fixSteps: string[]     // пошаговое решение
  owner: string
}
interface Cat { cat: string; label: string; subs: Sub[] }

const TAXONOMY: Cat[] = [
  {
    cat: 'order_create', label: 'Создание / приём заказа', subs: [
      {
        key: 'webhook_format', label: 'Неверный формат вебхука', match: /формат запроса.*вебхук|вебхук.*rpc|неправильный формат запроса|unmarshal/i, fault: 'delever',
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
        key: 'payment_type_iiko', label: 'Тип оплаты не получен из iiko', match: /GetPaymentTypeByCrmId|getting payment type|payment type in order create/i, fault: 'integration',
        decode: 'При создании заказа Delever запрашивает у iiko тип оплаты по crmId филиала, а iiko не возвращает его. Чаще всего тип оплаты не настроен/не сопоставлен в iiko для этого филиала, либо crmId филиала указывает не туда. Заказ из-за этого не создаётся.',
        fixSteps: [
          'Из текста ошибки определить филиал (filial:…).',
          'Проверить в iiko этого филиала, что нужные типы оплаты заведены и активны.',
          'Сверить crmId филиала и маппинг типов оплаты Delever↔iiko.',
          'Добавить/исправить недостающее сопоставление типа оплаты.',
          'Прогнать тестовый заказ по этому филиалу.',
        ], owner: 'integration',
      },
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
        key: 'product_unavailable', label: 'Товар недоступен (стоп-лист)', match: /недоступны|стоп.?лист/i, fault: 'merchant', nature: 'rejection',
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
        key: 'shipper_down', label: 'Служба доставки не работает', match: /shipper.?s not working|служба доставки.*не работает/i, fault: 'integration',
        decode: 'Сервис назначения курьера (shipper) недоступен — заказ не удаётся передать на доставку. Обычно временный сбой/недоступность сервиса доставки или его интеграции.',
        fixSteps: [
          'Проверить статус и доступность сервиса доставки (shipper).',
          'Посмотреть, всплеск ли это (тогда инцидент платформы) или единичные случаи.',
          'При всплеске — эскалация в инженерку; уведомить затронутые рестораны.',
        ], owner: 'engineering',
      },
      {
        key: 'out_of_zone', label: 'Адрес вне зоны', match: /за пределами|зоны достав|местополож/i, fault: 'customer', nature: 'rejection',
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
// Ресторан/филиал: метка «Ресторан:», иначе из 2-го формата «…Create err: <филиал> : rpc»
// или «…error: filial:<X>».
function getRestaurant(t: string): string | null {
  return field(t, 'Ресторан')
    || t.match(/Create err:\s*([^:]{1,60}?)\s*:\s*rpc error/i)?.[1]?.trim()
    || t.match(/filial\s*:\s*([^\n,;]{1,60})/i)?.[1]?.trim()
    || null
}
// Источник: метка «Источник:», иначе client_name из JSON «Запрос», иначе для
// прямых iiko-постов (стоп-лист без агрегатора) — 'iiko' вместо «unknown».
function getSource(t: string): string | null {
  return field(t, 'Источник')
    || t.match(/"client_name"\s*:\s*"([^"]+)"/i)?.[1]?.trim()
    || (/Get ?Iiko|GetIIko|OrderServiceV2/i.test(t) ? 'iiko' : null)
}
// Сервис: метка «Сервис:», иначе «Get Iiko/OrderServiceV2» = integrator-api.
function getService(t: string): string | null {
  return field(t, 'Сервис') || (/Get ?Iiko|GetIIko|OrderServiceV2/i.test(t) ? 'integrator-api' : null)
}
// Нормализованная сигнатура проблемы: убираем переменные части (время, JSON-запрос,
// числа/id), оставляем устойчивый «отпечаток». Так 6К ошибок схлопываются в ~250 проблем.
function normSig(raw: string): string {
  let s = String(raw).replace(/\s+/g, ' ')
  s = s.replace(/Время ошибки:.*$/i, '')
  s = s.replace(/Запрос:\s*\{[\s\S]*$/i, '')
  s = s.replace(/\b\d[\d:api_-]{3,}\b/gi, '#')
  s = s.replace(/\b\d+\b/g, '#')
  return s.trim()
}
function classify(errText: string): { cat: Cat; sub: Sub } | null {
  // СНАЧАЛА «ожидаемые отклонения» (стоп-лист, вне зоны) — они точнее rpc-кода:
  // 🛑 «недоступны» приходит с code=InvalidArgument и иначе попал бы в create_invalid.
  for (const cat of TAXONOMY) for (const sub of cat.subs) if ((sub.nature === 'rejection') && sub.match.test(errText)) return { cat, sub }
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
  const sigAgg: Record<string, { count: number; restaurant: string; source: string; service: string; sample: string; sub: Sub | null; catLabel: string }> = {}
  let classified = 0, unmatched = 0, rejections = 0

  for (const r of rows) {
    const t = String(r.t).replace(/\s+/g, ' ')
    const errText = field(t, 'Текст ошибки') || t
    const service = getService(t) || 'unknown'
    const source = getSource(t) || 'unknown'
    const restaurant = getRestaurant(t) || 'unknown'
    serviceAgg[service] = (serviceAgg[service] || 0) + 1
    sourceAgg[source] = (sourceAgg[source] || 0) + 1
    restaurantAgg[restaurant] = (restaurantAgg[restaurant] || 0) + 1

    const c = classify(errText)
    // уникальная сигнатура (дедуп) — считаем для всех, включая неклассифицированные
    const sig = normSig(t)
    const sa = sigAgg[sig] || (sigAgg[sig] = { count: 0, restaurant, source, service, sample: errText.slice(0, 220), sub: c?.sub || null, catLabel: c?.cat.label || 'Не определено' })
    sa.count++
    if (!c) { unmatched++; faultAgg['unknown'] = (faultAgg['unknown'] || 0) + 1; continue }
    classified++
    if ((c.sub.nature || 'error') === 'rejection') rejections++
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
  // Настоящие ошибки vs ожидаемые отклонения (стоп-лист/вне зоны — система отработала верно).
  const errorsTotal = total - rejections
  const ourFault = OUR_FAULT.reduce((s, f) => s + (faultAgg[f] || 0), 0)
  const topList = (o: Record<string, number>, n = 10) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, count: v }))

  // Уникальность: сколько РАЗНЫХ проблем за повторами + покрытие топ-N.
  const sigEntries = Object.entries(sigAgg).sort((a, b) => b[1].count - a[1].count)
  const uniqueCount = sigEntries.length
  const dedupPct = total ? Math.round((1 - uniqueCount / total) * 100) : 0
  const cover = (n: number) => total ? Math.round(sigEntries.slice(0, n).reduce((s, [, v]) => s + v.count, 0) / total * 100) : 0
  const topSignatures = sigEntries.slice(0, 30).map(([sig, v]) => ({
    signature: sig.slice(0, 200), count: v.count, pct: Math.round((v.count / total) * 100),
    restaurant: v.restaurant, source: v.source, service: v.service, category: v.catLabel,
    label: v.sub?.label || 'Не классифицировано', nature: v.sub?.nature || 'error',
    fault: v.sub?.fault || 'unknown', faultLabel: v.sub ? FAULT_LABEL[v.sub.fault] : FAULT_LABEL.unknown,
    decode: v.sub?.decode || '', fixSteps: v.sub?.fixSteps || [], owner: v.sub?.owner || '', sample: v.sample,
  }))

  const categories = Object.entries(catAgg).map(([key, c]) => ({
    key, label: c.label, count: c.count, pct: Math.round((c.count / total) * 100),
    subcategories: Object.values(c.subs).sort((a, b) => b.count - a.count).map(s => {
      const restE = Object.entries(s.restaurants).sort((a, b) => b[1] - a[1])
      const top = restE[0]
      const concentrated = !!top && top[1] / s.count >= 0.6 && s.count >= 5
      return {
        key: s.sub.key, label: s.sub.label, count: s.count, pct: Math.round((s.count / total) * 100),
        nature: s.sub.nature || 'error',
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
    errorsTotal, rejectionsTotal: rejections,
    uniqueCount, dedupPct, coverageTop10: cover(10), coverageTop20: cover(20), coverageTop50: cover(50), topSignatures,
    classifiedPct: total ? Math.round((classified / total) * 100) : 0, unmatched,
    ourFault, ourFaultPct: errorsTotal ? Math.round((ourFault / errorsTotal) * 100) : 0,
    byFault: Object.entries(faultAgg).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ fault: k, label: FAULT_LABEL[k as Fault] || k, count: v, pct: Math.round((v / total) * 100) })),
    byService: topList(serviceAgg), bySource: topList(sourceAgg), topRestaurants: topList(restaurantAgg, 12),
    categories,
  })
}
