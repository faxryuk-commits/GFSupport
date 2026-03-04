import { neon } from '@neondatabase/serverless'

export const runtime = 'edge'

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405 })
  }

  const sql = neon(process.env.DATABASE_URL!)

  try {
    const { days = 30 } = await req.json().catch(() => ({ days: 30 }))

    const rules: [string, string][] = [
      ['billing', '%оплат%'], ['billing', '%тариф%'], ['billing', '%баланс%'], ['billing', '%tolov%'], ['billing', '%счёт%'], ['billing', '%счет%'], ['billing', '%подписк%'],
      ['technical', '%ошибк%'], ['technical', '%не работа%'], ['technical', '%xato%'], ['technical', '%ishlamay%'], ['technical', '%баг%'], ['technical', '%глюч%'], ['technical', '%завис%'], ['technical', '%не загруж%'], ['technical', '%не открыва%'],
      ['integration', '%iiko%'], ['integration', '%интеграц%'], ['integration', '%webhook%'], ['integration', '%api%'], ['integration', '%подключ%'],
      ['order', '%заказ%'], ['order', '%buyurtma%'], ['order', '%чек%'], ['order', '%корзин%'], ['order', '%оформлен%'],
      ['delivery', '%доставк%'], ['delivery', '%курьер%'], ['delivery', '%yetkazib%'], ['delivery', '%адрес%'],
      ['menu', '%меню%'], ['menu', '%товар%'], ['menu', '%mahsulot%'], ['menu', '%продукт%'], ['menu', '%блюд%'], ['menu', '%позици%'], ['menu', '%каталог%'],
      ['app', '%приложен%'], ['app', '%android%'], ['app', '%ios%'], ['app', '%мобильн%'], ['app', '%ilova%'],
      ['question', '%подскажите%'], ['question', '%помогите%'], ['question', '%вопрос%'], ['question', '%объясни%'], ['question', '%savol%'],
      ['feedback', '%спасибо%'], ['feedback', '%rahmat%'], ['feedback', '%отлично%'], ['feedback', '%класс%'], ['feedback', '%молодц%'],
      ['complaint', '%жалоб%'], ['complaint', '%недовол%'], ['complaint', '%плохо%'], ['complaint', '%ужасн%'], ['complaint', '%возврат%'],
      ['onboarding', '%регистрац%'], ['onboarding', '%подключен%'], ['onboarding', '%настрой%'], ['onboarding', '%начать%'],
      ['feature_request', '%предложен%'], ['feature_request', '%хотел бы%'], ['feature_request', '%добавьте%'], ['feature_request', '%было бы%'],
    ]

    for (const [cat, p] of rules) {
      await sql`
        UPDATE support_messages SET ai_category = ${cat}
        WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
          AND LOWER(text_content) LIKE ${p}
          AND created_at > NOW() - make_interval(days => ${days})
      `
    }

    await sql`
      UPDATE support_messages SET ai_category = 'general'
      WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
        AND text_content IS NOT NULL AND LENGTH(text_content) > 10
        AND created_at > NOW() - make_interval(days => ${days})
    `

    const stats = await sql`
      SELECT ai_category, COUNT(*) as cnt FROM support_messages
      WHERE ai_category IS NOT NULL AND ai_category != ''
        AND created_at > NOW() - make_interval(days => ${days})
      GROUP BY ai_category ORDER BY cnt DESC
    `
    const result: Record<string, number> = {}
    for (const row of stats) result[row.ai_category] = parseInt(row.cnt)

    return new Response(JSON.stringify({ success: true, days, categories: result }))
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}
