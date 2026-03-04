import { neon } from '@neondatabase/serverless'

export const maxDuration = 60

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  const sql = neon(process.env.DATABASE_URL!)

  try {
    const rules: [string, string[]][] = [
      ['billing', ['%оплат%', '%тариф%', '%баланс%', '%tolov%']],
      ['technical', ['%ошибк%', '%не работа%', '%сломал%', '%xato%', '%ishlamay%', '%error%']],
      ['order', ['%заказ%', '%buyurtma%']],
      ['delivery', ['%доставк%', '%курьер%']],
      ['integration', ['%iiko%', '%интеграц%', '%webhook%']],
      ['menu', ['%меню%', '%товар%', '%mahsulot%']],
      ['app', ['%приложен%', '%android%']],
      ['question', ['%подскажите%', '%как сделать%', '%помогите%']],
      ['complaint', ['%жалоб%', '%недовол%']],
      ['feedback', ['%спасибо%', '%rahmat%']],
    ]

    for (const [cat, patterns] of rules) {
      for (const p of patterns) {
        await sql`
          UPDATE support_messages SET ai_category = ${cat}
          WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
            AND LOWER(text_content) LIKE ${p}
        `
      }
    }

    await sql`
      UPDATE support_messages SET ai_category = 'general'
      WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
        AND text_content IS NOT NULL AND LENGTH(text_content) > 5
    `

    const stats = await sql`
      SELECT ai_category, COUNT(*) as cnt FROM support_messages
      WHERE ai_category IS NOT NULL AND ai_category != ''
      GROUP BY ai_category ORDER BY cnt DESC
    `
    const result: Record<string, number> = {}
    for (const row of stats) result[row.ai_category] = parseInt(row.cnt)

    return new Response(JSON.stringify({ success: true, categories: result }))
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}
