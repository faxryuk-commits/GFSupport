/**
 * Поля сделки: человеческие названия и белый список того, что можно править.
 *
 * Один список на смену этапа (проверка критериев выхода) и на карточку сделки
 * (подписи и редактирование). Разъедутся — и сейлз увидит в блокировке одно
 * название, а в форме другое.
 */

export const FIELD_LABELS: Record<string, string> = {
  city: 'Город',
  points: 'Количество точек',
  orders_per_day: 'Заказов в день',
  pos: 'POS-система',
  aggregators: 'Агрегаторы',
  delivery_type: 'Тип доставки',
  pain: 'Боль клиента',
  segment: 'Тип заведения',
  dm_role: 'Роль ЛПР',
  dm_name: 'ЛПР',
  dm_confirmed: 'ЛПР подтверждён',
  budget_stated: 'Бюджет со слов клиента',
  meeting_at: 'Дата демо',
  next_step: 'Следующий шаг',
  next_step_at: 'Дата следующего шага',
  kp_file: 'Файл КП',
  monthly_amount: 'Сумма подписки в месяц',
  onetime_amount: 'Единоразовые работы',
  valid_till: 'Срок действия КП',
  legal_name: 'Реквизиты',
  start_date: 'Дата старта',
  paid_at: 'Депозит или первый платёж',
  lost_reason_id: 'Причина отказа',
  tariff: 'Тариф',
  discount_pct: 'Скидка, %',
  term_months: 'Срок контракта, мес',
  expected_close_at: 'Ожидаемое закрытие',
  probability: 'Вероятность',
  title: 'Название сделки',
  items: 'Позиции предложения',
}

/** Что разрешено менять через карточку сделки. Этап и владелец — не здесь. */
export const EDITABLE_FIELDS = [
  'title', 'city', 'points', 'orders_per_day', 'pos', 'aggregators', 'delivery_type',
  'segment', 'dm_role',
  'pain', 'dm_name', 'dm_confirmed', 'meeting_at', 'budget_stated', 'tariff',
  'monthly_amount', 'onetime_amount', 'discount_pct', 'term_months', 'valid_till',
  'kp_file', 'legal_name', 'start_date', 'paid_at', 'expected_close_at', 'probability',
  'next_step', 'next_step_at', 'items', 'currency',
] as const

export function isEmptyValue(v: any): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

/** Незаполненные критерии выхода целевого этапа. */
export function missingFields(deal: any, requiredFields: any): Array<{ field: string; label: string }> {
  const required: string[] = Array.isArray(requiredFields) ? requiredFields : []
  return required
    .filter(f => isEmptyValue(deal[f]))
    .map(f => ({ field: f, label: FIELD_LABELS[f] || f }))
}
