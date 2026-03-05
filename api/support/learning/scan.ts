import { neon } from '@neondatabase/serverless'
import { getOpenAIKey } from '../lib/db.js'

export const config = { 
  runtime: 'edge',
  maxDuration: 60
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

// Generate embedding for text using OpenAI
async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = await getOpenAIKey()
  if (!apiKey || !text) return null

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000), // Limit text length
      }),
    })

    const data = await res.json()
    return data.data?.[0]?.embedding || null
  } catch (e) {
    console.error('Embedding generation failed:', e)
    return null
  }
}

// Detect if message is a "thank you" or positive feedback
function isPositiveFeedback(text: string): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  const positiveWords = [
    'спасибо', 'благодарю', 'помогло', 'работает', 'решено', 'отлично',
    'супер', 'класс', 'круто', 'понял', 'понятно', 'да', 'хорошо',
    'rahmat', 'raxmat', 'thanks', 'thank you', 'tushundim', 'ok', 'ок',
    'молодец', 'молодцы', 'здорово', 'прекрасно', 'замечательно'
  ]
  return positiveWords.some(w => lower.includes(w))
}

// Detect if message indicates problem not solved
function isNegativeFeedback(text: string): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  const negativeWords = [
    'не помогло', 'не работает', 'всё равно', 'опять', 'снова', 
    'не понял', 'не понятно', 'плохо', 'ужас', 'не решено',
    'проблема осталась', 'та же проблема', 'ishlamayapti'
  ]
  return negativeWords.some(w => lower.includes(w))
}

