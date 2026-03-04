import { neon } from '@neondatabase/serverless'

export const runtime = 'edge'

const CATEGORY_KEYWORDS: [string, string[]][] = [
  ['onboarding', ['%подключ%', '%регистрац%', '%новый клиент%', '%ulanish%', '%yangi restoran%', '%hamkorlik%']],
  ['billing', ['%оплат%', '%счёт%', '%счет%', '%деньг%', '%тариф%', '%подписк%', '%баланс%', '%tolov%', '%narx%', '%summa%']],
  ['complaint', ['%жалоб%', '%недовол%', '%ужас%', '%shikoyat%', '%хамств%', '%кошмар%', '%обман%']],
  ['technical', ['%ошибк%', '%не работа%', '%не поступа%', '%не прихо%', '%не загруж%', '%сломал%', '%crash%', '%xato%', '%ishlamay%', '%buzilgan%', '%chiqmay%', '%не могу%', '%error%']],
  ['integration', ['%интеграц%', '%iiko%', '%r-keeper%', '%poster%', '%payme%', '%click%', '%webhook%', '%uzkassa%', '%jowi%']],
  ['order', ['%заказ%', '%buyurtma%', '%zakaz%', '%корзин%']],
  ['delivery', ['%доставк%', '%курьер%', '%yetkazib%', '%dostavka%']],
  ['menu', ['%меню%', '%товар%', '%mahsulot%', '%menyu%', '%ассортимент%']],
  ['app', ['%приложен%', '%android%', '%ios%', '%ilova%']],
  ['question', ['%подскажите%', '%как сделать%', '%как настроить%', '%как мне%', '%где найти%', '%qanday%', '%помогите%']],
  ['feedback', ['%спасибо%', '%благодар%', '%отлично%', '%rahmat%', '%молодц%']],
]

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

    let totalClassified = 0
    const stats: Record<string, number> = {}

    for (const [category, keywords] of CATEGORY_KEYWORDS) {
      const conditions = keywords.map(k => `LOWER(text_content) LIKE '${k}'`).join(' OR ')
      const result = await sql(`
        UPDATE support_messages SET ai_category = '${category}'
        WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
          AND text_content IS NOT NULL AND LENGTH(text_content) > 2
          AND (${conditions})
        RETURNING id
      `)
      if (result.length > 0) {
        totalClassified += result.length
        stats[category] = result.length
      }
    }

    // Remaining uncategorized > 5 chars → 'general'
    const generalResult = await sql`
      UPDATE support_messages SET ai_category = 'general'
      WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
        AND text_content IS NOT NULL AND LENGTH(text_content) > 5
      RETURNING id
    `
    if (generalResult.length > 0) {
      totalClassified += generalResult.length
      stats['general'] = generalResult.length
    }

    return new Response(JSON.stringify({
      success: true,
      uncategorizedBefore: parseInt(before[0]?.cnt || '0'),
      classified: totalClassified,
      stats,
    }))
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}
