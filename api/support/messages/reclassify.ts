import { neon } from '@neondatabase/serverless'

export const runtime = 'edge'

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  const sql = neon(process.env.DATABASE_URL!)

  try {
    // Simple single-pass UPDATE with CASE WHEN + ILIKE, LIMIT 300
    await sql`
      UPDATE support_messages SET ai_category = CASE
        WHEN LOWER(text_content) LIKE '%оплат%' OR LOWER(text_content) LIKE '%тариф%' OR LOWER(text_content) LIKE '%баланс%' OR LOWER(text_content) LIKE '%tolov%' THEN 'billing'
        WHEN LOWER(text_content) LIKE '%ошибк%' OR LOWER(text_content) LIKE '%не работа%' OR LOWER(text_content) LIKE '%сломал%' OR LOWER(text_content) LIKE '%xato%' OR LOWER(text_content) LIKE '%ishlamay%' OR LOWER(text_content) LIKE '%error%' THEN 'technical'
        WHEN LOWER(text_content) LIKE '%заказ%' OR LOWER(text_content) LIKE '%buyurtma%' OR LOWER(text_content) LIKE '%чек %' THEN 'order'
        WHEN LOWER(text_content) LIKE '%доставк%' OR LOWER(text_content) LIKE '%курьер%' THEN 'delivery'
        WHEN LOWER(text_content) LIKE '%интеграц%' OR LOWER(text_content) LIKE '%iiko%' OR LOWER(text_content) LIKE '%webhook%' THEN 'integration'
        WHEN LOWER(text_content) LIKE '%меню%' OR LOWER(text_content) LIKE '%товар%' OR LOWER(text_content) LIKE '%mahsulot%' THEN 'menu'
        WHEN LOWER(text_content) LIKE '%приложен%' OR LOWER(text_content) LIKE '%android%' OR LOWER(text_content) LIKE '%ilova%' THEN 'app'
        WHEN LOWER(text_content) LIKE '%подскажите%' OR LOWER(text_content) LIKE '%как сделать%' OR LOWER(text_content) LIKE '%помогите%' THEN 'question'
        WHEN LOWER(text_content) LIKE '%жалоб%' OR LOWER(text_content) LIKE '%недовол%' THEN 'complaint'
        WHEN LOWER(text_content) LIKE '%спасибо%' OR LOWER(text_content) LIKE '%rahmat%' THEN 'feedback'
        ELSE 'general'
      END
      WHERE id IN (
        SELECT id FROM support_messages
        WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
          AND text_content IS NOT NULL AND LENGTH(text_content) > 2
        LIMIT 300
      )
    `

    const stats = await sql`
      SELECT ai_category, COUNT(*) as cnt FROM support_messages
      WHERE ai_category IS NOT NULL AND ai_category != ''
      GROUP BY ai_category ORDER BY cnt DESC
    `

    const remaining = await sql`
      SELECT COUNT(*) as cnt FROM support_messages
      WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
        AND text_content IS NOT NULL AND LENGTH(text_content) > 2
    `

    const result: Record<string, number> = {}
    for (const row of stats) result[row.ai_category] = parseInt(row.cnt)

    return new Response(JSON.stringify({
      success: true,
      remaining: parseInt(remaining[0]?.cnt || '0'),
      categories: result,
    }))
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}
