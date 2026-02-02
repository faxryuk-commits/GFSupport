import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

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

// Default patterns
const DEFAULT_PATTERNS = {
  // Uzbek language patterns
  uzbek_keywords: {
    problem: ['muammo', 'xatolik', 'nosozlik', 'buzilgan'],
    not_working: ['ishlamayapti', 'ishlamayvotti', 'ishlamaydi', 'ochilmayapti'],
    help: ['yordam', "ko'mak", 'yordamchi'],
    urgent: ['tez', 'shoshilinch', 'tezkor', 'zudlik'],
    payment: ['pul', "to'lov", 'pullik', 'narx'],
    integration: ["bog'lanish", 'aloqa', 'integratsiya', 'ulanish'],
    order: ['buyurtma', 'zakaz', 'order'],
    delivery: ['yetkazib berish', 'dostavka', 'yetkazish'],
    menu: ['menyu', 'menu', 'taom'],
    branch: ['filial', 'branch', "bo'lim"],
  },
  
  // Russian problem indicators
  russian_problem_words: [
    'не работает', 'ошибка', 'проблема', 'баг', 'глючит',
    'сломалось', 'не открывается', 'не загружается', 'зависает',
    'не могу', 'не получается', 'помогите', 'срочно', 'критично'
  ],
  
  // Urgency scoring rules
  urgency_rules: [
    { condition: 'vip_client', mrr_threshold: 1000, score: 2, description: 'VIP клиент (MRR >= $1000)' },
    { condition: 'high_mrr', mrr_threshold: 500, score: 1, description: 'High MRR клиент (>= $500)' },
    { condition: 'repeat_issue', hours: 48, score: 1, description: 'Повторная проблема за 48 часов' },
    { condition: 'long_wait', hours: 24, score: 2, description: 'Ожидание ответа > 24 часов' },
    { condition: 'medium_wait', hours: 4, score: 1, description: 'Ожидание ответа > 4 часов' },
    { condition: 'frustrated_sentiment', score: 1, description: 'Негативный/frustrated sentiment' },
    { condition: 'negative_sentiment', score: 1, description: 'Негативный sentiment' },
  ],
  
  // Categories with extended keywords
  categories: [
    { id: 'technical', name: 'Техническая проблема', keywords: ['баг', 'ошибка', 'не работает', 'xatolik', 'глючит', 'виснет', 'crash', 'падает', 'тормозит', 'лагает', 'не загружается', 'белый экран', 'ishlamay', 'buzildi', 'timeout', '500', '404'] },
    { id: 'integration', name: 'Интеграция', keywords: ['интеграция', 'подключение', 'API', "bog'lanish", 'iiko', 'r-keeper', 'poster', 'jowi', 'wolt', 'yandex', 'express24', 'payme', 'click', 'синхронизация', 'webhook', 'не приходят заказы'] },
    { id: 'billing', name: 'Оплата/Биллинг', keywords: ['оплата', 'счёт', 'деньги', "to'lov", 'pul', 'тариф', 'подписка', 'списание', 'возврат', 'баланс', 'касса', 'терминал', 'эквайринг', 'чек'] },
    { id: 'complaint', name: 'Жалоба', keywords: ['жалоба', 'плохо', 'недоволен', 'yomon', 'ужас', 'кошмар', 'обман', 'хамство', 'грубо', 'претензия', 'скандал', 'shikoyat'] },
    { id: 'feature_request', name: 'Запрос функции', keywords: ['хочу', 'нужно', 'добавьте', 'kerak', 'предлагаю', 'улучшить', 'доработать', 'новая функция', 'было бы хорошо'] },
    { id: 'order', name: 'Заказы', keywords: ['заказ', 'order', 'buyurtma', 'zakaz', 'статус заказа', 'отменить заказ', 'изменить заказ', 'где заказ'] },
    { id: 'delivery', name: 'Доставка', keywords: ['доставка', 'курьер', 'yetkazib', 'dostavka', 'опоздал', 'задержка', 'не доставили', 'tracking'] },
    { id: 'menu', name: 'Меню', keywords: ['меню', 'блюдо', 'товар', 'позиция', 'цена', 'стоп-лист', 'ассортимент', 'добавить товар'] },
    { id: 'app', name: 'Приложение', keywords: ['приложение', 'app', 'мобильный', 'android', 'ios', 'скачать', 'обновление', 'ilova'] },
    { id: 'onboarding', name: 'Подключение', keywords: ['подключить', 'начать', 'настроить', 'boshlash', 'регистрация', 'первый раз', 'с чего начать'] },
    { id: 'question', name: 'Вопрос', keywords: ['как', 'почему', 'что', 'qanday', 'nima', 'подскажите', 'расскажите', 'где найти'] },
    { id: 'feedback', name: 'Обратная связь', keywords: ['спасибо', 'отлично', 'хорошо', 'rahmat', 'молодцы', 'супер', "zo'r"] },
    { id: 'general', name: 'Общие вопросы', keywords: [] },
  ],
  
  // Commitment detection patterns (Russian)
  commitment_patterns: {
    concrete: [
      { pattern: 'до завтра', hours: 24 },
      { pattern: 'завтра', hours: 24 },
      { pattern: 'сегодня', hours: 8 },
      { pattern: 'через (\\d+) час', hours_multiplier: 1 },
      { pattern: 'через (\\d+) минут', minutes_multiplier: 1 },
      { pattern: 'на этой неделе', days: 7 },
    ],
    vague: [
      'посмотрим', 'разберёмся', 'решим', 'сделаем',
      'проверю', 'уточню', 'узнаю', 'постараюсь', 'попробую'
    ],
    callback: [
      'перезвоню', 'напишу', 'отпишусь', 'свяжусь', 'дам знать'
    ],
    action: [
      'отправлю', 'скину', 'пришлю', 'подключу', 'настрою', 'исправлю'
    ]
  },
  
  // AI System prompt template
  ai_system_prompt: `Ты анализатор сообщений службы поддержки Delever (платформа для ресторанов и доставки в Узбекистане и Казахстане).
ВАЖНО: Ты понимаешь русский, узбекский (на латинице и кириллице) и английский языки.

{{UZBEK_KEYWORDS}}

Анализируй сообщение и верни JSON:
{
  "category": "одно из: technical, integration, billing, complaint, feature_request, order, delivery, menu, app, onboarding, question, feedback, general",
  "sentiment": "positive, neutral, negative, frustrated",
  "intent": "ask_question, report_problem, request_feature, complaint, gratitude, information, unknown",
  "urgency": "число 0-5, где 5 - критично срочно",
  "isProblem": true/false,
  "summary": "краткое резюме на русском (1-2 предложения)",
  "entities": {"product": "...", "error": "...", "restaurant": "..."} - извлечённые сущности
}
Отвечай ТОЛЬКО JSON, без markdown.`
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const sql = getSQL()

  // Ensure table exists
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS support_ai_patterns (
        id VARCHAR(100) PRIMARY KEY,
        category VARCHAR(50) NOT NULL,
        name VARCHAR(200),
        data JSONB NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `
  } catch (e) { /* table exists */ }

  // GET - Get all patterns
  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT * FROM support_ai_patterns WHERE is_active = true ORDER BY category, name
      `

      // If no patterns in DB, return defaults
      if (rows.length === 0) {
        return json({
          patterns: DEFAULT_PATTERNS,
          source: 'defaults',
          message: 'Using default patterns. Save to customize.'
        })
      }

      // Group by category
      const patterns: Record<string, any> = {}
      for (const row of rows) {
        patterns[row.id] = {
          ...row.data,
          id: row.id,
          category: row.category,
          name: row.name
        }
      }

      return json({ patterns, source: 'database' })

    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  // POST - Save/update patterns
  if (req.method === 'POST') {
    try {
      const { patterns } = await req.json()

      if (!patterns || typeof patterns !== 'object') {
        return json({ error: 'patterns object required' }, 400)
      }

      // Upsert each pattern
      for (const [id, data] of Object.entries(patterns)) {
        const patternData = data as any
        await sql`
          INSERT INTO support_ai_patterns (id, category, name, data, updated_at)
          VALUES (
            ${id},
            ${patternData.category || 'general'},
            ${patternData.name || id},
            ${JSON.stringify(patternData)},
            NOW()
          )
          ON CONFLICT (id) DO UPDATE SET
            data = ${JSON.stringify(patternData)},
            name = ${patternData.name || id},
            updated_at = NOW()
        `
      }

      return json({ success: true, message: 'Patterns saved' })

    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  // PUT - Update single pattern
  if (req.method === 'PUT') {
    try {
      const { id, data, name, category, isActive } = await req.json()

      if (!id) {
        return json({ error: 'id required' }, 400)
      }

      await sql`
        UPDATE support_ai_patterns SET
          data = COALESCE(${data ? JSON.stringify(data) : null}, data),
          name = COALESCE(${name}, name),
          category = COALESCE(${category}, category),
          is_active = COALESCE(${isActive}, is_active),
          updated_at = NOW()
        WHERE id = ${id}
      `

      return json({ success: true })

    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  // DELETE - Remove pattern
  if (req.method === 'DELETE') {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return json({ error: 'id required' }, 400)
    }

    try {
      await sql`DELETE FROM support_ai_patterns WHERE id = ${id}`
      return json({ success: true })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