// Categorize question with improved logic
function categorizeQuestion(text: string): string {
  if (!text) return 'general'
  const lower = text.toLowerCase()
  
  // Технические проблемы (расширенный список)
  if (/ошибк|error|не работа|сломал|баг|bug|xato|глючит|виснет|падает|crash|exception|500|404|timeout|не загруж|не открыва|зависа|тормоз|медленн|лагает|не отвеча|не реагир|белый экран|черный экран|ishlamay|buzildi/i.test(lower)) {
    return 'technical'
  }
  
  // Интеграции (POS системы, агрегаторы, API)
  if (/интеграц|подключ|api|webhook|iiko|r-keeper|rkeeper|poster|jowi|wolt|yandex|express24|узум|payme|click|apelsin|агрегатор|синхрониз|связ.*с|не приход.*заказ|не передаёт|не синхрон|bog'lanish|ulanish/i.test(lower)) {
    return 'integration'
  }
  
  // Оплата и биллинг
  if (/оплат|счёт|счет|деньг|pul|tolov|billing|tarif|тариф|подписк|subscription|списа|возврат|refund|чек|invoice|баланс|balance|касс|terminal|эквайринг|платёж|оплач|не оплат/i.test(lower)) {
    return 'billing'
  }
  
  // Жалобы
  if (/жалоб|недовол|плохо|ужас|shikoyat|отврат|кошмар|безобраз|хамств|грубо|обман|мошен|разочаров|возмущ|скандал|претензи|рекламац/i.test(lower)) {
    return 'complaint'
  }
  
  // Запросы функций
  if (/можно ли|хотел бы|было бы|добавьте|feature|предлага|улучш|доработ|реализ|внедр|новая функц|нужна возможн|kerak|qo'shsangiz/i.test(lower)) {
    return 'feature_request'
  }
  
  // Заказы
  if (/заказ|order|buyurtma|zakaz|не приш|где заказ|статус заказ|отмен.*заказ|изменить заказ|корректир.*заказ/i.test(lower)) {
    return 'order'
  }
  
  // Доставка
  if (/доставк|delivery|курьер|yetkazib|dostavka|опоздал|задерж.*доставк|не доставил|где курьер|tracking/i.test(lower)) {
    return 'delivery'
  }
  
  // Меню
  if (/меню|menu|блюд|товар|продукт|позици|ассортимент|добавить.*товар|удалить.*товар|изменить.*цен|стоп-лист/i.test(lower)) {
    return 'menu'
  }
  
  // Приложение
  if (/приложен|app|мобильн|android|ios|скачать|установ|обновлен|версия|play market|app store|ilova/i.test(lower)) {
    return 'app'
  }
  
  // Онбординг
  if (/начать|настро|установ|boshlash|sozlash|регистрац|первый раз|как подключ|с чего начать|пошагов/i.test(lower)) {
    return 'onboarding'
  }
  
  // Вопросы (общие)
  if (/как\s|что\s|где\s|почему|когда|qanday|nima|qayerda|подскажите|расскажите|объясните/i.test(lower)) {
    return 'question'
  }
  
  // Благодарность/отзыв
  if (/спасибо|благодар|отлично|супер|класс|молодц|rahmat|zo'r|ajoyib/i.test(lower)) {
    return 'feedback'
  }
  
  return 'general'
}

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

  // Allow cron calls without auth (check secret) or with Bearer token
  const authHeader = req.headers.get('Authorization')
  const url = new URL(req.url)
  const cronSecret = url.searchParams.get('secret')
  
  const isValidCron = cronSecret === process.env.CRON_SECRET
  const isValidAuth = authHeader?.startsWith('Bearer ')
  
  if (!isValidCron && !isValidAuth) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  
  // Get parameters
  const limit = parseInt(url.searchParams.get('limit') || '100')
  const daysBack = parseInt(url.searchParams.get('days') || '30')
  const generateEmbeddings = url.searchParams.get('embeddings') !== 'false'

  try {
    // Stats
    const stats = {
      scanned: 0,
      dialogsCreated: 0,
      dialogsUpdated: 0,
      positiveFound: 0,
      negativeFound: 0,
      embeddingsGenerated: 0,
      errors: [] as string[]
    }

    // Get conversations: client question followed by support answer
    // Group by channel and find Q&A pairs
    const conversations = await sql`
      WITH ranked_messages AS (
        SELECT 
          m.id,
          m.channel_id,
          m.text_content,
          m.transcript,
          m.sender_name,
          m.sender_role,
          m.is_from_client,
          m.ai_category,
          m.created_at,
          LAG(m.id) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_msg_id,
          LAG(m.text_content) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_text,
          LAG(m.transcript) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_transcript,
          LAG(m.sender_name) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_sender,
          LAG(m.sender_role) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_role,
          LAG(m.is_from_client) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as prev_is_client,
          LEAD(m.text_content) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as next_text,
          LEAD(m.sender_role) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as next_role,
          LEAD(m.is_from_client) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) as next_is_client
        FROM support_messages m
        WHERE m.created_at > NOW() - INTERVAL '${daysBack} days'
      )
      SELECT 
        r.id as answer_id,
        r.channel_id,
        r.text_content as answer_text,
        r.transcript as answer_transcript,
        r.sender_name as answer_by,
        r.sender_role,
        r.created_at as answer_time,
        r.prev_msg_id as question_id,
        r.prev_text as question_text,
        r.prev_transcript as question_transcript,
        r.prev_sender as question_sender,
        r.prev_role as question_role,
        r.next_text as followup_text,
        r.next_role as followup_role,
        r.next_is_client as followup_is_client
      FROM ranked_messages r
      WHERE r.sender_role IN ('support', 'team')
        AND r.prev_is_client = true
        AND (r.prev_text IS NOT NULL OR r.prev_transcript IS NOT NULL)
        AND (r.text_content IS NOT NULL OR r.transcript IS NOT NULL)
      ORDER BY r.created_at DESC
      LIMIT ${limit}
    `

    stats.scanned = conversations.length

    for (const conv of conversations) {
      try {
        const questionText = conv.question_text || conv.question_transcript || ''
        const answerText = conv.answer_text || conv.answer_transcript || ''
        
        // Skip if too short
        if (questionText.length < 5 || answerText.length < 5) continue

        // Check if dialog already exists
        const existingDialog = await sql`
          SELECT id, was_helpful, confidence_score FROM support_dialogs 
          WHERE channel_id = ${conv.channel_id}
            AND question_text = ${questionText}
          LIMIT 1
        `

        // Determine if answer was helpful based on follow-up
        let wasHelpful: boolean | null = null
        let confidenceScore = 0.5

        if (conv.followup_text && conv.followup_is_client) {
          if (isPositiveFeedback(conv.followup_text)) {
            wasHelpful = true
            confidenceScore = 0.8
            stats.positiveFound++
          } else if (isNegativeFeedback(conv.followup_text)) {
            wasHelpful = false
            confidenceScore = 0.3
            stats.negativeFound++
          }
        }

        // Categorize the question
        const category = categorizeQuestion(questionText)

        if (existingDialog.length > 0) {
          // Update existing dialog if we found feedback
          if (wasHelpful !== null && existingDialog[0].was_helpful === null) {
            await sql`
              UPDATE support_dialogs SET
                was_helpful = ${wasHelpful},
                confidence_score = ${confidenceScore},
                updated_at = NOW()
              WHERE id = ${existingDialog[0].id}
            `
            stats.dialogsUpdated++
          }
        } else {
          // Create new dialog
          const dialogId = `dlg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          
          // Generate embedding for semantic search
          let embedding: number[] | null = null
          if (generateEmbeddings) {
            embedding = await generateEmbedding(questionText)
            if (embedding) stats.embeddingsGenerated++
          }

          await sql`
            INSERT INTO support_dialogs (
              id, channel_id, question_text, question_category,
              answer_text, answer_by, answer_type,
              was_helpful, confidence_score,
              question_embedding
            ) VALUES (
              ${dialogId},
              ${conv.channel_id},
              ${questionText},
              ${category},
              ${answerText},
              ${conv.answer_by},
              'manual',
              ${wasHelpful},
              ${confidenceScore},
              ${embedding ? `[${embedding.join(',')}]` : null}
            )
          `
          stats.dialogsCreated++
        }
      } catch (e: any) {
        stats.errors.push(e.message)
      }
    }

    // Update daily learning stats
    const today = new Date().toISOString().split('T')[0]
    await sql`
      INSERT INTO support_learning_stats (date, total_dialogs, new_dialogs)
      VALUES (${today}, 
        (SELECT COUNT(*) FROM support_dialogs WHERE is_active = true),
        ${stats.dialogsCreated}
      )
      ON CONFLICT (date) DO UPDATE SET
        total_dialogs = (SELECT COUNT(*) FROM support_dialogs WHERE is_active = true),
        new_dialogs = support_learning_stats.new_dialogs + ${stats.dialogsCreated},
        updated_at = NOW()
    `.catch(() => {})

    return json({
      success: true,
      message: `Scanned ${stats.scanned} conversations`,
      stats,
      nextRun: 'Daily at midnight UTC (via Vercel cron)'
    })

  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
