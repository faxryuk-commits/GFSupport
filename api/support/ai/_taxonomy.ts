/**
 * Иерархическая таксономия обращений в поддержку Delever.
 *
 * Верхний уровень — "домен" (10 штук, закрытый список).
 * Второй уровень — "подкатегория" (закрытый список под каждый домен).
 * Третий уровень — "тема" (ai_theme) свободной строкой, её LLM формулирует сам.
 *
 * Источник — текущие значения ai_category в базе (см. analyze.ts) + продуктовый контекст Delever.
 * Первая версия, дерево может расширяться по результатам discovery.
 */

export type DomainKey =
  | 'integrations'
  | 'cashier'
  | 'menu'
  | 'orders'
  | 'delivery'
  | 'payment_billing'
  | 'app'
  | 'onboarding'
  | 'account'
  | 'complaint_feedback'
  | 'info_question'
  | 'feature_request'
  | 'other'

export interface SubcategoryDef {
  key: string
  label: string
  hints: string[] // ключевые слова / фразы, помогающие LLM и regex-fallback
}

export interface DomainDef {
  key: DomainKey
  label: string
  description: string
  subcategories: SubcategoryDef[]
}

export const TAXONOMY: DomainDef[] = [
  {
    key: 'integrations',
    label: 'Интеграции',
    description: 'Интеграции с POS, агрегаторами, платёжными системами и ККТ',
    subcategories: [
      { key: 'pos-iiko', label: 'iiko', hints: ['iiko', 'айко'] },
      { key: 'pos-rkeeper', label: 'R-Keeper', hints: ['r-keeper', 'rkeeper', 'р-кипер'] },
      { key: 'pos-poster', label: 'Poster', hints: ['poster', 'постер'] },
      { key: 'pos-other', label: 'Другая POS', hints: ['pos', 'касса', 'uzkassa', 'atol'] },
      { key: 'aggregator-wolt', label: 'Wolt', hints: ['wolt'] },
      { key: 'aggregator-yandex', label: 'Yandex Eda', hints: ['яндекс', 'yandex', 'yandex eda', 'яндекс еда'] },
      { key: 'aggregator-other', label: 'Другой агрегатор', hints: ['glovo', 'bolt food', 'express24'] },
      { key: 'payment-payme', label: 'Payme', hints: ['payme', 'пайми'] },
      { key: 'payment-click', label: 'Click', hints: ['click', 'клик'] },
      { key: 'payment-other', label: 'Другая оплата', hints: ['uzumpay', 'humo', 'uzcard'] },
      { key: 'fiscal-kkt', label: 'ККТ / Фискальные', hints: ['ккт', 'налоговая', 'фискал', 'uzkassa', 'atol'] },
      { key: 'api-webhook', label: 'API / Webhook', hints: ['api', 'webhook', 'вебхук'] },
    ],
  },
  {
    key: 'cashier',
    label: 'Касса и чеки',
    description: 'Проблемы с печатью чеков, фискализацией, принтерами',
    subcategories: [
      { key: 'receipt-not-printing', label: 'Чек не печатается', hints: ['не печата', 'не выход', 'bosmay', 'chiqmay', 'чкмидми'] },
      { key: 'receipt-wrong-data', label: 'Неверные данные в чеке', hints: ['неправильн', 'неверн', 'boshqa', 'другой чек', 'not\'gri'] },
      { key: 'receipt-wrong-branch', label: 'Чек из другого филиала', hints: ['другой филиал', 'boshqa filial', 'другого филиала'] },
      { key: 'printer-offline', label: 'Принтер не в сети', hints: ['принтер', 'printer', 'не подключ'] },
      { key: 'fiscal-registration', label: 'Фискальная регистрация', hints: ['регистрац', 'налоговой', 'ro\'yxat'] },
    ],
  },
  {
    key: 'menu',
    label: 'Меню',
    description: 'Блюда, цены, стоп-лист, модификаторы',
    subcategories: [
      { key: 'stop-list-sync', label: 'Стоп-лист не синкается', hints: ['стоп-лист', 'stop list', 'стоп лист', 'stop-list'] },
      { key: 'prices-mismatch', label: 'Цены не совпадают', hints: ['цен', 'narx', 'price', 'стоимость не'] },
      { key: 'items-missing', label: 'Блюда отсутствуют', hints: ['нет блюд', 'блюдо не', 'taom', 'пропало'] },
      { key: 'modifiers', label: 'Модификаторы / опции', hints: ['модификатор', 'опция', 'добав'] },
      { key: 'photos-descriptions', label: 'Фото / описания', hints: ['фото блюд', 'описание', 'rasm'] },
    ],
  },
  {
    key: 'orders',
    label: 'Заказы',
    description: 'Приём, статусы, отмены и дубликаты заказов',
    subcategories: [
      { key: 'order-not-arrived', label: 'Заказ не пришёл в систему', hints: ['не поступ', 'не прих', 'kelmay', 'келмаяпти'] },
      { key: 'order-wrong-status', label: 'Неверный статус', hints: ['статус', 'status', 'холодный'] },
      { key: 'order-cancelled', label: 'Отмена заказа', hints: ['отмен', 'cancel', 'bekor'] },
      { key: 'order-duplicate', label: 'Дубликат заказа', hints: ['дублик', 'duplicate', 'повтор', 'ikkita'] },
      { key: 'order-composition', label: 'Неверный состав', hints: ['не те блюда', 'не тот состав', 'noto\'g\'ri'] },
    ],
  },
  {
    key: 'delivery',
    label: 'Доставка',
    description: 'Курьеры, зоны, маршруты, время',
    subcategories: [
      { key: 'courier-late', label: 'Курьер опоздал', hints: ['опозда', 'поздно', 'late', 'kech'] },
      { key: 'courier-missing', label: 'Курьер не пришёл', hints: ['не пришёл курьер', 'no courier', 'yo\'q'] },
      { key: 'courier-behavior', label: 'Поведение курьера', hints: ['грубо', 'хамство', 'rude'] },
      { key: 'zones', label: 'Зоны доставки', hints: ['зона', 'zone', 'mintaqa', 'радиус'] },
      { key: 'routing', label: 'Маршрутизация / расчёт', hints: ['маршрут', 'route', 'yo\'nalish', 'расчёт'] },
    ],
  },
  {
    key: 'payment_billing',
    label: 'Деньги',
    description: 'Оплаты клиентов, возвраты, подписка/тариф',
    subcategories: [
      { key: 'price-discrepancy', label: 'Суммы не совпадают', hints: ['сумма', 'не совпад', 'почему', 'summa', 'narx'] },
      { key: 'payment-fail', label: 'Оплата не прошла', hints: ['не прошла', 'failed payment', 'не проходит'] },
      { key: 'refund', label: 'Возврат', hints: ['возврат', 'refund', 'qaytarish'] },
      { key: 'subscription-billing', label: 'Тариф / подписка', hints: ['тариф', 'подписк', 'billing', 'обиспеч'] },
      { key: 'commission-fees', label: 'Комиссии', hints: ['комисси', 'fee'] },
    ],
  },
  {
    key: 'app',
    label: 'Приложение / ЛК',
    description: 'Мобильное приложение и личный кабинет',
    subcategories: [
      { key: 'login-access', label: 'Вход / доступы', hints: ['вход', 'login', 'доступ', 'пароль'] },
      { key: 'crash-freeze', label: 'Виснет / падает', hints: ['вис', 'краш', 'crash', 'ishlamay', 'qotib'] },
      { key: 'ui-navigation', label: 'Не найти функцию', hints: ['где', 'как найти', 'qayerda', 'не могу найти'] },
      { key: 'performance', label: 'Медленно работает', hints: ['медлен', 'slow', 'зависа', 'sekin'] },
      { key: 'notifications', label: 'Уведомления', hints: ['уведомл', 'notification', 'пуш'] },
    ],
  },
  {
    key: 'onboarding',
    label: 'Онбординг',
    description: 'Новые клиенты: заявка, настройка, обучение',
    subcategories: [
      { key: 'signup', label: 'Заявка на подключение', hints: ['подключ', 'новый клиент', 'ulanish', 'yangi restoran'] },
      { key: 'setup', label: 'Настройка', hints: ['настр', 'setup', 'sozlash'] },
      { key: 'training', label: 'Обучение', hints: ['обуч', 'training', 'как пользов', 'qanday ishlash'] },
      { key: 'activation', label: 'Первые заказы', hints: ['первый заказ', 'активац', 'birinchi buyurtma'] },
    ],
  },
  {
    key: 'account',
    label: 'Аккаунт',
    description: 'Филиалы, сотрудники, права, реквизиты',
    subcategories: [
      { key: 'branches', label: 'Филиалы', hints: ['филиал', 'filial', 'точка', 'branch'] },
      { key: 'staff-access', label: 'Сотрудники / права', hints: ['сотрудник', 'xodim', 'права', 'permission'] },
      { key: 'company-data', label: 'Реквизиты компании', hints: ['реквизит', 'ИНН', 'inn', 'company data'] },
    ],
  },
  {
    key: 'complaint_feedback',
    label: 'Жалобы / обратная связь',
    description: 'Жалобы на продукт, поддержку, невыполненные обещания, угрозы уйти',
    subcategories: [
      { key: 'quality-product', label: 'Качество продукта', hints: ['плохо работает', 'сырой', 'buggy'] },
      { key: 'support-quality', label: 'Качество поддержки', hints: ['не отвечает', 'долго отвеч', 'никто не'] },
      { key: 'broken-promise', label: 'Не выполнили обещанное', hints: ['обещал', 'va\'da', 'не сделал'] },
      { key: 'churn-risk', label: 'Угроза уйти', hints: ['отключ', 'уйдём', 'уходим', 'конкурент', 'uzmay', 'boshqa kompaniya'] },
      { key: 'general-complaint', label: 'Общая жалоба', hints: ['жалоб', 'shikoyat', 'недов'] },
    ],
  },
  {
    key: 'info_question',
    label: 'Вопросы / инфо',
    description: 'Вопросы, не являющиеся проблемами',
    subcategories: [
      { key: 'how-to', label: 'Как пользоваться', hints: ['как', 'qanday', 'how'] },
      { key: 'pricing', label: 'Цены / тариф', hints: ['сколько стоит', 'цена', 'narxi', 'тариф'] },
      { key: 'hours', label: 'График работы', hints: ['время работ', 'график', 'ish vaqti', 'soat'] },
      { key: 'contacts', label: 'Контакты', hints: ['телефон', 'контакт', 'aloqa', 'manzil'] },
      { key: 'status-check', label: 'Проверить статус', hints: ['когда', 'qachon', 'status'] },
    ],
  },
  {
    key: 'feature_request',
    label: 'Пожелания',
    description: 'Запросы новых функций / улучшений. Подкатегории не делим — используем ai_theme свободно',
    subcategories: [
      { key: 'new-feature', label: 'Новая функция', hints: ['хорошо бы', 'добавьте', 'kerak', 'было бы'] },
      { key: 'improvement', label: 'Улучшение текущего', hints: ['улучш', 'yaxshila', 'сделать удобнее'] },
    ],
  },
  {
    key: 'other',
    label: 'Прочее',
    description: 'Не определено или неинформативно (шум)',
    subcategories: [{ key: 'undefined', label: 'Не определено', hints: [] }],
  },
]

