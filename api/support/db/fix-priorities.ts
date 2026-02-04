import { getSQL } from '../lib/db.js'

export const config = { runtime: 'edge' }

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

// Определение реального приоритета на основе текста
function determinePriority(title: string, description: string, category: string): string {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase()
  
  // CRITICAL - только реальные критические проблемы
  const criticalPatterns = [
    /все\s*(заказы|клиенты|филиалы).*не\s*работа/,
    /полностью\s*(не работает|сломал|остановил)/,
    /критичн|срочно|emergency|asap/,
    /массов(ая|ый|ое)\s*(проблем|сбой|отказ)/,
  ]
  if (criticalPatterns.some(p => p.test(text))) {
    return 'critical'
  }
  
  // URGENT - срочные проблемы с активными заказами/платежами
  const urgentPatterns = [
    /заказ.*не\s*(проход|принима|отправля)/,
    /оплат.*не\s*(проход|работа|принима)/,
    /клиент\s*ждет|ждут\s*клиент/,
    /сейчас\s*не\s*работает/,
    /прямо\s*сейчас/,
  ]
  if (urgentPatterns.some(p => p.test(text))) {
    return 'urgent'
  }
  
  // HIGH - технические проблемы
  const highPatterns = [
    /не\s*работает|ishlamayapti|не\s*печата|не\s*синхрон/,
    /ошибка|error|xatolik|oshibka/,
    /интеграци.*проблем|проблем.*интеграци/,
    /iiko|rkeeper|poster|yandex.*eat|wolt|uzum/i,
  ]
  if (highPatterns.some(p => p.test(text)) || category === 'technical' || category === 'integration') {
    return 'high'
  }
  
  // LOW - простые обращения
  const lowPatterns = [
    /спасибо|rahmat|благодар/,
    /как\s*(сделать|настроить|подключить)/,
    /вопрос\s*по|интересует/,
    /можно\s*ли/,
  ]
  if (lowPatterns.some(p => p.test(text)) || category === 'question' || category === 'feature_request') {
    return 'low'
  }
  
  // По умолчанию - MEDIUM
  return 'medium'
}

export async function GET() {
  try {
    const sql = getSQL()
    
    // Получаем все кейсы
    const cases = await sql`
      SELECT id, title, description, category, priority
      FROM support_cases
      ORDER BY created_at DESC
    `
    
    const updates: { id: string; oldPriority: string; newPriority: string; title: string }[] = []
    const stats = { critical: 0, urgent: 0, high: 0, medium: 0, low: 0 }
    
    for (const c of cases) {
      const newPriority = determinePriority(c.title || '', c.description || '', c.category || '')
      stats[newPriority as keyof typeof stats]++
      
      if (c.priority !== newPriority) {
        await sql`
          UPDATE support_cases 
          SET priority = ${newPriority}
          WHERE id = ${c.id}
        `
        updates.push({
          id: c.id,
          oldPriority: c.priority,
          newPriority,
          title: (c.title || '').slice(0, 50)
        })
      }
    }
    
    return json({
      success: true,
      totalCases: cases.length,
      updated: updates.length,
      newDistribution: stats,
      samples: updates.slice(0, 10)
    })
    
  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
