import { getSQL } from '../lib/db.js'

export const config = { runtime: 'edge' }

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

export async function GET() {
  try {
    const sql = getSQL()
    
    // Batch update using SQL CASE statements for speed
    // LOW: благодарности, вопросы
    const lowResult = await sql`
      UPDATE support_cases 
      SET priority = 'low'
      WHERE priority != 'low'
        AND (
          LOWER(title || ' ' || COALESCE(description, '')) ~ '(спасибо|rahmat|благодар|как сделать|как настроить|вопрос по|можно ли)'
          OR category IN ('question', 'feature_request', 'feedback')
        )
      RETURNING id
    `
    
    // CRITICAL: критичные проблемы
    const criticalResult = await sql`
      UPDATE support_cases 
      SET priority = 'critical'
      WHERE priority != 'critical'
        AND LOWER(title || ' ' || COALESCE(description, '')) ~ '(все.*(заказы|клиенты|филиалы).*не.*работа|полностью.*(не работает|сломал)|критичн|срочно|emergency|asap|массов.*(проблем|сбой))'
      RETURNING id
    `
    
    // URGENT: срочные с заказами/оплатой
    const urgentResult = await sql`
      UPDATE support_cases 
      SET priority = 'urgent'
      WHERE priority NOT IN ('critical', 'urgent')
        AND LOWER(title || ' ' || COALESCE(description, '')) ~ '(заказ.*не.*(проход|принима|отправля)|оплат.*не.*(проход|работа)|клиент.*ждет|сейчас не работает|прямо сейчас)'
      RETURNING id
    `
    
    // HIGH: технические проблемы
    const highResult = await sql`
      UPDATE support_cases 
      SET priority = 'high'
      WHERE priority NOT IN ('critical', 'urgent', 'high', 'low')
        AND (
          LOWER(title || ' ' || COALESCE(description, '')) ~ '(не работает|ishlamayapti|не печата|не синхрон|ошибка|error|xatolik|интеграци)'
          OR category IN ('technical', 'integration')
        )
      RETURNING id
    `
    
    // MEDIUM: остальные
    const mediumResult = await sql`
      UPDATE support_cases 
      SET priority = 'medium'
      WHERE priority NOT IN ('critical', 'urgent', 'high', 'low', 'medium')
      RETURNING id
    `
    
    // Get final distribution
    const distribution = await sql`
      SELECT priority, COUNT(*) as count 
      FROM support_cases 
      GROUP BY priority
    `
    
    const stats: Record<string, number> = {}
    for (const row of distribution) {
      stats[row.priority] = Number(row.count)
    }
    
    return json({
      success: true,
      updated: {
        low: lowResult.length,
        critical: criticalResult.length,
        urgent: urgentResult.length,
        high: highResult.length,
        medium: mediumResult.length
      },
      newDistribution: stats
    })
    
  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
