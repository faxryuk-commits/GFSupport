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
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

// Problem detection patterns
const problemPatterns = {
  notWorking: /ishlamay|ishlamaydi|ishlamaypti|ишламай|ишламаяпти|ишламайди|не\s*работает|not\s*working/i,
  notComing: /kelmay|kelmaypti|kelmadi|келмай|келмаяпти|келмади|не\s*приходит/i,
  notPrinting: /chiqmay|chiqmadi|bosmay|bosmaydi|чиқмай|чиқмади|не\s*печатает/i,
  error: /xato|xatolik|хато|хатолик|ошибк|error/i,
  problem: /muammo|муаммо|проблем|problem/i,
  broken: /buzilgan|buzildi|бузилган|бузилди|сломал|broken/i,
  wrong: /noto'g'ri|нотўғри|неправильн|wrong|incorrect/i,
  missing: /yo'q|йўқ|topilmadi|не\s*найден|missing|not\s*found/i,
  stuck: /qotib\s*qoldi|turib\s*qoldi|завис|застрял|stuck/i,
}

// Urgency patterns
const urgencyPatterns = {
  urgent: /срочно|urgent|tez|тез|shoshilinch|шошилинч|asap|немедленно|быстр/i,
  critical: /критич|critical|авария|emergency/i,
  deadline: /до\s*\d|сегодня|завтра|today|tomorrow|ertaga|bugun/i,
}

// Commitment patterns
const commitmentPatterns = {
  willDo: /сделаю|проверю|посмотрю|отправлю|решу|исправлю|qilaman|қиламан|will\s+(do|check|send|fix)/i,
  timePromise: /завтра|сегодня|через\s+\d|в\s+течение|ertaga|bugun|tomorrow|today|within/i,
  promise: /обещаю|гарантирую|обязательно|va'da|promise|guarantee/i,
}

// Analyze message for problems
function analyzeForProblems(text: string): { isProblem: boolean; problemTypes: string[]; urgency: number } {
  if (!text) return { isProblem: false, problemTypes: [], urgency: 0 }
  
  const lower = text.toLowerCase()
  const problemTypes: string[] = []
  let urgency = 0
  
  // Check problem patterns
  for (const [type, pattern] of Object.entries(problemPatterns)) {
    if (pattern.test(lower)) {
      problemTypes.push(type)
    }
  }
  
  // Check urgency
  for (const [type, pattern] of Object.entries(urgencyPatterns)) {
    if (pattern.test(lower)) {
      urgency = Math.max(urgency, type === 'critical' ? 5 : type === 'urgent' ? 4 : 3)
    }
  }
  
  const isProblem = problemTypes.length > 0
  if (isProblem && urgency === 0) urgency = 2 // Default urgency for problems
  
  return { isProblem, problemTypes, urgency }
}

// Analyze message for commitments
function analyzeForCommitments(text: string): { hasCommitment: boolean; timeframe: string | null } {
  if (!text) return { hasCommitment: false, timeframe: null }
  
  const lower = text.toLowerCase()
  let hasCommitment = false
  let timeframe: string | null = null
  
  // Check for action promises
  if (commitmentPatterns.willDo.test(lower)) {
    hasCommitment = true
  }
  
  // Check for explicit promises
  if (commitmentPatterns.promise.test(lower)) {
    hasCommitment = true
  }
  
  // Extract timeframe
  const timeMatch = lower.match(commitmentPatterns.timePromise)
  if (timeMatch) {
    timeframe = timeMatch[0]
  }
  
  return { hasCommitment, timeframe }
}

