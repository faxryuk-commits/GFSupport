import { neon } from '@neondatabase/serverless'
import { identifySender, autoBindTelegramId, markChannelReadOnReply } from '../lib/identification'

export const config = {
  runtime: 'edge',
  maxDuration: 60,
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Determine sender role based on telegram_id, username, or name patterns
// Uses centralized identification library for consistent employee detection
async function getSenderRole(
  sql: any, 
  username: string | null, 
  senderId: number | null,
  senderName?: string
): Promise<{
  role: 'client' | 'support' | 'team'
  managerId: string | null
}> {
  const result = await identifySender(sql, {
    username,
    telegramId: senderId,
    senderName
  })
  
  return {
    role: result.role,
    managerId: result.agentId
  }
}

// Detect commitments and deadlines in team messages
interface CommitmentDetection {
  hasCommitment: boolean
  isVague: boolean
  commitmentText: string | null
  commitmentType: 'concrete' | 'vague' | 'callback' | 'action' | null
  detectedDeadline: Date | null
  autoDeadline: Date
}

function detectCommitment(text: string): CommitmentDetection {
  const now = new Date()
  const result: CommitmentDetection = {
    hasCommitment: false,
    isVague: false,
    commitmentText: null,
    commitmentType: null,
    detectedDeadline: null,
    autoDeadline: new Date(now.getTime() + 4 * 60 * 60 * 1000) // 4 hours default
  }

  if (!text) return result

  const lowerText = text.toLowerCase()

  // Concrete deadline patterns (Russian)
  const concretePatterns = [
    { pattern: /до завтра/i, hours: 24 },
    { pattern: /завтра с утра/i, hours: 18 },
    { pattern: /завтра утром/i, hours: 18 },
    { pattern: /завтра/i, hours: 24 },
    { pattern: /к понедельнику|в понедельник/i, days: 'monday' },
    { pattern: /к вторнику|во вторник/i, days: 'tuesday' },
    { pattern: /к среде|в среду/i, days: 'wednesday' },
    { pattern: /к четвергу|в четверг/i, days: 'thursday' },
    { pattern: /к пятнице|в пятницу/i, days: 'friday' },
    // Time-based patterns
    { pattern: /через\s*пол\s*часа|через\s*полчаса/i, minutes: 30 },
    { pattern: /через\s*час/i, hours: 1 },
    { pattern: /через\s*пару\s*часов/i, hours: 2 },
    { pattern: /через\s*(\d+)\s*(час|ч)/i, hoursMatch: 1 },
    { pattern: /через\s*(\d+)\s*(минут|мин)/i, minutesMatch: 1 },
    { pattern: /через\s*(\d+)/i, minutesMatch: 1 }, // "через 30" = 30 минут
    { pattern: /будет готово через (\d+)/i, minutesMatch: 1 },
    { pattern: /готово через (\d+)/i, minutesMatch: 1 },
    { pattern: /до конца дня|сегодня/i, hours: 8 },
    { pattern: /на этой неделе/i, days: 7 },
    { pattern: /максимум (\d+)\s*(час|мин)/i, hoursMatch: 1 },
    { pattern: /в течение (\d+)\s*(час)/i, hoursMatch: 1 },
    { pattern: /к (\d{1,2}):(\d{2})/i, timeMatch: true },
    { pattern: /до (\d{1,2}):(\d{2})/i, timeMatch: true },
    // Quick responses
    { pattern: /5\s*минут|пять\s*минут/i, minutes: 5 },
    { pattern: /10\s*минут|десять\s*минут/i, minutes: 10 },
    { pattern: /15\s*минут|пятнадцать\s*минут/i, minutes: 15 },
  ]

  // Vague commitment patterns (DANGEROUS - no deadline!)
  const vaguePatterns = [
    /посмотрим/i,
    /разберёмся|разберемся/i,
    /решим/i,
    /сделаем/i,
    /минуточку/i,
    /минутку/i,
    /сейчас/i,
    /секундочку/i,
    /я проверю|проверю/i,
    /уточню/i,
    /узнаю/i,
    /да,?\s*(хорошо|ок|окей|ладно)/i,
    /хорошо,?\s*(сделаю|сделаем)/i,
    /постараюсь/i,
    /попробую/i,
  ]

  // Callback patterns
  const callbackPatterns = [
    /перезвоню/i,
    /напишу/i,
    /отпишусь/i,
    /свяжусь/i,
    /дам знать/i,
  ]

  // Action patterns
  const actionPatterns = [
    /отправлю/i,
    /скину/i,
    /пришлю/i,
    /подключу/i,
    /настрою/i,
    /исправлю|исправим/i,
    /поправлю|поправим/i,
  ]

  // Check for concrete deadlines first
  for (const p of concretePatterns) {
    const match = text.match(p.pattern)
    if (match) {
      result.hasCommitment = true
      result.isVague = false
      result.commitmentType = 'concrete'
      result.commitmentText = match[0]
      
      if ((p as any).minutes) {
        result.detectedDeadline = new Date(now.getTime() + ((p as any).minutes as number) * 60 * 1000)
      } else if (p.hours) {
        result.detectedDeadline = new Date(now.getTime() + (p.hours as number) * 60 * 60 * 1000)
      } else if (p.hoursMatch && match[1]) {
        const hours = parseInt(match[1])
        result.detectedDeadline = new Date(now.getTime() + hours * 60 * 60 * 1000)
      } else if (p.minutesMatch && match[1]) {
        const mins = parseInt(match[1])
        result.detectedDeadline = new Date(now.getTime() + mins * 60 * 1000)
      } else if (p.timeMatch && match[1] && match[2]) {
        const deadline = new Date(now)
        deadline.setHours(parseInt(match[1]), parseInt(match[2]), 0, 0)
        if (deadline <= now) deadline.setDate(deadline.getDate() + 1)
        result.detectedDeadline = deadline
      }
      
      return result
    }
  }

  // Check for vague commitments (DANGEROUS)
  for (const p of vaguePatterns) {
    const match = text.match(p)
    if (match) {
      result.hasCommitment = true
      result.isVague = true
      result.commitmentType = 'vague'
      result.commitmentText = match[0]
      // Vague commitments get 4 hour auto-deadline with aggressive escalation
      return result
    }
  }

  // Check for callback patterns
  for (const p of callbackPatterns) {
    const match = text.match(p)
    if (match) {
      result.hasCommitment = true
      result.isVague = true
      result.commitmentType = 'callback'
      result.commitmentText = match[0]
      return result
    }
  }

  // Check for action patterns
  for (const p of actionPatterns) {
    const match = text.match(p)
    if (match) {
      result.hasCommitment = true
      result.isVague = true  
      result.commitmentType = 'action'
      result.commitmentText = match[0]
      return result
    }
  }

  return result
}

// Create reminder from commitment
async function createReminder(
  sql: any, 
  commitment: CommitmentDetection, 
  channelId: string, 
  messageId: string, 
  senderName: string,
  managerId: string | null
): Promise<string | null> {
  if (!commitment.hasCommitment) return null

  try {
    // Ensure table exists
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
    
    const reminderId = `rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const deadline = commitment.detectedDeadline || commitment.autoDeadline
    const reminderAt = new Date(deadline.getTime() - 30 * 60 * 1000) // 30 min before

    await sql`
      INSERT INTO support_reminders (
        id, channel_id, message_id, commitment_text, commitment_type,
        is_vague, detected_deadline, auto_deadline, reminder_at,
        assigned_to, assigned_name
      ) VALUES (
        ${reminderId},
        ${channelId},
        ${messageId},
        ${commitment.commitmentText},
        ${commitment.commitmentType},
        ${commitment.isVague},
        ${commitment.detectedDeadline?.toISOString() || null},
        ${commitment.autoDeadline.toISOString()},
        ${reminderAt.toISOString()},
        ${managerId},
        ${senderName}
      )
    `

    return reminderId
  } catch (e) {
    console.error('Failed to create reminder:', e)
    return null
  }
}

// Telegram API helpers
async function getTelegramFile(fileId: string): Promise<{ url: string; path: string } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return null
  
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`)
    const data = await res.json()
    if (data.ok && data.result.file_path) {
      return {
        url: `https://api.telegram.org/file/bot${token}/${data.result.file_path}`,
        path: data.result.file_path
      }
    }
  } catch (e) {
    console.error('Failed to get Telegram file:', e)
  }
  return null
}

