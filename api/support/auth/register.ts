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

      const { telegramUsername, companyName } = body
      if (!telegramUsername || !companyName) {
        return json({ error: 'Укажите Telegram username и название компании' }, 400)
      }

      const cleanUsername = telegramUsername.replace(/^@/, '').toLowerCase().trim()

      const [existingAgent] = await sql`
        SELECT id FROM support_agents WHERE LOWER(username) = ${cleanUsername} LIMIT 1
      `
      if (existingAgent) {
        return json({ error: 'Пользователь с таким username уже существует' }, 409)
      }

      const [platformUser] = await sql`
        SELECT telegram_id, username FROM support_platform_users
        WHERE LOWER(username) = ${cleanUsername} LIMIT 1
      `
      if (!platformUser) {
        const botUsername = await getPlatformBotUsername()
        return json({
          error: `Сначала напишите /start боту @${botUsername} в Telegram`,
          code: 'BOT_NOT_STARTED',
          botUsername,
        }, 400)
      }

      const telegramId = platformUser.telegram_id
      const otp = generateOTP()
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

      await sql`
        INSERT INTO support_otp (email, code, expires_at, company_name, telegram_username)
        VALUES (${cleanUsername}, ${otp}, ${expiresAt}, ${companyName}, ${cleanUsername})
        ON CONFLICT (email) DO UPDATE SET
          code = ${otp}, expires_at = ${expiresAt},
          company_name = ${companyName}, telegram_username = ${cleanUsername},
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
      } else {
        console.log(`[Register] OTP for @${cleanUsername}: ${otp} (no platform bot token set)`)
      }

      return json({ success: true, message: 'OTP отправлен в Telegram', telegramUsername: cleanUsername })
    }

    if (step === 'verify-and-create') {
      const { telegramUsername, code, companyName, password, ownerName } = body
      if (!telegramUsername || !code || !password) {
        return json({ error: 'Укажите telegramUsername, code и password' }, 400)
      }

      const cleanUsername = telegramUsername.replace(/^@/, '').toLowerCase().trim()

      const [otpRow] = await sql`
        SELECT * FROM support_otp WHERE email = ${cleanUsername} LIMIT 1
      `

      if (!otpRow) return json({ error: 'OTP не найден. Запросите новый код.' }, 400)
      if (otpRow.attempts >= 5) return json({ error: 'Слишком много попыток. Запросите новый код.' }, 429)
      if (new Date(otpRow.expires_at) < new Date()) return json({ error: 'Код истёк. Запросите новый.' }, 400)

      await sql`UPDATE support_otp SET attempts = attempts + 1 WHERE email = ${cleanUsername}`

      if (otpRow.code !== code) return json({ error: 'Неверный код' }, 400)

      const name = companyName || otpRow.company_name || cleanUsername
      const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50)

      const existingSlug = await sql`SELECT id FROM support_organizations WHERE slug = ${slug}`
      const finalSlug = existingSlug.length > 0 ? `${slug}-${Date.now().toString(36).slice(-4)}` : slug
      const orgId = `org_${finalSlug}`

      await sql`
        INSERT INTO support_organizations (id, name, slug, plan, is_active, created_at, updated_at)
        VALUES (${orgId}, ${name}, ${finalSlug}, 'starter', true, NOW(), NOW())
      `

      const agentId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const agentName = ownerName || cleanUsername
      const passwordHash = hashPassword(password)

      const [platformUser] = await sql`
        SELECT telegram_id FROM support_platform_users
        WHERE LOWER(username) = ${cleanUsername} LIMIT 1
      `
      const telegramId = platformUser?.telegram_id || null

      await sql`
        INSERT INTO support_agents (id, name, username, role, password_hash, org_id, status, created_at)
        VALUES (${agentId}, ${agentName}, ${cleanUsername}, 'admin', ${passwordHash}, ${orgId}, 'offline', NOW())
      `

      await sql`UPDATE support_organizations SET owner_agent_id = ${agentId} WHERE id = ${orgId}`

      await sql`DELETE FROM support_otp WHERE email = ${cleanUsername}`

      const token = agentId

      writeAuditLog({
        orgId, agentId, action: 'register.complete',
        ip: getClientIP(req),
        details: { telegramUsername: cleanUsername, telegramId, companyName: name },
      })

      return json({
        success: true,
        token,
        agent: {
          id: agentId,
          name: agentName,
          username: cleanUsername,
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
