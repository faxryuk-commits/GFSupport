import { getSQL, json, corsHeaders } from '../lib/db.js'
import { checkAuthRateLimit } from '../lib/rate-limit.js'
import { writeAuditLog, getClientIP } from '../lib/audit.js'

export const config = { runtime: 'edge' }

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

function hashPassword(password: string): string {
  let hash = 0
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return `hash_${Math.abs(hash).toString(36)}_${password.length}`
}

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

async function getPlatformBotUsername(): Promise<string> {
  try {
    const sql = getSQL()
    const [row] = await sql`
      SELECT value FROM support_platform_settings WHERE key = 'platform_bot_username'
    `
    return row?.value || 'gfsupport_bot'
  } catch {
    return 'gfsupport_bot'
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const sql = getSQL()

  try {
    const body = await req.json()
    const { step } = body

    if (step === 'get-bot-username') {
      const botUsername = await getPlatformBotUsername()
      return json({ botUsername })
    }

    if (step === 'request-otp') {
      const ip = getClientIP(req)
      const rateCheck = checkAuthRateLimit(ip)
      if (!rateCheck.allowed) {
        return json({ error: 'Слишком много запросов. Попробуйте позже.' }, 429)
      }

      const { regCode, companyName, ownerName } = body
      if (!regCode || !companyName) {
        return json({ error: 'Укажите код из бота и название компании' }, 400)
      }

      const cleanCode = regCode.trim()

      const [platformUser] = await sql`
        SELECT telegram_id, username, first_name FROM support_platform_users
        WHERE reg_code = ${cleanCode} LIMIT 1
      `
      if (!platformUser) {
        const botUsername = await getPlatformBotUsername()
        return json({
          error: `Код не найден. Отправьте /start боту @${botUsername} и используйте полученный код.`,
          code: 'INVALID_CODE',
          botUsername,
        }, 400)
      }

      const telegramId = platformUser.telegram_id
      const displayName = platformUser.username || platformUser.first_name || telegramId

      const [existingAgent] = await sql`
        SELECT id FROM support_agents WHERE telegram_id = ${telegramId} LIMIT 1
      `
      if (existingAgent) {
        return json({ error: 'Этот Telegram аккаунт уже зарегистрирован' }, 409)
      }

      const otp = generateOTP()
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

      await sql`
        INSERT INTO support_otp (email, code, expires_at, company_name, telegram_username)
        VALUES (${telegramId}, ${otp}, ${expiresAt}, ${companyName}, ${displayName})
        ON CONFLICT (email) DO UPDATE SET
          code = ${otp}, expires_at = ${expiresAt},
          company_name = ${companyName}, telegram_username = ${displayName},
          attempts = 0
      `

      const botToken = await getPlatformBotToken()
      if (botToken) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramId,
            text: `🔐 Код подтверждения для регистрации компании «${companyName}»:\n\n<b>${otp}</b>\n\nКод действителен 10 минут.`,
            parse_mode: 'HTML',
          }),
        })
      }

      return json({ success: true, message: 'OTP отправлен в Telegram', telegramId, displayName })
    }

    if (step === 'verify-and-create') {
      const { regCode, code, companyName, password, ownerName } = body
      if (!regCode || !code || !password) {
        return json({ error: 'Укажите код из бота, OTP-код и пароль' }, 400)
      }

      const cleanCode = regCode.trim()

      const [platformUser] = await sql`
        SELECT telegram_id, username, first_name FROM support_platform_users
        WHERE reg_code = ${cleanCode} LIMIT 1
      `
      if (!platformUser) return json({ error: 'Код из бота не найден' }, 400)

      const telegramId = platformUser.telegram_id

      const [otpRow] = await sql`
        SELECT * FROM support_otp WHERE email = ${telegramId} LIMIT 1
      `

      if (!otpRow) return json({ error: 'OTP не найден. Запросите новый код.' }, 400)
      if (otpRow.attempts >= 5) return json({ error: 'Слишком много попыток. Запросите новый код.' }, 429)
      if (new Date(otpRow.expires_at) < new Date()) return json({ error: 'Код истёк. Запросите новый.' }, 400)

      await sql`UPDATE support_otp SET attempts = attempts + 1 WHERE email = ${telegramId}`

      if (otpRow.code !== code) return json({ error: 'Неверный код' }, 400)

      const name = companyName || otpRow.company_name || 'Моя компания'
      const slug = name.toLowerCase().replace(/[^a-z0-9а-яё]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50)

      const existingSlug = await sql`SELECT id FROM support_organizations WHERE slug = ${slug}`
      const finalSlug = existingSlug.length > 0 ? `${slug}-${Date.now().toString(36).slice(-4)}` : slug
      const orgId = `org_${finalSlug}`

      await sql`
        INSERT INTO support_organizations (id, name, slug, plan, is_active, created_at, updated_at)
        VALUES (${orgId}, ${name}, ${finalSlug}, 'starter', true, NOW(), NOW())
      `

      const agentId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const agentName = ownerName || platformUser.first_name || platformUser.username || 'Администратор'
      const agentUsername = platformUser.username || `user_${telegramId.slice(-6)}`
      const passwordHash = hashPassword(password)

      await sql`
        INSERT INTO support_agents (id, name, username, role, password_hash, org_id, status, telegram_id, created_at)
        VALUES (${agentId}, ${agentName}, ${agentUsername}, 'admin', ${passwordHash}, ${orgId}, 'offline', ${telegramId}, NOW())
      `

      await sql`UPDATE support_organizations SET owner_agent_id = ${agentId} WHERE id = ${orgId}`

      await sql`DELETE FROM support_otp WHERE email = ${telegramId}`
      await sql`UPDATE support_platform_users SET reg_code = NULL WHERE telegram_id = ${telegramId}`

      const token = agentId

      writeAuditLog({
        orgId, agentId, action: 'register.complete',
        ip: getClientIP(req),
        details: { telegramId, companyName: name },
      })

      return json({
        success: true,
        token,
        agent: {
          id: agentId,
          name: agentName,
          username: agentUsername,
          role: 'admin',
          status: 'online',
          orgId,
        },
        org: {
          id: orgId,
          name,
          slug: finalSlug,
          plan: 'starter',
        },
        message: `Организация "${name}" создана! Вы вошли как администратор.`,
      })
    }

    return json({ error: 'Unknown step. Use: get-bot-username, request-otp, verify-and-create' }, 400)
  } catch (e: any) {
    console.error('[Register]', e)
    return json({ error: e.message }, 500)
  }
}
