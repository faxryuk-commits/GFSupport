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

// Uzbek language patterns - both Latin and Cyrillic
const uzbekPatterns = {
  // Problem indicators
  problems: {
    notWorking: /ishlamay|ishlamaydi|ishlamaypti|ишламай|ишламаяпти|ишламайди/i,
    notComing: /kelmay|kelmaypti|kelmadi|келмай|келмаяпти|келмади/i,
    notPrinting: /chiqmay|chiqmadi|chiqmaypti|bosmay|bosmaydi|чиқмай|чиқмади|чқмидми|чкмидми|bosilmay/i,
    notChanging: /o'zgarmay|uzgarmay|o'zgarmadi|ўзгармай|узгармидми|ўзгармади/i,
    error: /xato|xatolik|хато|хатолик/i,
    problem: /muammo|муаммо/i,
    broken: /buzilgan|buzildi|бузилган|бузилди|singan|синган/i,
    wrong: /notogri|noto'g'ri|нотўғри|togri\s*emas|тўғри\s*эмас/i,
    missing: /yoq|yo'q|йўқ|топилmadi|topilmadi/i,
    stuck: /qotib\s*qoldi|қотиб\s*қолди|turib\s*qoldi|туриб\s*қолди/i,
    different: /boshqa|бошқа|другой/i,
  },
  // Contrast/but indicators (often signal problem)
  contrast: /lekin|lekn|лекин|лекн|ammo|аммо|birok|бироқ|faqat|fakat|факат/i,
  // Urgency indicators
  urgency: /tez|tezda|тез|shoshilinch|шошилинч|zarur|зарур|kerak|керак|darrov|дарров/i,
  // Positive/resolved
  positive: {
    working: /ishlayapti|ishlaypti|ishladi|ишлаяпти|ишлади|ishlamoqda|ишламоқда/i,
    fixed: /tuzatildi|тузатилди|hal\s*boldi|hal\s*bo'ldi|ҳал\s*бўлди|yechildi|ечилди/i,
    thanks: /rahmat|рахмат|tashakkur|ташаккур|sag\s*bol|саг\s*бўл|minnatdor|миннатдор/i,
    good: /yaxshi|яхши|zo'r|зўр|ajoyib|ажойиб|super|супер|ok|ок/i,
    yes: /\bha\b|ҳа|xa|ха|to'g'ri|тўғри/i,
  },
  // Question words
  questions: /qanday|қандай|nima|нима|nega|нега|qayerda|қаерда|qachon|қачон|qancha|қанча|kim|ким/i,
  // Request words
  requests: /iltimos|илтимос|marhamat|марҳамат|kerak|керак|qiling|қилинг|yordam|ёрдам/i,
  // Greetings
  greetings: /salom|салом|assalomu|ассалому|hayrli|ҳайрли/i,
  // Business terms
  business: {
    order: /buyurtma|буюртма|zakaz|заказ|order/i,
    check: /chek|чек|квитанция/i,
    branch: /filial|филиал|branch/i,
    delivery: /yetkazib|етказиб|dostavka|доставка|delivery/i,
    payment: /tolov|тўлов|pul|пул|oplata|оплата/i,
    client: /mijoz|мижоз|klient|клиент|client/i,
    menu: /menyu|меню|taom|таом|ovqat|овқат/i,
    price: /narx|нарх|summa|сумма|price/i,
  },
  // Commitment/promise words
  commitments: /va'da|ваъда|obeshchaniye|обещание|promise|qilaman|қиламан|beraman|бераман|yuboraman|юбораман|hal\s*qilaman|ҳал\s*қиламан|ko'raman|кўраман|tekshiraman|текшираман/i,
}

// Detect language
function detectLanguage(text: string): 'uz_latin' | 'uz_cyrillic' | 'ru' | 'en' | 'mixed' {
  const hasCyrillic = /[а-яёўқғҳ]/i.test(text)
  const hasLatin = /[a-z]/i.test(text)
  const hasUzbekCyrillic = /[ўқғҳ]/i.test(text)
  const hasRussianSpecific = /[ыэъь]/i.test(text)
  
  if (hasUzbekCyrillic) return 'uz_cyrillic'
  if (hasCyrillic && hasRussianSpecific) return 'ru'
  if (hasCyrillic && !hasRussianSpecific) return 'mixed' // Could be Uzbek or Russian
  if (hasLatin && /\b(salom|rahmat|kerak|qanday|yoq|lekin)\b/i.test(text)) return 'uz_latin'
  if (hasLatin) return 'en'
  return 'mixed'
}

