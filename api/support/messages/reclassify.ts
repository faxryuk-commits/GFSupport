import { neon } from '@neondatabase/serverless'

export const runtime = 'edge'

const ALL_RULES: Record<string, string[]> = {
  billing: ['%оплат%', '%тариф%', '%баланс%', '%tolov%'],
  technical: ['%ошибк%', '%не работа%', '%сломал%', '%xato%', '%ishlamay%'],
  order: ['%заказ%', '%buyurtma%'],
  delivery: ['%доставк%', '%курьер%'],
  integration: ['%iiko%', '%интеграц%', '%webhook%'],
  menu: ['%меню%', '%товар%', '%mahsulot%'],
  app: ['%приложен%', '%android%'],
  question: ['%подскажите%', '%как сделать%', '%помогите%'],
  complaint: ['%жалоб%', '%недовол%'],
  feedback: ['%спасибо%', '%rahmat%'],
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({
      error: 'POST required',
      usage: 'POST with {"category":"billing"} or {"category":"all"} (one at a time)',
      available: Object.keys(ALL_RULES),
    }), { status: 405 })
  }

  const sql = neon(process.env.DATABASE_URL!)

  try {
    const { category = 'all' } = await req.json().catch(() => ({ category: 'all' }))

    if (category === 'all') {
      // Process one category — pick the first unprocessed
      for (const [cat, patterns] of Object.entries(ALL_RULES)) {
        for (const p of patterns) {
          const check = await sql`
            SELECT COUNT(*) as cnt FROM support_messages
            WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
              AND LOWER(text_content) LIKE ${p} LIMIT 1
          `
          if (parseInt(check[0]?.cnt || '0') > 0) {
            await sql`
              UPDATE support_messages SET ai_category = ${cat}
              WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
                AND LOWER(text_content) LIKE ${p}
            `
            return new Response(JSON.stringify({ success: true, processed: cat, pattern: p }))
          }
        }
      }

      // All specific done — set remaining to general
      await sql`
        UPDATE support_messages SET ai_category = 'general'
        WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
          AND text_content IS NOT NULL AND LENGTH(text_content) > 5
      `
      return new Response(JSON.stringify({ success: true, processed: 'general', message: 'done' }))
    }

    // Specific category
    const patterns = ALL_RULES[category]
    if (!patterns) {
      return new Response(JSON.stringify({ error: `Unknown: ${category}`, available: Object.keys(ALL_RULES) }), { status: 400 })
    }

    for (const p of patterns) {
      await sql`
        UPDATE support_messages SET ai_category = ${category}
        WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
          AND LOWER(text_content) LIKE ${p}
      `
    }

    return new Response(JSON.stringify({ success: true, processed: category }))
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}
