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
    
    // 1. Update 'open' -> 'detected'
    const statusResult = await sql`
      UPDATE support_cases 
      SET status = 'detected' 
      WHERE status = 'open'
      RETURNING id, title
    `
    
    // 2. Get max ticket number
    const maxNum = await sql`
      SELECT COALESCE(MAX(ticket_number), 0) as max_num FROM support_cases
    `
    let nextNum = (maxNum[0]?.max_num || 0) + 1
    
    // 3. Find cases without ticket numbers
    const noNumbers = await sql`
      SELECT id, title FROM support_cases 
      WHERE ticket_number IS NULL 
      ORDER BY created_at ASC
    `
    
    // 4. Assign ticket numbers
    const numbered: any[] = []
    for (const c of noNumbers) {
      await sql`
        UPDATE support_cases 
        SET ticket_number = ${nextNum}
        WHERE id = ${c.id}
      `
      numbered.push({ id: c.id, ticketNumber: nextNum, title: c.title?.slice(0, 40) })
      nextNum++
    }
    
    return json({
      success: true,
      statusesUpdated: statusResult.length,
      ticketNumbersAssigned: numbered.length,
      cases: numbered
    })
  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
