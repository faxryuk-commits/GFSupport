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

// Commitment detection function (same as in webhook)
function detectCommitment(text: string) {
  const now = new Date()
  const result = {
    hasCommitment: false,
    isVague: false,
    commitmentText: null as string | null,
    commitmentType: null as string | null,
    detectedDeadline: null as Date | null,
    autoDeadline: new Date(now.getTime() + 4 * 60 * 60 * 1000)
  }

  if (!text) return result

  // Concrete deadline patterns
  const concretePatterns = [
    { pattern: /через\s*пол\s*часа|через\s*полчаса/i, minutes: 30 },
    { pattern: /через\s*час/i, hours: 1 },
    { pattern: /через\s*пару\s*часов/i, hours: 2 },
    { pattern: /через\s*(\d+)\s*(час|ч)/i, hoursMatch: 1 },
    { pattern: /через\s*(\d+)\s*(минут|мин)/i, minutesMatch: 1 },
    { pattern: /через\s*(\d+)/i, minutesMatch: 1 },
    { pattern: /до завтра/i, hours: 24 },
    { pattern: /завтра/i, hours: 24 },
    { pattern: /5\s*минут|пять\s*минут/i, minutes: 5 },
    { pattern: /10\s*минут/i, minutes: 10 },
    { pattern: /15\s*минут/i, minutes: 15 },
  ]

  // Vague patterns
  const vaguePatterns = [
    /посмотрим/i, /разберёмся|разберемся/i, /сделаем/i, /минуточку/i,
    /сейчас/i, /проверю/i, /уточню/i, /постараюсь/i,
  ]

  // Check concrete first
  for (const p of concretePatterns) {
    const match = text.match(p.pattern)
    if (match) {
      result.hasCommitment = true
      result.isVague = false
      result.commitmentType = 'concrete'
      result.commitmentText = match[0]
      
      if ((p as any).minutes) {
        result.detectedDeadline = new Date(now.getTime() + (p as any).minutes * 60 * 1000)
      } else if ((p as any).hours) {
        result.detectedDeadline = new Date(now.getTime() + (p as any).hours * 60 * 60 * 1000)
      } else if ((p as any).hoursMatch && match[1]) {
        result.detectedDeadline = new Date(now.getTime() + parseInt(match[1]) * 60 * 60 * 1000)
      } else if ((p as any).minutesMatch && match[1]) {
        result.detectedDeadline = new Date(now.getTime() + parseInt(match[1]) * 60 * 1000)
      }
      return result
    }
  }

  // Check vague
  for (const p of vaguePatterns) {
    const match = text.match(p)
    if (match) {
      result.hasCommitment = true
      result.isVague = true
      result.commitmentType = 'vague'
      result.commitmentText = match[0]
      return result
    }
  }

  return result
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const text = url.searchParams.get('text') || ''
  const createTest = url.searchParams.get('create') === 'true'

  // Test detection
  const detection = detectCommitment(text)

  if (createTest && detection.hasCommitment) {
    const sql = getSQL()
    
    // Ensure table exists
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS support_reminders (
          id VARCHAR(50) PRIMARY KEY,
          channel_id VARCHAR(50) NOT NULL,
          case_id VARCHAR(50),
          message_id VARCHAR(100),
          commitment_text TEXT,
          commitment_type VARCHAR(50),
          is_vague BOOLEAN DEFAULT false,
          detected_deadline TIMESTAMP,
          auto_deadline TIMESTAMP NOT NULL,
          reminder_at TIMESTAMP,
          escalation_level INTEGER DEFAULT 0,
          assigned_to VARCHAR(50),
          assigned_name VARCHAR(255),
          status VARCHAR(30) DEFAULT 'active',
          completed_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
    } catch (e) { /* exists */ }

    const reminderId = `rem_test_${Date.now()}`
    const deadline = detection.detectedDeadline || detection.autoDeadline
    const reminderAt = new Date(deadline.getTime() - 5 * 60 * 1000)

    await sql`
      INSERT INTO support_reminders (
        id, channel_id, message_id, commitment_text, commitment_type,
        is_vague, detected_deadline, auto_deadline, reminder_at, assigned_name
      ) VALUES (
        ${reminderId}, 'test_channel', 'test_msg', ${detection.commitmentText},
        ${detection.commitmentType}, ${detection.isVague},
        ${detection.detectedDeadline?.toISOString() || null},
        ${deadline.toISOString()}, ${reminderAt.toISOString()}, 'Test User'
      )
    `

    return json({
      message: 'Test reminder created!',
      reminderId,
      detection,
    })
  }

  return json({
    inputText: text,
    detection,
    examples: [
      'через пол часа',
      'через 30 минут',
      'через час',
      'завтра',
      'сейчас проверю',
      'минуточку',
    ],
    usage: 'GET /api/support/reminders/test?text=через пол часа&create=true'
  })
}
