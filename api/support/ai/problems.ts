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

// Паттерны проблем на русском и узбекском
const PROBLEM_PATTERNS: Record<string, {
  category: string
  patterns: RegExp[]
  description: string
}> = {
  // ============ ТЕХНИЧЕСКИЕ ПРОБЛЕМЫ ============
  technical_not_working: {
    category: 'technical',
    patterns: [
      /не работа|не открыва|не загруж|не отобража|не сохран|не отправ|не получа/i,
      /ishlamay|ishlamaydi|ishlamaypti|ochilmay|yuklanmay/i,
      /ишламай|ишламаяпти|очилмай|юкланмай/i,
    ],
    description: 'Функционал не работает',
  },
  technical_error: {
    category: 'technical',
    patterns: [
      /ошибк|error|exception|failed|crash|баг|bug/i,
      /xato|xatolik|oshibka|hatolik/i,
      /хато|хатолик|ошибка/i,
    ],
    description: 'Ошибки и сбои',
  },
  technical_slow: {
    category: 'technical',
    patterns: [
      /медленн|тормоз|долго загруж|зависа|глючит|виснет/i,
      /sekin|qotib qol|osilib qol/i,
      /секин|қотиб қол|осилиб қол/i,
    ],
    description: 'Медленная работа/зависания',
  },
  
  // ============ ПРОБЛЕМЫ С ЗАКАЗАМИ ============
  order_wrong: {
    category: 'order',
    patterns: [
      /неправильн\w*\s*(заказ|чек|сумм|цен)|заказ\s*(не\s*т|неверн|ошиб)/i,
      /buyurtma\s*(xato|noto'g'ri)|chek\s*(xato|noto'g'ri)/i,
      /буюртма\s*(хато|нотўғри)|чек\s*(хато|нотўғри)/i,
    ],
    description: 'Неправильный заказ/чек',
  },
  order_missing: {
    category: 'order',
    patterns: [
      /заказ\s*(не\s*пришёл|не\s*пришел|не\s*поступ|потеря|пропал)/i,
      /buyurtma\s*(kelmay|yo'qol|yetib kelma)/i,
      /буюртма\s*(келмай|йўқол|етиб келма)/i,
    ],
    description: 'Заказ не поступил/потерялся',
  },
  order_duplicate: {
    category: 'order',
    patterns: [
      /дубл|повтор\w*\s*заказ|два\s*раза|дважды/i,
      /ikki marta|takroriy|dublikat/i,
      /икки марта|такрорий|дубликат/i,
    ],
    description: 'Дублирование заказов',
  },
  
  // ============ ПРОБЛЕМЫ С ОПЛАТОЙ ============
  billing_wrong_amount: {
    category: 'billing',
    patterns: [
      /сумм\w*\s*(не\s*совпад|неправильн|лишн|другая)|переплат|недоплат/i,
      /как\s+(за|так)\s*\d+.*если.*\d+|почему\s+\d+.*если.*\d+/i,
      /summa\s*(mos\s*kel|xato|noto'g'ri)/i,
    ],
    description: 'Несоответствие суммы оплаты',
  },
  billing_payment_failed: {
    category: 'billing',
    patterns: [
      /оплат\w*\s*(не\s*прош|не\s*прин|отклон|ошибк)/i,
      /to'lov\s*(o'tmay|qabul qilinma|rad etil)/i,
      /тўлов\s*(ўтмай|қабул қилинма|рад этил)/i,
    ],
    description: 'Оплата не прошла',
  },
  billing_refund: {
    category: 'billing',
    patterns: [
      /возврат|верн\w*\s*деньг|refund/i,
      /qaytarish|pulni qaytaring/i,
      /қайтариш|пулни қайтаринг/i,
    ],
    description: 'Запрос возврата',
  },
  
  // ============ ПРОБЛЕМЫ С ДОСТАВКОЙ ============
  delivery_late: {
    category: 'delivery',
    patterns: [
      /доставк\w*\s*(опазд|задерж|долго)|курьер\s*(опазд|не\s*пришёл)/i,
      /yetkazib berish\s*(kechik|uzay)|kurier\s*(kelma|kechik)/i,
      /етказиб бериш\s*(кечик|узай)|курьер\s*(келма|кечик)/i,
    ],
    description: 'Задержка доставки',
  },
  delivery_wrong_address: {
    category: 'delivery',
    patterns: [
      /неправильн\w*\s*адрес|адрес\s*(не\s*т|ошиб|друг)/i,
      /manzil\s*(xato|noto'g'ri|boshqa)/i,
      /манзил\s*(хато|нотўғри|бошқа)/i,
    ],
    description: 'Неправильный адрес доставки',
  },
  
  // ============ ПРОБЛЕМЫ С МЕНЮ ============
  menu_wrong_price: {
    category: 'menu',
    patterns: [
      /цен\w*\s*(не\s*совпад|неправильн|устарел|друг)|прайс\s*(устарел|неверн)/i,
      /narx\s*(mos\s*kel|xato|eskirgan)/i,
      /нарх\s*(мос\s*кел|хато|эскирган)/i,
    ],
    description: 'Неправильные цены в меню',
  },
  menu_item_missing: {
    category: 'menu',
    patterns: [
      /позици\w*\s*(нет|отсутств|не\s*отобража)|товар\s*(нет|пропал)/i,
      /mahsulot\s*(yo'q|ko'rinmay)|menyu\s*(yo'q|ko'rinmay)/i,
      /маҳсулот\s*(йўқ|кўринмай)|меню\s*(йўқ|кўринмай)/i,
    ],
    description: 'Позиция отсутствует в меню',
  },
  
  // ============ ПРОБЛЕМЫ С ФИЛИАЛАМИ ============
  branch_wrong: {
    category: 'technical',
    patterns: [
      /филиал\s*(не\s*т|друг|неправильн)|чек\s*(из\s*друг|не\s*т\w*\s*филиал)/i,
      /boshqa\s*filial|filial\s*(xato|noto'g'ri)/i,
      /бошқа\s*филиал|филиал\s*(хато|нотўғри)/i,
    ],
    description: 'Проблема с выбором филиала',
  },
  branch_not_available: {
    category: 'technical',
    patterns: [
      /филиал\s*(не\s*доступ|закрыт|не\s*работа)|регион\s*(не\s*доступ|нет)/i,
      /filial\s*(mavjud\s*emas|yopiq|ishlamay)/i,
      /филиал\s*(мавжуд\s*эмас|ёпиқ|ишламай)/i,
    ],
    description: 'Филиал недоступен',
  },
  
  // ============ ПРОБЛЕМЫ С ИНТЕГРАЦИЯМИ ============
  integration_iiko: {
    category: 'integration',
    patterns: [
      /iiko\s*(не\s*работа|ошибк|не\s*синхрон)/i,
      /iiko\s*(ishlamay|xato|sinxronlanma)/i,
    ],
    description: 'Проблемы с iiko',
  },
  integration_rkeeper: {
    category: 'integration',
    patterns: [
      /r-?keeper\s*(не\s*работа|ошибк|не\s*синхрон)/i,
      /r-?keeper\s*(ishlamay|xato|sinxronlanma)/i,
    ],
    description: 'Проблемы с R-Keeper',
  },
  integration_payment: {
    category: 'integration',
    patterns: [
      /(payme|click|uzcard|humo)\s*(не\s*работа|ошибк)/i,
      /(payme|click|uzcard|humo)\s*(ishlamay|xato)/i,
    ],
    description: 'Проблемы с платёжными системами',
  },
  
  // ============ ЗАПРОСЫ НА ПОДКЛЮЧЕНИЕ ============
  onboarding_new: {
    category: 'onboarding',
    patterns: [
      /подключ|подключить|регистрац|хотим\s*работать|хочу\s*работать|начать\s*работ/i,
      /ulanish|ro'yxatdan|ishlay\s*boshla|hamkorlik/i,
      /уланиш|рўйхатдан|ишлай\s*бошла|ҳамкорлик/i,
    ],
    description: 'Запрос на подключение',
  },
  
  // ============ ЖАЛОБЫ ============
  complaint_service: {
    category: 'complaint',
    patterns: [
      /жалоб|недовол|плохо\s*обслуж|ужас|безобраз/i,
      /shikoyat|norozi|xizmat\s*yomon/i,
      /шикоят|норози|хизмат\s*ёмон/i,
    ],
    description: 'Жалоба на обслуживание',
  },
  complaint_quality: {
    category: 'complaint',
    patterns: [
      /качеств\w*\s*(плох|низк|ужас)|испорчен|некачествен/i,
      /sifat\s*(yomon|past)|buzilgan/i,
      /сифат\s*(ёмон|паст)|бузилган/i,
    ],
    description: 'Жалоба на качество',
  },
}

