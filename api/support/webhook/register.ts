import { getSQL, json, corsHeaders } from '../lib/db.js'
import { getRequestOrgId } from '../lib/org.js'
import { extractAgentContext } from '../lib/auth.js'

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'Unauthorized' }, 401)
  if (!ctx.isOrgAdmin && !ctx.isSuperAdmin) return json({ error: 'Admin access required' }, 403)

  const orgId = await getRequestOrgId(req)
  const sql = getSQL()

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { action } = body

      if (action === 'setup-telegram') {
        const [org] = await sql`
          SELECT telegram_bot_token FROM support_organizations WHERE id = ${orgId}
        `
        const botToken = org?.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN
        if (!botToken) return json({ error: 'Telegram bot token not configured for this organization' }, 400)

        const host = req.headers.get('host') || 'gfsupport.vercel.app'
        const protocol = host.includes('localhost') ? 'http' : 'https'
        const webhookUrl = `${protocol}://${host}/api/support/webhook/telegram?org=${orgId}`

        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: webhookUrl,
            allowed_updates: ['message', 'edited_message', 'message_reaction', 'callback_query'],
            drop_pending_updates: false,
          }),
        })

        const tgData = await tgRes.json() as any

        if (!tgData.ok) {
          return json({ error: 'Telegram API error', details: tgData.description }, 500)
        }

        const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
        const meData = await meRes.json() as any
        const botUsername = meData.result?.username || null

        if (botUsername) {
          await sql`
            UPDATE support_organizations 
            SET telegram_bot_username = ${botUsername}, updated_at = NOW()
            WHERE id = ${orgId}
          `
        }

        return json({
          success: true,
          webhookUrl,
          botUsername,
          message: `Webhook зарегистрирован для @${botUsername || 'bot'}`,
        })
      }

      if (action === 'check-telegram') {
        const [org] = await sql`
          SELECT telegram_bot_token FROM support_organizations WHERE id = ${orgId}
        `
        const botToken = org?.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN
        if (!botToken) return json({ error: 'No bot token' }, 400)

        const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`)
        const info = await infoRes.json() as any

        return json({
          success: true,
          webhook: info.result || null,
        })
      }

      if (action === 'remove-telegram') {
        const [org] = await sql`
          SELECT telegram_bot_token FROM support_organizations WHERE id = ${orgId}
        `
        const botToken = org?.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN
        if (!botToken) return json({ error: 'No bot token' }, 400)

        const res = await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`)
        const data = await res.json() as any

        return json({ success: data.ok, message: 'Webhook removed' })
      }

      return json({ error: 'Unknown action. Use: setup-telegram, check-telegram, remove-telegram' }, 400)
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  if (req.method === 'GET') {
    const [org] = await sql`
      SELECT telegram_bot_token, telegram_bot_username, whatsapp_bridge_url
      FROM support_organizations WHERE id = ${orgId}
    `

    return json({
      orgId,
      telegram: {
        configured: !!(org?.telegram_bot_token),
        botUsername: org?.telegram_bot_username || null,
      },
      whatsapp: {
        configured: !!(org?.whatsapp_bridge_url),
      },
    })
  }

  return json({ error: 'Method not allowed' }, 405)
}
