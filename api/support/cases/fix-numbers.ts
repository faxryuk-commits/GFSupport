import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Find cases with NULL or invalid ticket_number
    const invalidCases = await sql`
      SELECT id, ticket_number, created_at 
      FROM support_cases 
      WHERE ticket_number IS NULL OR ticket_number < 1000
      ORDER BY created_at ASC
    `

    if (invalidCases.length === 0) {
      return res.json({ message: 'No cases need fixing', fixed: 0 })
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

    return res.json({ 
      message: `Fixed ${fixed.length} cases`,
      fixed,
      nextSequenceValue: nextNum
    })

  } catch (error) {
    console.error('Error fixing ticket numbers:', error)
    return res.status(500).json({ error: 'Failed to fix ticket numbers', details: String(error) })
  }
}
