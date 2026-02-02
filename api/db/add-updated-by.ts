import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

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

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const results: string[] = []

  try {
    // Add updated_by column to support_cases
    try {
      await sql`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50)`
      results.push('✓ Added updated_by column')
    } catch (e: any) {
      results.push(`updated_by: ${e.message}`)
    }

    // Add updated_at column if not exists
    try {
      await sql`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`
      results.push('✓ Added updated_at column')
    } catch (e: any) {
      results.push(`updated_at: ${e.message}`)
    }

    // Create trigger to auto-update updated_at
    try {
      await sql`
        CREATE OR REPLACE FUNCTION update_support_cases_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `
      results.push('✓ Created update function')
    } catch (e: any) {
      results.push(`function: ${e.message}`)
    }

    try {
      await sql`
        DROP TRIGGER IF EXISTS trigger_support_cases_updated_at ON support_cases
      `
      await sql`
        CREATE TRIGGER trigger_support_cases_updated_at
        BEFORE UPDATE ON support_cases
        FOR EACH ROW
        EXECUTE FUNCTION update_support_cases_updated_at()
      `
      results.push('✓ Created update trigger')
    } catch (e: any) {
      results.push(`trigger: ${e.message}`)
    }

    return json({
      success: true,
      message: 'Database updated for case tracking',
      results
    })

  } catch (e: any) {
    return json({ error: e.message, results }, 500)
  }
}
