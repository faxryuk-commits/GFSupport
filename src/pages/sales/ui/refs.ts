import { useEffect, useState } from 'react'
import { apiGet } from '@/shared/services/api.service'

/**
 * Справочники продаж на клиенте: этапы, источники, причины отказа и — главное —
 * готовые значения полей (город, касса, тип доставки, тариф).
 *
 * Держим один общий кэш на модуль: справочники меняются раз в месяц, а страниц,
 * которым они нужны, много. Перезагружаем по refreshRefs() после правки.
 */

export interface FieldOption {
  id: string
  field: string
  value: string
  label: string
  market_id: string | null
  is_active: boolean
}

export interface SalesRefs {
  stages: any[]
  reasons: any[]
  sources: Array<{ key: string; label: string; kind: string; is_active: boolean }>
  markets: Array<{ market_id: string; currency: string; legal_entity: string; deals: number }>
  options: FieldOption[]
}

let cache: SalesRefs | null = null
let inflight: Promise<SalesRefs> | null = null
const listeners = new Set<(r: SalesRefs) => void>()

/**
 * Один сбой запроса не должен оставлять поля без списков до конца сессии:
 * пустой справочник молча превращает выбор в обычный ввод — ровно так выглядел
 * модуль во время простоя, и со стороны это читалось как «списков нет вовсе».
 */
function fetchRefs(attempt = 0): Promise<SalesRefs> {
  if (inflight) return inflight
  inflight = apiGet<SalesRefs>('/sales/refs', false)
    .then(r => {
      cache = r
      listeners.forEach(l => l(r))
      return r
    })
    .catch(e => {
      inflight = null
      if (attempt < 2) {
        return new Promise<SalesRefs>(resolve => {
          setTimeout(() => resolve(fetchRefs(attempt + 1)), 2000 * (attempt + 1))
        })
      }
      throw e
    })
    .finally(() => { inflight = null })
  return inflight
}

/** Сбросить кэш после правки справочника. */
export function refreshRefs(): Promise<SalesRefs> {
  cache = null
  return fetchRefs()
}

export function useSalesRefs(): SalesRefs | null {
  const [refs, setRefs] = useState<SalesRefs | null>(cache)

  useEffect(() => {
    listeners.add(setRefs)
    if (!cache) fetchRefs().catch(() => {})
    else setRefs(cache)
    return () => { listeners.delete(setRefs) }
  }, [])

  return refs
}

/**
 * Резервные списки на клиенте.
 *
 * Справочник живёт на сервере и правится в интерфейсе, но если запрос не дошёл,
 * поле молча превращалось в пустой ввод — и выбор будто исчезал. Эти значения
 * повторяют серверные сиды и служат подпоркой: список есть всегда, серверный —
 * главнее и дополняет его.
 */
const DEFAULTS: Record<string, string[]> = {
  country: ['Узбекистан', 'Казахстан', 'Кыргызстан', 'Азербайджан', 'Грузия', 'Кипр', 'ОАЭ'],
  segment: ['Ресторан', 'Кафе', 'Чайхана', 'Фастфуд', 'Кофейня', 'Пекарня',
    'Дарк-китчен', 'Сеть заведений', 'Столовая', 'Кондитерская'],
  pos: ['Нет кассы', 'IIKO', 'Clopos', 'Alisa', 'Poster', 'R-Keeper', 'Paloma', 'Jowi',
    'Rezerv', 'Своя разработка', 'Другая'],
  delivery_type: ['Свои курьеры', 'Только агрегаторы', 'Свои курьеры и агрегаторы',
    'Самовывоз', 'Доставки нет'],
  aggregators: ['Не работает с агрегаторами', 'Yandex Eats', 'Uzum Tezkor', 'Wolt',
    'Glovo', 'Bolt Food', 'Несколько агрегаторов'],
  orders_per_day: ['до 10', '10-30', '30-50', '50-100', '100-300', 'больше 300'],
  pain: ['Высокая комиссия агрегаторов', 'Нет своей доставки', 'Нет учёта заказов',
    'Долгая сборка заказа', 'Нет аналитики продаж', 'Курьеры не под контролем',
    'Нет своего приложения', 'Заказы теряются между кассой и кухней', 'Нет повторных продаж'],
  dm_role: ['Владелец', 'Управляющий', 'Директор', 'Операционный директор', 'Маркетолог',
    'IT-специалист', 'Бухгалтер'],
  tariff: ['Start', 'Medium', 'Big', 'Enterprise'],
  products: ['Мобильное приложение', 'Киоск самообслуживания', 'QR-меню',
    'Курьерское приложение', 'KDS (экран кухни)', 'Маркетинг-модуль',
    'Дашборд аналитики', 'Бронирование', 'Агрегатор (1 сервис)', 'Все агрегаторы',
    'Курьерские сервисы'],
  currency: ['UZS', 'KZT', 'KGS', 'GEL', 'EUR', 'USD', 'AED'],
  term_months: ['1', '3', '6', '12', '24'],
  discount_pct: ['0', '5', '10', '15', '20'],
  partner_kind: ['Дистрибьютор', 'Агент', 'Реселлер', 'Разовая рекомендация',
    'Технологический партнёр', 'Интегратор'],
  vendor: ['Поставщик касс', 'Поставщик оборудования', 'Курьерская служба',
    'Платёжный провайдер', 'Агрегатор доставки', 'Маркетинговое агентство',
    'Подрядчик по разработке'],
  next_step: ['Позвонить', 'Написать в мессенджер', 'Провести демо', 'Отправить КП',
    'Дожать после КП', 'Встреча', 'Отправить договор', 'Подписать договор',
    'Выставить счёт', 'Напомнить о себе', 'Уточнить у ЛПР'],
}