/**
 * Auto-process endpoint - analyzes new messages and:
 * 1. Updates is_problem and ai_urgency fields
 * 2. Creates cases for problem messages (if settings allow)
 * 3. Creates commitments when promises are detected
 * 
 * Called by: Vercel Cron or manually
 */
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

  const sql = getSQL()
  
  try {
    // Get settings
    const settingsResult = await sql`SELECT * FROM support_settings WHERE id = 'default' LIMIT 1`
    const settings = settingsResult[0] || { auto_create_cases: true }
    
    // Get unprocessed messages (last hour, not yet analyzed)
    const messages = await sql`
      SELECT 
        m.id, m.channel_id, m.text_content, m.sender_name, m.sender_role,
        m.is_from_client, m.is_problem, m.ai_urgency, m.created_at,
        c.name as channel_name, c.sla_category
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.created_at >= NOW() - INTERVAL '1 hour'
        AND m.text_content IS NOT NULL
        AND m.text_content != ''
        AND (m.ai_urgency IS NULL OR m.ai_urgency = 0)
      ORDER BY m.created_at DESC
      LIMIT 100
    `
    
    let processed = 0
    let casesCreated = 0
    let commitmentsCreated = 0
    const results: any[] = []
    
    for (const msg of messages) {
      const text = msg.text_content || ''
      
      // Analyze for problems
      const problemAnalysis = analyzeForProblems(text)
      
      // Analyze for commitments (only from support/team messages)
      const commitmentAnalysis = !msg.is_from_client ? analyzeForCommitments(text) : { hasCommitment: false, timeframe: null }
      
      // Update message with analysis
      await sql`
        UPDATE support_messages SET
          is_problem = ${problemAnalysis.isProblem},
          ai_urgency = ${problemAnalysis.urgency},
          ai_category = ${problemAnalysis.problemTypes.length > 0 ? problemAnalysis.problemTypes[0] : null}
        WHERE id = ${msg.id}
      `
      
      // Create case for problem messages (if client message with urgency >= 3)
      if (problemAnalysis.isProblem && msg.is_from_client && problemAnalysis.urgency >= 3 && settings.auto_create_cases) {
        // Check if case already exists for this channel recently
        const existingCase = await sql`
          SELECT id FROM support_cases 
          WHERE channel_id = ${msg.channel_id}
            AND status NOT IN ('resolved', 'closed')
            AND created_at >= NOW() - INTERVAL '24 hours'
          LIMIT 1
        `
        
        if (existingCase.length === 0) {
          const caseId = `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          const title = text.slice(0, 100) + (text.length > 100 ? '...' : '')
          
          // Get next ticket number - ensure sequence exists and get next value
          let ticketNumber: number
          try {
            // First ensure sequence exists
            await sql`CREATE SEQUENCE IF NOT EXISTS support_case_ticket_seq START WITH 1000`
            
            // Get max existing ticket number to avoid duplicates
            const maxResult = await sql`SELECT COALESCE(MAX(ticket_number), 1000) as max_num FROM support_cases`
            const maxNum = parseInt(maxResult[0]?.max_num || '1000')
            
            // Set sequence to max + 1 if needed
            await sql`SELECT setval('support_case_ticket_seq', GREATEST(nextval('support_case_ticket_seq'), ${maxNum + 1}), false)`
            
            // Get next value
            const seqResult = await sql`SELECT nextval('support_case_ticket_seq') as num`
            ticketNumber = parseInt(seqResult[0]?.num || '1001')
          } catch (e) {
            // Fallback: use max + 1
            const maxResult = await sql`SELECT COALESCE(MAX(ticket_number), 1000) as max_num FROM support_cases`
            ticketNumber = parseInt(maxResult[0]?.max_num || '1000') + 1
          }
          
          await sql`
            INSERT INTO support_cases (
              id, ticket_number, channel_id, title, description,
              category, priority, status, source_message_id
            ) VALUES (
              ${caseId},
              ${ticketNumber},
              ${msg.channel_id},
              ${title},
              ${text},
              ${problemAnalysis.problemTypes[0] || 'general'},
              ${problemAnalysis.urgency >= 4 ? 'high' : 'medium'},
              'detected',
              ${msg.id}
            )
          `
          casesCreated++
          results.push({ type: 'case_created', caseId, channel: msg.channel_name, urgency: problemAnalysis.urgency })
        }
      }
      
      // Create commitment if promise detected
      if (commitmentAnalysis.hasCommitment) {
        const commitmentId = `commit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        
        // Calculate due date based on timeframe
        let dueDate = new Date()
        if (commitmentAnalysis.timeframe) {
          const tf = commitmentAnalysis.timeframe.toLowerCase()
          if (/завтра|tomorrow|ertaga/.test(tf)) {
            dueDate.setDate(dueDate.getDate() + 1)
          } else if (/через\s*(\d+)|in\s*(\d+)/.test(tf)) {
            const match = tf.match(/\d+/)
            if (match) dueDate.setDate(dueDate.getDate() + parseInt(match[0]))
          } else {
            dueDate.setDate(dueDate.getDate() + 1) // Default: tomorrow
          }
        } else {
          dueDate.setDate(dueDate.getDate() + 1) // Default: tomorrow
        }
        
        await sql`
          INSERT INTO support_commitments (
            id, channel_id, message_id, agent_name,
            commitment_text, commitment_type, due_date, status
          ) VALUES (
            ${commitmentId},
            ${msg.channel_id},
            ${msg.id},
            ${msg.sender_name},
            ${text.slice(0, 500)},
            'promise',
            ${dueDate.toISOString()},
            'pending'
          )
        `
        commitmentsCreated++
        results.push({ type: 'commitment_created', commitmentId, agent: msg.sender_name, dueDate: dueDate.toISOString() })
      }
      
      processed++
    }
    
    return json({
      success: true,
      processed,
      casesCreated,
      commitmentsCreated,
      results,
      timestamp: new Date().toISOString()
    })
    
  } catch (e: any) {
    console.error('[Auto-process] Error:', e)
    return json({ error: 'Processing failed', details: e.message }, 500)
  }
}