// Быстрый поиск/валидация
const DOMAIN_MAP = new Map(TAXONOMY.map((d) => [d.key, d]))
const SUBCATEGORY_TO_DOMAIN = new Map<string, DomainKey>()
for (const d of TAXONOMY) {
  for (const s of d.subcategories) {
    SUBCATEGORY_TO_DOMAIN.set(s.key, d.key)
  }
}

export function isValidDomain(key: string | null | undefined): key is DomainKey {
  return !!key && DOMAIN_MAP.has(key as DomainKey)
}

export function isValidSubcategory(domain: string | null | undefined, sub: string | null | undefined): boolean {
  if (!sub) return false
  const got = SUBCATEGORY_TO_DOMAIN.get(sub)
  if (!got) return false
  return !domain || got === domain
}

export function getDomainForSubcategory(sub: string | null | undefined): DomainKey | null {
  if (!sub) return null
  return SUBCATEGORY_TO_DOMAIN.get(sub) || null
}

export function getDomain(key: string | null | undefined): DomainDef | null {
  if (!key) return null
  return DOMAIN_MAP.get(key as DomainKey) || null
}

/**
 * Маппинг legacy ai_category (13 старых значений из analyze.ts) в новые домены.
 * Используется в бекфилле и как fallback, если LLM ещё не проставил ai_domain.
 */
