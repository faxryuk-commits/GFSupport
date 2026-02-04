import { neon } from '@neondatabase/serverless'
import OpenAI from 'openai'

export const config = {
  runtime: 'edge',
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

// AI analysis prompt
const ANALYSIS_PROMPT = `Ты анализатор сообщений службы поддержки Delever (платформа для ресторанов и доставки в Узбекистане и Казахстане).
ВАЖНО: Ты понимаешь русский, узбекский (на латинице и кириллице) и английский языки.

Узбекские слова-индикаторы проблем:
- muammo, xatolik, nosozlik, buzilgan = проблема
- ishlamayapti, ishlamaydi = не работает
- yordam, ko'mak = помощь
- tez, shoshilinch = срочно

Анализируй сообщение и верни ТОЛЬКО JSON без markdown:
{
  "category": "одно из: technical, integration, billing, complaint, feature_request, order, delivery, menu, app, onboarding, question, feedback, general",
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

interface AnalysisResult {
  category: string
  sentiment: string
  intent: string
  urgency: number
  isProblem: boolean
  needsResponse: boolean
  autoReplyAllowed: boolean
  summary: string
  entities: Record<string, string>
}

// Simple intents that can be detected without AI (for performance)
const SIMPLE_INTENT_PATTERNS: Array<{ pattern: RegExp; intent: string; autoReply: boolean }> = [
  // Greetings (Russian + Uzbek Latin + Uzbek Cyrillic)
  { pattern: /^(здравствуйте|привет|добрый\s+(день|вечер|утро)|salom|assalomu\s*alaykum|assalom|hi|hello|приветствую|салом|ассалому\s*алайкум)[\s!.,]*$/i, intent: 'greeting', autoReply: true },
  
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

// Fallback analysis without AI
function analyzeWithoutAI(text: string): AnalysisResult {
  const lower = text.toLowerCase()
  
  // First, check for simple intents (fast path, no AI needed)
  const simpleIntent = detectSimpleIntent(text)
  
  // Determine category
  let category = 'general'
  if (/ошибк|error|не работа|сломал|баг|bug|xato|глючит|виснет|crash|ishlamay/i.test(lower)) {
    category = 'technical'
  } else if (/интеграц|подключ|api|webhook|iiko|r-keeper|poster|wolt|payme|click/i.test(lower)) {
    category = 'integration'
  } else if (/оплат|счёт|счет|деньг|pul|tolov|тариф|подписк/i.test(lower)) {
    category = 'billing'
  } else if (/жалоб|недовол|плохо|ужас|shikoyat|хамств/i.test(lower)) {
    category = 'complaint'
  } else if (/можно ли|хотел бы|добавьте|kerak|предлага|улучш/i.test(lower)) {
    category = 'feature_request'
  } else if (/заказ|order|buyurtma|zakaz/i.test(lower)) {
    category = 'order'
  } else if (/доставк|курьер|yetkazib|dostavka/i.test(lower)) {
    category = 'delivery'
  } else if (/меню|блюд|товар|позици|цен/i.test(lower)) {
    category = 'menu'
  } else if (/приложен|app|мобильн|android|ios|ilova/i.test(lower)) {
    category = 'app'
  } else if (/как\s|что\s|где\s|почему|qanday|nima|подскажите/i.test(lower)) {
    category = 'question'
  } else if (/спасибо|благодар|отлично|супер|rahmat|zo'r/i.test(lower)) {
    category = 'feedback'
  }

  // Determine sentiment
  let sentiment = 'neutral'
  if (/спасибо|отлично|супер|хорошо|rahmat|zo'r|молодц/i.test(lower)) {
    sentiment = 'positive'
  } else if (/ужас|кошмар|безобраз|хамств|обман/i.test(lower)) {
    sentiment = 'frustrated'
  } else if (/плохо|недовол|проблем|не работа|ошибк|жалоб/i.test(lower)) {
    sentiment = 'negative'
  }

  // Determine if problem
  const isProblem = /не работа|ошибк|проблем|сломал|баг|глючит|виснет|ishlamay|xato|muammo/i.test(lower)

  // Determine urgency
  let urgency = 1
  if (/срочно|критично|urgent|tez|shoshilinch|блокир|не могу работать/i.test(lower)) {
    urgency = 4
  } else if (isProblem && sentiment === 'frustrated') {
    urgency = 3
  } else if (isProblem) {
    urgency = 2
  } else if (sentiment === 'positive') {
    urgency = 0
  }

  // Determine intent - use simple detection first
  let intent = simpleIntent?.intent || 'information'
  let autoReplyAllowed = simpleIntent?.autoReply || false
  
  if (!simpleIntent) {
    if (isProblem) {
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
  }
}

// Analyze with OpenAI
async function analyzeWithAI(text: string): Promise<AnalysisResult> {
  // OPTIMIZATION: Check for simple intents first (no AI call needed)
  const simpleIntent = detectSimpleIntent(text)
  if (simpleIntent) {
    console.log(`[AI Analyze] Fast path: detected simple intent "${simpleIntent.intent}"`)
    return analyzeWithoutAI(text) // Use fallback which already uses simple intent
  }

  const apiKey = process.env.OPENAI_API_KEY
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

    const result = JSON.parse(jsonMatch[0]) as AnalysisResult
    
    // Determine autoReplyAllowed based on intent
    const autoReplyIntents = ['greeting', 'gratitude', 'closing', 'faq_pricing', 'faq_hours', 'faq_contacts']
    const autoReplyAllowed = result.autoReplyAllowed ?? autoReplyIntents.includes(result.intent)
    
    // Validate and normalize
    return {
      category: result.category || 'general',
      sentiment: result.sentiment || 'neutral',
      intent: result.intent || 'information',
      urgency: Math.min(5, Math.max(0, Number(result.urgency) || 1)),
      isProblem: Boolean(result.isProblem),
      needsResponse: result.needsResponse !== false, // Default to true if not specified
      autoReplyAllowed,
      summary: result.summary || text.slice(0, 100),
      entities: result.entities || {},
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const sql = getSQL()

  // POST - Analyze message
  if (req.method === 'POST') {
    try {
      const { messageId, text, channelId, telegramChatId, senderName, telegramId } = await req.json()

      if (!text || text.length < 3) {
        return json({ error: 'Text too short for analysis' }, 400)
      }

      console.log(`[AI Analyze] Analyzing message ${messageId}: "${text.slice(0, 50)}..."`)

      // Run AI analysis
      const analysis = await analyzeWithAI(text)

      console.log(`[AI Analyze] Result: intent=${analysis.intent}, sentiment=${analysis.sentiment}, autoReply=${analysis.autoReplyAllowed}, needsResponse=${analysis.needsResponse}`)

      // Update message in database
      if (messageId) {
        await sql`
          UPDATE support_messages SET
            ai_category = ${analysis.category},
            ai_sentiment = ${analysis.sentiment},
            ai_intent = ${analysis.intent},
            ai_urgency = ${analysis.urgency},
            is_problem = ${analysis.isProblem},
            ai_summary = ${analysis.summary},
            ai_extracted_entities = ${JSON.stringify(analysis.entities)},
            auto_reply_candidate = ${analysis.autoReplyAllowed}
          WHERE id = ${messageId}
        `
        console.log(`[AI Analyze] Updated message ${messageId}`)
      }

      // Update channel awaiting_reply based on needsResponse
      if (channelId && !analysis.needsResponse) {
        // If message doesn't need response (e.g., "спасибо", "ок"), 
        // mark channel as not awaiting reply
        await sql`
          UPDATE support_channels SET
            awaiting_reply = false
          WHERE id = ${channelId} AND awaiting_reply = true
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
          WHERE id = ${channelId}
        `
      }

      // Trigger auto-reply if allowed
      let autoReplyResult = null
      if (analysis.autoReplyAllowed && channelId && telegramChatId) {
        console.log(`[AI Analyze] Triggering auto-reply for intent=${analysis.intent}`)
        
        // Call auto-reply endpoint
        const autoReplyUrl = process.env.VERCEL_URL 
          ? `https://${process.env.VERCEL_URL}/api/support/auto-reply`
          : null
        
        if (autoReplyUrl) {
          try {
            const response = await fetch(autoReplyUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                channelId,
                telegramChatId,
                intent: analysis.intent,
                senderName: senderName || '',
                telegramId: telegramId || null,
                originalText: text, // Pass original text for language detection
              }),
            })
            autoReplyResult = await response.json()
            console.log(`[AI Analyze] Auto-reply result: ${JSON.stringify(autoReplyResult)}`)
          } catch (e: any) {
            console.log(`[AI Analyze] Auto-reply call failed: ${e.message}`)
          }
        }
      }

      // Auto-create ticket for problems (urgent: >= 2, or isProblem with needsResponse)
      let ticketResult = null
      if (analysis.isProblem && analysis.needsResponse && analysis.urgency >= 2 && messageId && channelId) {
        console.log(`[AI Analyze] Auto-creating ticket for problem message (urgency=${analysis.urgency})`)
        
        try {
          // Check if ticket already exists for this message
          const existingCase = await sql`
            SELECT id FROM support_cases WHERE source_message_id = ${messageId} LIMIT 1
          `
          
          if (existingCase.length === 0) {
            // Get channel info for case creation
            const channelInfo = await sql`
              SELECT name, company_id, telegram_chat_id FROM support_channels WHERE id = ${channelId}
            `
            
            const caseId = `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            const casePriority = analysis.urgency >= 5 ? 'urgent' : 
                                 analysis.urgency >= 4 ? 'high' : 
                                 analysis.urgency >= 3 ? 'medium' : 'low'
            const caseSeverity = analysis.urgency >= 4 ? 'critical' : 
                                 analysis.urgency >= 3 ? 'high' : 'normal'
            
            // Add column if not exists
            try {
              await sql`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS source_message_id VARCHAR(64)`
            } catch (e) { /* column exists */ }
            
            await sql`
              INSERT INTO support_cases (
                id, channel_id, company_id, title, description,
                category, priority, severity, status, source_message_id,
                reporter_name, created_at
              ) VALUES (
                ${caseId},
                ${channelId},
                ${channelInfo[0]?.company_id || null},
                ${analysis.summary || text.slice(0, 100)},
                ${text},
                ${analysis.category || 'general'},
                ${casePriority},
                ${caseSeverity},
                'open',
                ${messageId},
                ${senderName || 'Клиент'},
                NOW()
              )
            `
            
            // Link message to case
            await sql`UPDATE support_messages SET case_id = ${caseId} WHERE id = ${messageId}`
            
            // Create activity
            await sql`
              INSERT INTO support_case_activities (id, case_id, type, title, description, created_at)
              VALUES (
                ${'act_' + Date.now()},
                ${caseId},
                'auto_created',
                'Тикет создан автоматически',
                ${'AI определил проблему: ' + (analysis.summary || analysis.category)},
                NOW()
              )
            `
            
            ticketResult = { success: true, caseId, priority: casePriority }
            console.log(`[AI Analyze] Auto-created ticket ${caseId} with priority ${casePriority}`)
          } else {
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
      })

    } catch (e: any) {
      console.error('[AI Analyze] Error:', e.message)
      return json({ error: e.message }, 500)
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
      return json({ error: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
