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

// Copy of detectCommitment for testing
interface CommitmentDetection {
  hasCommitment: boolean
  isVague: boolean
  commitmentText: string | null
  commitmentType: 'time' | 'action' | 'vague' | null
  detectedDeadline: Date | null
  autoDeadline: Date
  matchedPattern?: string
}

function detectCommitment(text: string): CommitmentDetection {
  const now = new Date()
  const result: CommitmentDetection = {
    hasCommitment: false,
    isVague: false,
    commitmentText: null,
    commitmentType: null,
    detectedDeadline: null,
    autoDeadline: new Date(now.getTime() + 4 * 60 * 60 * 1000)
  }

  const lowerText = text.toLowerCase()

  // Concrete time patterns
  const concretePatterns = [
    { pattern: /через\s+пол\s*часа/i, minutes: 30 },
    { pattern: /через\s+час/i, minutes: 60 },
    { pattern: /через\s+(\d+)\s*мин/i, minutes: null },
    { pattern: /через\s+(\d+)\s*час/i, hours: null },
    { pattern: /(\d+)\s*мин/i, minutes: null },
    { pattern: /будет\s+готово\s+через/i, minutes: 30 },
    { pattern: /5\s*минут/i, minutes: 5 },
    { pattern: /10\s*минут/i, minutes: 10 },
    { pattern: /15\s*минут/i, minutes: 15 },
    { pattern: /20\s*минут/i, minutes: 20 },
    { pattern: /завтра\s+(с\s+)?утра|завтра\s+утром/i, hours: null, nextMorning: true },
    { pattern: /завтра/i, hours: 24 },
    { pattern: /сегодня/i, hours: 4 },
    { pattern: /с\s+утра/i, hours: null, morning: true },
    { pattern: /в\s+ближайшее\s+время/i, hours: 2 },
    { pattern: /ближайшее\s+время/i, hours: 2 },
    { pattern: /до\s+конца\s+дня/i, hours: 8 },
    { pattern: /к\s+вечеру/i, hours: 6 },
    { pattern: /к\s+обеду/i, hours: 4 },
    { pattern: /ertaga\s+ertalab/i, hours: null, nextMorning: true },
    { pattern: /ertaga/i, hours: 24 },
    { pattern: /bugun/i, hours: 4 },
    { pattern: /bir\s+soat(da|dan\s+keyin)/i, minutes: 60 },
    { pattern: /yarim\s+soat(da|dan\s+keyin)/i, minutes: 30 },
    { pattern: /(\d+)\s*daqiqa(da|dan\s+keyin)?/i, minutes: null },
    { pattern: /(\d+)\s*soat(da|dan\s+keyin)?/i, hours: null },
    { pattern: /ertalab/i, hours: null, morning: true },
    { pattern: /kechqurun(gacha)?/i, hours: 8 },
    { pattern: /tushlik(gacha)?/i, hours: 4 },
    { pattern: /yaqin\s+vaqt(da)?/i, hours: 2 },
  ]

  for (const p of concretePatterns) {
    const match = lowerText.match(p.pattern)
    if (match) {
      result.hasCommitment = true
      result.isVague = false
      result.commitmentType = 'time'
      result.commitmentText = match[0]
      result.matchedPattern = p.pattern.toString()
      
      let deadline: Date
      
      if ((p as any).nextMorning) {
        deadline = new Date(now)
        deadline.setDate(deadline.getDate() + 1)
        deadline.setHours(9, 0, 0, 0)
        result.detectedDeadline = deadline
        result.autoDeadline = deadline
      } else if ((p as any).morning) {
        deadline = new Date(now)
        if (now.getHours() >= 18) {
          deadline.setDate(deadline.getDate() + 1)
          deadline.setHours(9, 0, 0, 0)
        } else {
          deadline.setHours(12, 0, 0, 0)
        }
        result.detectedDeadline = deadline
        result.autoDeadline = deadline
      } else {
        let totalMinutes = 0
        if (p.minutes !== null && p.minutes !== undefined) {
          totalMinutes = p.minutes
        } else if ((p as any).hours !== null && (p as any).hours !== undefined) {
          totalMinutes = (p as any).hours * 60
        } else if (match[1]) {
          const num = parseInt(match[1])
          if (p.pattern.toString().includes('час')) {
            totalMinutes = num * 60
          } else {
            totalMinutes = num
          }
        }
        
        if (totalMinutes > 0) {
          result.detectedDeadline = new Date(now.getTime() + totalMinutes * 60 * 1000)
          result.autoDeadline = result.detectedDeadline
        }
      }
      return result
    }
  }

  // Action patterns
  const actionPatterns = [
    /сформирую\s+тикет/i,
    /создам\s+тикет/i,
    /возьм[уе]тся\s+за\s+решение/i,
    /возьмутся\s+за/i,
    /займ[уе]сь/i,
    /займ[уе]тся/i,
    /отработа[юетм]/i,
    /отработать/i,
    /исправ[люяиет]/i,
    /поправ[люяиет]/i,
    /сделаю/i,
    /сделаем/i,
    /сделают/i,
    /будет\s+сделано/i,
    /будет\s+готово/i,
    /будет\s+исправлено/i,
    /будет\s+решено/i,
    /решу/i,
    /решим/i,
    /решат/i,
    /проверю/i,
    /проверим/i,
    /проверят/i,
    /проверить/i,
    /уточню/i,
    /уточним/i,
    /узнаю/i,
    /узнаем/i,
    /передам/i,
    /передадим/i,
    /свяжусь/i,
    /свяжемся/i,
    /перезвоню/i,
    /перезвоним/i,
    /отвечу/i,
    /ответим/i,
    /ребята.*отработа/i,
    /думаю.*отработа/i,
    /думаю.*завтра.*отработа/i,
    /завтра.*отработа/i,
    /обработа[юетм]/i,
    /постараюсь/i,
    /постараемся/i,
    /выполн[юиет]/i,
    /посмотрю/i,
    /посмотрим/i,
    /посмотрят/i,
    /надо.*проверить/i,
    /нужно.*проверить/i,
    /надо.*сделать/i,
    /нужно.*сделать/i,
    /срочно.*проверить/i,
    /срочно.*сделать/i,
    /qilaman/i,
    /qilamiz/i,
    /qilishadi/i,
    /tekshiraman/i,
    /tekshiramiz/i,
    /to'g'irlayman/i,
    /to'g'irlaymiz/i,
    /tuzataman/i,
    /tuzatamiz/i,
    /hal\s+qilaman/i,
    /hal\s+qilamiz/i,
    /yechaman/i,
    /yechamiz/i,
    /bog'lanaman/i,
    /bog'lanamiz/i,
    /xabar\s+beraman/i,
    /xabar\s+beramiz/i,
    /javob\s+beraman/i,
    /javob\s+beramiz/i,
    /ishlab\s+chiqaman/i,
    /ishlab\s+chiqamiz/i,
    /tayyor\s+bo'ladi/i,
    /amalga\s+oshiriladi/i,
    /bajariladi/i,
    /ko'raman/i,
    /ko'ramiz/i,
    /aniqlayman/i,
    /aniqlaymiz/i,
    /harakat\s+qilaman/i,
    /harakat\s+qilamiz/i,
    /bajaraman/i,
    /bajaramiz/i,
  ]

  for (const pattern of actionPatterns) {
    const match = lowerText.match(pattern)
    if (match) {
      result.hasCommitment = true
      result.isVague = false
      result.commitmentType = 'action'
      result.commitmentText = match[0]
      result.matchedPattern = pattern.toString()
      result.autoDeadline = new Date(now.getTime() + 4 * 60 * 60 * 1000)
      return result
    }
  }

  // Vague patterns
  const vaguePatterns = [
    /сейчас\s+(проверю|посмотрю|уточню|узнаю)/i,
    /минуточку/i,
    /подождите/i,
    /разберусь/i,
    /разберёмся/i,
    /скоро/i,
    /очень\s+скоро/i,
    /попозже/i,
    /чуть\s+позже/i,
    /позже/i,
    /в\s+процессе/i,
    /работаем/i,
    /разбираемся/i,
    /займёмся/i,
    /возьмёмся/i,
    /hozir/i,
    /kutib\s+turing/i,
    /bir\s+daqiqa/i,
    /tez\s+orada/i,
    /yaqinda/i,
    /keyinroq/i,
    /ishlaymiz/i,
  ]

  for (const pattern of vaguePatterns) {
    const match = lowerText.match(pattern)
    if (match) {
      result.hasCommitment = true
      result.isVague = true
      result.commitmentType = 'vague'
      result.commitmentText = match[0]
      result.matchedPattern = pattern.toString()
      result.autoDeadline = new Date(now.getTime() + 30 * 60 * 1000)
      return result
    }
  }

  return result
}

