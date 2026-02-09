import { neon } from '@neondatabase/serverless'
import OpenAI from 'openai'

export const config = {
  runtime: 'edge',
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

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

// Telegram Bot API - simple message without buttons (feedback via context/reactions)
async function sendTelegramMessage(
  chatId: string | number, 
  text: string, 
  parseMode = 'HTML',
  askForFeedback = false // Only ask occasionally
) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN not found')
  
  // If asking for feedback, append a gentle question
  let finalText = text
  if (askForFeedback) {
    finalText += '\n\n💬 <i>Это было полезно? Ответьте "да" или поставьте 👍</i>'
  }
  
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: finalText,
      parse_mode: parseMode,
    }),
  })
  
  return response.json()
}

// Search similar dialogs from learning database (RAG)
async function searchSimilarDialogs(sql: any, questionText: string): Promise<{
  found: boolean
  dialog?: { id: string; answer: string; confidence: number }
}> {
  try {
    // Simple keyword-based search (embeddings would be better but more complex)
    const searchTerms = questionText
      .toLowerCase()
      .replace(/[^\wа-яёўқғҳ\s]/gi, '')
      .split(/\s+/)
      .filter((w: string) => w.length > 3)
      .slice(0, 5)
    
    if (searchTerms.length === 0) {
      return { found: false }
    }
    
    // Search with multiple conditions
    const searchPattern = `%${searchTerms.join('%')}%`
    const results = await sql`
      SELECT id, question_text, answer_text, confidence_score, used_count
      FROM support_dialogs
      WHERE is_active = true
        AND (was_helpful IS NULL OR was_helpful = true)
        AND confidence_score >= 0.6
        AND used_count >= 1
        AND (
          question_text ILIKE ${searchPattern}
          OR question_text ILIKE ${'%' + searchTerms[0] + '%'}
        )
      ORDER BY confidence_score DESC, used_count DESC
      LIMIT 1
    `
    
    if (results.length > 0 && results[0].confidence_score >= 0.7) {
      return {
        found: true,
        dialog: {
          id: results[0].id,
          answer: results[0].answer_text,
          confidence: results[0].confidence_score
        }
      }
    }
    
    return { found: false }
  } catch (e) {
    console.log('RAG search error:', e)
    return { found: false }
  }
}

// Поиск в базе знаний
async function searchDocs(sql: any, query: string): Promise<{ title: string; url: string } | null> {
  try {
    const results = await sql`
      SELECT title, url
      FROM support_docs
      WHERE title ILIKE ${'%' + query + '%'}
         OR content ILIKE ${'%' + query + '%'}
      ORDER BY 
        CASE WHEN title ILIKE ${'%' + query + '%'} THEN 0 ELSE 1 END
      LIMIT 1
    `
    return results[0] || null
  } catch {
    return null
  }
}

// LLM prompt for auto-response generation
const AUTORESPONDER_PROMPT = `Ты AI помощник службы поддержки Delever (платформа для ресторанов и доставки).
Тебе нужно сгенерировать вежливый и полезный автоматический ответ клиенту.

ПРАВИЛА:
1. Будь вежливым и профессиональным
2. Отвечай на русском языке
3. Если есть информация из базы знаний - используй её
4. Если не можешь помочь - извинись и сообщи что сотрудник свяжется
5. Ответ должен быть кратким (2-4 предложения)
6. НЕ выдумывай информацию которой не знаешь
7. В конце добавь что это автоматическое сообщение

КОНТЕКСТ:
- Причина автоответа: {{REASON}}
- Имя клиента: {{NAME}}
{{DOC_HINT}}

Сообщение клиента:
{{MESSAGE}}

Сгенерируй ответ (только текст, без HTML тегов):`

