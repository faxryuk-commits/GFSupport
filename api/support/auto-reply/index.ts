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

// Simple in-memory cache for templates and settings
const cache = new Map<string, { data: any; expires: number }>()

function getCached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) {
    return Promise.resolve(cached.data)
  }
  return fetcher().then(data => {
    cache.set(key, { data, expires: Date.now() + ttlMs })
    return data
  })
}

// Send message to Telegram
async function sendTelegramMessage(chatId: string | number, text: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN not found')
  
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  })
  
  return response.json()
}

// Get template for intent (with caching)
async function getTemplate(sql: any, intent: string): Promise<{ text: string; vars: string[] } | null> {
  return getCached(`template:${intent}`, 60 * 60 * 1000, async () => {
    const rows = await sql`
      SELECT template_text, personalization_vars
      FROM support_auto_templates
      WHERE intent = ${intent} AND is_active = true
      ORDER BY priority DESC
      LIMIT 1
    `
    if (rows.length === 0) return null
    return {
      text: rows[0].template_text,
      vars: rows[0].personalization_vars || []
    }
  })
}

// Get auto-reply settings (with caching)
async function getSettings(sql: any): Promise<Record<string, string>> {
  return getCached('auto_reply_settings', 5 * 60 * 1000, async () => {
    const rows = await sql`
      SELECT key, value FROM support_settings
      WHERE key LIKE 'auto_reply_%'
    `
    const settings: Record<string, string> = {}
    for (const row of rows) {
      settings[row.key] = row.value
    }
    return settings
  })
}

// Get client profile (with caching)
async function getClientProfile(sql: any, telegramId: string): Promise<{
  name: string
  totalConversations: number
  lastIssue: string | null
} | null> {
  return getCached(`profile:${telegramId}`, 5 * 60 * 1000, async () => {
    const rows = await sql`
      SELECT name, total_conversations, last_issue_summary
      FROM support_users
      WHERE telegram_id = ${telegramId}
      LIMIT 1
    `
    if (rows.length === 0) return null
    return {
      name: rows[0].name,
      totalConversations: rows[0].total_conversations || 0,
      lastIssue: rows[0].last_issue_summary
    }
  })
}

// Personalize template with variables
function personalizeTemplate(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
  }
  // Clean up any remaining {var} placeholders
  result = result.replace(/\{[^}]+\}/g, '')
  return result.trim()
}

