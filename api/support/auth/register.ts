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

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const sql = getSQL()

  try {
    const body = await req.json()
    const { step } = body

    // Step 1: Request OTP
    if (step === 'request-otp') {
      const ip = getClientIP(req)
      const rateCheck = checkAuthRateLimit(ip)
      if (!rateCheck.allowed) {
        return json({ error: 'Слишком много запросов. Попробуйте позже.' }, 429)
      }

      const { email, companyName } = body
      if (!email || !companyName) return json({ error: 'email and companyName are required' }, 400)

      const emailLower = email.toLowerCase().trim()

      const existing = await sql`
        SELECT id FROM support_agents WHERE LOWER(email) = ${emailLower} LIMIT 1
      `
      if (existing.length > 0) return json({ error: 'Пользователь с таким email уже существует' }, 409)

      const otp = generateOTP()
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

      await sql`
        INSERT INTO support_otp (email, code, expires_at, company_name)
        VALUES (${emailLower}, ${otp}, ${expiresAt}, ${companyName})
        ON CONFLICT (email) DO UPDATE SET code = ${otp}, expires_at = ${expiresAt}, company_name = ${companyName}, attempts = 0
      `

      // Send OTP via Resend (or log for dev)
      const resendKey = process.env.RESEND_API_KEY
      if (resendKey) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'GFSupport <noreply@gfsupport.app>',
              to: emailLower,
              subject: `Код подтверждения: ${otp}`,
              html: `
                <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
                  <h2 style="color: #1e293b;">Добро пожаловать в GFSupport!</h2>
                  <p style="color: #475569;">Ваш код подтверждения для регистрации компании <strong>${companyName}</strong>:</p>
                  <div style="background: #f1f5f9; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e293b;">${otp}</span>
                  </div>
                  <p style="color: #94a3b8; font-size: 14px;">Код действителен 10 минут.</p>
                </div>
              `,
            }),
          })
        } catch (e) {
          console.error('[Register] Failed to send email:', e)
        }
      } else {
        console.log(`[Register] OTP for ${emailLower}: ${otp} (no RESEND_API_KEY set)`)
      }

      return json({ success: true, message: 'OTP sent to email', email: emailLower })
    }

    // Step 2: Verify OTP & Create Org
    if (step === 'verify-and-create') {
      const { email, code, companyName, password, ownerName } = body
      if (!email || !code || !password) return json({ error: 'email, code, and password are required' }, 400)

      const emailLower = email.toLowerCase().trim()

      const [otpRow] = await sql`
        SELECT * FROM support_otp WHERE email = ${emailLower} LIMIT 1
      `

      if (!otpRow) return json({ error: 'OTP не найден. Запросите новый код.' }, 400)
      if (otpRow.attempts >= 5) return json({ error: 'Слишком много попыток. Запросите новый код.' }, 429)
      if (new Date(otpRow.expires_at) < new Date()) return json({ error: 'Код истёк. Запросите новый.' }, 400)

      await sql`UPDATE support_otp SET attempts = attempts + 1 WHERE email = ${emailLower}`

      if (otpRow.code !== code) return json({ error: 'Неверный код' }, 400)

      // OTP verified — create org + admin agent
      const name = companyName || otpRow.company_name || emailLower.split('@')[0]
      const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50)

      const existingSlug = await sql`SELECT id FROM support_organizations WHERE slug = ${slug}`
      const finalSlug = existingSlug.length > 0 ? `${slug}-${Date.now().toString(36).slice(-4)}` : slug
      const orgId = `org_${finalSlug}`

      await sql`
        INSERT INTO support_organizations (id, name, slug, plan, is_active, created_at, updated_at)
        VALUES (${orgId}, ${name}, ${finalSlug}, 'starter', true, NOW(), NOW())
      `

      const agentId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const agentName = ownerName || emailLower.split('@')[0]
      const passwordHash = hashPassword(password)

      await sql`
        INSERT INTO support_agents (id, name, username, email, role, password_hash, org_id, status, created_at)
        VALUES (${agentId}, ${agentName}, ${emailLower}, ${emailLower}, 'admin', ${passwordHash}, ${orgId}, 'offline', NOW())
      `

      await sql`UPDATE support_organizations SET owner_agent_id = ${agentId} WHERE id = ${orgId}`

      // Cleanup OTP
      await sql`DELETE FROM support_otp WHERE email = ${emailLower}`

      // Generate token
      const token = `agent_${agentId}_${Date.now().toString(36)}`

      writeAuditLog({ orgId, agentId, action: 'register.complete', ip: getClientIP(req), details: { email: emailLower, companyName: name } })

      return json({
        success: true,
        token,
        agent: {
          id: agentId,
          name: agentName,
          username: emailLower,
          email: emailLower,
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

    return json({ error: 'Unknown step. Use: request-otp, verify-and-create' }, 400)
  } catch (e: any) {
    console.error('[Register]', e)
    return json({ error: e.message }, 500)
  }
}