/**
 * Test endpoint for commitment detection
 * GET ?text=... - test single text
 * POST { texts: [...] } - test multiple texts
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  const sql = getSQL()
  const url = new URL(req.url)

  // GET - test single text
  if (req.method === 'GET') {
    const text = url.searchParams.get('text')
    
    if (!text) {
      // Return recent commitments from DB for diagnosis
      const recent = await sql`
        SELECT * FROM support_commitments 
        ORDER BY created_at DESC 
        LIMIT 20
      `.catch(() => [])
      
      // Also get recent messages that should have commitments
      const recentMessages = await sql`
        SELECT m.id, m.text_content, m.sender_name, m.sender_role, m.created_at,
               c.commitment_text
        FROM support_messages m
        LEFT JOIN support_commitments c ON c.message_id = m.id
        WHERE m.text_content IS NOT NULL
          AND m.created_at > NOW() - INTERVAL '24 hours'
          AND (m.sender_role IN ('support', 'team') OR m.is_from_client = false)
        ORDER BY m.created_at DESC
        LIMIT 30
      `.catch(() => [])
      
      return json({
        message: 'Use ?text=your message to test detection',
        recentCommitments: recent,
        recentStaffMessages: recentMessages.map((m: any) => ({
          id: m.id,
          text: m.text_content?.slice(0, 200),
          sender: m.sender_name,
          role: m.sender_role,
          hasCommitmentInDB: !!m.commitment_text,
          detection: detectCommitment(m.text_content || ''),
          createdAt: m.created_at,
        })),
      })
    }
    
    const detection = detectCommitment(text)
    return json({
      input: text,
      detection,
    })
  }

  // POST - test multiple texts OR backfill missing commitments
  if (req.method === 'POST') {
    const body = await req.json()
    
    // Backfill mode - create commitments for messages without them
    if (body.action === 'backfill') {
      const hours = parseInt(body.hours) || 24
      const sinceDate = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
      
      // Find messages with commitments but no record in support_commitments
      const messagesWithoutCommitments = await sql`
        SELECT m.id, m.channel_id, m.text_content, m.sender_name, m.sender_role, m.created_at
        FROM support_messages m
        LEFT JOIN support_commitments c ON c.message_id = m.id
        WHERE m.text_content IS NOT NULL
          AND m.created_at > ${sinceDate}::timestamptz
          AND (m.sender_role IN ('support', 'team') OR m.is_from_client = false)
          AND c.id IS NULL
        ORDER BY m.created_at DESC
        LIMIT 1000
      `
      
      const created: any[] = []
      const skipped: any[] = []
      
      for (const msg of messagesWithoutCommitments) {
        const detection = detectCommitment(msg.text_content || '')
        
        if (detection.hasCommitment) {
          const commitmentId = `commit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          const deadline = detection.detectedDeadline || detection.autoDeadline
          const reminderOffset = detection.isVague ? 30 * 60 * 1000 : 60 * 60 * 1000
          const reminderAt = new Date(deadline.getTime() - reminderOffset)
          
          // Determine priority
          let priority = 'medium'
          const hoursUntilDeadline = (deadline.getTime() - Date.now()) / (1000 * 60 * 60)
          if (detection.commitmentType === 'time' && hoursUntilDeadline <= 2) {
            priority = 'high'
          } else if (detection.isVague) {
            priority = 'low'
          }
          
          try {
            await sql`
              INSERT INTO support_commitments (
                id, channel_id, message_id, agent_name, sender_role,
                commitment_text, commitment_type, is_vague, priority,
                due_date, reminder_at, status, created_at, updated_at
              ) VALUES (
                ${commitmentId}, ${msg.channel_id}, ${msg.id}, ${msg.sender_name}, ${msg.sender_role || 'support'},
                ${detection.commitmentText}, ${detection.commitmentType}, ${detection.isVague}, ${priority},
                ${deadline.toISOString()}::timestamptz, ${reminderAt.toISOString()}::timestamptz, 
                'pending', ${msg.created_at}::timestamptz, NOW()
              )
            `
            created.push({
              messageId: msg.id,
              commitmentId,
              text: detection.commitmentText,
              sender: msg.sender_name,
            })
          } catch (e: any) {
            skipped.push({ messageId: msg.id, error: e.message })
          }
        } else {
          skipped.push({ messageId: msg.id, reason: 'no commitment detected' })
        }
      }
      
      return json({
        action: 'backfill',
        hours,
        processed: messagesWithoutCommitments.length,
        created: created.length,
        skipped: skipped.length,
        createdCommitments: created,
      })
    }
    
    // Regular test mode
    const texts = body.texts || []
    
    const results = texts.map((text: string) => ({
      input: text,
      detection: detectCommitment(text),
    }))
    
    return json({ results })
  }

  return json({ error: 'Method not allowed' }, 405)
}
