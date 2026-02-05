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

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()

  try {
    // Find cases with NULL or invalid ticket_number
    const invalidCases = await sql`
      SELECT id, ticket_number, created_at 
      FROM support_cases 
      WHERE ticket_number IS NULL OR ticket_number < 1000
      ORDER BY created_at ASC
    `

    if (invalidCases.length === 0) {
      return json({ message: 'No cases need fixing', fixed: 0 })
    }

    // Get current max ticket number
    const maxResult = await sql`SELECT COALESCE(MAX(ticket_number), 1000) as max_num FROM support_cases WHERE ticket_number >= 1000`
    let nextNum = parseInt(maxResult[0]?.max_num || '1000') + 1

    const fixed: string[] = []

    // Update each invalid case
    for (const c of invalidCases) {
      await sql`UPDATE support_cases SET ticket_number = ${nextNum} WHERE id = ${c.id}`
      fixed.push(`${c.id} -> #${nextNum}`)
      nextNum++
    }

    // Update sequence to be ahead
    await sql`CREATE SEQUENCE IF NOT EXISTS support_case_ticket_seq START WITH 1000`
    await sql`SELECT setval('support_case_ticket_seq', ${nextNum}, false)`

    return json({ 
      message: `Fixed ${fixed.length} cases`,
      fixed,
      nextSequenceValue: nextNum
    })

  } catch (error) {
    console.error('Error fixing ticket numbers:', error)
    return json({ error: 'Failed to fix ticket numbers', details: String(error) }, 500)
  }
}
