/**
 * Сопоставление имён ПланФакта и CRM.
 *
 * В ПланФакте клиент — это юрлицо латиницей («"RIZO-LINE" MCHJ»), в CRM —
 * бренд как его знает сейлз («Ризо Лайн»). Ни одна сторона не совпадает
 * с другой буквально, поэтому имена приводятся к общему виду: без кавычек,
 * без организационно-правовых форм, целиком в латинице.
 *
 * Живёт отдельным файлом, потому что этим пользуются двое: разбор поступлений
 * в KPI и ночная сверка ручных вводов с ПланФактом. Копия во втором месте
 * разошлась бы с первой при первой же правке.
 */

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

export function normName(s: string): string {
  const base = String(s || '')
    .toLowerCase()
    .replace(/["'«»“”„()]/g, ' ')
    .replace(/\b(ооо|оoo|мчж|mchj|xk|ип|тоо|яттб|llc|ltd|inc|co)\b/g, ' ')
    .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // В ПланФакте латиница, в CRM кириллица (и наоборот): сводим всё к латинице,
  // иначе «SYROVARNYA» никогда не встретит «Сыроварню»
  return base.replace(/[а-яё]/g, ch => TRANSLIT[ch] ?? ch)
}

/** Заглушки вместо имени клиента — в сопоставление не идут. */
export const NOISE_NAMES = new Set(['физ лицо', 'физлицо', 'не выбран', 'не выбрано'])

/**
 * Ключ клиента для истории платежей: статья (бренд) надёжнее контрагента —
 * юрлица у франшиз разные, а бренд один. Контрагент — запасной вариант.
 */
export function clientKeyOf(contragent?: string | null, category?: string | null): string {
  const cat = normName(category || '')
  if (cat.length >= 3 && !NOISE_NAMES.has(cat) && cat !== 'okazanie uslug') return cat
  const ca = normName(contragent || '')
  if (ca.length >= 3 && !NOISE_NAMES.has(ca)) return ca
  return ''
}

/**
 * Насколько похожи два набора имён: 100 — точное совпадение, 60 — одно имя
 * содержится в другом, 0 — не похожи. Короткие куски не сравниваем: «osh»
 * встречается в половине названий и совпал бы со всем подряд.
 */
export function nameScore(
  signals: Array<string | null | undefined>,
  names: Array<string | null | undefined>,
): number {
  const targets = signals
    .map(s => normName(s || ''))
    .filter(t => t.length >= 3 && !NOISE_NAMES.has(t))
  if (!targets.length) return 0
  let score = 0
  for (const raw of names) {
    const n = normName(raw || '')
    if (!n || n.length < 3) continue
    for (const t of targets) {
      if (n === t) score = Math.max(score, 100)
      else if (t.length >= 5 && n.length >= 5 && (n.includes(t) || t.includes(n))) score = Math.max(score, 60)
    }
  }
  return score
}