// Генерация AI ответа с использованием LLM
async function generateAutoResponse(
  messageText: string, 
  senderName: string,
  reason: 'night' | 'weekend' | 'offline' | 'timeout',
  docHint?: { title: string; url: string } | null
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  
  // Fallback response if no API key
  const fallbackResponse = generateFallbackResponse(messageText, senderName, reason, docHint)
  
  if (!apiKey) {
    console.log('[Autoresponder] No OpenAI key, using fallback')
    return fallbackResponse
  }
  
  try {
    const openai = new OpenAI({ apiKey })
    
    const reasonTexts: Record<string, string> = {
      night: 'Нерабочее время (22:00 - 08:00)',
      weekend: 'Выходной день',
      offline: 'Все сотрудники офлайн',
      timeout: 'Задержка ответа более 5 минут',
    }
    
    const docHintText = docHint 
      ? `\nСтатья из базы знаний: "${docHint.title}" - ${docHint.url}`
      : ''
    
    const prompt = AUTORESPONDER_PROMPT
      .replace('{{REASON}}', reasonTexts[reason] || reason)
      .replace('{{NAME}}', senderName || 'клиент')
      .replace('{{DOC_HINT}}', docHintText)
      .replace('{{MESSAGE}}', messageText || 'Сообщение клиента')
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 300,
    })
    
    let response = completion.choices[0]?.message?.content || fallbackResponse
    
    // Add automatic message indicator
    if (!response.includes('автоматическ')) {
      response += '\n\n🤖 Это автоматическое сообщение'
    }
    
    // Add doc link if available and not already in response
    if (docHint && !response.includes(docHint.url)) {
      response += `\n\n📖 Возможно поможет: ${docHint.title}\n${docHint.url}`
    }
    
    return response
    
  } catch (e: any) {
    console.error('[Autoresponder] LLM error:', e.message)
    return fallbackResponse
  }
}

