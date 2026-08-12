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
  'alipos', '1с', '1c']

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

  // Поток заказов: порог ICP из плейбука — 30 в день
  const orders = parseFirstNumber(input.ordersPerDay)
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
