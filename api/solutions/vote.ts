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
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()

  try {
    const body = await req.json()
    const { solutionId, vote, caseId } = body // vote: 'helpful' or 'not_helpful'

    if (!solutionId || !vote) {
      return json({ error: 'solutionId and vote are required' }, 400)
    }

    if (vote === 'helpful') {
      await sql`
        UPDATE support_solutions SET 
          helpful_votes = helpful_votes + 1,
          used_count = used_count + 1,
          updated_at = NOW()
        WHERE id = ${solutionId}
      `
    } else if (vote === 'not_helpful') {
      await sql`
        UPDATE support_solutions SET 
          not_helpful_votes = not_helpful_votes + 1,
          used_count = used_count + 1,
          updated_at = NOW()
        WHERE id = ${solutionId}
      `
    } else if (vote === 'used') {
      // Just mark as used without voting
      await sql`
        UPDATE support_solutions SET 
          used_count = used_count + 1,
          updated_at = NOW()
        WHERE id = ${solutionId}
      `
    }

    // Link solution to case if provided
    if (caseId) {
      await sql`
        UPDATE support_cases SET 
          resolution_notes = COALESCE(resolution_notes, '') || ' [Solution: ' || ${solutionId} || ']',
          updated_at = NOW()
        WHERE id = ${caseId}
      `
    }

    return json({
      success: true,
      message: `Vote recorded: ${vote}`
    })

  } catch (e: any) {
    return json({ error: 'Failed to record vote', details: e.message }, 500)
  }
}
