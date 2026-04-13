import { getSQL, json } from '../lib/db.js'
export const config = {
  runtime: 'edge',
}

/**
 * POST /api/support/cases/fix-numbers
 * 
 * Присваивает номера тикетам у которых их нет
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Use POST' }, 405)
  }

  // Allow admin access
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || (!authHeader.includes('admin') && !authHeader.startsWith('Bearer '))) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()

  try {
    // 1. Создаем sequence если не существует
    try {
      await sql`CREATE SEQUENCE IF NOT EXISTS support_case_ticket_seq START WITH 1000`
    } catch (e) {
      console.log('Sequence exists or error:', e)
    }

    // 2. Получаем максимальный существующий номер
    const maxResult = await sql`
      SELECT COALESCE(MAX(ticket_number), 999) as max_num 
      FROM support_cases 
      WHERE ticket_number IS NOT NULL
    `
    const maxNum = parseInt(maxResult[0]?.max_num || '999')

    // 3. Устанавливаем sequence на max + 1
    await sql`SELECT setval('support_case_ticket_seq', ${maxNum}, true)`

    // 4. Получаем все кейсы без номера
    const casesWithoutNumber = await sql`
      SELECT id FROM support_cases 
      WHERE ticket_number IS NULL 
      ORDER BY created_at ASC
    `

    // 5. Присваиваем номера
    let updated = 0
    for (const c of casesWithoutNumber) {
      try {
        const nextNum = await sql`SELECT nextval('support_case_ticket_seq') as num`
        const ticketNum = parseInt(nextNum[0].num)
        await sql`UPDATE support_cases SET ticket_number = ${ticketNum} WHERE id = ${c.id}`
        updated++
      } catch (e) {
        console.error('Error updating case:', c.id, e)
      }
    }

    // 6. Проверяем результат
    const stillNull = await sql`
      SELECT COUNT(*) as count FROM support_cases WHERE ticket_number IS NULL
    `

    return json({
      success: true,
      maxExistingNumber: maxNum,
      casesUpdated: updated,
      casesStillWithoutNumber: parseInt(stillNull[0]?.count || '0')
    })

  } catch (e: any) {
    console.error('Fix numbers error:', e)
    return json({ error: 'Failed to fix numbers' }, 500)
  }
}
