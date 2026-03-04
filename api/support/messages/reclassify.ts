import { neon } from '@neondatabase/serverless'

export const runtime = 'edge'

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  const sql = neon(process.env.DATABASE_URL!)

  try {
    // Count before
    const before = await sql`
      SELECT COUNT(*) as cnt FROM support_messages
      WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
        AND text_content IS NOT NULL AND LENGTH(text_content) > 2
    `

    // Single batch UPDATE with CASE WHEN — no loop, one query
    const result = await sql`
      UPDATE support_messages SET ai_category = CASE
        WHEN text_content ~* 'подключ|регистрац|зарегистр|новый клиент|хотим работать|хочу работать|начать работ|ulanish|yangi restoran|yangi mijoz|hamkorlik' THEN 'onboarding'
        WHEN text_content ~* 'оплат|счёт|счет|деньг|pul|tolov|тариф|подписк|баланс|balans|oplata|переплат|недоплат|narx|summa' THEN 'billing'
        WHEN text_content ~* 'жалоб|недовол|плохо|ужас|shikoyat|хамств|безобраз|кошмар|обман' THEN 'complaint'
        WHEN text_content ~* 'ошибк|error|не работа|не поступа|не прихо|не загруж|не открыва|не сохран|не отправ|не печата|сломал|баг|bug|глючит|виснет|crash|xato|xatolik|ishlamay|buzilgan|chiqmay|bosmay|urilmay|tushmay|aktualmas|не отобража|не видн|не могу' THEN 'technical'
        WHEN text_content ~* 'интеграц|api|webhook|iiko|r-keeper|poster|wolt|payme|click|uzsmart|uzkassa|jowi|iikocard' THEN 'integration'
        WHEN text_content ~* 'заказ|order|buyurtma|zakaz|чек|chek|корзин|savat|заявк' THEN 'order'
        WHEN text_content ~* 'доставк|курьер|yetkazib|dostavka|yetkazma' THEN 'delivery'
        WHEN text_content ~* 'меню|блюд|товар|позици|mahsulot|taom|menyu|tovar|ассортимент|номенклатур' THEN 'menu'
        WHEN text_content ~* 'приложен|мобильн|android|ios|ilova|apk' THEN 'app'
        WHEN text_content ~* 'можно ли|хотел бы|добавьте|kerak|предлага|улучш|пожелан|реализов' THEN 'feature_request'
        WHEN text_content ~* 'подскажите|как сделать|как настроить|как включить|как мне|где найти|qanday|qayerda|помогите|объясните|можно узнать' THEN 'question'
        WHEN text_content ~* 'спасибо|благодар|отлично|супер|хорошо|rahmat|молодц|класс|здорово|great|thank' THEN 'feedback'
        WHEN text_content ~* 'филиал|filial|регион|region|адрес|address|manzil|локаци' THEN 'technical'
        WHEN text_content ~* 'статус|status|holat|состояни|когда будет|qachon|что с моим' THEN 'question'
        WHEN LENGTH(text_content) > 20 AND text_content ~ '\\?' THEN 'question'
        ELSE 'general'
      END
      WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
        AND text_content IS NOT NULL
        AND LENGTH(text_content) > 2
    `

    // Count after
    const after = await sql`
      SELECT ai_category, COUNT(*) as cnt FROM support_messages
      WHERE ai_category IS NOT NULL AND ai_category != ''
      GROUP BY ai_category
      ORDER BY cnt DESC
    `

    const stats: Record<string, number> = {}
    for (const row of after) {
      stats[row.ai_category] = parseInt(row.cnt)
    }

    return new Response(JSON.stringify({
      success: true,
      uncategorizedBefore: parseInt(before[0]?.cnt || '0'),
      categoriesAfter: stats,
    }))
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}