// Категоризация
const CATEGORIES: Record<string, { label: string; color: string }> = {
  technical: { label: 'Технические', color: 'red' },
  order: { label: 'Заказы', color: 'orange' },
  billing: { label: 'Оплата', color: 'yellow' },
  delivery: { label: 'Доставка', color: 'blue' },
  menu: { label: 'Меню', color: 'green' },
  integration: { label: 'Интеграции', color: 'purple' },
  onboarding: { label: 'Подключение', color: 'teal' },
  complaint: { label: 'Жалобы', color: 'pink' },
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
  const url = new URL(req.url)

  // GET - Получить статистику и примеры проблем
  if (req.method === 'GET') {
    try {
      const limit = parseInt(url.searchParams.get('limit') || '5000')
      
      // Получаем сообщения от клиентов
      const messages = await sql`
        SELECT 
          id,
          text_content,
          ai_category,
          ai_sentiment,
          is_problem,
          created_at
        FROM support_messages
        WHERE sender_role = 'client'
          AND text_content IS NOT NULL
          AND LENGTH(text_content) > 3
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
      
      console.log(`[Analyze Problems] Found ${messages.length} client messages`)
      
      // Анализируем каждое сообщение
      const problemStats: Record<string, { 
        count: number
        examples: Array<{ id: string; text: string; date: string }>
      }> = {}
      
      // Инициализируем статистику
      for (const key of Object.keys(PROBLEM_PATTERNS)) {
        problemStats[key] = { count: 0, examples: [] }
      }
      
      let totalProblems = 0
      let matchedMessages = 0
      
      for (const msg of messages) {
        const text = msg.text_content || ''
        let matched = false
        
        for (const [key, pattern] of Object.entries(PROBLEM_PATTERNS)) {
          for (const regex of pattern.patterns) {
            if (regex.test(text)) {
              matched = true
              problemStats[key].count++
              
              // Сохраняем до 10 примеров для каждого типа
              if (problemStats[key].examples.length < 10) {
                problemStats[key].examples.push({
                  id: msg.id,
                  text: text.slice(0, 200),
                  date: msg.created_at
                })
              }
              break // Один паттерн найден - достаточно
            }
          }
        }
        
        if (matched) {
          matchedMessages++
        }
        
        if (msg.is_problem) {
          totalProblems++
        }
      }
      
      // Группируем по категориям
      const byCategory: Record<string, { 
        total: number
        problems: Array<{ key: string; description: string; count: number; examples: any[] }>
      }> = {}
      
      for (const [key, pattern] of Object.entries(PROBLEM_PATTERNS)) {
        const cat = pattern.category
        if (!byCategory[cat]) {
          byCategory[cat] = { total: 0, problems: [] }
        }
        
        if (problemStats[key].count > 0) {
          byCategory[cat].total += problemStats[key].count
          byCategory[cat].problems.push({
            key,
            description: pattern.description,
            count: problemStats[key].count,
            examples: problemStats[key].examples
          })
        }
      }
      
      // Сортируем проблемы внутри категорий по частоте
      for (const cat of Object.values(byCategory)) {
        cat.problems.sort((a, b) => b.count - a.count)
      }
      
      // Топ-20 проблем по всем категориям
      const allProblems = Object.entries(problemStats)
        .map(([key, stats]) => ({
          key,
          description: PROBLEM_PATTERNS[key].description,
          category: PROBLEM_PATTERNS[key].category,
          count: stats.count,
          examples: stats.examples
        }))
        .filter(p => p.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20)
      
      return json({
        summary: {
          totalMessages: messages.length,
          markedAsProblems: totalProblems,
          matchedByPatterns: matchedMessages,
          uniqueProblemTypes: allProblems.length,
        },
        topProblems: allProblems,
        byCategory: Object.entries(byCategory)
          .map(([cat, data]) => ({
            category: cat,
            label: CATEGORIES[cat]?.label || cat,
            total: data.total,
            problems: data.problems
          }))
          .filter(c => c.total > 0)
          .sort((a, b) => b.total - a.total),
        patterns: Object.entries(PROBLEM_PATTERNS).map(([key, p]) => ({
          key,
          category: p.category,
          description: p.description,
          patternCount: p.patterns.length
        }))
      })
      
    } catch (e: any) {
      console.error('[Analyze Problems] Error:', e)
      return json({ error: e.message }, 500)
    }
  }

  // POST - Сохранить паттерны в базу для обучения
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { action, patterns: customPatterns } = body
      
      if (action === 'save_patterns') {
        // Создаём таблицу для паттернов если не существует
        await sql`
          CREATE TABLE IF NOT EXISTS support_problem_patterns (
            id VARCHAR(100) PRIMARY KEY,
            category VARCHAR(50) NOT NULL,
            description TEXT NOT NULL,
            patterns JSONB NOT NULL,
            examples JSONB DEFAULT '[]',
            match_count INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `
        
        // Сохраняем паттерны
        for (const [key, pattern] of Object.entries(PROBLEM_PATTERNS)) {
          const patternsJson = JSON.stringify(pattern.patterns.map(p => p.source))
          
          await sql`
            INSERT INTO support_problem_patterns (id, category, description, patterns)
            VALUES (${key}, ${pattern.category}, ${pattern.description}, ${patternsJson}::jsonb)
            ON CONFLICT (id) DO UPDATE SET
              category = EXCLUDED.category,
              description = EXCLUDED.description,
              patterns = EXCLUDED.patterns,
              updated_at = NOW()
          `
        }
        
        return json({ success: true, savedPatterns: Object.keys(PROBLEM_PATTERNS).length })
      }
      
      if (action === 'add_pattern' && customPatterns) {
        // Добавить пользовательский паттерн
        const { id, category, description, regexPatterns } = customPatterns
        
        await sql`
          INSERT INTO support_problem_patterns (id, category, description, patterns)
          VALUES (${id}, ${category}, ${description}, ${JSON.stringify(regexPatterns)}::jsonb)
          ON CONFLICT (id) DO UPDATE SET
            category = EXCLUDED.category,
            description = EXCLUDED.description,
            patterns = EXCLUDED.patterns,
            updated_at = NOW()
        `
        
        return json({ success: true, patternId: id })
      }
      
      return json({ error: 'Unknown action' }, 400)
      
    } catch (e: any) {
      console.error('[Analyze Problems] POST Error:', e)
      return json({ error: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