// Analyze single message
function analyzeMessage(text: string) {
  const lower = text.toLowerCase()
  const lang = detectLanguage(text)
  
  // Check for problems
  let isProblem = false
  let problemType: string[] = []
  
  for (const [key, pattern] of Object.entries(uzbekPatterns.problems)) {
    if (pattern.test(lower)) {
      isProblem = true
      problemType.push(key)
    }
  }
  
  // Check for contrast words (often indicate problem)
  const hasContrast = uzbekPatterns.contrast.test(lower)
  if (hasContrast && Object.values(uzbekPatterns.business).some(p => p.test(lower))) {
    isProblem = true
    problemType.push('contrast_with_business')
  }
  
  // Check if resolved/positive
  let isResolved = false
  for (const pattern of Object.values(uzbekPatterns.positive)) {
    if (pattern.test(lower)) {
      isResolved = true
      break
    }
  }
  
  // Check for commitments
  const hasCommitment = uzbekPatterns.commitments.test(lower)
  
  // Check urgency
  const isUrgent = uzbekPatterns.urgency.test(lower)
  
  // Check if question
  const isQuestion = uzbekPatterns.questions.test(lower) || text.includes('?')
  
  return {
    language: lang,
    isProblem,
    problemType,
    isResolved,
    hasCommitment,
    isUrgent,
    isQuestion,
    hasContrast,
  }
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
  const action = url.searchParams.get('action') || 'analyze'
  
  try {
    // GET all messages and analyze
    if (req.method === 'GET') {
      const today = url.searchParams.get('today') === 'true'
      const limit = parseInt(url.searchParams.get('limit') || '1000')
      
      // Get messages
      let messages
      if (today) {
        messages = await sql`
          SELECT m.id, m.channel_id, m.text_content, m.sender_name, m.sender_role, 
                 m.is_from_client, m.created_at, m.case_id,
                 c.name as channel_name
          FROM support_messages m
          LEFT JOIN support_channels c ON m.channel_id = c.id
          WHERE m.text_content IS NOT NULL 
            AND m.text_content != ''
            AND DATE(m.created_at) = CURRENT_DATE
          ORDER BY m.created_at DESC
          LIMIT ${limit}
        `
      } else {
        messages = await sql`
          SELECT m.id, m.channel_id, m.text_content, m.sender_name, m.sender_role,
                 m.is_from_client, m.created_at, m.case_id,
                 c.name as channel_name
          FROM support_messages m
          LEFT JOIN support_channels c ON m.channel_id = c.id
          WHERE m.text_content IS NOT NULL 
            AND m.text_content != ''
          ORDER BY m.created_at DESC
          LIMIT ${limit}
        `
      }
      
      // Analyze each message
      const analyzed = messages.map((m: any) => ({
        id: m.id,
        channelId: m.channel_id,
        channelName: m.channel_name,
        text: m.text_content,
        senderName: m.sender_name,
        senderRole: m.sender_role,
        isFromClient: m.is_from_client,
        createdAt: m.created_at,
        hasCaseId: !!m.case_id,
        analysis: analyzeMessage(m.text_content),
      }))
      
      // Group by channel for context
      const byChannel: Record<string, any[]> = {}
      for (const msg of analyzed) {
        if (!byChannel[msg.channelId]) {
          byChannel[msg.channelId] = []
        }
        byChannel[msg.channelId].push(msg)
      }
      
      // Find unresolved problems without tickets
      const unresolvedProblems = analyzed.filter((m: any) => 
        m.analysis.isProblem && !m.hasCaseId && m.isFromClient
      )
      
      // Find commitments
      const commitments = analyzed.filter((m: any) => 
        m.analysis.hasCommitment && !m.isFromClient
      )
      
      // Collect Uzbek vocabulary
      const uzbekVocab: Record<string, Set<string>> = {
        problems: new Set(),
        positive: new Set(),
        business: new Set(),
        questions: new Set(),
      }
      
      for (const msg of analyzed) {
        const text = msg.text.toLowerCase()
        if (msg.analysis.language === 'uz_latin' || msg.analysis.language === 'uz_cyrillic' || msg.analysis.language === 'mixed') {
          // Extract words
          const words = text.split(/\s+/)
          for (const word of words) {
            if (word.length < 3) continue
            if (msg.analysis.isProblem) uzbekVocab.problems.add(word)
            if (msg.analysis.isResolved) uzbekVocab.positive.add(word)
            if (msg.analysis.isQuestion) uzbekVocab.questions.add(word)
          }
        }
      }
      
      return json({
        total: messages.length,
        analyzed: analyzed.length,
        unresolvedProblems: unresolvedProblems.length,
        commitments: commitments.length,
        
        // Summary
        summary: {
          byLanguage: {
            uz_latin: analyzed.filter((m: any) => m.analysis.language === 'uz_latin').length,
            uz_cyrillic: analyzed.filter((m: any) => m.analysis.language === 'uz_cyrillic').length,
            ru: analyzed.filter((m: any) => m.analysis.language === 'ru').length,
            en: analyzed.filter((m: any) => m.analysis.language === 'en').length,
            mixed: analyzed.filter((m: any) => m.analysis.language === 'mixed').length,
          },
          problems: analyzed.filter((m: any) => m.analysis.isProblem).length,
          resolved: analyzed.filter((m: any) => m.analysis.isResolved).length,
          urgent: analyzed.filter((m: any) => m.analysis.isUrgent).length,
          questions: analyzed.filter((m: any) => m.analysis.isQuestion).length,
        },
        
        // Details
        unresolvedProblemsList: unresolvedProblems.slice(0, 50).map((m: any) => ({
          id: m.id,
          channelName: m.channelName,
          text: m.text,
          senderName: m.senderName,
          problemType: m.analysis.problemType,
          createdAt: m.createdAt,
        })),
        
        commitmentsList: commitments.slice(0, 30).map((m: any) => ({
          id: m.id,
          channelName: m.channelName,
          text: m.text,
          senderName: m.senderName,
          createdAt: m.createdAt,
        })),
        
        // Uzbek vocabulary collected
        uzbekVocabulary: {
          problems: Array.from(uzbekVocab.problems).slice(0, 100),
          positive: Array.from(uzbekVocab.positive).slice(0, 100),
          questions: Array.from(uzbekVocab.questions).slice(0, 100),
        },
        
        // Channels summary
        channelsSummary: Object.entries(byChannel).map(([channelId, msgs]) => ({
          channelId,
          channelName: msgs[0]?.channelName,
          totalMessages: msgs.length,
          problems: msgs.filter((m: any) => m.analysis.isProblem).length,
          resolved: msgs.filter((m: any) => m.analysis.isResolved).length,
          hasUnresolvedProblem: msgs.some((m: any) => m.analysis.isProblem && !m.hasCaseId),
        })).sort((a, b) => b.problems - a.problems),
      })
    }
    
    // POST - Create tickets for unresolved problems
    if (req.method === 'POST') {
      const body = await req.json()
      const { createTickets, messageIds } = body
      
      if (!createTickets) {
        return json({ error: 'Set createTickets: true to create tickets' }, 400)
      }
      
      // Get messages that need tickets
      let messagesToProcess
      if (messageIds && messageIds.length > 0) {
        messagesToProcess = await sql`
          SELECT m.id, m.channel_id, m.text_content, m.sender_name, m.created_at,
                 c.name as channel_name, c.company_id
          FROM support_messages m
          LEFT JOIN support_channels c ON m.channel_id = c.id
          WHERE m.id = ANY(${messageIds})
            AND m.case_id IS NULL
        `
      } else {
        // Get today's unresolved problems without tickets
        messagesToProcess = await sql`
          SELECT m.id, m.channel_id, m.text_content, m.sender_name, m.created_at,
                 c.name as channel_name, c.company_id
          FROM support_messages m
          LEFT JOIN support_channels c ON m.channel_id = c.id
          WHERE m.text_content IS NOT NULL 
            AND m.text_content != ''
            AND DATE(m.created_at) = CURRENT_DATE
            AND m.is_from_client = true
            AND m.case_id IS NULL
          ORDER BY m.created_at ASC
          LIMIT 100
        `
      }
      
      const created: any[] = []
      const skipped: any[] = []
      
      for (const msg of messagesToProcess) {
        const analysis = analyzeMessage(msg.text_content)
        
        // Skip if not a problem or if resolved
        if (!analysis.isProblem || analysis.isResolved) {
          skipped.push({ id: msg.id, reason: analysis.isResolved ? 'resolved' : 'not_problem' })
          continue
        }
        
        // Check if channel already has open case
        const existingCase = await sql`
          SELECT id FROM support_cases 
          WHERE channel_id = ${msg.channel_id} 
            AND status IN ('detected', 'in_progress', 'waiting', 'blocked')
          LIMIT 1
        `
        
        if (existingCase.length > 0) {
          // Link message to existing case
          await sql`UPDATE support_messages SET case_id = ${existingCase[0].id} WHERE id = ${msg.id}`
          skipped.push({ id: msg.id, reason: 'linked_to_existing', caseId: existingCase[0].id })
          continue
        }
        
        // Create new case
        const caseId = `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const priority = analysis.isUrgent ? 'high' : 'medium'
        const category = analysis.problemType.includes('notPrinting') ? 'technical' :
                        analysis.problemType.includes('notWorking') ? 'technical' :
                        analysis.problemType.includes('order') ? 'order' : 'general'
        
        // Get next ticket number
        const maxNum = await sql`SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_num FROM support_cases`
        const ticketNumber = maxNum[0]?.next_num || 1
        
        await sql`
          INSERT INTO support_cases (
            id, channel_id, company_id, title, description,
            category, priority, status, source_message_id, reporter_name, ticket_number, created_at
          ) VALUES (
            ${caseId},
            ${msg.channel_id},
            ${msg.company_id || null},
            ${msg.text_content.slice(0, 100)},
            ${msg.text_content},
            ${category},
            ${priority},
            'detected',
            ${msg.id},
            ${msg.sender_name || 'Клиент'},
            ${ticketNumber},
            NOW()
          )
        `
        
        // Link message to case
        await sql`UPDATE support_messages SET case_id = ${caseId} WHERE id = ${msg.id}`
        
        created.push({
          caseId,
          messageId: msg.id,
          channelName: msg.channel_name,
          text: msg.text_content.slice(0, 100),
          priority,
          category,
        })
      }
      
      return json({
        created: created.length,
        skipped: skipped.length,
        createdList: created,
        skippedList: skipped,
      })
    }
    
    return json({ error: 'Method not allowed' }, 405)
    
  } catch (e: any) {
    console.error('[Bulk Analyze] Error:', e)
    return json({ error: e.message }, 500)
  }
}
