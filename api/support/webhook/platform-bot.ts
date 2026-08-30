import { getSQL, json, corsHeaders } from '../lib/db.js'
import { handleSalesCallback, handleSalesCommand, handleVoiceNote } from '../lib/sales-bot.js'
import { handleWorkCallback } from '../lib/work-items.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

async function getPlatformBotToken(): Promise<string | null> {
  try {
    const sql = getSQL()
    const [row] = await sql`
      SELECT value FROM support_platform_settings WHERE key = 'platform_bot_token'
    `
    return row?.value || null
  } catch {
    return null
  }
}

async function sendTgMessage(botToken: string, chatId: string | number, text: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  })
}

function generateRegCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: true })

  try {
    const update = await req.json()
    const sqlEarly = getSQL()

    // Продажи: нажатия на карточках лидов и команды сейлза обрабатываются
    // раньше регистрации — это тот же бот, но другая роль (см. lib/sales-bot.ts)
    if (update.callback_query) {
      // Сверка задач (wi:) и карточки продаж (sl:) — один бот, разные роли
      if (await handleWorkCallback(sqlEarly, update)) return json({ ok: true })
      await handleSalesCallback(sqlEarly, update)
      return json({ ok: true })
    }

    const message = update.message
    if (!message) return json({ ok: true })

    if (await handleSalesCommand(sqlEarly, message)) return json({ ok: true })
    // Голосовое после звонка → поля сделки (замена телефонии)
    if (await handleVoiceNote(sqlEarly, message)) return json({ ok: true })

    const chatId = message.chat?.id
    const fromUser = message.from
    if (!chatId || !fromUser) return json({ ok: true })

    const telegramId = String(fromUser.id)
    const username = fromUser.username || null
    const firstName = fromUser.first_name || null
    const text = (message.text || '').trim()

    const sql = getSQL()

    const regCode = generateRegCode()

    await sql`
      INSERT INTO support_platform_users (telegram_id, username, first_name, reg_code, created_at)
      VALUES (${telegramId}, ${username}, ${firstName}, ${regCode}, NOW())
      ON CONFLICT (telegram_id) DO UPDATE SET
        username = COALESCE(${username}, support_platform_users.username),
        first_name = COALESCE(${firstName}, support_platform_users.first_name),
        reg_code = ${regCode}
    `

    if (text === '/start') {
      const botToken = await getPlatformBotToken()
      if (botToken) {
        const greeting = firstName ? `Привет, ${firstName}!` : 'Привет!'
        await sendTgMessage(
          botToken,
          chatId,
          `${greeting} 👋\n\nЯ бот платформы <b>GFSupport</b>.\n\n` +
          `Ваш код для регистрации:\n\n` +
          `🔑 <code>${regCode}</code>\n\n` +
          `Перейдите на <b>gfsupport.uz/signup</b> и введите этот код.\n` +
          `Код подтверждения придёт сюда.`
        )
      }
    }

    return json({ ok: true })
  } catch (e: any) {
    console.error('[PlatformBot] Error:', e)
    return json({ ok: true })
  }
}
