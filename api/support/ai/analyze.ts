import OpenAI from 'openai'
import { getOpenAIKey, getSQL, json } from '../lib/db.js'
import { getRequestOrgId } from '../lib/org.js'
import { ensureTaxonomyColumns } from '../lib/ensure-taxonomy.js'
import {
  TAXONOMY,
  isValidDomain,
  isValidSubcategory,
  getDomainForSubcategory,
  LEGACY_CATEGORY_TO_DOMAIN,
  taxonomyPromptBlock,
  type DomainKey,
} from './taxonomy.js'

export const config = {
  runtime: 'edge',
  regions: ['iad1'],
}

// AI analysis prompt
const ANALYSIS_PROMPT = `Ты анализатор сообщений службы поддержки Delever (платформа для ресторанов и доставки в Узбекистане и Казахстане).
ВАЖНО: Ты понимаешь русский, узбекский (на латинице и кириллице) и английский языки.

Узбекские слова-индикаторы проблем:
- muammo, xatolik, nosozlik, buzilgan = проблема
- ishlamayapti, ishlamaydi = не работает
- yordam, ko'mak = помощь
- tez, shoshilinch = срочно

Таксономия обращений (выбирай ключи строго из этого списка):
${taxonomyPromptBlock()}

Анализируй сообщение и верни ТОЛЬКО JSON без markdown:
{
  "category": "одно из: technical, integration, billing, complaint, feature_request, order, delivery, menu, app, onboarding, question, feedback, general",
  "domain": "один из ключей верхнего уровня из таксономии (integrations/cashier/menu/orders/delivery/payment_billing/app/onboarding/account/complaint_feedback/info_question/feature_request/other)",
  "subcategory": "ключ подкатегории ИЗ выбранного domain (например pos-iiko, receipt-not-printing). Если ничего не подходит — пустая строка",
  "theme": "краткая формулировка конкретной темы сообщения одной строкой на русском (например: 'чеки не печатаются после обновления iiko'). Нужно для поиска рецидивов",
  "tags": ["2-4 кратких тега-маркера", "например: iiko, печать-чеков, срочно"],
  "sentiment": "одно из: positive, neutral, negative, frustrated",
  "intent": "одно из: greeting, gratitude, closing, faq_pricing, faq_hours, faq_contacts, ask_question, report_problem, request_feature, complaint, information, response, unknown",
  "urgency": число от 0 до 5 (0 = не срочно, 5 = критично),
  "isProblem": true или false,
  "needsResponse": true или false,
  "autoReplyAllowed": true или false (можно ли ответить автоматически без оператора),
  "summary": "краткое резюме на русском (1-2 предложения)",
  "entities": {
    "product": "название продукта если упоминается",
    "error": "описание ошибки если есть",
    "integration": "название интеграции если упоминается"
  }
}

Правила определения intent:
- greeting = приветствие клиента ("здравствуйте", "привет", "добрый день", "salom")
- gratitude = благодарность ("спасибо", "благодарю", "rahmat", "отлично помогли")
- closing = завершение диалога ("до свидания", "пока", "всего доброго")
- faq_pricing = вопрос о ценах, тарифах, стоимости
- faq_hours = вопрос о графике работы, времени
- faq_contacts = запрос контактов, телефона, адреса
- ask_question = общий вопрос
- report_problem = сообщение о проблеме
- request_feature = запрос новой функции
- complaint = жалоба
- response = ответ на вопрос оператора
- information = информирование

Правила autoReplyAllowed:
- true для: greeting, gratitude, closing, faq_pricing, faq_hours, faq_contacts
- false для: report_problem, complaint, request_feature, сложных вопросов

Правила needsResponse:
- true если сообщение требует ответа (вопрос, проблема, запрос)
- false если это благодарность, подтверждение ("ок", "понял", "спасибо"), closing

Отвечай ТОЛЬКО JSON, без markdown блоков.`

export interface AnalysisResult {
  category: string
  sentiment: string
  intent: string
  urgency: number
  isProblem: boolean
  needsResponse: boolean
  autoReplyAllowed: boolean
  summary: string
  entities: Record<string, string>
  // Новая таксономия (domain → subcategory → theme + tags)
  domain: DomainKey
  subcategory: string | null
  theme: string | null
  tags: string[]
}

