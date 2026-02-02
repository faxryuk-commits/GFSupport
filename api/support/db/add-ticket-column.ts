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

    // 3. Считаем кейсы без номера
    const countResult = await sql`
      SELECT COUNT(*) as cnt FROM support_cases WHERE ticket_number IS NULL
    `
    const casesCount = parseInt(countResult[0]?.cnt || '0')
    steps.push(`Found ${casesCount} cases without ticket number`)

    // 4. Присваиваем номера одним запросом через window function
    if (casesCount > 0) {
      await sql`
        UPDATE support_cases 
        SET ticket_number = sub.new_number
        FROM (
          SELECT id, 1000 + ROW_NUMBER() OVER (ORDER BY created_at ASC) as new_number
          FROM support_cases 
          WHERE ticket_number IS NULL
        ) sub
        WHERE support_cases.id = sub.id
      `
      steps.push(`Assigned numbers 1001-${1000 + casesCount} to ${casesCount} cases`)
    }

    // 5. Обновляем sequence
    const maxNum = await sql`SELECT COALESCE(MAX(ticket_number), 1000) as max_num FROM support_cases`
    const nextVal = parseInt(maxNum[0]?.max_num || '1000') + 1
    await sql`SELECT setval('support_case_ticket_seq', ${nextVal}, false)`
    steps.push(`Sequence set to ${nextVal}`)

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
