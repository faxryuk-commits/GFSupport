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

// Patterns for detecting commitments/promises in messages
const commitmentPatterns = {
  // Russian
  ru: {
    // Future tense verbs
    willDo: /\b(сделаю|сделаем|проверю|проверим|посмотрю|посмотрим|отправлю|отправим|решу|решим|уточню|уточним|свяжусь|перезвоню|напишу|подготовлю|исправлю|обновлю|добавлю|настрою)\b/i,
    // Time promises
    timePromise: /\b(завтра|сегодня|в течение|через\s+\d+|до\s+конца|на\s+этой\s+неделе|в\s+понедельник|во\s+вторник|в\s+среду|в\s+четверг|в\s+пятницу|скоро|позже)\b/i,
    // Explicit promises
    explicit: /\b(обещаю|гарантирую|обязательно|постараюсь|попробую|планирую|собираюсь)\b/i,
  },
  // Uzbek Latin
  uz_latin: {
    willDo: /\b(qilaman|qilamiz|ko'raman|ko'ramiz|tekshiraman|tekshiramiz|yuboraman|yuboramiz|hal\s*qilaman|tuzataman|yangilaman|qo'shaman|sozlaman|yozaman)\b/i,
    timePromise: /\b(ertaga|bugun|ichida|keyin|yaqinda|kechqurun|ertalab|hafta\s*ichida|dushanba|seshanba|chorshanba|payshanba|juma)\b/i,
    explicit: /\b(va'da\s*beraman|albatta|harakat\s*qilaman|rejalashtiryapman)\b/i,
  },
  // Uzbek Cyrillic  
  uz_cyrillic: {
    willDo: /\b(қиламан|қиламиз|кўраман|кўрамиз|текширааман|текширамиз|юбораман|юборамиз|ҳал\s*қиламан|тузатаман|янгилайман|қўшаман|созлайман|ёзаман)\b/i,
    timePromise: /\b(эртага|бугун|ичида|кейин|яқинда|кечқурун|эрталаб|ҳафта\s*ичида)\b/i,
    explicit: /\b(ваъда\s*бераман|албатта|ҳаракат\s*қиламан)\b/i,
  },
  // English
  en: {
    willDo: /\b(will\s+(do|check|send|fix|update|add|configure|look|review|contact)|i'll|we'll|going\s+to|gonna)\b/i,
    timePromise: /\b(tomorrow|today|within|in\s+\d+|by\s+(end|monday|tuesday|wednesday|thursday|friday)|soon|later|this\s+week|next\s+week|asap)\b/i,
    explicit: /\b(promise|guarantee|definitely|certainly|for\s+sure|planning\s+to|intend\s+to)\b/i,
  },
}

// Detect commitments in text
function detectCommitments(text: string): {
  hasCommitment: boolean
  types: string[]
  timeframe: string | null
  language: string
} {
  const lower = text.toLowerCase()
  const types: string[] = []
  let timeframe: string | null = null
  let language = 'unknown'
  
  // Check each language
  for (const [lang, patterns] of Object.entries(commitmentPatterns)) {
    if (patterns.willDo.test(lower)) {
      types.push('action_promise')
      language = lang
    }
    if (patterns.explicit.test(lower)) {
      types.push('explicit_promise')
      language = lang
    }
    
    // Extract timeframe
    const timeMatch = lower.match(patterns.timePromise)
    if (timeMatch) {
      timeframe = timeMatch[0]
      if (language === 'unknown') language = lang
    }
  }
  
  return {
    hasCommitment: types.length > 0,
    types: [...new Set(types)],
    timeframe,
    language,
  }
}

// Check if commitment is overdue
function isOverdue(commitmentDate: Date, timeframe: string | null): boolean {
  if (!timeframe) return false
  
  const now = new Date()
  const commitDate = new Date(commitmentDate)
  
  // Parse timeframe
  const lowerTimeframe = timeframe.toLowerCase()
  
  // "today/сегодня/bugun" - overdue if not same day
  if (/today|сегодня|бугун|bugun/i.test(lowerTimeframe)) {
    return commitDate.toDateString() !== now.toDateString() && now > commitDate
  }
  
  // "tomorrow/завтра/ertaga" - overdue if more than 1 day passed
  if (/tomorrow|завтра|эртага|ertaga/i.test(lowerTimeframe)) {
    const dayAfter = new Date(commitDate)
    dayAfter.setDate(dayAfter.getDate() + 1)
    dayAfter.setHours(23, 59, 59)
    return now > dayAfter
  }
  
  // "within X/в течение X" - parse the number
  const withinMatch = lowerTimeframe.match(/(\d+)\s*(час|hour|дн|day|kun|soat)/i)
  if (withinMatch) {
    const amount = parseInt(withinMatch[1])
    const unit = withinMatch[2].toLowerCase()
    const deadline = new Date(commitDate)
    
    if (/час|hour|soat/i.test(unit)) {
      deadline.setHours(deadline.getHours() + amount)
    } else {
      deadline.setDate(deadline.getDate() + amount)
    }
    
    return now > deadline
  }
  
  // Default: overdue if more than 48 hours passed
  const hoursPassed = (now.getTime() - commitDate.getTime()) / (1000 * 60 * 60)
  return hoursPassed > 48
}

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
  
  try {
    if (req.method === 'GET') {
      const days = parseInt(url.searchParams.get('days') || '7')
      const includeResolved = url.searchParams.get('resolved') === 'true'
      
      // Get all messages from support/team in the last N days
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - days)
      
      const messages = await sql`
        SELECT 
          m.id, m.channel_id, m.text_content, m.sender_name, m.sender_role,
          m.created_at, m.case_id,
          c.name as channel_name,
          cs.status as case_status
        FROM support_messages m
        LEFT JOIN support_channels c ON m.channel_id = c.id
        LEFT JOIN support_cases cs ON m.case_id = cs.id
        WHERE m.text_content IS NOT NULL 
          AND m.text_content != ''
          AND m.created_at >= ${startDate.toISOString()}
          AND (m.sender_role IN ('support', 'team', 'agent') OR m.is_from_client = false)
        ORDER BY m.created_at DESC
      `
      
      // Analyze each message for commitments
      const commitments: any[] = []
      const overdueCommitments: any[] = []
      
      for (const msg of messages) {
        const analysis = detectCommitments(msg.text_content)
        
        if (analysis.hasCommitment) {
          const isResolved = msg.case_status === 'resolved' || msg.case_status === 'closed'
          
          // Skip resolved if not requested
          if (isResolved && !includeResolved) continue
          
          const overdue = isOverdue(msg.created_at, analysis.timeframe)
          
          const commitment = {
            messageId: msg.id,
            channelId: msg.channel_id,
            channelName: msg.channel_name,
            text: msg.text_content,
            senderName: msg.sender_name,
            senderRole: msg.sender_role,
            createdAt: msg.created_at,
            caseId: msg.case_id,
            caseStatus: msg.case_status,
            commitmentTypes: analysis.types,
            timeframe: analysis.timeframe,
            language: analysis.language,
            isOverdue: overdue,
            isResolved,
          }
          
          commitments.push(commitment)
          if (overdue && !isResolved) {
            overdueCommitments.push(commitment)
          }
        }
      }
      
      // Group by channel
      const byChannel: Record<string, any[]> = {}
      for (const c of commitments) {
        if (!byChannel[c.channelId]) {
          byChannel[c.channelId] = []
        }
        byChannel[c.channelId].push(c)
      }
      
      // Group by sender
      const bySender: Record<string, any[]> = {}
      for (const c of commitments) {
        const key = c.senderName || 'Unknown'
        if (!bySender[key]) {
          bySender[key] = []
        }
        bySender[key].push(c)
      }
      
      return json({
        total: commitments.length,
        overdue: overdueCommitments.length,
        resolved: commitments.filter(c => c.isResolved).length,
        
        summary: {
          byType: {
            actionPromise: commitments.filter(c => c.commitmentTypes.includes('action_promise')).length,
            explicitPromise: commitments.filter(c => c.commitmentTypes.includes('explicit_promise')).length,
          },
          byLanguage: {
            ru: commitments.filter(c => c.language === 'ru').length,
            uz_latin: commitments.filter(c => c.language === 'uz_latin').length,
            uz_cyrillic: commitments.filter(c => c.language === 'uz_cyrillic').length,
            en: commitments.filter(c => c.language === 'en').length,
          },
          bySender: Object.entries(bySender).map(([name, items]) => ({
            name,
            total: items.length,
            overdue: items.filter((i: any) => i.isOverdue && !i.isResolved).length,
          })).sort((a, b) => b.overdue - a.overdue),
        },
        
        // Overdue commitments (priority)
        overdueCommitments: overdueCommitments.slice(0, 30).map(c => ({
          ...c,
          text: c.text.slice(0, 300) + (c.text.length > 300 ? '...' : ''),
        })),
        
        // All commitments by channel
        byChannel: Object.entries(byChannel).map(([channelId, items]) => ({
          channelId,
          channelName: items[0]?.channelName,
          total: items.length,
          overdue: items.filter((i: any) => i.isOverdue && !i.isResolved).length,
          commitments: items.slice(0, 10).map((c: any) => ({
            ...c,
            text: c.text.slice(0, 200) + (c.text.length > 200 ? '...' : ''),
          })),
        })).sort((a, b) => b.overdue - a.overdue),
      })
    }
    
    return json({ error: 'Method not allowed' }, 405)
    
  } catch (e: any) {
    console.error('[Commitments Scan] Error:', e)
    return json({ error: e.message }, 500)
  }
}