// AI Image Analysis using GPT-4 Vision
async function analyzeImage(imageUrl: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !imageUrl) return null

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `Ты анализатор скриншотов и изображений для службы поддержки Delever.
Delever - это платформа для ресторанов и доставки в Узбекистане и Казахстане.

Если на изображении:
- Скриншот ошибки: опиши ошибку, возможную причину и предложи решение
- Скриншот админ-панели: определи что показано и есть ли проблемы
- Скриншот интеграции (iiko, R-Keeper, и т.д.): определи статус и проблемы
- Скриншот заказа: проверь корректность данных
- Фото еды/ресторана: опиши что видишь

Отвечай кратко (2-3 предложения) на русском языке. Если видишь проблему - предложи решение.`
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Проанализируй это изображение:' },
              { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } }
            ]
          }
        ],
        max_tokens: 300,
      }),
    })

    const data = await res.json()
    return data.choices?.[0]?.message?.content || null
  } catch (e) {
    console.error('Image analysis failed:', e)
    return null
  }
}

// AI Analysis with conversation context
interface ConversationMessage {
  role: 'client' | 'support'
  name: string
  text: string
  time?: string
}

async function analyzeMessage(
  text: string, 
  contentType: string,
  conversationHistory: ConversationMessage[] = []
): Promise<{
  category: string
  sentiment: string
  intent: string
  urgency: number
  isProblem: boolean
  summary: string
  entities: any
  suggestion?: string
}> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !text) {
    return {
      category: 'general',
      sentiment: 'neutral',
      intent: 'unknown',
      urgency: 0,
      isProblem: false,
      summary: '',
      entities: {}
    }
  }

  // Detect if this is a technical error log
  const isTechLog = /error|exception|failed|exit\s*(code|status)|stack\s*trace|TypeError|SyntaxError|TS\d{4}|ELIFECYCLE|ERR_|Cannot find|does not exist|undefined|null/i.test(text)

  // Format conversation history for context
  const historyContext = conversationHistory.length > 0
    ? `\n\nИСТОРИЯ РАЗГОВОРА (последние ${conversationHistory.length} сообщений, от старых к новым):
${conversationHistory.map(m => `[${m.role === 'client' ? 'Клиент' : 'Поддержка'}] ${m.name}: ${m.text?.slice(0, 200) || '[медиа]'}`).join('\n')}
---
АНАЛИЗИРУЙ НОВОЕ СООБЩЕНИЕ В КОНТЕКСТЕ РАЗГОВОРА ВЫШЕ.
Учитывай: о чём шла речь, на что отвечает клиент, какие вопросы открыты.`
    : ''

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Ты анализатор сообщений службы поддержки Delever (платформа для ресторанов и доставки в Узбекистане и Казахстане).
ВАЖНО: Ты понимаешь русский, узбекский (на латинице и кириллице) и английский языки.

Узбекские слова которые нужно знать:
- "muammo", "xatolik" = проблема
- "ishlamayapti", "ishlamayvotti" = не работает  
- "yordam", "ko'mak" = помощь
- "tez", "shoshilinch" = срочно
- "pul", "to'lov" = оплата
- "bog'lanish", "aloqa" = связь/интеграция
- "kassa" = касса
- "buyurtma" = заказ
- "yetkazib berish" = доставка
- "menu", "menyu" = меню
- "narx", "baho" = цена
- "filial" = филиал
${historyContext}
${isTechLog ? `\nВАЖНО: Это технический лог с ошибкой! Проанализируй ошибку детально.
Типичные ошибки:
- TypeScript ошибки (TS2339, TS2345 и т.д.) - обычно нужно добавить типы или поля в интерфейс
- Build errors - проверить зависимости, конфиги
- Runtime errors - баги в коде
- API errors - проблемы с сервером или сетью` : ''}

