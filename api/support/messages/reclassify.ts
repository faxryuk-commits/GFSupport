import { neon } from '@neondatabase/serverless'

export const runtime = 'edge'

function classifyText(text: string): string {
  if (!text || text.length < 2) return 'general'
  const lower = text.toLowerCase()

  // Onboarding
  if (/подключ|регистрац|зарегистр|новый клиент|новое заведен|хотим работать|хочу работать|начать работ|присоединить|сотруднича|ulanish|ro'yxatdan|yangi restoran|yangi mijoz|ishlay boshla|hamkorlik/i.test(lower)) return 'onboarding'

  // Billing
  if (/оплат|счёт|счет|деньг|pul|tolov|тариф|подписк|сумм\w*\s*не|цен\w*\s*не|переплат|недоплат|narx|summa|to'lov|баланс|balans|oplata/i.test(lower)) return 'billing'
  if (/\d+\s*(а|но|если)\s*(оплат|заказ|сумм|чек).*\d+/i.test(lower)) return 'billing'

  // Complaint
  if (/жалоб|недовол|плохо|ужас|shikoyat|хамств|безобраз|кошмар|обман/i.test(lower)) return 'complaint'

  // Technical
  if (/ошибк|error|не работа|не поступа|не прихо|не загруж|не открыва|не сохран|не отправ|не печата|не выход|сломал|баг|bug|глючит|виснет|crash|xato|xatolik|ishlamay|buzilgan|chiqmay|bosmay|o'zgarmay|urilmay|tushmay|yopilmay|aktualmas|не отобража|не видн|не могу/i.test(lower)) return 'technical'

  // Integration
  if (/интеграц|api|webhook|iiko|r-keeper|poster|wolt|payme|click|uzsmart|uzkassa|jowi|join|iikocard|telegram.*bot|бот/i.test(lower)) return 'integration'

  // Order
  if (/заказ|order|buyurtma|zakaz|чек|chek|корзин|savat|basket|заявк|zayavka/i.test(lower)) return 'order'

  // Delivery
  if (/доставк|курьер|yetkazib|dostavka|yetkazma|qayerga|адрес.*доставк/i.test(lower)) return 'delivery'

  // Menu
  if (/меню|блюд|товар|позици|цен\w*\s*товар|категори\w*\s*товар|mahsulot|taom|menyu|narx|tovar|assortiment|ассортимент|номенклатур/i.test(lower)) return 'menu'

  // App
  if (/приложен|app\b|мобильн|android|ios|ilova|apk|скачать.*прилож|обновить.*прилож|обновлен/i.test(lower)) return 'app'

  // Feature request
  if (/можно ли|хотел бы|добавьте|kerak|предлага|улучш|пожелан|реализов|внедрить|suggestion|request/i.test(lower)) return 'feature_request'

  // Question
  if (/как\s+(сделать|настроить|включить|отключить|подключить|изменить|удалить|добавить)/i.test(lower)) return 'question'
  if (/подскажите|как\s+мне|где\s+найти|где\s+находит|qanday|qayerda|nima\s+qilish|qanday\s+qilish/i.test(lower)) return 'question'
  if (/можно\s+(ли|узнать)|скажите|расскажите|объясните|помогите/i.test(lower)) return 'question'

  // Feedback
  if (/спасибо|благодар|отлично|супер|хорошо|rahmat|zo'r|молодц|класс|здорово|great|thank/i.test(lower)) return 'feedback'

  // Greeting (short messages)
  if (/^(здравствуйте|привет|добрый\s*(день|утро|вечер)|assalomu|salom|hello|hi)\b/i.test(lower)) return 'general'

  // Branch/location issues
  if (/филиал|filial|регион|region|адрес|address|manzil|локаци|координат/i.test(lower)) return 'technical'

  // Status inquiry
  if (/статус|status|holat|состояни|когда\s+будет|qachon|nima\s+bo'ldi|что\s+с\s+моим/i.test(lower)) return 'question'

  // If message has enough text but wasn't caught - try broader patterns
  if (lower.length > 20) {
    if (/\?/.test(text)) return 'question'
    if (/не\s+\w+|emas|yo'q|йўқ/i.test(lower)) return 'technical'
  }

  return 'general'
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  const sql = neon(process.env.DATABASE_URL!)

  try {
    const { limit = 500 } = await req.json().catch(() => ({}))

    // Fetch uncategorized messages with text
    const uncategorized = await sql`
      SELECT id, text_content
      FROM support_messages
      WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
        AND text_content IS NOT NULL
        AND LENGTH(text_content) > 2
      ORDER BY created_at DESC
      LIMIT ${limit}
    `

    if (uncategorized.length === 0) {
      return new Response(JSON.stringify({ success: true, classified: 0, message: 'Все сообщения уже классифицированы' }))
    }

    let classified = 0
    const stats: Record<string, number> = {}

    for (const msg of uncategorized) {
      const category = classifyText(msg.text_content)
      if (category !== 'general' || msg.text_content.length > 5) {
        await sql`UPDATE support_messages SET ai_category = ${category} WHERE id = ${msg.id} AND (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')`
        classified++
        stats[category] = (stats[category] || 0) + 1
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total: uncategorized.length,
      classified,
      stats,
    }))
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}