/**
 * Города по странам. Общий список городов — это каша: в карточке узбекского
 * клиента незачем предлагать Лимассол. Без выбранного региона показываем все,
 * но каждый город остаётся привязан к своей стране.
 */
const CITIES: Record<string, string[]> = {
  uz: ['Ташкент', 'Ташкентская область', 'Самарканд', 'Фергана', 'Андижан', 'Бухара',
    'Наманган', 'Кашкадарья', 'Хорезм', 'Джизак', 'Навои', 'Сурхандарья', 'Сырдарья',
    'Каракалпакстан'],
  kz: ['Алматы', 'Астана', 'Шымкент', 'Караганда', 'Актобе', 'Тараз', 'Павлодар',
    'Усть-Каменогорск', 'Семей', 'Атырау', 'Костанай', 'Кызылорда'],
  kg: ['Бишкек', 'Ош', 'Джалал-Абад', 'Каракол', 'Токмок', 'Нарын', 'Талас', 'Баткен'],
  az: ['Баку', 'Гянджа', 'Сумгаит', 'Мингечевир', 'Ленкорань', 'Шеки', 'Нахичевань'],
  ge: ['Тбилиси', 'Батуми', 'Кутаиси', 'Рустави', 'Гори', 'Зугдиди', 'Поти'],
  cy: ['Лимассол', 'Никосия', 'Ларнака', 'Пафос', 'Айя-Напа', 'Протарас', 'Кирения'],
  ae: ['Дубай', 'Абу-Даби', 'Шарджа', 'Аджман', 'Рас-эль-Хайма', 'Фуджейра', 'Умм-эль-Кайвайн'],
}

/** Страна по коду рынка — для подписи и связки «страна ↔ города». */
export const COUNTRY_BY_MARKET: Record<string, string> = {
  uz: 'Узбекистан', kz: 'Казахстан', kg: 'Кыргызстан', az: 'Азербайджан',
  ge: 'Грузия', cy: 'Кипр', ae: 'ОАЭ',
}

/**
 * Значения одного поля. Город зависит от региона: в списке Узбекистана нет
 * смысла показывать Алматы. Значения без региона общие для всех.
 */
export function optionsFor(refs: SalesRefs | null, field: string, market?: string | null): string[] {
  const fromServer = (refs?.options || [])
    .filter(o => o.field === field && o.is_active !== false)
    .filter(o => !o.market_id || !market || o.market_id === market)
    .map(o => o.label || o.value)
  if (fromServer.length) return fromServer
  if (field === 'city') {
    const code = (market || '').toLowerCase()
    return CITIES[code] || Object.values(CITIES).flat()
  }
  return DEFAULTS[field] || []
}

/** Есть ли у поля справочник вообще — по нему решаем, показывать ли список. */
export function hasOptions(field: string): boolean {
  return field in DEFAULTS
}
