import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
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

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) {
    return json({ error: 'Database connection string not found' }, 500)
  }

  const sql = neon(connectionString)
  const results: string[] = []

  try {
    // 1. Добавляем колонку ticket_number если не существует
    await sql`
      ALTER TABLE support_cases 
      ADD COLUMN IF NOT EXISTS ticket_number INTEGER
    `
    results.push('Added ticket_number column')

    // 2. Создаём sequence для автонумерации
    await sql`
      CREATE SEQUENCE IF NOT EXISTS support_case_ticket_seq START WITH 1
    `
    results.push('Created ticket sequence')

    // 3. Присваиваем номера существующим кейсам (по дате создания)
    const existingCases = await sql`
      SELECT id FROM support_cases 
      WHERE ticket_number IS NULL 
      ORDER BY created_at ASC
    `
    
    if (existingCases.length > 0) {
      // Получаем текущее значение sequence
      const seqResult = await sql`SELECT last_value FROM support_case_ticket_seq`
      let currentNum = parseInt(seqResult[0]?.last_value || '0')
      
      for (const c of existingCases) {
        currentNum++
        await sql`
          UPDATE support_cases 
          SET ticket_number = ${currentNum}
          WHERE id = ${c.id}
        `
      }
      
      // Обновляем sequence до последнего использованного номера
      await sql`SELECT setval('support_case_ticket_seq', ${currentNum})`
      
      results.push(`Assigned ticket numbers to ${existingCases.length} existing cases (1 to ${currentNum})`)
    } else {
      results.push('No existing cases without ticket numbers')
    }

    // 4. Создаём уникальный индекс на ticket_number
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_support_cases_ticket_number 
      ON support_cases(ticket_number) 
      WHERE ticket_number IS NOT NULL
    `
    results.push('Created unique index on ticket_number')

    return json({
      success: true,
      message: 'Ticket numbering migration completed',
      results
    })

  } catch (e: any) {
    return json({
      success: false,
      error: e.message,
      results
    }, 500)
  }
}
