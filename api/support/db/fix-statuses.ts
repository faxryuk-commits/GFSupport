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
    
    // Update 'open' -> 'detected'
    const result = await sql`
      UPDATE support_cases 
      SET status = 'detected' 
      WHERE status = 'open'
      RETURNING id, title
    `
    
    return json({
      success: true,
      updated: result.length,
      cases: result.map((c: any) => ({ id: c.id, title: c.title?.slice(0, 50) }))
    })
  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