export const LEGACY_CATEGORY_TO_DOMAIN: Record<string, DomainKey> = {
  technical: 'app',
  integration: 'integrations',
  billing: 'payment_billing',
  complaint: 'complaint_feedback',
  feature_request: 'feature_request',
  order: 'orders',
  delivery: 'delivery',
  menu: 'menu',
  app: 'app',
  onboarding: 'onboarding',
  question: 'info_question',
  feedback: 'complaint_feedback',
  general: 'other',
}

/**
 * Компактное текстовое представление таксономии для промпта LLM.
 * Возвращаем именно ключи (на английском) — LLM будет выбирать их буквально.
 */
export function taxonomyPromptBlock(): string {
  const lines: string[] = []
  for (const d of TAXONOMY) {
    lines.push(`- ${d.key} (${d.label}): ${d.description}`)
    for (const s of d.subcategories) {
      lines.push(`    • ${s.key} — ${s.label}`)
    }
  }
  return lines.join('\n')
}

/**
 * Дефолтная подкатегория домена — когда домен понятен, а под ним ничего не подошло.
 * Берём первую объявленную либо 'undefined' для other.
 */
export function defaultSubcategory(domain: DomainKey): string {
  const d = DOMAIN_MAP.get(domain)
  if (!d || d.subcategories.length === 0) return 'undefined'
  return d.subcategories[0].key
}
