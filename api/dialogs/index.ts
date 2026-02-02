import { neon } from '@neondatabase/serverless'
import { createEmbedding, sanitizeText, createQuestionHash, detectLanguage } from '../ai/embed'

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
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const url = new URL(req.url)

  // GET - List dialogs with stats
  if (req.method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const category = url.searchParams.get('category')
    const helpfulOnly = url.searchParams.get('helpful') === 'true'

    try {
      // Get dialogs
      let dialogs
      if (category) {
        dialogs = await sql`
          SELECT id, channel_id, question_text, question_category, question_language,
                 answer_text, answer_by, answer_type, was_helpful, confidence_score,
                 version, used_count, created_at, updated_at
          FROM support_dialogs
          WHERE is_active = true 
            AND question_category = ${category}
            ${helpfulOnly ? sql`AND was_helpful = true` : sql``}
          ORDER BY used_count DESC, confidence_score DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      } else {
        dialogs = await sql`
          SELECT id, channel_id, question_text, question_category, question_language,
                 answer_text, answer_by, answer_type, was_helpful, confidence_score,
                 version, used_count, created_at, updated_at
          FROM support_dialogs
          WHERE is_active = true
            ${helpfulOnly ? sql`AND was_helpful = true` : sql``}
          ORDER BY used_count DESC, confidence_score DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      }

      // Get stats
      const stats = await sql`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE was_helpful = true) as helpful,
          COUNT(*) FILTER (WHERE was_helpful = false) as not_helpful,
          AVG(confidence_score) as avg_confidence,
          SUM(used_count) as total_uses
        FROM support_dialogs
        WHERE is_active = true
      `

      return json({
        dialogs,
        stats: stats[0],
        pagination: { limit, offset }
      })

    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  // POST - Create new dialog
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { 
        channelId, 
        questionText, 
        answerText, 
        answerBy, 
        answerType = 'manual',
        category,
        clientType,
        resolutionMinutes
      } = body

      if (!questionText || !answerText) {
        return json({ error: 'questionText and answerText required' }, 400)
      }

      // Sanitize texts
      const sanitizedQuestion = sanitizeText(questionText)
      const sanitizedAnswer = sanitizeText(answerText)
      
      // Create hash for deduplication
      const questionHash = createQuestionHash(sanitizedQuestion)
      
      // Check for duplicates
      const existing = await sql`
        SELECT id, used_count, confidence_score 
        FROM support_dialogs 
        WHERE question_hash = ${questionHash} AND is_active = true
        LIMIT 1
      `
      
      if (existing.length > 0) {
        // Update existing dialog instead of creating duplicate
        await sql`
          UPDATE support_dialogs 
          SET 
            used_count = used_count + 1,
            last_used_at = NOW(),
            updated_at = NOW(),
            -- Optionally update answer if better
            answer_text = CASE 
              WHEN LENGTH(${sanitizedAnswer}) > LENGTH(answer_text) 
              THEN ${sanitizedAnswer} 
              ELSE answer_text 
            END
          WHERE id = ${existing[0].id}
        `
        
        return json({
          success: true,
          dialogId: existing[0].id,
          isDuplicate: true,
          message: 'Existing dialog updated'
        })
      }

      // Create embedding for new dialog
      const embedding = await createEmbedding(sanitizedQuestion)
      const language = detectLanguage(questionText)
      
      const dialogId = `dlg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

      // Insert new dialog
      if (embedding) {
        await sql`
          INSERT INTO support_dialogs (
            id, channel_id, question_text, question_embedding, question_hash,
            question_category, question_language, answer_text, answer_by, 
            answer_type, client_type, resolution_minutes
          ) VALUES (
            ${dialogId}, ${channelId || null}, ${sanitizedQuestion}, 
            ${JSON.stringify(embedding)}::vector, ${questionHash},
            ${category || null}, ${language}, ${sanitizedAnswer}, 
            ${answerBy || null}, ${answerType}, ${clientType || null},
            ${resolutionMinutes || null}
          )
        `
      } else {
        // Insert without embedding (will be created later)
        await sql`
          INSERT INTO support_dialogs (
            id, channel_id, question_text, question_hash,
            question_category, question_language, answer_text, answer_by, 
            answer_type, client_type, resolution_minutes
          ) VALUES (
            ${dialogId}, ${channelId || null}, ${sanitizedQuestion}, ${questionHash},
            ${category || null}, ${language}, ${sanitizedAnswer}, 
            ${answerBy || null}, ${answerType}, ${clientType || null},
            ${resolutionMinutes || null}
          )
        `
      }

      return json({
        success: true,
        dialogId,
        hasEmbedding: !!embedding,
        language,
        message: 'Dialog saved for learning'
      })

    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  // PUT - Update dialog (mark helpful, update confidence, etc.)
  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { id, wasHelpful, confidenceAdjust, newVersion, expiresAt, isActive } = body

      if (!id) {
        return json({ error: 'Dialog ID required' }, 400)
      }

      const updates: string[] = []
      
      if (wasHelpful !== undefined) {
        await sql`
          UPDATE support_dialogs 
          SET was_helpful = ${wasHelpful}, updated_at = NOW()
          WHERE id = ${id}
        `
        updates.push('was_helpful')
      }
      
      if (confidenceAdjust !== undefined) {
        await sql`
          UPDATE support_dialogs 
          SET confidence_score = GREATEST(0, LEAST(1, confidence_score + ${confidenceAdjust})),
              updated_at = NOW()
          WHERE id = ${id}
        `
        updates.push('confidence_score')
      }
      
      if (newVersion !== undefined) {
        await sql`
          UPDATE support_dialogs 
          SET version = ${newVersion}, updated_at = NOW()
          WHERE id = ${id}
        `
        updates.push('version')
      }
      
      if (expiresAt !== undefined) {
        await sql`
          UPDATE support_dialogs 
          SET expires_at = ${expiresAt}, updated_at = NOW()
          WHERE id = ${id}
        `
        updates.push('expires_at')
      }
      
      if (isActive !== undefined) {
        await sql`
          UPDATE support_dialogs 
          SET is_active = ${isActive}, updated_at = NOW()
          WHERE id = ${id}
        `
        updates.push('is_active')
      }

      return json({ success: true, updated: updates })

    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  // DELETE - Deactivate dialog
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id')
    
    if (!id) {
      return json({ error: 'Dialog ID required' }, 400)
    }

    try {
      await sql`
        UPDATE support_dialogs 
        SET is_active = false, updated_at = NOW()
        WHERE id = ${id}
      `
      
      return json({ success: true, message: 'Dialog deactivated' })
      
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
