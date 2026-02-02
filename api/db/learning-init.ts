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
    // 1. Enable pgvector extension
    try {
      await sql`CREATE EXTENSION IF NOT EXISTS vector`
      results.push('pgvector extension enabled')
    } catch (e: any) {
      results.push(`pgvector: ${e.message}`)
    }

    // 2. Create support_dialogs table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS support_dialogs (
          id VARCHAR(50) PRIMARY KEY,
          channel_id VARCHAR(50),
          
          -- Question from client
          question_text TEXT NOT NULL,
          question_embedding vector(1536),
          question_category VARCHAR(50),
          question_language VARCHAR(10) DEFAULT 'ru',
          
          -- Answer from agent/bot
          answer_text TEXT NOT NULL,
          answer_by VARCHAR(100),
          answer_type VARCHAR(20) DEFAULT 'manual',
          
          -- Quality metrics
          was_helpful BOOLEAN,
          resolution_minutes INT,
          confidence_score DECIMAL(3,2) DEFAULT 0.50,
          
          -- Versioning & lifecycle
          version INT DEFAULT 1,
          expires_at TIMESTAMP,
          is_active BOOLEAN DEFAULT true,
          
          -- Deduplication
          is_duplicate_of VARCHAR(50),
          question_hash VARCHAR(64),
          
          -- Client context
          client_type VARCHAR(20),
          
          -- Safety
          requires_human_review BOOLEAN DEFAULT false,
          
          -- Metadata
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          used_count INT DEFAULT 0,
          last_used_at TIMESTAMP
        )
      `
      results.push('support_dialogs table created')
    } catch (e: any) {
      results.push(`support_dialogs: ${e.message}`)
    }

    // 3. Create support_feedback table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS support_feedback (
          id VARCHAR(50) PRIMARY KEY,
          dialog_id VARCHAR(50),
          channel_id VARCHAR(50),
          message_id VARCHAR(50),
          
          rating VARCHAR(20) NOT NULL,
          comment TEXT,
          
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
      results.push('support_feedback table created')
    } catch (e: any) {
      results.push(`support_feedback: ${e.message}`)
    }

    // 4. Create support_learning_stats table for analytics
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS support_learning_stats (
          id SERIAL PRIMARY KEY,
          date DATE UNIQUE,
          total_dialogs INT DEFAULT 0,
          new_dialogs INT DEFAULT 0,
          auto_responses INT DEFAULT 0,
          auto_success_rate DECIMAL(5,2),
          avg_confidence DECIMAL(3,2),
          feedback_positive INT DEFAULT 0,
          feedback_negative INT DEFAULT 0,
          feedback_partial INT DEFAULT 0,
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `
      results.push('support_learning_stats table created')
    } catch (e: any) {
      results.push(`support_learning_stats: ${e.message}`)
    }

    // 5. Create vector index for similarity search
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_dialogs_embedding 
        ON support_dialogs 
        USING ivfflat (question_embedding vector_cosine_ops)
        WITH (lists = 100)
      `
      results.push('Vector index created')
    } catch (e: any) {
      // Index may fail if not enough data, that's ok
      results.push(`Vector index: ${e.message}`)
    }

    // 6. Create hash index for deduplication
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_dialogs_hash 
        ON support_dialogs (question_hash)
        WHERE question_hash IS NOT NULL
      `
      results.push('Hash index created')
    } catch (e: any) {
      results.push(`Hash index: ${e.message}`)
    }

    // 7. Create indexes for common queries
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_dialogs_channel ON support_dialogs (channel_id)`
      await sql`CREATE INDEX IF NOT EXISTS idx_dialogs_category ON support_dialogs (question_category)`
      await sql`CREATE INDEX IF NOT EXISTS idx_dialogs_helpful ON support_dialogs (was_helpful) WHERE was_helpful = true`
      await sql`CREATE INDEX IF NOT EXISTS idx_feedback_dialog ON support_feedback (dialog_id)`
      results.push('Additional indexes created')
    } catch (e: any) {
      results.push(`Additional indexes: ${e.message}`)
    }

    return json({
      success: true,
      message: 'Learning database initialized',
      results
    })

  } catch (e: any) {
    return json({ error: e.message, results }, 500)
  }
}
