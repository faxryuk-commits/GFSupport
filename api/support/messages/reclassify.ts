import { neon } from '@neondatabase/serverless'

export const runtime = 'edge'

const CLASSIFY_SQL = `
  UPDATE support_messages SET ai_category = CASE
    WHEN text_content ~* 'подключ|регистрац|новый клиент|хотим работать|ulanish|yangi restoran|hamkorlik' THEN 'onboarding'
    WHEN text_content ~* 'оплат|счёт|счет|деньг|pul|tolov|тариф|подписк|баланс|переплат|narx|summa' THEN 'billing'
    WHEN text_content ~* 'жалоб|недовол|плохо|ужас|shikoyat|хамств|кошмар|обман' THEN 'complaint'
    WHEN text_content ~* 'ошибк|error|не работа|не поступа|не прихо|не загруж|сломал|баг|bug|crash|xato|ishlamay|buzilgan|chiqmay|не могу' THEN 'technical'
    WHEN text_content ~* 'интеграц|api|webhook|iiko|r-keeper|poster|payme|click|uzkassa|jowi' THEN 'integration'
    WHEN text_content ~* 'заказ|order|buyurtma|zakaz|чек|chek|корзин' THEN 'order'
    WHEN text_content ~* 'доставк|курьер|yetkazib|dostavka' THEN 'delivery'
    WHEN text_content ~* 'меню|блюд|товар|mahsulot|menyu|tovar|ассортимент' THEN 'menu'
    WHEN text_content ~* 'приложен|мобильн|android|ios|ilova' THEN 'app'
    WHEN text_content ~* 'подскажите|как сделать|как настроить|как мне|где найти|qanday|помогите' THEN 'question'
    WHEN text_content ~* 'спасибо|благодар|отлично|rahmat|молодц' THEN 'feedback'
    WHEN text_content ~* 'филиал|filial|регион|адрес|manzil' THEN 'technical'
    ELSE 'general'
  END
`

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  const sql = neon(process.env.DATABASE_URL!)

  try {
    const before = await sql`
      SELECT COUNT(*) as cnt FROM support_messages
      WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
        AND text_content IS NOT NULL AND LENGTH(text_content) > 2
    `
    const totalUncategorized = parseInt(before[0]?.cnt || '0')

    if (totalUncategorized === 0) {
      return new Response(JSON.stringify({ success: true, classified: 0, message: 'Все сообщения уже классифицированы' }))
    }

    // Process in batches of 200 to avoid edge timeout
    let totalClassified = 0
    const maxBatches = 5
    for (let i = 0; i < maxBatches; i++) {
      const result = await sql`
        UPDATE support_messages SET ai_category = CASE
          WHEN text_content ~* 'подключ|регистрац|новый клиент|хотим работать|ulanish|yangi restoran|hamkorlik' THEN 'onboarding'
          WHEN text_content ~* 'оплат|счёт|счет|деньг|pul|tolov|тариф|подписк|баланс|переплат|narx|summa' THEN 'billing'
          WHEN text_content ~* 'жалоб|недовол|плохо|ужас|shikoyat|хамств|кошмар|обман' THEN 'complaint'
          WHEN text_content ~* 'ошибк|error|не работа|не поступа|не прихо|не загруж|сломал|баг|bug|crash|xato|ishlamay|buzilgan|chiqmay|не могу' THEN 'technical'
          WHEN text_content ~* 'интеграц|api|webhook|iiko|r-keeper|poster|payme|click|uzkassa|jowi' THEN 'integration'
          WHEN text_content ~* 'заказ|order|buyurtma|zakaz|чек|chek|корзин' THEN 'order'
          WHEN text_content ~* 'доставк|курьер|yetkazib|dostavka' THEN 'delivery'
          WHEN text_content ~* 'меню|блюд|товар|mahsulot|menyu|tovar|ассортимент' THEN 'menu'
          WHEN text_content ~* 'приложен|мобильн|android|ios|ilova' THEN 'app'
          WHEN text_content ~* 'подскажите|как сделать|как настроить|как мне|где найти|qanday|помогите' THEN 'question'
          WHEN text_content ~* 'спасибо|благодар|отлично|rahmat|молодц' THEN 'feedback'
          WHEN text_content ~* 'филиал|filial|регион|адрес|manzil' THEN 'technical'
          ELSE 'general'
        END
        WHERE id IN (
          SELECT id FROM support_messages
          WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
            AND text_content IS NOT NULL AND LENGTH(text_content) > 2
          LIMIT 200
        )
        RETURNING id
      `
      totalClassified += result.length
      if (result.length < 200) break
    }

    // Stats
    const after = await sql`
      SELECT ai_category, COUNT(*) as cnt FROM support_messages
      WHERE ai_category IS NOT NULL AND ai_category != ''
      GROUP BY ai_category ORDER BY cnt DESC
    `
    const stats: Record<string, number> = {}
    for (const row of after) {
      stats[row.ai_category] = parseInt(row.cnt)
    }

    return new Response(JSON.stringify({
      success: true,
      uncategorizedBefore: totalUncategorized,
      classified: totalClassified,
      categoriesAfter: stats,
    }))
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}