// Detect language from text (ru or uz)
function detectLanguage(text: string): 'ru' | 'uz' {
  const lower = text.toLowerCase()
  // Uzbek indicators (Latin)
  const uzLatinWords = /\b(salom|rahmat|xayr|kerak|qanday|nima|yordam|yaxshi|bormi|bor|yoq|ha|yo'q)\b/i
  // Uzbek indicators (Cyrillic)
  const uzCyrillicWords = /\b(салом|рахмат|хайр|керак|қандай|нима|ёрдам|яхши|борми|бор|йўқ)\b/i
  
  if (uzLatinWords.test(lower) || uzCyrillicWords.test(lower)) {
    return 'uz'
  }
  return 'ru'
}

// Check if this is an ongoing conversation (has recent activity)
async function isOngoingConversation(sql: any, channelId: string): Promise<boolean> {
  const recentMessages = await sql`
    SELECT COUNT(*) as cnt FROM support_messages
    WHERE channel_id = ${channelId}
      AND created_at > NOW() - INTERVAL '24 hours'
  `
  return parseInt(recentMessages[0]?.cnt || '0') > 1
}

// Process auto-reply based on intent
async function processAutoReply(
  sql: any,
  channelId: string,
  telegramChatId: string,
  intent: string,
  senderName: string,
  telegramId?: string,
  originalText?: string
): Promise<{ success: boolean; message?: string; skipped?: boolean; reason?: string }> {
  
  // Get settings
  const settings = await getSettings(sql)
  
  // Check if auto-reply is enabled for this intent
  const intentSettingKey = `auto_reply_${intent.replace('faq_', '')}`
  if (settings['auto_reply_enabled'] === 'false') {
    return { success: false, skipped: true, reason: 'Auto-reply disabled' }
  }
  
  // Check for specific intent settings
  if (intent === 'greeting' && settings['auto_reply_greeting'] === 'false') {
    return { success: false, skipped: true, reason: 'Greeting auto-reply disabled' }
  }
  if (intent === 'gratitude' && settings['auto_reply_gratitude'] === 'false') {
    return { success: false, skipped: true, reason: 'Gratitude auto-reply disabled' }
  }
  if (intent.startsWith('faq_') && settings['auto_reply_faq'] === 'false') {
    return { success: false, skipped: true, reason: 'FAQ auto-reply disabled' }
  }
  
  // IMPORTANT: Don't send greeting in ongoing conversations!
  if (intent === 'greeting') {
    const isOngoing = await isOngoingConversation(sql, channelId)
    if (isOngoing) {
      console.log(`[Auto-Reply] Skipping greeting - ongoing conversation in channel ${channelId}`)
      return { success: false, skipped: true, reason: 'Ongoing conversation - no greeting needed' }
    }
  }
  
  // Check if we already sent auto-reply recently (spam protection)
  const recentAutoReply = await sql`
    SELECT id FROM support_messages
    WHERE channel_id = ${channelId}
      AND sender_role IN ('autoresponder', 'auto_reply')
      AND created_at > NOW() - INTERVAL '2 minutes'
    LIMIT 1
  `
  if (recentAutoReply.length > 0) {
    return { success: false, skipped: true, reason: 'Recent auto-reply exists' }
  }
  
  // Detect language from original message
  const lang = originalText ? detectLanguage(originalText) : 'ru'
  console.log(`[Auto-Reply] Detected language: ${lang}`)
  
  // Get template for this intent
  let template = await getTemplate(sql, intent)
  
  // Fallback to default templates with language support
  if (!template) {
    const defaultsRu: Record<string, string> = {
      greeting: 'Здравствуйте{client_name}! Спасибо за обращение. Чем могу помочь?',
      gratitude: 'Рады были помочь! Если возникнут вопросы - обращайтесь.',
      closing: 'Спасибо за обращение! Хорошего дня!',
      faq_pricing: 'Информация о тарифах доступна на нашем сайте. Если нужна консультация - мы скоро ответим.',
      faq_hours: 'Мы работаем с 09:00 до 22:00 по будням. В выходные с 10:00 до 18:00.',
      faq_contacts: 'Вы можете связаться с нами через этот чат или по телефону, указанному на сайте.',
    }
    const defaultsUz: Record<string, string> = {
      greeting: 'Assalomu alaykum{client_name}! Murojaat uchun rahmat. Qanday yordam bera olaman?',
      gratitude: 'Yordamimiz tegdi - xursandmiz! Savollar bo\'lsa - murojaat qiling.',
      closing: 'Murojaat uchun rahmat! Yaxshi kun tilaymiz!',
      faq_pricing: 'Tariflar haqida ma\'lumot saytimizda. Maslahat kerak bo\'lsa - tez javob beramiz.',
      faq_hours: 'Biz dushanbadan jumagacha 09:00 dan 22:00 gacha ishlaymiz. Dam olish kunlari 10:00 dan 18:00 gacha.',
      faq_contacts: 'Bu chat orqali yoki saytdagi telefon raqami orqali bog\'lanishingiz mumkin.',
    }
    
    const defaults = lang === 'uz' ? defaultsUz : defaultsRu
    if (defaults[intent]) {
      template = { text: defaults[intent], vars: ['{client_name}'] }
    }
  }
  
  if (!template) {
    return { success: false, skipped: true, reason: `No template for intent: ${intent}` }
  }
  
  // Get client profile for personalization
  let clientName = senderName || ''
  if (telegramId) {
    const profile = await getClientProfile(sql, telegramId)
    if (profile?.name) {
      clientName = profile.name
    }
  }
  
  // Personalize template
  const vars: Record<string, string> = {
    client_name: clientName ? `, ${clientName}` : '',
    name: clientName || (lang === 'uz' ? 'mijoz' : 'клиент'),
  }
  
  const responseText = personalizeTemplate(template.text, vars)
  
  // Optional delay (from settings)
  const delaySeconds = parseInt(settings['auto_reply_delay_seconds'] || '0')
  if (delaySeconds > 0) {
    await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000))
  }
  
  // Send to Telegram
  const telegramResult = await sendTelegramMessage(telegramChatId, responseText)
  
  if (!telegramResult.ok) {
    return { success: false, reason: 'Telegram send failed: ' + telegramResult.description }
  }
  
  // Save message to database
  const msgId = `msg_auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  await sql`
    INSERT INTO support_messages (
      id, channel_id, telegram_message_id, sender_name, sender_role,
      is_from_client, content_type, text_content, ai_intent, created_at
    ) VALUES (
      ${msgId}, ${channelId}, ${telegramResult.result?.message_id},
      'AI Помощник', 'auto_reply', false, 'text', ${responseText}, ${intent}, NOW()
    )
  `
  
  // Update template usage count
  await sql`
    UPDATE support_auto_templates
    SET usage_count = usage_count + 1
    WHERE intent = ${intent} AND is_active = true
  `.catch(() => {})
  
  // Update channel status
  await sql`
    UPDATE support_channels
    SET awaiting_reply = false
    WHERE id = ${channelId}
  `.catch(() => {})
  
  return { success: true, message: responseText }
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  const sql = getSQL()

  // POST - Process auto-reply
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { channelId, telegramChatId, intent, senderName, telegramId, originalText } = body

      if (!channelId || !telegramChatId || !intent) {
        return json({ error: 'channelId, telegramChatId, and intent required' }, 400)
      }

      console.log(`[Auto-Reply] Processing intent="${intent}" for channel ${channelId}`)

      const result = await processAutoReply(sql, channelId, telegramChatId, intent, senderName, telegramId, originalText)

      console.log(`[Auto-Reply] Result: success=${result.success}, skipped=${result.skipped}`)

      return json(result)

    } catch (error: any) {
      console.error('[Auto-Reply Error]', error)
      return json({ success: false, error: error.message }, 500)
    }
  }

  // GET - List templates or check settings
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    if (action === 'templates') {
      const templates = await sql`
        SELECT id, intent, template_text, tone, language, priority, usage_count, is_active
        FROM support_auto_templates
        ORDER BY intent, priority DESC
      `
      return json({ templates })
    }

    if (action === 'settings') {
      const settings = await getSettings(sql)
      return json({ settings })
    }

    return json({ error: 'Use ?action=templates or ?action=settings' }, 400)
  }

  return json({ error: 'Method not allowed' }, 405)
}
