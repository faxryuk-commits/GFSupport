/**
 * Ответы рекламной формы → поля квалификации в нашем словаре.
 *
 * Meta-форма спрашивает четыре вещи: направление заведения, есть ли доставка,
 * сколько доставок в день, какая услуга интересует. Ответы приезжали в CRM
 * как есть — «15+», «ha bor», «fast food» — и никуда не ложились: в карточке
 * обращения они висели текстом, а сделка, заведённая с доски, получала пустые
 * поля квалификации. Сейлз переспрашивал по телефону то, что человек уже
 * написал, или оставлял поля пустыми (из 31 сделки с Meta заполнено 10–12).
 *
 * Здесь ответы переводятся в значения, которые знают селекты сделки
 * (`sales_field_options`). Правило переводов — консервативное: там, где ответ
 * не даёт уверенности («есть доставка» — какая?), поле не трогаем, а суть
 * кладём в текст и в боль. Лучше пусто, чем уверенно неверно.
 *
 * Сырые ответы сохраняются рядом (`answers`): карточка показывает их как слова
 * человека, а не как наш домысел.
 */

export interface QualPatch {
  orders_per_day?: string
  delivery_type?: string
  aggregators?: string
  segment?: string
  pain?: string
  interest?: string
  /** Сырые ответы формы, как их дал человек. */
  answers?: Record<string, string>
}

/** Число заказов в день → корзина селекта сделки. */
export function ordersBucket(raw: string | number | null | undefined): string | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return null
  // Уже наше значение — оставляем
  const ours = ['до 10', '10-30', '30-50', '50-100', '100-300', 'больше 300']
  const exact = ours.find(o => o.replace(/\s+/g, '') === s)
  if (exact) return exact
  // Диапазон анкеты или произвольная запись: «15+», «3-7», «10-15», «40»
  const nums = s.match(/\d+/g)?.map(Number) || []
  if (!nums.length) return null
  // «15+» — нижняя граница известна, верхняя нет: считаем по нижней
  const plus = /\+$/.test(s)
  const value = plus || nums.length === 1 ? nums[0] : (nums[0] + nums[1]) / 2
  if (value >= 300) return 'больше 300'
  if (value >= 100) return '100-300'
  if (value >= 50) return '50-100'
  if (value >= 30) return '30-50'
  if (value >= 10) return '10-30'
  return 'до 10'
}

const INTEREST: Record<string, string> = {
  telegram_bot: 'Telegram-бот заказов',
  'telegram-бот': 'Telegram-бот заказов',
  restoran_uchun_maxsus_ilova: 'Приложение для ресторана',
  'мобильное_приложение_для_ресторана': 'Приложение для ресторана',
  pos_sistema: 'POS-система',
  'pos-система': 'POS-система',
  qr_menu: 'QR-меню',
  'qr-меню': 'QR-меню',
}

const CUISINE: Record<string, string> = {
  milliy_taom: 'национальная кухня',
  '_национальная_кухня': 'национальная кухня',
  xorijiy_taomlar: 'международная кухня',
  'международная_кухня': 'международная кухня',
  fast_food: 'фастфуд',
  '_fast_food': 'фастфуд',
  "boshqa_yo'nalish": 'другое направление',
  'другая_кухня': 'другое направление',
}

/**
 * Что человек ответил на вопросы формы. Названия вопросов сверены с боевыми
 * формами Meta (uz и kz): узбекские и русские версии одного вопроса
 * узнаются одним правилом.
 */
export function qualFromAnswers(fields?: Array<{ name: string; value: string }> | null): QualPatch {
  const out: QualPatch = {}
  const answers: Record<string, string> = {}
  const pains: string[] = []
  for (const f of fields || []) {
    const q = String(f?.name || '').toLowerCase()
    const v = String(f?.value ?? '').trim()
    if (!v) continue
    const key = v.toLowerCase()

    // Сколько доставок в день
    if ((/nechta|necha|qancha/.test(q) && /dostavka|buyurtma|zakaz/.test(q)) || /сколько.*(заказ|доставок)|заказов в день/.test(q)) {
      answers.orders_per_day = v
      const b = ordersBucket(v)
      if (b) out.orders_per_day = b
      continue
    }
    // Есть ли доставка сейчас — ответы смешивают состояние и боль
    if (/dostavka\s*bor|есть ли.*доставк/.test(q)) {
      answers.delivery = v
      if (key === "kuryer_yo'q" || key === 'kuryer_yoq' || key === 'online_sotuv_kanali_yo\'q' || key === 'online_sotuv_kanali_yoq') {
        out.delivery_type = 'Доставки нет'
      } else if (key === 'yandex_va_uzum_platforma_ulanmagan') {
        out.aggregators = 'Не работает с агрегаторами'
        pains.push('не подключены к Яндекс и Uzum')
      } else if (key === 'zakaz_qabul_qilishda_muammo') {
        pains.push('проблемы с приёмом заказов')
      } else if (key === 'qisman_ishlaydi') {
        pains.push('доставка работает частично')
      }
      // «ha bor» — доставка есть, но какая — неизвестно: поле не трогаем
      continue
    }
    // Направление заведения: в наш словарь надёжно ложится только фастфуд
    if (/yonalish|yo'nalish|направлен|кухн/.test(q)) {
      answers.cuisine = CUISINE[key] || v.replace(/_/g, ' ')
      if (/fast_food|фастфуд/.test(key)) out.segment = 'Фастфуд'
      continue
    }
    // Какая услуга интересует
    if (/xizmat|услуг|интересует/.test(q)) {
      answers.interest = INTEREST[key] || v.replace(/_/g, ' ')
      out.interest = answers.interest
      continue
    }
  }
  if (pains.length) out.pain = pains.join('; ')
  if (Object.keys(answers).length) out.answers = answers
  return out
}

/** Короткая строка «что человек сказал» — для текста обращения и карточки. */
export function answersSummary(patch: QualPatch): string | null {
  const a = patch.answers
  if (!a) return null
  const parts: string[] = []
  if (a.interest) parts.push(`Интересует: ${a.interest}`)
  if (a.orders_per_day) parts.push(`Доставок в день: ${a.orders_per_day}`)
  if (a.cuisine) parts.push(`Кухня: ${a.cuisine}`)
  if (a.delivery) parts.push(`Доставка сейчас: ${a.delivery.replace(/_/g, ' ')}`)
  return parts.length ? parts.join(' · ') : null
}