Анализируй НОВОЕ сообщение и верни JSON:
{
  "category": "одно из: technical, billing, integration, onboarding, feature_request, complaint, question, feedback, general",
  "sentiment": "positive, neutral, negative, frustrated",
  "intent": "ask_question, report_problem, request_feature, complaint, gratitude, information, unknown",
  "urgency": "число 0-5, где 5 - критично срочно",
  "isProblem": true/false,
  "summary": "краткое резюме на русском С УЧЁТОМ КОНТЕКСТА (1-2 предложения)",
  "entities": {"product": "...", "error": "...", "errorCode": "...", "file": "...", "topic": "тема из контекста"} - извлечённые сущности,
  "suggestion": "ОБЯЗАТЕЛЬНО: конкретная рекомендация для оператора С УЧЁТОМ КОНТЕКСТА РАЗГОВОРА. ${isTechLog ? 'Для ошибки - как исправить. ' : ''}Что отвечать клиенту учитывая всю историю. 1-2 предложения."
}
Отвечай ТОЛЬКО JSON, без markdown.`
          },
          {
            role: 'user',
            content: `НОВОЕ СООБЩЕНИЕ (${contentType}): ${text.slice(0, 3000)}`
          }
        ],
        temperature: 0.3,
        max_tokens: 800,
      }),
    })

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || '{}'
    
    try {
      return JSON.parse(content)
    } catch {
      return {
        category: 'general',
        sentiment: 'neutral',
        intent: 'unknown',
        urgency: 0,
        isProblem: false,
        summary: '',
        entities: {}
      }
    }
  } catch (e) {
    console.error('AI analysis failed:', e)
    return {
      category: 'general',
      sentiment: 'neutral',
      intent: 'unknown',
      urgency: 0,
      isProblem: false,
      summary: '',
      entities: {}
    }
  }
}

// Transcribe voice/video using Whisper
async function transcribeMedia(fileUrl: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !fileUrl) return null

  try {
    // Download file
    const fileRes = await fetch(fileUrl)
    const fileBlob = await fileRes.blob()
    
    // Determine file extension from URL or content-type
    let filename = 'audio.ogg'
    const urlLower = fileUrl.toLowerCase()
    if (urlLower.includes('.mp4') || fileBlob.type.includes('mp4')) {
      filename = 'video.mp4'
    } else if (urlLower.includes('.mp3') || fileBlob.type.includes('mp3')) {
      filename = 'audio.mp3'
    } else if (urlLower.includes('.m4a') || fileBlob.type.includes('m4a')) {
      filename = 'audio.m4a'
    } else if (urlLower.includes('.webm') || fileBlob.type.includes('webm')) {
      filename = 'video.webm'
    } else if (urlLower.includes('.wav') || fileBlob.type.includes('wav')) {
      filename = 'audio.wav'
    }

    // Send to Whisper with language hints for better recognition
    const formData = new FormData()
    formData.append('file', fileBlob, filename)
    formData.append('model', 'whisper-1')
    // Prompt helps Whisper understand context - Russian/Uzbek support messages
    formData.append('prompt', 'Это сообщение службы поддержки на русском или узбекском языке. Tushunaman, rahmat, yordam, muammo.')
    // Don't specify language to allow auto-detection between ru/uz/en

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    })

    const data = await res.json()
    return data.text || null
  } catch (e) {
    console.error('Transcription failed:', e)
    return null
  }
}

// Track conversation for first response time and resolution metrics
async function trackConversation(sql: any, channelId: string, isFromClient: boolean, agentId: string | null): Promise<void> {
  try {
    // Check for active conversation in this channel
    const activeConv = await sql`
      SELECT id, started_at, first_response_at, status
      FROM support_conversations
      WHERE channel_id = ${channelId} AND status = 'active'
      ORDER BY started_at DESC
      LIMIT 1
    `

    if (isFromClient) {
      // Client message - start new conversation if none active
      if (activeConv.length === 0) {
        const convId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        await sql`
          INSERT INTO support_conversations (id, channel_id, started_at, status, message_count)
          VALUES (${convId}, ${channelId}, NOW(), 'active', 1)
        `
      } else {
        // Increment message count
        await sql`
          UPDATE support_conversations 
          SET message_count = message_count + 1
          WHERE id = ${activeConv[0].id}
        `
      }
    } else {
      // Agent/team message
      if (activeConv.length > 0) {
        const conv = activeConv[0]
        
        if (!conv.first_response_at) {
          // First response - record time
          await sql`
            UPDATE support_conversations 
            SET first_response_at = NOW(), 
                agent_id = ${agentId},
                message_count = message_count + 1
            WHERE id = ${conv.id}
          `
        } else {
          // Just increment message count
          await sql`
            UPDATE support_conversations 
            SET message_count = message_count + 1
            WHERE id = ${conv.id}
          `
        }

        // Check if conversation should be closed (no client messages for 30+ min)
        const lastClientMsg = await sql`
          SELECT MAX(created_at) as last_msg
          FROM support_messages
          WHERE channel_id = ${channelId} AND is_from_client = true
        `
        
        if (lastClientMsg[0]?.last_msg) {
          const minutesAgo = (Date.now() - new Date(lastClientMsg[0].last_msg).getTime()) / 60000
          if (minutesAgo > 30) {
            // Close conversation as resolved
            await sql`
              UPDATE support_conversations 
              SET status = 'resolved', ended_at = NOW()
              WHERE id = ${conv.id}
            `
          }
        }
      }
    }
  } catch (e: any) {
    // Table might not exist - create it
    if (e.message?.includes('does not exist')) {
      try {
        await sql`
          CREATE TABLE IF NOT EXISTS support_conversations (
            id VARCHAR(64) PRIMARY KEY,
            channel_id VARCHAR(64) NOT NULL,
            started_at TIMESTAMP NOT NULL DEFAULT NOW(),
            ended_at TIMESTAMP,
            status VARCHAR(32) DEFAULT 'active',
            first_response_at TIMESTAMP,
            message_count INTEGER DEFAULT 0,
            agent_id VARCHAR(64),
            client_satisfaction INTEGER
          )
        `
      } catch (createErr) {
        console.error('Failed to create conversations table:', createErr)
      }
    }
    console.error('Track conversation error:', e)
  }
}

// Create support case from problem message
async function createCaseFromMessage(sql: any, message: any, channel: any, analysis: any): Promise<string | null> {
  try {
    const caseId = `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    
    await sql`
      INSERT INTO support_cases (
        id, channel_id, company_id, title, description,
        category, priority, severity, status
      ) VALUES (
        ${caseId},
        ${channel.id},
        ${channel.company_id},
        ${analysis.summary || 'Новое обращение'},
        ${message.text_content || message.transcript || ''},
        ${analysis.category},
        ${analysis.urgency >= 4 ? 'urgent' : analysis.urgency >= 3 ? 'high' : 'medium'},
        ${analysis.urgency >= 4 ? 'critical' : analysis.urgency >= 3 ? 'high' : 'normal'},
        'detected'
      )
    `

    // Link message to case
    await sql`
      UPDATE support_messages SET case_id = ${caseId} WHERE id = ${message.id}
    `

    // Create activity
    await sql`
      INSERT INTO support_case_activities (id, case_id, type, title, description)
      VALUES (
        ${'act_' + Date.now()},
        ${caseId},
        'auto_created',
        'Кейс создан автоматически',
        ${'Обнаружена проблема: ' + (analysis.intent || 'unknown')}
      )
    `

    return caseId
  } catch (e) {
    console.error('Failed to create case:', e)
    return null
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ ok: true, method: req.method })
  }

  try {
    const update = await req.json()
    const sql = getSQL()

    // Handle reactions
    if (update.message_reaction) {
      const reaction = update.message_reaction
      const chatId = reaction.chat.id
      const messageId = reaction.message_id
      const user = reaction.user || reaction.actor_chat
      const newReactions = reaction.new_reaction || []
      const oldReactions = reaction.old_reaction || []

      // Find the message in our DB
      const msgResult = await sql`
        SELECT id, channel_id FROM support_messages 
        WHERE telegram_message_id = ${messageId}
        LIMIT 1
      `

      if (msgResult.length > 0) {
        const msg = msgResult[0]

        // Remove old reactions from this user
        if (oldReactions.length > 0) {
          for (const r of oldReactions) {
            await sql`
              DELETE FROM support_reactions 
              WHERE message_id = ${msg.id} AND user_id = ${user?.id || 0} AND emoji = ${r.emoji}
            `
          }
        }

        // Add new reactions
        for (const r of newReactions) {
          const reactionId = `react_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          try {
            await sql`
              INSERT INTO support_reactions (id, message_id, channel_id, telegram_message_id, user_id, user_name, emoji)
              VALUES (
                ${reactionId},
                ${msg.id},
                ${msg.channel_id},
                ${messageId},
                ${user?.id || null},
                ${user?.first_name || user?.title || 'Unknown'},
                ${r.emoji}
              )
            `
          } catch (e) { /* duplicate */ }
        }

        // Update aggregated reactions on message
        const reactionsAgg = await sql`
          SELECT emoji, COUNT(*) as count, array_agg(user_name) as users
          FROM support_reactions WHERE message_id = ${msg.id}
          GROUP BY emoji
        `
        
        const reactionsJson: Record<string, { count: number; users: string[] }> = {}
        for (const r of reactionsAgg) {
          reactionsJson[r.emoji] = { count: parseInt(r.count), users: r.users }
        }

        await sql`
          UPDATE support_messages SET reactions = ${JSON.stringify(reactionsJson)} WHERE id = ${msg.id}
        `
        
        // Check if reaction is on autoresponder message - use as feedback
        for (const r of newReactions) {
          const emoji = r.emoji
          const isPositive = ['👍', '❤️', '🔥', '👏', '💯', '⭐', '🙏', '😊', '🎉'].includes(emoji)
          const isNegative = ['👎', '😢', '😡', '💔', '😤', '🤦', '😕'].includes(emoji)
          
          if (isPositive || isNegative) {
            try {
              // Check if this message is from autoresponder
              const autoMsg = await sql`
                SELECT m.id, m.channel_id, d.id as dialog_id
                FROM support_messages m
                LEFT JOIN support_dialogs d ON d.channel_id = m.channel_id 
                  AND d.created_at > m.created_at - INTERVAL '5 minutes'
                WHERE m.id = ${msg.id}
                  AND m.sender_role IN ('autoresponder', 'bot', 'ai')
                LIMIT 1
              `
              
              if (autoMsg.length > 0 && autoMsg[0].dialog_id) {
                const dialogId = autoMsg[0].dialog_id
                const rating = isPositive ? 'helpful' : 'not_helpful'
                
                // Save feedback from reaction
                const feedbackId = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
                await sql`
                  INSERT INTO support_feedback (id, dialog_id, channel_id, message_id, rating, comment)
                  VALUES (${feedbackId}, ${dialogId}, ${msg.channel_id}, ${msg.id}, ${rating}, ${'Reaction: ' + emoji})
                `.catch(() => {})
                
                // Update dialog confidence
                if (isPositive) {
                  await sql`
                    UPDATE support_dialogs 
                    SET was_helpful = true, confidence_score = LEAST(1.0, confidence_score + 0.05), updated_at = NOW()
                    WHERE id = ${dialogId}
                  `.catch(() => {})
                } else {
                  await sql`
                    UPDATE support_dialogs 
                    SET was_helpful = false, confidence_score = GREATEST(0, confidence_score - 0.1), requires_human_review = true, updated_at = NOW()
                    WHERE id = ${dialogId}
                  `.catch(() => {})
                }
                
                console.log(`Reaction feedback: ${emoji} (${rating}) for dialog ${dialogId}`)
              }
            } catch (e) {
              console.log('Reaction feedback skipped:', e)
            }
          }
        }
      }

      return json({ ok: true, type: 'reaction', messageId })
    }

    // Handle callback queries (inline button clicks) - for feedback
    if (update.callback_query) {
      const callback = update.callback_query
      const callbackData = callback.data || ''
      const chatId = callback.message?.chat?.id
      const messageId = callback.message?.message_id
      const userId = callback.from?.id
      const userName = callback.from?.first_name || 'User'
      
      // Parse callback data: feedback_helpful_dialogId or feedback_not_helpful_dialogId
      if (callbackData.startsWith('feedback_')) {
        const parts = callbackData.split('_')
        const rating = parts[1] // helpful, not_helpful, partially
        const dialogId = parts.slice(2).join('_') // dialog ID may contain underscores
        
        try {
          // Save feedback
          const feedbackId = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          await sql`
            INSERT INTO support_feedback (id, dialog_id, channel_id, rating, comment)
            VALUES (${feedbackId}, ${dialogId || null}, ${chatId?.toString() || null}, ${rating}, ${`From ${userName}`})
          `
          
          // Update dialog confidence
          if (dialogId) {
            if (rating === 'helpful') {
              await sql`
                UPDATE support_dialogs 
                SET was_helpful = true, confidence_score = LEAST(1.0, confidence_score + 0.05), used_count = used_count + 1, updated_at = NOW()
                WHERE id = ${dialogId}
              `
            } else if (rating === 'not_helpful' || rating === 'not') {
              await sql`
                UPDATE support_dialogs 
                SET was_helpful = false, confidence_score = GREATEST(0, confidence_score - 0.15), requires_human_review = true, updated_at = NOW()
                WHERE id = ${dialogId}
              `
            } else if (rating === 'partially') {
              await sql`
                UPDATE support_dialogs 
                SET confidence_score = GREATEST(0, confidence_score - 0.05), requires_human_review = true, updated_at = NOW()
                WHERE id = ${dialogId}
              `
            }
          }
          
          // Update daily stats
          const today = new Date().toISOString().split('T')[0]
          await sql`
            INSERT INTO support_learning_stats (date, feedback_positive, feedback_negative, feedback_partial)
            VALUES (${today}, 
              ${rating === 'helpful' ? 1 : 0},
              ${rating === 'not_helpful' || rating === 'not' ? 1 : 0},
              ${rating === 'partially' ? 1 : 0}
            )
            ON CONFLICT (date) DO UPDATE SET
              feedback_positive = support_learning_stats.feedback_positive + ${rating === 'helpful' ? 1 : 0},
              feedback_negative = support_learning_stats.feedback_negative + ${rating === 'not_helpful' || rating === 'not' ? 1 : 0},
              feedback_partial = support_learning_stats.feedback_partial + ${rating === 'partially' ? 1 : 0},
              updated_at = NOW()
          `.catch(() => {})
          
          // Answer callback query and update message
          const botToken = process.env.TELEGRAM_BOT_TOKEN
          if (botToken && chatId && messageId) {
            // Answer the callback
            await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                callback_query_id: callback.id,
                text: rating === 'helpful' ? 'Спасибо! Рады что помогли 😊' : 
                      rating === 'partially' ? 'Спасибо за отзыв! Будем улучшать.' :
                      'Спасибо за отзыв. Передадим специалисту.'
              })
            })
            
            // Remove inline keyboard from the message
            await fetch(`https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [] }
              })
            }).catch(() => {})
          }
          
          console.log(`Feedback received: ${rating} for dialog ${dialogId} from ${userName}`)
          
        } catch (e: any) {
          console.error('Feedback processing error:', e.message)
        }
        
        return json({ ok: true, type: 'feedback', rating })
      }
      
      return json({ ok: true, type: 'callback_query' })
    }

    // Handle group/supergroup messages
    const message = update.message || update.edited_message
    if (!message) {
      console.log('Webhook: No message in update', JSON.stringify(update).slice(0, 500))
      return json({ ok: true })
    }
    
    // Log incoming message for debugging
    console.log(`Webhook: ${message.chat?.title || 'Unknown'} | ${message.from?.first_name || 'Unknown'} | ${(message.text || message.caption || '[media]').slice(0, 50)}`)
    
    // Track forwards of broadcast messages
    if (message.forward_from_message_id || message.forward_date) {
      try {
        // Пробуем найти оригинальное broadcast сообщение по тексту
        const forwardedText = message.text || message.caption || ''
        if (forwardedText.includes('📢') || forwardedText.includes('🔄') || forwardedText.includes('⚠️')) {
          // Это может быть пересланное broadcast сообщение
          await sql`
            UPDATE support_broadcasts 
            SET clicks_count = COALESCE(clicks_count, 0) + 1
            WHERE message_text ILIKE ${'%' + forwardedText.slice(0, 100) + '%'}
              AND created_at > NOW() - INTERVAL '7 days'
          `.catch(() => {})
          
          // Также записываем forward event
          await sql`
            CREATE TABLE IF NOT EXISTS support_broadcast_forwards (
              id SERIAL PRIMARY KEY,
              original_message_id INTEGER,
              forward_chat_id BIGINT,
              forward_from_chat_id BIGINT,
              created_at TIMESTAMPTZ DEFAULT NOW()
            )
          `.catch(() => {})
          
          await sql`
            INSERT INTO support_broadcast_forwards (original_message_id, forward_chat_id, forward_from_chat_id)
            VALUES (${message.forward_from_message_id || 0}, ${message.chat?.id || 0}, ${message.forward_from_chat?.id || 0})
          `.catch(() => {})
          
          console.log('Webhook: Tracked broadcast forward')
        }
      } catch (e) {
        console.error('Failed to track forward:', e)
      }
    }

    // Skip service messages that don't need processing
    // NOTE: new_chat_members is NOT skipped - it's needed for channel registration
    if (message.left_chat_member || 
        message.new_chat_title ||
        message.new_chat_photo ||
        message.delete_chat_photo ||
        message.group_chat_created ||
        message.supergroup_chat_created ||
        message.channel_chat_created ||
        message.migrate_to_chat_id ||
        message.migrate_from_chat_id ||
        message.pinned_message ||
        message.invoice ||
        message.successful_payment ||
        message.proximity_alert_triggered ||
        message.forum_topic_created ||
        message.forum_topic_edited ||
        message.forum_topic_closed ||
        message.forum_topic_reopened ||
        message.general_forum_topic_hidden ||
        message.general_forum_topic_unhidden ||
        message.video_chat_scheduled ||
        message.video_chat_started ||
        message.video_chat_ended ||
        message.video_chat_participants_invited) {
      return json({ ok: true, skipped: 'service_message' })
    }
    
    // Handle new_chat_members - register new channel but don't create message
    if (message.new_chat_members) {
      const chat = message.chat
      const chatId = chat.id
      const chatName = chat.title || `Chat ${chatId}`
      const isForum = chat.is_forum || false
      
      // Check if channel exists
      const existingChannel = await sql`
        SELECT id FROM support_channels WHERE telegram_chat_id = ${chatId} LIMIT 1
      `
      
      if (existingChannel.length === 0) {
        // Register new channel
        const channelId = `ch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        await sql`
          INSERT INTO support_channels (id, telegram_chat_id, name, type, is_active, is_forum, created_at)
          VALUES (${channelId}, ${chatId}, ${chatName}, 'client', true, ${isForum}, NOW())
        `
        console.log(`New channel registered: ${chatName} (${chatId})`)
      }
      
      return json({ ok: true, type: 'new_chat_members', channelRegistered: existingChannel.length === 0 })
    }

    const chat = message.chat
    const chatId = chat.id
    const chatType = chat.type // 'group', 'supergroup', 'private'

    // Only process group/supergroup messages
    if (chatType !== 'group' && chatType !== 'supergroup') {
      return json({ ok: true, skipped: 'not a group' })
    }

    // Check if channel is registered
    const channelResult = await sql`
      SELECT * FROM support_channels WHERE telegram_chat_id = ${chatId} AND is_active = true
    `

    let channel = channelResult[0]

    // Auto-register channel if not exists (можно отключить)
    const isForum = chat.is_forum || false
    if (!channel) {
      const channelId = `ch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      
      // Try to get channel photo
      let channelPhotoUrl: string | null = null
      const botToken = process.env.TELEGRAM_BOT_TOKEN
      if (botToken) {
        try {
          const chatInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${chatId}`)
          const chatInfo = await chatInfoRes.json()
          if (chatInfo.ok && chatInfo.result?.photo?.small_file_id) {
            const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${chatInfo.result.photo.small_file_id}`)
            const fileData = await fileRes.json()
            if (fileData.ok) {
              channelPhotoUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`
            }
          }
        } catch (e) { /* ignore photo errors */ }
      }
      
      await sql`
        INSERT INTO support_channels (id, telegram_chat_id, name, type, is_forum, photo_url)
        VALUES (${channelId}, ${chatId}, ${chat.title || 'Unknown Group'}, 'client', ${isForum}, ${channelPhotoUrl})
      `
      channel = { id: channelId, telegram_chat_id: chatId, company_id: null, is_forum: isForum, photo_url: channelPhotoUrl }
    } else if (isForum && !channel.is_forum) {
      // Update channel to mark as forum if not already
      await sql`UPDATE support_channels SET is_forum = true WHERE id = ${channel.id}`
      channel.is_forum = true
    }
    
    // Update channel photo if missing
    if (!channel.photo_url) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN
      if (botToken) {
        try {
          const chatInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${chatId}`)
          const chatInfo = await chatInfoRes.json()
          if (chatInfo.ok && chatInfo.result?.photo?.small_file_id) {
            const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${chatInfo.result.photo.small_file_id}`)
            const fileData = await fileRes.json()
            if (fileData.ok) {
              const photoUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`
              await sql`UPDATE support_channels SET photo_url = ${photoUrl} WHERE id = ${channel.id}`
              channel.photo_url = photoUrl
            }
          }
        } catch (e) { /* ignore photo errors */ }
      }
    }

    // Handle Topics/Threads
    const threadId = message.message_thread_id || null
    const isTopicMessage = message.is_topic_message || false
    let threadName = null

    if (threadId && isForum) {
      // Try to get or create topic record
      const topicResult = await sql`
        SELECT * FROM support_topics WHERE channel_id = ${channel.id} AND thread_id = ${threadId}
      `
      
      if (topicResult.length === 0) {
        // Create new topic record
        const topicId = `topic_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        threadName = message.reply_to_message?.forum_topic_created?.name || `Topic ${threadId}`
        
        try {
          await sql`
            INSERT INTO support_topics (id, channel_id, thread_id, name)
            VALUES (${topicId}, ${channel.id}, ${threadId}, ${threadName})
          `
        } catch (e) { /* topic already exists */ }
      } else {
        threadName = topicResult[0].name
      }
    }

    // Determine content type and extract data
    let contentType = 'text'
    let textContent = message.text || message.caption || ''
    let mediaFileId = null
    let mediaUrl = null
    let transcript = null

    if (message.voice) {
      contentType = 'voice'
      mediaFileId = message.voice.file_id
    } else if (message.video_note) {
      contentType = 'video_note'
      mediaFileId = message.video_note.file_id
    } else if (message.video) {
      contentType = 'video'
      mediaFileId = message.video.file_id
    } else if (message.audio) {
      contentType = 'audio'
      mediaFileId = message.audio.file_id
    } else if (message.document) {
      contentType = 'document'
      mediaFileId = message.document.file_id
    } else if (message.photo) {
      contentType = 'photo'
      mediaFileId = message.photo[message.photo.length - 1]?.file_id
    }

    // Get media URL if needed
    if (mediaFileId) {
      const fileInfo = await getTelegramFile(mediaFileId)
      if (fileInfo) {
        mediaUrl = fileInfo.url
      }
    }

    // Transcribe voice/video (including regular video)
    if (['voice', 'video_note', 'video', 'audio'].includes(contentType) && mediaUrl) {
      transcript = await transcribeMedia(mediaUrl)
    }

    // Analyze images with GPT-4 Vision
    let imageAnalysis: string | null = null
    if (contentType === 'photo' && mediaUrl) {
      imageAnalysis = await analyzeImage(mediaUrl)
    }

    // Determine sender - check sender_chat for anonymous admins/channels first
    const senderChat = (message as any).sender_chat
    const from = message.from || {}
    
    let senderName: string
    let senderId: number | null
    let senderUsername: string | null
    
    if (senderChat && senderChat.type !== 'private') {
      // Anonymous admin posting as channel, or linked channel
      senderName = senderChat.title || senderChat.username || 'Channel'
      senderId = senderChat.id
      senderUsername = senderChat.username || null
    } else {
      // Regular user
      senderName = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Unknown'
      senderId = from.id || null
      senderUsername = from.username || null
    }
    
    const { role: senderRole, managerId } = await getSenderRole(sql, senderUsername, senderId, senderName)
    const isFromClient = senderRole === 'client'

    // Get conversation history for AI context (last 30 messages for better context)
    let conversationHistory: ConversationMessage[] = []
    if (isFromClient) {
      try {
        const historyResult = await sql`
          SELECT sender_name, sender_role, text_content, created_at
          FROM support_messages
          WHERE channel_id = ${channel.id}
          ORDER BY created_at DESC
          LIMIT 30
        `
        // Reverse to get chronological order (oldest first)
        conversationHistory = historyResult.reverse().map((m: any) => ({
          role: m.sender_role === 'client' ? 'client' : 'support',
          name: m.sender_name || 'Unknown',
          text: m.text_content || '',
          time: m.created_at
        }))
      } catch (e) {
        console.error('Failed to fetch conversation history:', e)
      }
    }

    // Analyze message (only for client messages or if it looks like a problem)
    const textToAnalyze = transcript || textContent
    let analysis = isFromClient 
      ? await analyzeMessage(textToAnalyze, contentType, conversationHistory)
      : { category: 'response', sentiment: 'neutral', intent: 'response', urgency: 0, isProblem: false, summary: '', entities: {} }

    // Smart urgency calculation for client messages
    if (isFromClient) {
      let urgencyBoost = 0
      let boostReasons: string[] = []

      // Check if VIP client (company with high MRR)
      if (channel.company_id) {
        try {
          const companyResult = await sql`
            SELECT mrr FROM crm_companies WHERE id = ${channel.company_id}
          `
          const mrr = parseFloat(companyResult[0]?.mrr || 0)
          if (mrr >= 1000) {
            urgencyBoost += 2
            boostReasons.push('VIP client')
          } else if (mrr >= 500) {
            urgencyBoost += 1
            boostReasons.push('High MRR')
          }
        } catch {}
      }

      // Check for repeat issues (same sender, recent messages)
      try {
        const recentResult = await sql`
          SELECT COUNT(*) as count FROM support_messages 
          WHERE channel_id = ${channel.id} 
            AND sender_id = ${from.id}
            AND is_from_client = true
            AND is_problem = true
            AND created_at > NOW() - INTERVAL '48 hours'
        `
        const repeatCount = parseInt(recentResult[0]?.count || 0)
        if (repeatCount >= 2) {
          urgencyBoost += 1
          boostReasons.push('Repeat issue')
        }
      } catch {}

      // Check wait time since last team response
      if (channel.last_team_message_at) {
        const lastTeamMessage = new Date(channel.last_team_message_at)
        const hoursSinceResponse = (Date.now() - lastTeamMessage.getTime()) / (1000 * 60 * 60)
        if (hoursSinceResponse > 24) {
          urgencyBoost += 2
          boostReasons.push('Long wait')
        } else if (hoursSinceResponse > 4) {
          urgencyBoost += 1
          boostReasons.push('Waiting')
        }
      }

      // Boost for negative sentiment
      if (analysis.sentiment === 'frustrated') {
        urgencyBoost += 1
        boostReasons.push('Frustrated')
      } else if (analysis.sentiment === 'negative') {
        urgencyBoost += 1
        boostReasons.push('Negative')
      }

      // Apply boost (max 5)
      if (urgencyBoost > 0) {
        const newUrgency = Math.min(5, (analysis.urgency || 0) + urgencyBoost)
        analysis = {
          ...analysis,
          urgency: newUrgency,
          isProblem: analysis.isProblem || newUrgency >= 3,
          entities: {
            ...analysis.entities,
            urgencyBoost,
            boostReasons
          }
        }
      }
    }

    // Create message record
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    // Better preview for media content
    const contentPreviewMap: Record<string, string> = {
      photo: '📷 Фото',
      video: '🎬 Видео',
      audio: '🎵 Аудио',
      voice: '🎤 Голосовое',
      video_note: '📹 Видеосообщение',
      document: '📎 Документ',
      sticker: '🎨 Стикер',
      animation: '🎞 GIF',
      contact: '👤 Контакт',
      location: '📍 Локация',
      poll: '📊 Опрос'
    }
    const messagePreview = textContent 
      ? textContent.slice(0, 100)
      : transcript 
        ? `🎤 ${transcript.slice(0, 90)}`
        : contentPreviewMap[contentType] || '[медиа]'

    // Get user photo URL if available (small photo)
    let senderPhotoUrl: string | null = null
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (from.id && botToken) {
      try {
        const photosRes = await fetch(`https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${from.id}&limit=1`)
        const photosData = await photosRes.json()
        if (photosData.ok && photosData.result?.photos?.length > 0) {
          const photo = photosData.result.photos[0][0] // smallest size
          const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${photo.file_id}`)
          const fileData = await fileRes.json()
          if (fileData.ok) {
            senderPhotoUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`
          }
        }
      } catch (e) { /* ignore photo errors */ }
    }

    // Extract reply quote text and sender from reply_to_message
    const replyToText = message.reply_to_message?.text || message.reply_to_message?.caption || null
    const replyToSender = message.reply_to_message?.from?.first_name 
      ? `${message.reply_to_message.from.first_name}${message.reply_to_message.from.last_name ? ' ' + message.reply_to_message.from.last_name : ''}`
      : null

    // Ensure columns exist for reply quotes and AI suggestion
    try {
      await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS reply_to_text TEXT`
      await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS reply_to_sender VARCHAR(255)`
      await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS ai_suggestion TEXT`
    } catch (e) { /* columns exist */ }

    // Auto-register user in support_users table
    if (from.id) {
      try {
        // Ensure users table exists
        await sql`
          CREATE TABLE IF NOT EXISTS support_users (
            id VARCHAR(100) PRIMARY KEY,
            telegram_id BIGINT UNIQUE,
            telegram_username VARCHAR(255),
            name VARCHAR(255) NOT NULL,
            photo_url TEXT,
            role VARCHAR(50) DEFAULT 'client',
            department VARCHAR(100),
            position VARCHAR(255),
            is_active BOOLEAN DEFAULT true,
            notes TEXT,
            channels JSONB DEFAULT '[]',
            metrics JSONB DEFAULT '{}',
            first_seen_at TIMESTAMP DEFAULT NOW(),
            last_seen_at TIMESTAMP DEFAULT NOW(),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `
        
        // Check if user exists
        const existingUser = await sql`
          SELECT id, channels FROM support_users WHERE telegram_id = ${from.id}
        `
        
        if (existingUser.length > 0) {
          // Update existing user
          const channels = existingUser[0].channels || []
          if (!channels.some((c: any) => c.id === channel.id)) {
            channels.push({ id: channel.id, name: chat.title, addedAt: new Date().toISOString() })
          }
          
          await sql`
            UPDATE support_users SET
              telegram_username = COALESCE(${from.username}, telegram_username),
              name = COALESCE(${senderName}, name),
              photo_url = COALESCE(${senderPhotoUrl}, photo_url),
              channels = ${JSON.stringify(channels)},
              last_seen_at = NOW(),
              updated_at = NOW()
            WHERE telegram_id = ${from.id}
          `
        } else {
          // Create new user
          const userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          const initialRole = senderRole === 'client' ? 'client' : 'employee'
          const channels = [{ id: channel.id, name: chat.title, addedAt: new Date().toISOString() }]
          
          await sql`
            INSERT INTO support_users (id, telegram_id, telegram_username, name, photo_url, role, channels)
            VALUES (${userId}, ${from.id}, ${from.username}, ${senderName}, ${senderPhotoUrl}, ${initialRole}, ${JSON.stringify(channels)})
            ON CONFLICT (telegram_id) DO NOTHING
          `
        }
      } catch (e) {
        console.error('User registration error:', e)
        // Don't fail message processing if user registration fails
      }
    }

    await sql`
      INSERT INTO support_messages (
        id, channel_id, telegram_message_id, sender_id, sender_name, sender_username, sender_photo_url,
        is_from_client, sender_role, manager_id, content_type, text_content, media_file_id, media_url, transcript,
        ai_summary, ai_category, ai_sentiment, ai_intent, ai_urgency, ai_extracted_entities, ai_image_analysis, ai_suggestion,
        is_problem, is_processed, is_read, reply_to_message_id, reply_to_text, reply_to_sender, thread_id, thread_name
      ) VALUES (
        ${messageId},
        ${channel.id},
        ${message.message_id},
        ${senderId},
        ${senderName},
        ${senderUsername},
        ${senderPhotoUrl},
        ${isFromClient},
        ${senderRole},
        ${managerId},
        ${contentType},
        ${textContent || null},
        ${mediaFileId || null},
        ${mediaUrl || null},
        ${transcript || null},
        ${analysis.summary || null},
        ${analysis.category || null},
        ${analysis.sentiment || null},
        ${analysis.intent || null},
        ${analysis.urgency || 0},
        ${JSON.stringify(analysis.entities || {})},
        ${imageAnalysis || null},
        ${analysis.suggestion || null},
        ${analysis.isProblem || false},
        ${true},
        ${!isFromClient},
        ${message.reply_to_message?.message_id || null},
        ${replyToText},
        ${replyToSender},
        ${threadId},
        ${threadName}
      )
    `

    // Update topic stats if applicable
    if (threadId) {
      await sql`
        UPDATE support_topics SET 
          messages_count = messages_count + 1,
          last_message_at = NOW(),
          last_sender_name = ${senderName}
        WHERE channel_id = ${channel.id} AND thread_id = ${threadId}
      `
    }

    // Update channel stats based on who sent the message
    if (isFromClient) {
      // Client message - check if it needs a reply based on AI analysis
      // Messages that don't need reply: gratitude, confirmations, reactions, farewells
      const needsReply = analysis.intent !== 'gratitude' && 
                         analysis.intent !== 'confirmation' &&
                         analysis.intent !== 'farewell' &&
                         analysis.intent !== 'reaction' &&
                         analysis.intent !== 'acknowledgment' &&
                         !['спасибо', 'благодарю', 'хорошо', 'понял', 'ок', 'окей', 'супер', 'классно', 'отлично', 'здорово', 'круто'].some(w => (textContent || '').toLowerCase().includes(w)) &&
                         analysis.urgency > 0 // urgency 0 = no action needed
      
      await sql`
        UPDATE support_channels SET 
          last_message_at = NOW(),
          last_client_message_at = NOW(),
          last_sender_name = ${senderName},
          last_message_preview = ${messagePreview},
          awaiting_reply = ${needsReply},
          unread_count = COALESCE(unread_count, 0) + 1
        WHERE id = ${channel.id}
      `
    } else {
      // Team/Support message - no longer awaiting reply
      await sql`
        UPDATE support_channels SET 
          last_message_at = NOW(),
          last_team_message_at = NOW(),
          last_sender_name = ${senderName},
          last_message_preview = ${messagePreview},
          awaiting_reply = false
        WHERE id = ${channel.id}
      `

      // AUTO-MARK AS READ: When employee responds, mark all client messages as read
      const readResult = await markChannelReadOnReply(sql, channel.id)
      if (readResult.updatedMessages > 0) {
        console.log(`Auto-marked ${readResult.updatedMessages} messages as read after employee reply`)
      }

      // AUTO-BIND: If employee has agent ID but no telegram_id bound, auto-bind it
      if (managerId && senderId) {
        const bound = await autoBindTelegramId(sql, managerId, senderId)
        if (bound) {
          console.log(`Auto-bound telegram_id ${senderId} to agent ${managerId}`)
        }
      }

      // Detect commitments in team messages
      const textForCommitment = textContent || transcript || ''
      const commitment = detectCommitment(textForCommitment)
      
      if (commitment.hasCommitment) {
        const reminderId = await createReminder(
          sql,
          commitment,
          channel.id,
          messageId,
          senderName,
          managerId
        )
        
        if (reminderId) {
          console.log(`Created reminder ${reminderId}: ${commitment.commitmentType} - "${commitment.commitmentText}"`)
        }
      }
    }

    // Auto-create case if problem detected
    let caseId = null
    if (analysis.isProblem && analysis.urgency >= 2) {
      caseId = await createCaseFromMessage(sql, {
        id: messageId,
        text_content: textContent,
        transcript
      }, channel, analysis)
    }

    // Track conversation metrics
    await trackConversation(sql, channel.id, isFromClient, managerId)

    // Auto-detect feedback from client messages after auto-responses
    if (isFromClient) {
      try {
        // Check if last message was from autoresponder
        const lastAutoResponse = await sql`
          SELECT m.id, m.text_content, d.id as dialog_id
          FROM support_messages m
          LEFT JOIN support_dialogs d ON d.channel_id = m.channel_id 
            AND d.created_at > m.created_at - INTERVAL '5 minutes'
          WHERE m.channel_id = ${channel.id}
            AND m.sender_role IN ('autoresponder', 'bot', 'ai')
            AND m.created_at > NOW() - INTERVAL '30 minutes'
          ORDER BY m.created_at DESC
          LIMIT 1
        `
        
        if (lastAutoResponse.length > 0) {
          const dialogId = lastAutoResponse[0].dialog_id
          const clientText = (textContent || '').toLowerCase()
          
          // Analyze client response to determine feedback
          const positiveWords = ['спасибо', 'благодарю', 'помогло', 'понял', 'понятно', 'отлично', 'супер', 'класс', 'круто', 'да', 'ок', 'хорошо', 'работает', 'решено', 'rahmat', 'raxmat']
          const negativeWords = ['не помогло', 'не работает', 'всё равно', 'опять', 'снова', 'не понял', 'не понятно', 'нет', 'плохо', 'ужас']
          
          const isPositive = positiveWords.some(w => clientText.includes(w))
          const isNegative = negativeWords.some(w => clientText.includes(w))
          
          // If we can determine feedback and have a dialog ID
          if (dialogId && (isPositive || isNegative)) {
            const rating = isPositive ? 'helpful' : 'not_helpful'
            
            // Save implicit feedback
            const feedbackId = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            await sql`
              INSERT INTO support_feedback (id, dialog_id, channel_id, message_id, rating, comment)
              VALUES (${feedbackId}, ${dialogId}, ${channel.id}, ${messageId}, ${rating}, ${'Auto-detected from: ' + clientText.slice(0, 50)})
            `.catch(() => {})
            
            // Update dialog confidence
            if (isPositive) {
              await sql`
                UPDATE support_dialogs 
                SET was_helpful = true, confidence_score = LEAST(1.0, confidence_score + 0.03), used_count = used_count + 1, updated_at = NOW()
                WHERE id = ${dialogId}
              `.catch(() => {})
            } else {
              await sql`
                UPDATE support_dialogs 
                SET was_helpful = false, confidence_score = GREATEST(0, confidence_score - 0.1), requires_human_review = true, updated_at = NOW()
                WHERE id = ${dialogId}
              `.catch(() => {})
            }
            
            console.log(`Auto-detected feedback: ${rating} for dialog ${dialogId} from message "${clientText.slice(0, 30)}..."`)
          }
        }
      } catch (e) {
        // Don't fail on feedback detection errors
        console.log('Feedback detection skipped:', e)
      }
    }

    return json({
      ok: true,
      messageId,
      channelId: channel.id,
      contentType,
      hasTranscript: !!transcript,
      sender: {
        name: senderName,
        username: from.username,
        role: senderRole,
        isClient: isFromClient
      },
      analysis: {
        category: analysis.category,
        sentiment: analysis.sentiment,
        urgency: analysis.urgency,
        isProblem: analysis.isProblem
      },
      caseCreated: !!caseId,
      caseId
    })

  } catch (e: any) {
    console.error('Webhook error:', e)
    return json({ ok: false, error: e.message }, 500)
  }
}
