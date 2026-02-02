import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

/**
 * POST /api/support/db/add-ticket-column
 * 
 * Добавляет колонку ticket_number и присваивает номера
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Use POST' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || (!authHeader.includes('admin') && !authHeader.startsWith('Bearer '))) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const steps: string[] = []

  try {
    // 1. Добавляем колонку
    try {
      await sql`ALTER TABLE support_cases ADD COLUMN ticket_number INTEGER`
      steps.push('Added ticket_number column')
    } catch (e: any) {
      if (e.message?.includes('already exists')) {
        steps.push('Column ticket_number already exists')
      } else {
        throw e
      }
    }

    // 2. Создаем sequence
    try {
      await sql`CREATE SEQUENCE support_case_ticket_seq START WITH 1000`
      steps.push('Created sequence')
    } catch (e: any) {
      if (e.message?.includes('already exists')) {
        steps.push('Sequence already exists')
      } else {
        throw e
      }
    }

    // 3. Получаем все кейсы без номера, отсортированные по дате
    const casesWithoutNumber = await sql`
      SELECT id, created_at FROM support_cases 
      WHERE ticket_number IS NULL 
      ORDER BY created_at ASC
    `
    
    steps.push(`Found ${casesWithoutNumber.length} cases without ticket number`)

    // 4. Присваиваем простые номера начиная с 1001
    let counter = 1001
    let updated = 0
    
    for (const c of casesWithoutNumber) {
      await sql`UPDATE support_cases SET ticket_number = ${counter} WHERE id = ${c.id}`
      counter++
      updated++
    }

    // 5. Обновляем sequence
    await sql`SELECT setval('support_case_ticket_seq', ${counter}, false)`
    steps.push(`Assigned numbers 1001-${counter - 1} to ${updated} cases`)

    // 6. Проверяем
    const check = await sql`
      SELECT 
        COUNT(*) as total,
        COUNT(ticket_number) as with_number,
        MIN(ticket_number) as min_num,
        MAX(ticket_number) as max_num
      FROM support_cases
    `

    return json({
      success: true,
      steps,
      stats: {
        totalCases: parseInt(check[0]?.total || '0'),
        casesWithNumber: parseInt(check[0]?.with_number || '0'),
        minTicketNumber: check[0]?.min_num,
        maxTicketNumber: check[0]?.max_num,
      }
    })

  } catch (e: any) {
    console.error('Add ticket column error:', e)
    return json({ error: 'Failed', details: e.message, steps }, 500)
  }
}
