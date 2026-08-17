/**
 * Оценка лида (ICP) и маршрутизация.
 *
 * Веса взяты из разбора закрытых сделок: сильнее всего покупку предсказывает
 * наличие POS-системы, затем число филиалов, затем поток заказов. Цифры держим
 * здесь, а не в базе: их меняют редко и осознанно, а история оценок остаётся
 * в sales_leads.icp_reasons — видно, по каким основаниям балл был выставлен.
 */

export interface IcpInput {
  ordersPerDay?: string | number | null
  points?: string | number | null
  pos?: string | null
  aggregators?: string | null
  deliveryType?: string | null
  city?: string | null
  text?: string | null
}

export interface IcpResult {
  score: number
  band: 'green' | 'yellow' | 'red'
  reasons: Array<{ label: string; points: number }>
}

const KNOWN_POS = ['iiko', 'айко', 'jowi', 'жови', 'rkeeper', 'r-keeper', 'ркипер',
  'poster', 'постер', 'syrve', 'сюрв', 'paloma', 'палома', 'clopos', 'клопос',
  // Alisa стоит у 32 клиентов в боевой базе и не распознавалась
  'alisa', 'алиса', 'alipos', '1с', '1c']

const EMPTY_POS = ['нет', 'yo\'q', 'yoq', 'другое', 'other', 'не знаю', '-']

/** Первое число из строки: «30-35», «150 200», «250» → 30 / 150 / 250. */
export function parseFirstNumber(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return 0
  if (typeof raw === 'number') return Math.round(raw)
  let num = ''
  for (const ch of String(raw)) {
    if (ch >= '0' && ch <= '9') num += ch
    else if (num) break
  }
  return num ? parseInt(num, 10) : 0
}

/**
 * Ответ из анкеты — это категория, а не число.
 *
 * Лид-форма предлагает выбрать «1-3», «3-7», «7-15», «15+», и «15+» означает
 * верхний вариант шкалы: у человека может быть и двадцать заказов, и триста.
 * Читать его как ровно пятнадцать и штрафовать за «мало» — значит наказывать
 * клиента за то, что в форме не было варианта крупнее.
 */
function ordersFromAnswer(raw: string): { label: string; points: number } | null {
  const s = raw.trim()
  if (!/^\s*\d+\s*(\+|-|–|—)?\s*\d*\s*$/.test(s)) return null
  const open = /[+]/.test(s)
  const nums = (s.match(/\d+/g) || []).map(Number)
  if (!nums.length) return null
  const top = Math.max(...nums)
  // Верхняя категория шкалы: поток есть, но точного числа мы не знаем —
  // даём умеренный плюс, а не оценку по порогам
  if (open) return { label: `${top}+ заказов/день по анкете`, points: top >= 15 ? 8 : 0 }
  if (top >= 15) return { label: `${nums[0]}–${top} заказов/день по анкете`, points: 2 }
  return { label: `${nums[0]}–${top} заказов/день по анкете`, points: -5 }
}

export function scoreIcp(input: IcpInput): IcpResult {
  const reasons: Array<{ label: string; points: number }> = []
  const add = (label: string, points: number) => { if (points) reasons.push({ label, points }) }

  // POS — сильнейший признак
  const pos = (input.pos || '').toLowerCase().trim()
  if (pos && KNOWN_POS.some(p => pos.includes(p))) add(`POS: ${input.pos}`, 30)
  else if (pos && EMPTY_POS.some(p => pos === p)) add('POS нет или «другое»', -15)

  // Филиалы: сети закрываются заметно лучше одиночных точек
  const points = parseFirstNumber(input.points)
  if (points >= 5) add(`${points} филиалов`, 22)
  else if (points >= 2) add(`${points} филиала`, 15)
  else if (points === 1) add('1 точка', 2)

  // Поток заказов: порог ICP из плейбука — 30 в день.
  // Категорию из анкеты («15+», «3-7») по этим порогам мерить нельзя
  const rawOrders = String(input.ordersPerDay ?? '').trim()
  const fromAnswer = /[+]|[-–—]/.test(rawOrders) ? ordersFromAnswer(rawOrders) : null
  const orders = fromAnswer ? 0 : parseFirstNumber(input.ordersPerDay)
  if (fromAnswer) add(fromAnswer.label, fromAnswer.points)
  if (orders >= 200) add(`${orders} заказов/день`, 25)
  else if (orders >= 100) add(`${orders} заказов/день`, 22)
  else if (orders >= 50) add(`${orders} заказов/день`, 18)
  else if (orders >= 30) add(`${orders} заказов/день`, 12)
  else if (orders > 0) add(`только ${orders} заказов/день`, -10)

  // Контекст: агрегаторы и своя доставка — продавать есть что
  const hay = `${input.aggregators || ''} ${input.deliveryType || ''} ${input.text || ''}`.toLowerCase()
  if (/wolt|yandex|яндекс|uzum|узум|express24|glovo|chocofood|болт|bolt/.test(hay))
    add('работает с агрегаторами', 6)
  if (/свои курьер|своя доставк|курьер|kuryer/.test(hay))
    add('есть своя доставка', 6)

  const score = Math.max(0, Math.min(100, reasons.reduce((a, r) => a + r.points, 0)))

  // Пустой лид — это не плохой лид, а лид без данных: канал прислал только имя
  // и телефон. Отправлять такое в nurture нельзя, иначе живые обращения будут
  // молча теряться. Отсутствие сигналов = общая очередь, разбирается человеком.
  if (reasons.length === 0) {
    return { score: 0, band: 'yellow', reasons: [{ label: 'данных нет — в общую очередь', points: 0 }] }
  }

  // Порог зелёного — 50: сеть с известной кассой (POS 30 + филиалы 22) должна
  // уходить сейлзу сразу, даже когда поток заказов в форме не указан
  const band: IcpResult['band'] = score >= 50 ? 'green' : score >= 20 ? 'yellow' : 'red'
  return { score, band, reasons }
}

/** Первое касание по плейбуку — 15 минут (§2). */
export const FIRST_TOUCH_SLA_MIN = 15

/**
 * Куда лид попадает сразу после приёма.
 * green  — назначаем свободному сейлзу и запускаем таймер
 * yellow — общая очередь, таймер тот же, но без персонального адресата
 * red    — nurture: человек не тратит на него время
 */
export function routeByBand(band: IcpResult['band']): 'assigned' | 'new' | 'nurture' {
  if (band === 'green') return 'assigned'
  if (band === 'yellow') return 'new'
  return 'nurture'
}