// Simple intents that can be detected without AI (for performance)
const SIMPLE_INTENT_PATTERNS: Array<{ pattern: RegExp; intent: string; autoReply: boolean }> = [
  // Greetings (Russian + Uzbek Latin + Uzbek Cyrillic) - use \s+ for spaces
  { pattern: /^(здравствуйте|привет|добрый\s+день|добрый\s+вечер|добрый\s+утро|salom|assalomu\s+alaykum|assalom\s+alaykum|assalomu|assalom|hi|hello|приветствую|салом|ассалому\s+алайкум|ассалом\s+алайкум)[\s!.,]*$/i, intent: 'greeting', autoReply: true },
  
  // Gratitude (Russian + Uzbek)
  { pattern: /^(спасибо|благодар|rahmat|raxmat|thanks|thank you|отлично|супер|класс|молодцы?|рахмат|катта рахмат|katta rahmat)[\s!.,]*$/i, intent: 'gratitude', autoReply: true },
  
  // Closing (Russian + Uzbek)
  { pattern: /^(до свидания|пока|всего доброго|xayr|hayr|xo'?sh|хайр|хуш|goodbye|bye|удачи|ko'rishguncha|кўришгунча)[\s!.,]*$/i, intent: 'closing', autoReply: true },
  
  // Short confirmations (no response needed) - Russian + Uzbek
  { pattern: /^(ок|ok|хорошо|понял|понятно|ясно|да|нет|угу|ага|👍|👌|✅|🙏|принято|отлично|yaxshi|яхши|ha|xa|yo'q|йўқ|tushundim|тушундим|bo'ldi|бўлди|mayli|майли)[\s!.,]*$/i, intent: 'response', autoReply: false },
  
  // FAQ - pricing (Russian + Uzbek)
  { pattern: /(сколько стоит|какая цена|тариф|стоимость|прайс|narxi|qancha|qancha turadi|price|нархи|қанча|канча туради)/i, intent: 'faq_pricing', autoReply: true },
  
  // FAQ - hours (Russian + Uzbek)
  { pattern: /(время работы|график|рабочие часы|когда работаете|working hours|soat|ish vaqti|qachon ishlaysiz|иш вақти|соат|качон ишлайсиз)/i, intent: 'faq_hours', autoReply: true },
  
  // FAQ - contacts (Russian + Uzbek)
  { pattern: /(телефон|контакт|адрес|как связаться|номер|manzil|telefon|contact|aloqa|bog'lanish|манзил|алоқа|боғланиш)/i, intent: 'faq_contacts', autoReply: true },
]

// Quick detection of simple intents without AI
function detectSimpleIntent(text: string): { intent: string; autoReply: boolean } | null {
  const trimmed = text.trim()
  for (const { pattern, intent, autoReply } of SIMPLE_INTENT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { intent, autoReply }
    }
  }
  return null
}

// Check if text is positive feedback (resolved confirmation)
function isPositiveFeedback(text: string): boolean {
  const lower = text.toLowerCase()
  // Russian
  if (/\b(да|решен|решено|решена|все\s+ок|всё\s+ок|хорошо|спасибо|работает|заработало|помогло|норм|отлично|супер|класс|ок|все\s+хорошо|всё\s+хорошо|получилось)\b/i.test(lower)) {
    return true
  }
  // Uzbek
  // Uzbek Latin - based on real messages: "ishladi", "rahmat", "boldi", "hop", "xop"
  if (/\b(ha|yaxshi|rahmat|raxmat|ishladi|ishlaypti|ishlayapti|bo'ldi|boldi|yechildi|yordam\s+berdi|zo'r|zor|hop|xop|tushunarli|ajoyib)\b/i.test(lower)) {
    return true
  }
  // Uzbek Cyrillic - based on real messages
  if (/\b(ҳа|яхши|раҳмат|рахмат|ишлади|ишлаяпти|бўлди|ечилди|зўр|хоп|тушунарли|ажойиб)\b/i.test(lower)) {
    return true
  }
  // English
  if (/\b(yes|resolved|works|working|fixed|thanks|thank\s+you|great|good|ok|okay|perfect|awesome|done)\b/i.test(lower)) {
    return true
  }
  // Emoji positive
  if (/[👍✅👌💯🎉🙏🤝]/u.test(text)) {
    return true
  }
  return false
}

// Check if text is negative feedback (not resolved)
function isNegativeFeedback(text: string): boolean {
  const lower = text.toLowerCase()
  // Russian
  if (/\b(нет|не\s+решен|не\s+работает|не\s+помогло|всё\s+ещё|все\s+еще|проблема|ошибка|опять|снова|не\s+так|не\s+то)\b/i.test(lower)) {
    return true
  }
  // Uzbek  
  if (/\b(yoq|yo'q|ishlamaydi|hal\s+bo'lmadi|muammo|xato|yana)\b/i.test(lower)) {
    return true
  }
  // English
  if (/\b(no|not\s+resolved|not\s+working|still|problem|error|issue|again|doesn't\s+work|didn't\s+help)\b/i.test(lower)) {
    return true
  }
  // Emoji negative
  if (/[👎❌😞😤]/u.test(text)) {
    return true
  }
  return false
}

// Fallback analysis without AI
function analyzeWithoutAI(text: string): AnalysisResult {
  const lower = text.toLowerCase()
  
  // First, check for simple intents (fast path, no AI needed)
  const simpleIntent = detectSimpleIntent(text)
  
  // =========== STEP 1: Determine all problem patterns first ===========
  // These need to be defined before category determination

  // Determine if problem - expanded patterns for ru/uz/en
  // Based on real message analysis from support channels
  
  // Russian patterns
  const ruProblem = /не работа|не поступа|не прихо|не отобража|не загруж|не открыва|не сохран|не отправ|не получа|не видн|не могу|не удаётся|не удается|не печата|не выход|ошибк|ошибка|error|проблем|сломал|баг|bug|глючит|виснет|зависа|crash|доступа\s*нет/i.test(lower)
  
  // Uzbek patterns (Latin + Cyrillic mixed, common in chat)
  // Includes negative verb forms: -may, -madi, -maydi, -maypti, -midmi, -mayapti
  // Real patterns from messages: urilmayapti, tushmayapti, chiqmayapti, yopilmagan, aktualmas
  const uzProblem = /ishlamay|ishlamaydi|ishlamaypti|ishlamayapti|xato|xatolik|muammo|buzilgan|buzildi|kelmay|kelmaypti|kelmayapti|yoq|yo'q|chiqmay|chiqmadi|chiqmaypti|chiqmayapti|o'zgarmay|uzgarmay|bosmay|bosmaydi|bosmayapti|chiqmidmi|urilmay|urilmayapti|tushmay|tushmayapti|yopilmay|yopilmagan|aktualmas|oshibka|hatolik|узгармидми|чкмидми|чкмади|чиқмади|ишламай|ишламаяпти|ишламайапти|хато|хатолик|муаммо|бузилган|келмай|келмаяпти|йўқ|ёқ|чиқмай|чиқмаяпти|тўғри\s*эмас|нотўғри|togri\s*emas|notogri|boshqa.*chiq|урилмаяпти|тушмаяпти|йопилмаган|актуалмас|ошибка/i.test(lower)
  
  // Check for "lekin" (but) pattern - often indicates problem context  
  // Also check for "бошқа" (boshqa = another/different) which indicates wrong result
  const hasLekinProblem = /лекн|лекин|lekin|lekn|аммо|ammo|бирок|birok|faqat|факат/i.test(lower) && /чек|chek|филиал|filial|заказ|zakaz|buyurtma|регион|region|skidka|скидка|zakaz|заказ/i.test(lower)
  
  // "boshqa" (another) pattern - e.g. "check from another branch"
  const hasBoshqaProblem = /бошқа|boshqa|другой|другого|другим/i.test(lower) && /чек|chek|филиал|filial|чиқ|chiq|выход/i.test(lower)
  
  // Check for error messages/JSON errors
  const hasErrorMessage = /invalid|bad_request|exception|failed|error.*response|response.*error|correlationid/i.test(lower)
  
  // English patterns
  const enProblem = /doesn't work|not working|broken|failed|error|issue|problem|bug|crash|not\s*included|access\s*denied/i.test(lower)
  
  // =========== NEW: Billing/Payment complaint patterns ===========
  // Жалобы на несоответствие суммы, цены, оплаты
  // Patterns like: "почему 175 если оплата 170", "сумма не совпадает", "неправильная цена"
  
  // Pattern: question about price/sum discrepancy "как за X если Y", "почему X а не Y"
  const hasPriceDiscrepancy = /как\s+(за|так|это)\s*\d+.*если.*\d+|почему\s+\d+.*если.*\d+|почему\s+\d+.*а\s+не\s+\d+|\d+\s+(а|но|если)\s+(оплат|заказ|сумм|чек).*\d+/i.test(lower)
  
  // Pattern: explicit billing complaints
  const hasBillingComplaint = /неправильн\w*\s*(сумм|цен|оплат|счёт|счет)|сумм\w*\s*(не\s*(совпад|соответств|та\b)|неправильн|лишн)|цен\w*\s*(не\s*та|другая|неправильн)|оплат\w*\s*(не\s*(та|совпад|прош)|неправильн|лишн)|переплат|недоплат|разниц\w*\s*(в\s*)?(сумм|цен)/i.test(lower)
  
  // Pattern: questions about money/price issues (why, how come, etc)
  const hasMoneyQuestion = /(почему|зачем|как\s+так|откуда|с\s+чего)\s*.{0,20}(больше|меньше|дороже|дешевле|сумм|цен|оплат|денег|деньг)/i.test(lower)
  
  // Pattern: Uzbek billing complaints
  const uzBillingProblem = /narx\w*\s*(xato|noto'g'ri|boshqa)|summa\s*(xato|noto'g'ri|mos\s*kel)|to'lov\s*(xato|noto'g'ri)|nega\s+\d+.*\d+|qanday\s+qilib\s+\d+/i.test(lower)
  
  // Combined billing problem
  const isBillingProblem = hasPriceDiscrepancy || hasBillingComplaint || hasMoneyQuestion || uzBillingProblem
  
  // Onboarding requests - these are important leads, treat as actionable items
  const isOnboardingRequest = /подключ|подключить|регистрац|зарегистр|новый клиент|новое заведен|хотим работать|хочу работать|начать работ|присоединить|сотруднича|ulanish|ro'yxatdan|yangi restoran|yangi mijoz|ishlay boshla|hamkorlik/i.test(lower)
  
  // Media that likely shows a problem (screenshot, video of issue)
  const isMediaProblem = /фото|скриншот|screenshot|видео|video|демонстрац|показыва|смотрите|посмотрите|вот|rasm|surat|ko'ring|qarang/i.test(lower)
  
  // Question-complaints: questions that imply dissatisfaction or problem
  // "А как за...", "А почему...", "А зачем...", "Как так..." with numbers or order/payment context
  const isQuestionComplaint = /^(а\s+)?(как\s+(за|так|это)|почему|зачем|откуда|с\s+чего)/i.test(lower) && 
    (/\d+.*\d+|\d+.*если|оплат|сумм|цен|заказ|чек|денег|деньг/i.test(lower))
  
  const isProblem = ruProblem || uzProblem || hasLekinProblem || hasBoshqaProblem || hasErrorMessage || enProblem || isOnboardingRequest || isMediaProblem || isBillingProblem || isQuestionComplaint

  // =========== STEP 2: Determine category (using problem patterns) ===========
  let category = 'general'
  
  // PRIORITY 1: Onboarding/New client requests (заявки на подключение)
  if (isOnboardingRequest) {
    category = 'onboarding'
  }
  // PRIORITY 2: Billing/Payment issues (жалобы на оплату, суммы)
  else if (isBillingProblem || /оплат|счёт|счет|деньг|pul|tolov|тариф|подписк/i.test(lower)) {
    category = 'billing'
  }
  // PRIORITY 3: Question-complaints (вопросы-жалобы)
  else if (isQuestionComplaint || /жалоб|недовол|плохо|ужас|shikoyat|хамств/i.test(lower)) {
    category = 'complaint'
  }
  // PRIORITY 4: Technical errors
  else if (/ошибк|error|не работа|не поступа|не прихо|не загруж|сломал|баг|bug|xato|xatolik|глючит|виснет|crash|ishlamay|buzilgan|чкмидми|chiqmay|bosmay|узгармидми|o'zgarmay/i.test(lower)) {
    category = 'technical'
  } else if (/интеграц|api|webhook|iiko|r-keeper|poster|wolt|payme|click|uzsmart|uzkassa/i.test(lower)) {
    category = 'integration'
  } else if (/можно ли|хотел бы|добавьте|kerak|предлага|улучш/i.test(lower)) {
    category = 'feature_request'
  } else if (/заказ|order|buyurtma|zakaz|чек|chek/i.test(lower)) {
    category = 'order'
  } else if (/доставк|курьер|yetkazib|dostavka/i.test(lower)) {
    category = 'delivery'
  } else if (/филиал|filial|регион|region|адрес|address|manzil/i.test(lower)) {
    category = 'technical' // филиал/регион issues are usually technical
  } else if (/меню|блюд|товар|позици|цен/i.test(lower)) {
    category = 'menu'
  } else if (/приложен|app|мобильн|android|ios|ilova/i.test(lower)) {
    category = 'app'
  } else if (/как\s|что\s|где\s|почему|qanday|nima|подскажите/i.test(lower)) {
    category = 'question'
  } else if (/спасибо|благодар|отлично|супер|rahmat|zo'r/i.test(lower)) {
    category = 'feedback'
  }

  // =========== STEP 3: Determine sentiment ===========
  let sentiment = 'neutral'
  if (/спасибо|отлично|супер|хорошо|rahmat|zo'r|молодц/i.test(lower)) {
    sentiment = 'positive'
  } else if (/ужас|кошмар|безобраз|хамств|обман/i.test(lower)) {
    sentiment = 'frustrated'
  } else if (/плохо|недовол|проблем|не работа|ошибк|жалоб/i.test(lower) || isBillingProblem || isQuestionComplaint) {
    sentiment = 'negative'
  }

  // =========== STEP 4: Determine urgency ===========
  let urgency = 1 // Default: low priority
  if (/срочно|критично|urgent|tez|shoshilinch|блокир|не могу работать|asap|немедленно/i.test(lower)) {
    urgency = 4
  } else if (isProblem && sentiment === 'frustrated') {
    urgency = 3
  } else if (isOnboardingRequest) {
    // Onboarding requests are high priority - potential new clients!
    urgency = 3
  } else if (isBillingProblem || isQuestionComplaint) {
    // Billing complaints are important - money issues need quick resolution
    urgency = 3
  } else if (isProblem) {
    urgency = 2
  } else if (/\?/.test(text)) {
    // Questions deserve attention
    urgency = 1
  } else if (sentiment === 'positive') {
    urgency = 0
  }

  // Determine intent - use simple detection first
  let intent = simpleIntent?.intent || 'information'
  let autoReplyAllowed = simpleIntent?.autoReply || false
  
  if (!simpleIntent) {
    if (isBillingProblem || isQuestionComplaint) {
      // Billing complaints or question-complaints need human attention
      intent = 'complaint'
      autoReplyAllowed = false
    } else if (isProblem) {
      intent = 'report_problem'
      autoReplyAllowed = false
    } else if (/как\s|что\s|где\s|почему|подскажите|qanday|nima/i.test(lower)) {
      intent = 'ask_question'
      autoReplyAllowed = false // Complex questions need human
    } else if (/хочу|нужно|добавьте|kerak|можно ли/i.test(lower)) {
      intent = 'request_feature'
      autoReplyAllowed = false
    } else if (/жалоб|претензи|shikoyat/i.test(lower)) {
      intent = 'complaint'
      autoReplyAllowed = false
    }
  }

  // Determine if needs response
  const isClosingOrGratitude = ['gratitude', 'closing', 'response'].includes(intent)
  const needsResponse = !isClosingOrGratitude && (
    isProblem || 
    intent === 'ask_question' || 
    intent === 'request_feature' || 
    intent === 'complaint' ||
    intent === 'greeting' ||
    intent.startsWith('faq_') ||
    /\?$/.test(text.trim()) // Ends with question mark
  )

  // Fallback-таксономия: пробуем по legacy category + по хинтам определить subcategory
  const fallbackDomain: DomainKey = LEGACY_CATEGORY_TO_DOMAIN[category] || 'other'
  const fallbackSubcategory = detectSubcategoryByHints(lower, fallbackDomain)

  return {
    category,
    sentiment,
    intent,
    urgency,
    isProblem,
    needsResponse,
    autoReplyAllowed,
    summary: text.slice(0, 100) + (text.length > 100 ? '...' : ''),
    entities: {},
    domain: fallbackDomain,
    subcategory: fallbackSubcategory,
    theme: null,
    tags: [],
  }
}

/**
 * Fallback-детекция подкатегории по хинтам из таксономии.
 * Используется только в analyzeWithoutAI и при бекфилле, когда LLM недоступен.
 */
function detectSubcategoryByHints(lowerText: string, domain: DomainKey): string | null {
  const d = TAXONOMY.find((x) => x.key === domain)
  if (!d) return null
  for (const s of d.subcategories) {
    for (const hint of s.hints) {
      if (!hint) continue
      if (lowerText.includes(hint.toLowerCase())) return s.key
    }
  }
  return null
}

// Analyze with OpenAI
export async function analyzeWithAI(text: string): Promise<AnalysisResult> {
  // OPTIMIZATION: Check for simple intents first (no AI call needed)
  const simpleIntent = detectSimpleIntent(text)
  if (simpleIntent) {
    console.log(`[AI Analyze] Fast path: detected simple intent "${simpleIntent.intent}"`)
    return analyzeWithoutAI(text) // Use fallback which already uses simple intent
  }

  const apiKey = await getOpenAIKey()
  if (!apiKey) {
    console.log('[AI Analyze] No OpenAI key, using fallback')
    return analyzeWithoutAI(text)
  }

  try {
    const openai = new OpenAI({ apiKey })
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: ANALYSIS_PROMPT },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
      max_tokens: 500,
    })

    const content = completion.choices[0]?.message?.content || ''
    
    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.log('[AI Analyze] No JSON in response, using fallback')
      return analyzeWithoutAI(text)
    }

    const raw = JSON.parse(jsonMatch[0]) as Partial<AnalysisResult> & Record<string, any>

    // Determine autoReplyAllowed based on intent
    const autoReplyIntents = ['greeting', 'gratitude', 'closing', 'faq_pricing', 'faq_hours', 'faq_contacts']
    const autoReplyAllowed = raw.autoReplyAllowed ?? autoReplyIntents.includes(raw.intent as string)

    // === Валидация таксономии ===
    const category = (raw.category as string) || 'general'
    const lowerText = text.toLowerCase()

    // 1. domain: берём из LLM, если валиден; иначе маппим из legacy category
    let domain: DomainKey = isValidDomain(raw.domain as string)
      ? (raw.domain as DomainKey)
      : (LEGACY_CATEGORY_TO_DOMAIN[category] || 'other')

    // 2. subcategory: если LLM дал невалидный ключ — null, затем пробуем хинты
    let subcategory: string | null = null
    if (raw.subcategory && isValidSubcategory(domain, raw.subcategory as string)) {
      subcategory = raw.subcategory as string
    } else if (raw.subcategory && isValidSubcategory(null, raw.subcategory as string)) {
      // Подкатегория валидна, но относится к другому домену — выравниваем домен
      const correctDomain = getDomainForSubcategory(raw.subcategory as string)
      if (correctDomain) {
        domain = correctDomain
        subcategory = raw.subcategory as string
      }
    }
    if (!subcategory) {
      subcategory = detectSubcategoryByHints(lowerText, domain)
    }

    // 3. theme: свободная строка, тримим и ограничиваем длину
    const rawTheme = typeof raw.theme === 'string' ? raw.theme.trim() : ''
    const theme = rawTheme ? rawTheme.slice(0, 300) : null

    // 4. tags: массив строк, до 5 штук, короткие
    const rawTags = Array.isArray(raw.tags) ? raw.tags : []
    const tags = rawTags
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0 && t.length <= 40)
      .slice(0, 5)

    return {
      category,
      sentiment: (raw.sentiment as string) || 'neutral',
      intent: (raw.intent as string) || 'information',
      urgency: Math.min(5, Math.max(0, Number(raw.urgency) || 1)),
      isProblem: Boolean(raw.isProblem),
      needsResponse: raw.needsResponse !== false,
      autoReplyAllowed,
      summary: (raw.summary as string) || text.slice(0, 100),
      entities: (raw.entities as Record<string, string>) || {},
      domain,
      subcategory,
      theme,
      tags,
    }

  } catch (e: any) {
    console.error('[AI Analyze] OpenAI error:', e.message)
    return analyzeWithoutAI(text)
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  // POST - Analyze message
  if (req.method === 'POST') {
    try {
      const { messageId, text, channelId, telegramChatId, senderName, telegramId, senderRole } = await req.json()
      
      // senderRole: 'client' | 'support' | 'team' - used to decide on auto-reply
      // Сотрудники НЕ должны создавать тикеты: только явно client
      const isFromClient = senderRole === 'client'

      if (!text || text.length < 3) {
        return json({ error: 'Text too short for analysis' }, 400)
      }

      console.log(`[AI Analyze] Analyzing message ${messageId} from ${senderRole || 'unknown'}: "${text.slice(0, 100)}..."`)
      console.log(`[AI Analyze] Channel: ${channelId}, TelegramChat: ${telegramChatId}`)

      // Check if there's a case awaiting feedback for this channel
      let pendingFeedbackCase = null
      if (channelId) {
        const feedbackCases = await sql`
          SELECT id, ticket_number FROM support_cases
          WHERE channel_id = ${channelId}
            AND status = 'resolved'
            AND resolution_notes LIKE '%[Awaiting feedback]%'
            AND org_id = ${orgId}
          ORDER BY updated_at DESC
          LIMIT 1
        `
        if (feedbackCases.length > 0) {
          pendingFeedbackCase = feedbackCases[0]
          console.log(`[AI Analyze] Found case awaiting feedback: ${pendingFeedbackCase.id}`)
        }
      }

      // Run AI analysis
      const analysis = await analyzeWithAI(text)
      
      // ОТКЛЮЧЕНО: Обработка feedback и уведомления клиентам
      // Информирование работает только внутри системы для сотрудников
      const feedbackResult = null
      // if (pendingFeedbackCase && telegramChatId) { ... }

      console.log(`[AI Analyze] Result: intent=${analysis.intent}, sentiment=${analysis.sentiment}, autoReply=${analysis.autoReplyAllowed}, needsResponse=${analysis.needsResponse}`)

      // Update message in database
      if (messageId) {
        // Гарантируем наличие колонок таксономии (no-op если уже есть)
        await ensureTaxonomyColumns()
        await sql`
          UPDATE support_messages SET
            ai_category = ${analysis.category},
            ai_sentiment = ${analysis.sentiment},
            ai_intent = ${analysis.intent},
            ai_urgency = ${analysis.urgency},
            is_problem = ${analysis.isProblem},
            ai_summary = ${analysis.summary},
            ai_extracted_entities = ${JSON.stringify(analysis.entities)},
            ai_domain = ${analysis.domain},
            ai_subcategory = ${analysis.subcategory},
            ai_theme = ${analysis.theme},
            ai_tags = ${analysis.tags as any},
            auto_reply_candidate = ${analysis.autoReplyAllowed}
          WHERE id = ${messageId} AND org_id = ${orgId}
        `
        console.log(`[AI Analyze] Updated message ${messageId} (domain=${analysis.domain}, sub=${analysis.subcategory || '-'}, theme="${analysis.theme ? analysis.theme.slice(0, 60) : '-'}")`)
      }

      // Update channel awaiting_reply based on needsResponse
      if (channelId && !analysis.needsResponse) {
        // If message doesn't need response (e.g., "спасибо", "ок"), 
        // mark channel as not awaiting reply
        await sql`
          UPDATE support_channels SET
            awaiting_reply = false
          WHERE id = ${channelId} AND awaiting_reply = true AND org_id = ${orgId}
        `
        console.log(`[AI Analyze] Channel ${channelId} marked as not awaiting reply (message doesn't need response)`)
      }

      // If high urgency problem, update channel priority
      if (analysis.isProblem && analysis.urgency >= 3 && channelId) {
        await sql`
          UPDATE support_channels SET
            priority = CASE 
              WHEN ${analysis.urgency} >= 4 THEN 'urgent'
              WHEN ${analysis.urgency} >= 3 THEN 'high'
              ELSE priority
            END
          WHERE id = ${channelId} AND org_id = ${orgId}
        `
      }

      // ОТКЛЮЧЕНО: Автоответы в Telegram-каналы клиентов
      // Информирование работает только внутри системы для сотрудников
      const autoReplyResult = null
      // if (analysis.autoReplyAllowed && channelId && telegramChatId && isFromClient) { ... }

      // Auto-create ticket for problems (urgent: >= 2, or isProblem with needsResponse)
      // ВАЖНО: Тикеты создаются ТОЛЬКО для сообщений от КЛИЕНТОВ, не от сотрудников!
      let ticketResult = null
      console.log(`[AI Analyze] Ticket check: isProblem=${analysis.isProblem}, needsResponse=${analysis.needsResponse}, urgency=${analysis.urgency}, isFromClient=${isFromClient}, messageId=${!!messageId}, channelId=${!!channelId}`)
      
      // Добавлена проверка isFromClient чтобы не создавать дубликаты тикетов когда сотрудник отвечает
      if (analysis.isProblem && analysis.needsResponse && analysis.urgency >= 2 && messageId && channelId && isFromClient) {
        console.log(`[AI Analyze] Auto-creating ticket for problem message (urgency=${analysis.urgency})`)
        
        try {
          // Check if ticket already exists for this message
          const existingCase = await sql`
            SELECT id FROM support_cases WHERE source_message_id = ${messageId} AND org_id = ${orgId} LIMIT 1
          `
          
          // NEW: Check for recent open case in same channel (within 10 minutes)
          // This groups consecutive messages from the same client into one case
          const recentOpenCase = await sql`
            SELECT c.id, c.title, c.description, c.created_at
            FROM support_cases c
            WHERE c.channel_id = ${channelId}
              AND c.status IN ('detected', 'in_progress')
              AND c.created_at > NOW() - INTERVAL '10 minutes'
              AND c.org_id = ${orgId}
              -- No staff reply since case was created
              AND NOT EXISTS (
                SELECT 1 FROM support_messages m
                WHERE m.channel_id = c.channel_id
                  AND m.created_at > c.created_at
                  AND (m.sender_role IN ('support', 'team', 'agent') OR m.is_from_client = false)
              )
            ORDER BY c.created_at DESC
            LIMIT 1
          `
          
          if (recentOpenCase.length > 0) {
            // Group message into existing case instead of creating new one
            const existingCaseId = recentOpenCase[0].id
            
            // Link message to existing case
            await sql`UPDATE support_messages SET case_id = ${existingCaseId} WHERE id = ${messageId} AND org_id = ${orgId}`
            
            // Update case description to include new message info
            const currentDesc = recentOpenCase[0].description || ''
            const separator = currentDesc ? '\n\n---\n\n' : ''
            const newDesc = `${currentDesc}${separator}[Продолжение]: ${text.slice(0, 200)}`
            
            await sql`
              UPDATE support_cases 
              SET description = ${newDesc},
                  updated_at = NOW()
              WHERE id = ${existingCaseId} AND org_id = ${orgId}
            `
            
            // Log activity
            await sql`
              INSERT INTO support_case_activities (id, case_id, type, title, description, org_id, created_at)
              VALUES (
                ${'act_' + Date.now()},
                ${existingCaseId},
                'message_added',
                'Добавлено сообщение',
                ${'Клиент продолжил описывать проблему: ' + text.slice(0, 100)},
                ${orgId},
                NOW()
              )
            `
            
            ticketResult = { 
              success: true, 
              grouped: true, 
              caseId: existingCaseId, 
              message: 'Сообщение добавлено к существующему кейсу' 
            }
            console.log(`[AI Analyze] Message grouped into existing case ${existingCaseId}`)
          } else if (existingCase.length === 0) {
            // Get channel info for case creation
            const channelInfo = await sql`
              SELECT name, company_id, telegram_chat_id FROM support_channels WHERE id = ${channelId} AND org_id = ${orgId}
            `
            
            const caseId = `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            // Более консервативная логика приоритетов:
            // urgent: только критичные (urgency 5)
            // high: срочные проблемы (urgency 4)
            // medium: обычные проблемы (urgency 2-3)
            // low: простые обращения (urgency 0-1)
            const casePriority = analysis.urgency >= 5 ? 'urgent' : 
                                 analysis.urgency >= 4 ? 'high' : 
                                 analysis.urgency >= 2 ? 'medium' : 'low'
            const caseSeverity = analysis.urgency >= 5 ? 'critical' : 
                                 analysis.urgency >= 4 ? 'high' : 'normal'
            
            // Add columns if not exists
            try {
              await sql`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS source_message_id VARCHAR(64)`
              await sql`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS reporter_name VARCHAR(255)`
            } catch (e) { /* columns exist */ }
            
            await sql`
              INSERT INTO support_cases (
                id, channel_id, company_id, title, description,
                category, priority, severity, status, source_message_id,
                reporter_name, org_id, created_at
              ) VALUES (
                ${caseId},
                ${channelId},
                ${channelInfo[0]?.company_id || null},
                ${analysis.summary || text.slice(0, 100)},
                ${text},
                ${analysis.category || 'general'},
                ${casePriority},
                ${caseSeverity},
                'detected',
                ${messageId},
                ${senderName || 'Клиент'},
                ${orgId},
                NOW()
              )
            `
            
            // Link message to case
            await sql`UPDATE support_messages SET case_id = ${caseId} WHERE id = ${messageId} AND org_id = ${orgId}`
            
            // Create activity
            await sql`
              INSERT INTO support_case_activities (id, case_id, type, title, description, org_id, created_at)
              VALUES (
                ${'act_' + Date.now()},
                ${caseId},
                'auto_created',
                'Тикет создан автоматически',
                ${'AI определил проблему: ' + (analysis.summary || analysis.category)},
                ${orgId},
                NOW()
              )
            `
            
            ticketResult = { success: true, caseId, priority: casePriority }
            console.log(`[AI Analyze] Auto-created ticket ${caseId} with priority ${casePriority}`)
          } else if (existingCase.length > 0) {
            // Case already exists for this specific message
            console.log(`[AI Analyze] Ticket already exists for message ${messageId}`)
            ticketResult = { success: false, reason: 'Ticket already exists', existingCaseId: existingCase[0].id }
          }
        } catch (e: any) {
          console.log(`[AI Analyze] Auto-ticket creation failed: ${e.message}`)
          ticketResult = { success: false, error: e.message }
        }
      }

      return json({
        success: true,
        analysis,
        messageId,
        autoReply: autoReplyResult,
        ticket: ticketResult,
        feedback: feedbackResult,
      })

    } catch (e: any) {
      console.error('[AI Analyze] Error:', e.message)
      return json({ error: "Internal server error" }, 500)
    }
  }

  // GET - Analyze text without saving
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const text = url.searchParams.get('text') || url.searchParams.get('q')

    if (!text || text.length < 3) {
      return json({ error: 'Text required (min 3 chars)' }, 400)
    }

    try {
      const analysis = await analyzeWithAI(text)
      return json({ analysis })
    } catch (e: any) {
      return json({ error: "Internal server error" }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
// deploy 1770212057
