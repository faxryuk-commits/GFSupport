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
  "intent": "одно из: ask_question, report_problem, request_feature, complaint, gratitude, information, unknown",
  "urgency": число от 0 до 5 (0 = не срочно, 5 = критично),
  "isProblem": true или false,
  "summary": "краткое резюме на русском (1-2 предложения)",
  "entities": {
    "product": "название продукта если упоминается",
    "error": "описание ошибки если есть",
    "integration": "название интеграции если упоминается"
  }
}

Правила определения:
- isProblem = true если клиент сообщает о проблеме, ошибке, что-то не работает
- urgency 4-5 если критическая проблема, блокирует работу, упоминается "срочно"
- urgency 3 если серьезная проблема но не критическая
- urgency 1-2 для обычных вопросов
- urgency 0 для благодарности, положительных отзывов

Отвечай ТОЛЬКО JSON, без markdown блоков.`

interface AnalysisResult {
  category: string
  sentiment: string
  intent: string
  urgency: number
  isProblem: boolean
  summary: string
  entities: Record<string, string>
}

// Fallback analysis without AI
function analyzeWithoutAI(text: string): AnalysisResult {
  const lower = text.toLowerCase()
  
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

  // Determine intent
  let intent = 'information'
  if (isProblem) {
    intent = 'report_problem'
  } else if (/как\s|что\s|где\s|почему|подскажите|qanday|nima/i.test(lower)) {
    intent = 'ask_question'
  } else if (/хочу|нужно|добавьте|kerak|можно ли/i.test(lower)) {
    intent = 'request_feature'
  } else if (/жалоб|претензи|shikoyat/i.test(lower)) {
    intent = 'complaint'
  } else if (/спасибо|благодар|rahmat/i.test(lower)) {
    intent = 'gratitude'
  }

  return {
    category,
    sentiment,
    intent,
    urgency,
    isProblem,
    summary: text.slice(0, 100) + (text.length > 100 ? '...' : ''),
    entities: {},
  }
}

// Analyze with OpenAI
async function analyzeWithAI(text: string): Promise<AnalysisResult> {
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
    
    // Validate and normalize
    return {
      category: result.category || 'general',
      sentiment: result.sentiment || 'neutral',
      intent: result.intent || 'information',
      urgency: Math.min(5, Math.max(0, Number(result.urgency) || 1)),
      isProblem: Boolean(result.isProblem),
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
      const { messageId, text, channelId } = await req.json()

      if (!text || text.length < 3) {
        return json({ error: 'Text too short for analysis' }, 400)
      }

      console.log(`[AI Analyze] Analyzing message ${messageId}: "${text.slice(0, 50)}..."`)

      // Run AI analysis
      const analysis = await analyzeWithAI(text)

      console.log(`[AI Analyze] Result: category=${analysis.category}, sentiment=${analysis.sentiment}, isProblem=${analysis.isProblem}, urgency=${analysis.urgency}`)

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
            ai_extracted_entities = ${JSON.stringify(analysis.entities)}
          WHERE id = ${messageId}
        `
        console.log(`[AI Analyze] Updated message ${messageId}`)
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

      return json({
        success: true,
        analysis,
        messageId,
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