// Fallback response without LLM
function generateFallbackResponse(
  messageText: string, 
  senderName: string,
  reason: 'night' | 'weekend' | 'offline' | 'timeout',
  docHint?: { title: string; url: string } | null
): string {
  const greeting = `Здравствуйте, ${senderName}!`
  
  let reasonText = ''
  switch (reason) {
    case 'night':
      reasonText = 'Сейчас нерабочее время (22:00 - 08:00).'
      break
    case 'weekend':
      reasonText = 'Сегодня выходной день.'
      break
    case 'offline':
      reasonText = 'В данный момент все сотрудники поддержки офлайн.'
      break
    case 'timeout':
      reasonText = 'Приносим извинения за ожидание.'
      break
  }
  
  let helpText = 'Ваше сообщение зарегистрировано. Мы свяжемся с вами в ближайшее рабочее время.'
  
  if (docHint) {
    helpText = `Возможно, вам поможет эта статья из нашей базы знаний:\n📖 ${docHint.title}\n${docHint.url}\n\nЕсли это не решит ваш вопрос, мы ответим в ближайшее рабочее время.`
  }
  
  // Проверяем ключевые слова для быстрых ответов
  const lowerText = messageText.toLowerCase()
  
  if (lowerText.includes('не работает') || lowerText.includes('ошибка') || lowerText.includes('проблема')) {
    helpText = `Мы зафиксировали вашу проблему и создали тикет для её решения.\n\n${helpText}`
  } else if (lowerText.includes('цена') || lowerText.includes('стоимость') || lowerText.includes('тариф')) {
    helpText = `По вопросам цен и тарифов вас проконсультирует наш менеджер.\n\n${helpText}`
  } else if (lowerText.includes('подключ') || lowerText.includes('интеграц')) {
    helpText = `Вопросы по подключению и интеграции требуют детального обсуждения с нашим специалистом.\n\n${helpText}`
  }
  
  return `${greeting}\n\n${reasonText}\n\n${helpText}\n\n🤖 Это автоматическое сообщение`
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }
  
  // ВРЕМЕННО ОТКЛЮЧЕНО - автоответчик деактивирован
  // TODO: включить обратно после доработки логики
  return json({ success: false, skipped: true, reason: 'Autoresponder temporarily disabled' })

  const sql = getSQL()
  
  try {
    const body = await req.json()
    const { 
      channelId, 
      telegramChatId, 
      messageText, 
      senderName,
      reason = 'timeout' 
    } = body
    
    if (!channelId || !telegramChatId) {
      return json({ error: 'channelId and telegramChatId required' }, 400)
    }
    
    // Проверяем не отправляли ли уже автоответ в этот канал за последние 30 мин
    const recentAutoResponse = await sql`
      SELECT id FROM support_messages 
      WHERE channel_id = ${channelId}
        AND sender_role = 'autoresponder'
        AND created_at > NOW() - INTERVAL '30 minutes'
      LIMIT 1
    `
    
    if (recentAutoResponse.length > 0) {
      return json({ 
        success: false, 
        skipped: true, 
        reason: 'Already sent autoresponse in last 30 minutes' 
      })
    }
    
    // 1. First try RAG - search for similar solved dialogs
    const ragResult = await searchSimilarDialogs(sql, messageText || '')
    let responseText: string
    let usedDialogId: string | null = null
    let responseSource: 'rag' | 'docs' | 'template' = 'template'
    
    if (ragResult.found && ragResult.dialog && ragResult.dialog.confidence >= 0.75) {
      // High confidence match from learning database - use it!
      responseText = `Здравствуйте, ${senderName || 'клиент'}!\n\n${ragResult.dialog.answer}\n\n🤖 <i>Это автоматический ответ на основе похожего вопроса</i>`
      usedDialogId = ragResult.dialog.id
      responseSource = 'rag'
      
      // Update used_count for the dialog
      await sql`
        UPDATE support_dialogs 
        SET used_count = used_count + 1, last_used_at = NOW()
        WHERE id = ${usedDialogId}
      `.catch(() => {})
      
    } else {
      // 2. Fallback to docs search
      const keywords = (messageText || '').split(/\s+/).filter((w: string) => w.length > 3).slice(0, 3)
      let docHint = null
      for (const keyword of keywords) {
        docHint = await searchDocs(sql, keyword)
        if (docHint) break
      }
      
      if (docHint) {
        responseSource = 'docs'
      }
      
      // 3. Generate LLM response
      responseText = await generateAutoResponse(
        messageText || '',
        senderName || 'клиент',
        reason as any,
        docHint
      )
    }
    
    // Decide if we should ask for feedback (rarely - 1 in 15 auto responses)
    let askForFeedback = false
    if (usedDialogId) {
      try {
        const autoResponseCount = await sql`
          SELECT COUNT(*) as cnt FROM support_messages 
          WHERE sender_role = 'autoresponder' 
          AND created_at > NOW() - INTERVAL '7 days'
        `
        const count = parseInt(autoResponseCount[0]?.cnt || '0')
        // Ask for feedback every ~15 auto responses
        askForFeedback = count > 0 && count % 15 === 0
      } catch { /* ignore */ }
    }
    
    // Отправляем в Telegram (occasionally ask for feedback, not every time)
    const telegramResult = await sendTelegramMessage(
      telegramChatId, 
      responseText,
      'HTML',
      askForFeedback
    )
    
    if (!telegramResult.ok) {
      return json({ 
        success: false, 
        error: 'Failed to send Telegram message',
        telegramError: telegramResult.description
      }, 500)
    }
    
    // Сохраняем в базу
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    await sql`
      INSERT INTO support_messages (
        id, channel_id, telegram_message_id, sender_name, sender_role, 
        is_from_client, content_type, text_content, created_at
      ) VALUES (
        ${msgId}, ${channelId}, ${telegramResult.result?.message_id}, 
        'AI Помощник', 'autoresponder', false, 'text', ${responseText}, NOW()
      )
    `
    
    // Создаём тикет/кейс если нужно
    if (reason === 'night' || reason === 'weekend' || reason === 'offline') {
      const caseId = `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      await sql`
        INSERT INTO support_cases (
          id, channel_id, title, description, status, priority, category, created_at
        ) VALUES (
          ${caseId}, ${channelId}, 
          ${'Автоматический тикет: ' + (senderName || 'Клиент')},
          ${messageText?.slice(0, 500) || 'Сообщение в нерабочее время'},
          'detected', 'medium', 'auto-created', NOW()
        )
        ON CONFLICT DO NOTHING
      `.catch(() => {}) // Игнорируем если таблица не существует
    }
    
    return json({
      success: true,
      messageId: msgId,
      telegramMessageId: telegramResult.result?.message_id,
      responseSource, // 'rag', 'docs', or 'template'
      usedDialogId, // dialog ID if from RAG
      ragConfidence: ragResult.dialog?.confidence || null
    })
    
  } catch (error: any) {
    console.error('[Autoresponder Respond Error]', error)
    return json({ success: false, error: error.message }, 500)
  }
}
