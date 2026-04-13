import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = { runtime: 'edge' }

// Detect language from recent messages in channel
async function detectChannelLanguage(sql: any, channelId: string, orgId: string): Promise<'ru' | 'uz' | 'en'> {
  const recentMessages = await sql`
    SELECT text_content FROM support_messages
    WHERE channel_id = ${channelId}
      AND org_id = ${orgId}
      AND is_from_client = true
      AND text_content IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 5
  `
  
  const allText = recentMessages.map((m: any) => m.text_content).join(' ')
  const lower = allText.toLowerCase()
  
  // Check Uzbek
  if (/\b(salom|assalomu|rahmat|kerak|qanday|nima|yordam|yaxshi|bormi|yo'q|салом|рахмат|керак|яхши)\b/i.test(lower)) {
    return 'uz'
  }
  
  // Check English
  if (/\b(hello|hi|thanks|please|help|how|what|why|where|problem|issue|order)\b/i.test(lower)) {
    const asciiRatio = allText.replace(/[^a-zA-Z]/g, '').length / Math.max(allText.replace(/\s/g, '').length, 1)
    if (asciiRatio > 0.7) return 'en'
  }
  
  return 'ru'
}

// Get localized messages - natural conversational style
function getLocalizedMessages(lang: 'ru' | 'uz' | 'en') {
  const messages = {
    ru: {
      resolved: '✅ Готово! Подскажите, всё ли работает?\n\nЕсли остались вопросы - пишите, разберёмся.',
      thanks: '🙏 Отлично, рады что помогли! Если что - пишите.',
      reopened: '📋 Понял, сейчас посмотрим ещё раз. Скоро вернёмся с решением.',
    },
    uz: {
      resolved: '✅ Tayyor! Hammasi ishlayaptimi?\n\nSavollar bo\'lsa - yozing, hal qilamiz.',
      thanks: '🙏 Zo\'r, yordam berganimizdan xursandmiz! Kerak bo\'lsa - yozing.',
      reopened: '📋 Tushundim, yana qarab chiqamiz. Tez orada javob beramiz.',
    },
    en: {
      resolved: '✅ Done! Is everything working now?\n\nIf you have any questions - just let us know.',
      thanks: '🙏 Great, glad we could help! Feel free to reach out anytime.',
      reopened: '📋 Got it, we\'ll take another look. We\'ll get back to you shortly.',
    },
  }
  return messages[lang]
}

// Send simple message to Telegram
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

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // ОТКЛЮЧЕНО: Уведомления клиентам в Telegram при изменении статуса тикета
  // Информирование должно работать только внутри системы для сотрудников
  return json({ 
    success: false, 
    skipped: true, 
    reason: 'Client notifications disabled - internal system only' 
  })

  try {
    const sql = getSQL()
    const orgId = await getRequestOrgId(req)
    const { caseId, action } = await req.json()

    if (!caseId) {
      return json({ error: 'caseId required' }, 400)
    }

    // Get case details
    const caseResult = await sql`
      SELECT c.*, ch.telegram_chat_id, ch.name as channel_name
      FROM support_cases c
      LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
      WHERE c.id = ${caseId} AND c.org_id = ${orgId}
    `

    if (caseResult.length === 0) {
      return json({ error: 'Case not found' }, 404)
    }

    const caseData = caseResult[0]
    const telegramChatId = caseData.telegram_chat_id

    if (!telegramChatId) {
      return json({ error: 'No telegram chat associated with this case' }, 400)
    }

    // Detect language
    const lang = await detectChannelLanguage(sql, caseData.channel_id, orgId)
    const messages = getLocalizedMessages(lang)

    // Action: notify - Send natural text message (no buttons)
    if (action === 'notify' || !action) {
      const text = messages.resolved
      
      const result = await sendTelegramMessage(telegramChatId, text)

      if (!result.ok) {
        return json({ error: 'Failed to send Telegram message', details: result }, 500)
      }

      // Save message to DB
      const msgId = `msg_notify_${Date.now()}`
      await sql`
        INSERT INTO support_messages (
          id, channel_id, org_id, telegram_message_id, sender_name, sender_role,
          is_from_client, content_type, text_content, ai_intent, created_at
        ) VALUES (
          ${msgId}, ${caseData.channel_id}, ${orgId}, ${result.result?.message_id},
          'AI Помощник', 'auto_reply', false, 'text', ${text}, 'case_resolved_notify', NOW()
        )
      `

      // Record that we're waiting for feedback
      await sql`
        UPDATE support_cases 
        SET resolution_notes = COALESCE(resolution_notes, '') || '[Awaiting feedback]',
            updated_at = NOW()
        WHERE id = ${caseId} AND org_id = ${orgId}
      `

      return json({ 
        success: true, 
        action: 'notify',
        messageId: result.result?.message_id,
        language: lang
      })
    }

    // Action: feedback_yes - Client confirmed resolved
    if (action === 'feedback_yes') {
      const text = messages.thanks
      
      await sendTelegramMessage(telegramChatId, text)

      // Update case
      await sql`
        UPDATE support_cases 
        SET status = 'resolved',
            resolution_notes = REPLACE(COALESCE(resolution_notes, ''), '[Awaiting feedback]', '[Confirmed resolved by client]'),
            updated_at = NOW()
        WHERE id = ${caseId} AND org_id = ${orgId}
      `

      // Record feedback
      await sql`
        INSERT INTO support_case_activities (id, case_id, type, title, description, created_at)
        VALUES (
          ${'act_' + Date.now()},
          ${caseId},
          'client_feedback',
          'Клиент подтвердил решение',
          'Клиент подтвердил что проблема решена',
          NOW()
        )
      `

      return json({ success: true, action: 'feedback_yes', status: 'resolved' })
    }

    // Action: feedback_no - Client says not resolved, reopen
    if (action === 'feedback_no') {
      const text = messages.reopened
      
      await sendTelegramMessage(telegramChatId, text)

      // Reopen case
      await sql`
        UPDATE support_cases 
        SET status = 'detected',
            priority = CASE WHEN priority = 'low' THEN 'medium' ELSE priority END,
            resolution_notes = REPLACE(COALESCE(resolution_notes, ''), '[Awaiting feedback]', '[Reopened by client]'),
            updated_at = NOW()
        WHERE id = ${caseId} AND org_id = ${orgId}
      `

      // Record escalation
      await sql`
        INSERT INTO support_case_activities (id, case_id, type, title, description, created_at)
        VALUES (
          ${'act_' + Date.now()},
          ${caseId},
          'reopened',
          'Тикет переоткрыт',
          'Клиент сообщил что проблема не решена',
          NOW()
        )
      `

      return json({ success: true, action: 'feedback_no', status: 'reopened' })
    }

    return json({ error: 'Invalid action' }, 400)

  } catch (e: any) {
    console.error('Resolve notify error:', e)
    return json({ error: "Internal server error" }, 500)
  }
}
