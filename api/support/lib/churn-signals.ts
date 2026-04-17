/**
 * Словарь триггер-фраз риска ухода клиента (churn risk).
 * Используется на лету в аналитике /health — сканируем текст последних N дней
 * клиентских сообщений и ищем совпадения.
 *
 * ВАЖНО: паттерны должны быть узкими, чтобы не ловить нейтральные упоминания.
 * Например "отключить уведомления" — не churn. "отключимся от вас" — churn.
 */

export interface ChurnSignalMatch {
  phrase: string
  severity: 'high' | 'medium' | 'low'
  category: 'leaving' | 'competitor' | 'disappointed' | 'refund'
}

interface ChurnPattern {
  /** Регулярка, буквально применяется с флагом i */
  pattern: RegExp
  severity: ChurnSignalMatch['severity']
  category: ChurnSignalMatch['category']
  /** Человекочитаемое имя сигнала для отображения */
  phrase: string
}

/**
 * Сборник паттернов. Язык: ru, uz-latin, uz-cyrillic, en.
 * Разбиваем по смыслу, чтобы в UI можно было показать причину риска.
 */
export const CHURN_PATTERNS: ChurnPattern[] = [
  // === LEAVING: прямые угрозы отключиться / уйти ===
  { phrase: 'отключимся', category: 'leaving', severity: 'high', pattern: /\b(отключ(им(ся|ся\s*от\s*вас|ся\s*от\s*сервиса)?|аемся))\b/i },
  { phrase: 'уходим', category: 'leaving', severity: 'high', pattern: /\b(уход(им|ить|ят)|уйд(ём|ем|у)|ухожу)\b/i },
  { phrase: 'расторг', category: 'leaving', severity: 'high', pattern: /\bрасторг(ну(ть|ем)|аем|ать)?\s*(договор|контракт|сотруднич)/i },
  { phrase: 'отменяем договор', category: 'leaving', severity: 'high', pattern: /\bотмен(ить|яем)\s*(договор|контракт|подписк|сотруднич)/i },
  { phrase: 'больше не работаем', category: 'leaving', severity: 'high', pattern: /\bбольше\s*не\s*работае(м|т)\b|\bне\s*хотим\s*работать\b/i },
  { phrase: 'откажемся', category: 'leaving', severity: 'medium', pattern: /\bоткаж(ем(ся)?|усь)\b/i },

  // Узбекский латинский
  { phrase: 'uzamiz', category: 'leaving', severity: 'high', pattern: /\buz(amiz|ib\s*qo'yamiz|ib\s*ketamiz|maymiz)\b/i },
  { phrase: 'boshqa kompaniya', category: 'leaving', severity: 'high', pattern: /\bboshqa\s+(kompaniya|xizmat|servis)(ga|da)\b/i },
  { phrase: 'hamkorlik tugadi', category: 'leaving', severity: 'high', pattern: /\bhamkorlik(ni)?\s*(tugat|bekor|to'xta)/i },
  { phrase: 'ishlamaymiz', category: 'leaving', severity: 'high', pattern: /\bbunday\s+ishla(ma|may)\b|\bsiz\s*bilan\s*ishlam(ay|ai)/i },

  // Узбекский кириллический
  { phrase: 'узамиз', category: 'leaving', severity: 'high', pattern: /\bуз(амиз|иб\s*қўямиз|иб\s*кетамиз|маймиз)\b/i },
  { phrase: 'бошқа компания', category: 'leaving', severity: 'high', pattern: /\bбошқа\s+(компания|хизмат|сервис)(га|да)\b/i },

  // English
  { phrase: 'will cancel', category: 'leaving', severity: 'high', pattern: /\b(cancel|terminate|end)\s+(our|the)\s+(subscription|contract|partnership)\b/i },
  { phrase: 'leaving service', category: 'leaving', severity: 'high', pattern: /\b(leaving|quit|stop\s+using)\s+(your|this|the)\s+(service|platform|system)\b/i },

  // === COMPETITOR: упоминают конкурентов ===
  { phrase: 'конкуренты', category: 'competitor', severity: 'medium', pattern: /\bконкурент(ы|ов|а)\b/i },
  { phrase: 'перейдём на', category: 'competitor', severity: 'high', pattern: /\bперейд(ём|ем|у|ут)\s*(на|к)\s*\S+/i },
  { phrase: 'у них лучше', category: 'competitor', severity: 'medium', pattern: /\bу\s+(них|конкурент)\s+(лучше|дешевле|удобне)/i },

  // Uzbek
  { phrase: 'boshqa-platforma', category: 'competitor', severity: 'medium', pattern: /\brakobat|raqobat|konkurent/i },

  // === DISAPPOINTED: устали, разочаровались, нет улучшений ===
  { phrase: 'устали от', category: 'disappointed', severity: 'medium', pattern: /\bустал(и|а)\s+(от|ждать|терпеть)\b/i },
  { phrase: 'терпение кончилось', category: 'disappointed', severity: 'high', pattern: /\bтерпени(е|я)\s*(кончил|закончил|лопнул)/i },
  { phrase: 'в последний раз', category: 'disappointed', severity: 'high', pattern: /\bв\s+последний\s+раз\s*(говорю|прош|повтор)/i },
  { phrase: 'никто не решает', category: 'disappointed', severity: 'medium', pattern: /\bникто\s*не\s*(реша|отвеча|помога)/i },
  { phrase: 'сколько можно', category: 'disappointed', severity: 'medium', pattern: /\bсколько\s*можно\b/i },

  // Uzbek
  { phrase: 'hal qilinmaydi', category: 'disappointed', severity: 'medium', pattern: /\bhal\s*(qilinmay|bo'lma)\b/i },
  { phrase: 'kutib toliqdim', category: 'disappointed', severity: 'medium', pattern: /\bkutib\s*(toli|charch|ket)/i },

  // === REFUND: просят возврат / перерасчёт как форма недовольства ===
  { phrase: 'верните деньги', category: 'refund', severity: 'high', pattern: /\bверн(уть|ите|ём)\s*(деньг|средств|платёж)/i },
  { phrase: 'возврат средств', category: 'refund', severity: 'high', pattern: /\bвозврат\s*(денег|средств|оплат)\b/i },
  { phrase: 'pulni qaytar', category: 'refund', severity: 'high', pattern: /\bpulni\s*qaytar|\bto'lovni\s*qaytar/i },
]

/**
 * Ищет все матчи churn-паттернов в тексте.
 * Короткие тексты (< 8 символов) и явные greetings — пропускаем на уровне выборки, не здесь.
 */
export function detectChurnSignals(text: string | null | undefined): ChurnSignalMatch[] {
  if (!text) return []
  const str = String(text)
  if (str.length < 4) return []

  const matches: ChurnSignalMatch[] = []
  const seen = new Set<string>()
  for (const p of CHURN_PATTERNS) {
    if (p.pattern.test(str)) {
      const key = `${p.category}:${p.phrase}`
      if (!seen.has(key)) {
        seen.add(key)
        matches.push({ phrase: p.phrase, severity: p.severity, category: p.category })
      }
    }
  }
  return matches
}

/**
 * Возвращает единую оценку серьёзности: берём максимум из найденных.
 */
export function churnScore(matches: ChurnSignalMatch[]): number {
  if (matches.length === 0) return 0
  let max = 0
  for (const m of matches) {
    const v = m.severity === 'high' ? 90 : m.severity === 'medium' ? 60 : 30
    if (v > max) max = v
  }
  return max
}

/**
 * Компактный SQL-friendly regex-паттерн для pre-фильтрации на уровне БД (ILIKE ANY).
 * Возвращаем массив паттернов, чтобы использовать в WHERE ... ~* ANY(...).
 * Тут только самые "чёрные" слова — чтобы не гонять весь массив регексов по БД.
 */
export const CHURN_SQL_KEYWORDS: string[] = [
  'отключ', 'уходим', 'уйдём', 'уйдем', 'расторг', 'отмен.*договор',
  'конкурент', 'перейд.*на', 'верн.*деньг', 'возврат.*средств',
  'uzamiz', 'boshqa\\s+kompaniya', 'hamkorlik.*tugat', 'raqobat',
  'узамиз', 'бошқа\\s+компания', 'рахкобат',
  'cancel.*(subscription|contract|partnership)',
  'leaving.*(service|platform)',
]
