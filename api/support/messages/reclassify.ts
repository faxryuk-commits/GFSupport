import { neon } from '@neondatabase/serverless'

export const maxDuration = 60

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  const sql = neon(process.env.DATABASE_URL!)

  try {
    const rules: [string, string][] = [
      ['billing', '%оплат%'], ['billing', '%тариф%'], ['billing', '%баланс%'], ['billing', '%tolov%'],
      ['technical', '%ошибк%'], ['technical', '%не работа%'], ['technical', '%сломал%'], ['technical', '%xato%'], ['technical', '%ishlamay%'], ['technical', '%error%'],
      ['order', '%заказ%'], ['order', '%buyurtma%'],
      ['delivery', '%доставк%'], ['delivery', '%курьер%'],
      ['integration', '%iiko%'], ['integration', '%интеграц%'], ['integration', '%webhook%'],
      ['menu', '%меню%'], ['menu', '%товар%'], ['menu', '%mahsulot%'],
      ['app', '%приложен%'], ['app', '%android%'],
      ['question', '%подскажите%'], ['question', '%как сделать%'], ['question', '%помогите%'],
      ['complaint', '%жалоб%'], ['complaint', '%недовол%'],
      ['feedback', '%спасибо%'], ['feedback', '%rahmat%'],
    ]

    let updated = 0
    for (const [cat, pattern] of rules) {
      const r = await sql`
        UPDATE support_messages SET ai_category = ${cat}
        WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
          AND text_content IS NOT NULL AND LENGTH(text_content) > 2
          AND LOWER(text_content) LIKE ${pattern}
        RETURNING id
      `
      updated += r.length
    }

    // Remaining → general
    const g = await sql`
      UPDATE support_messages SET ai_category = 'general'
      WHERE (ai_category IS NULL OR ai_category = '' OR ai_category = 'unknown')
        AND text_content IS NOT NULL AND LENGTH(text_content) > 5
      RETURNING id
    `
    updated += g.length

    return new Response(JSON.stringify({ success: true, updated, generalAssigned: g.length }))
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}
